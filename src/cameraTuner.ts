// Ajuste automático da câmera ao nosso uso.
//
// POR QUE EXISTE
//
// A webcam do posto de referência tem 90° de campo de visão: ótimo para
// videochamada, péssimo para rastreamento ocular. Medido nas gravações reais,
// isso espalha 91 cm de cena pelo frame, o rosto ocupa ~16% da largura, e o
// deslocamento da íris — o sinal ÚTIL do pipeline inteiro — vale 6,8 px para a
// tela toda. A relação medida é de 141 px de TELA por 1 px de CÂMERA.
//
// Pedir ao cuidador que configure zoom, brilho e exposição no painel do
// Windows é inviável: ele não sabe qual valor serve, e o valor certo depende
// da distância em que o paciente sentou hoje. Mas o pipeline JÁ mede o tamanho
// do rosto no frame a cada quadro — dá para fechar a malha e deixar o programa
// procurar o ajuste sozinho.
//
// Este módulo é a parte que decide; o adaptador que fala com a
// `MediaStreamTrack` fica em `cameraControl.ts`. Separado porque a lei de
// controle é o que precisa de teste, e testar isso através de uma webcam real
// seria não-determinístico.
//
// ⚠️ LIMITE HONESTO: `zoom` é uma constraint opcional do padrão e depende do
// driver. Quando ela não existe, este módulo não finge — reporta que o ajuste
// tem de ser físico (aproximar a câmera) e não inventa outro caminho.

import { CANTHAL_DISTANCE_CM, fovHorizontalDeg } from './anthropometry';

export interface CapabilityRange {
  min: number;
  max: number;
  step?: number;
}

/** Subconjunto de `MediaTrackCapabilities` que sabemos usar. */
export interface CameraCapabilities {
  zoom?: CapabilityRange;
  brightness?: CapabilityRange;
  contrast?: CapabilityRange;
  exposureMode?: readonly string[];
  focusMode?: readonly string[];
  whiteBalanceMode?: readonly string[];
  /** Frequência da rede que a câmera usa para cancelar cintilação. Quando o
   *  driver expõe, é a correção certa para o batimento que `flickerDetector`
   *  enxerga — melhor que pedir ao cuidador para trocar de lâmpada. */
  powerLineFrequency?: readonly number[];
  /** Tempo de exposição em unidades de 100 µs (convenção do padrão). Só é
   *  gravável com `exposureMode: 'manual'`. */
  exposureTime?: CapabilityRange;
  /** Compensação de exposição em EV. Alternativa quando o driver não expõe o
   *  tempo absoluto. */
  exposureCompensation?: CapabilityRange;
}

/** Valores atualmente aplicados (de `track.getSettings()`). */
export interface CameraState {
  zoom?: number;
  brightness?: number;
  contrast?: number;
  exposureMode?: string;
  focusMode?: string;
  whiteBalanceMode?: string;
  powerLineFrequency?: number;
  exposureTime?: number;
  exposureCompensation?: number;
}

export interface TuningMeasurement {
  hasFace: boolean;
  /** iodPx / videoWidth — densidade do rosto, independente de resolução. */
  iodFraction: number;
  /**
   * Brilho medido no crop ocular, 0..1 — ou `undefined` quando NÃO foi
   * medido (bbox degenerada, canvas tainted). Tratar isso como `0` faria o
   * planner concluir "imagem preta, aumente o brilho ao máximo" a partir de
   * uma ausência de leitura.
   */
  brightness?: number;
  /** Contraste medido no crop ocular, 0..1, ou `undefined` se não medido. */
  contrast?: number;
}

export interface TuningTarget {
  iodFraction: number;
  brightness: number;
  contrast: number;
}

/**
 * Alvo de densidade do rosto no frame.
 *
 * A gravação que produziu 115 px de erro tinha 0,099. Como o erro escala com o
 * inverso desta fração, 0,20 corresponde a ~2× menos erro de landmark. Não vai
 * mais alto porque acima de ~0,32 o rosto começa a encostar nas bordas quando
 * o paciente se mexe, e perder o rosto custa mais que ganhar densidade.
 */
export const TARGET_IOD_FRACTION = 0.20;

/** Alvo de brilho no crop ocular. Medido 0,236 nas duas gravações reais. */
export const TARGET_BRIGHTNESS = 0.45;

/**
 * Alvo de contraste no crop ocular. Medido 0,094–0,107 nas duas gravações.
 *
 * Contraste é o que separa íris de esclera; com pouco, a borda fica mole e o
 * landmark escorrega. 0,20 é o dobro do medido e ainda longe de saturar.
 */
export const TARGET_CONTRAST = 0.20;

export const DEFAULT_TARGET: TuningTarget = {
  iodFraction: TARGET_IOD_FRACTION,
  brightness: TARGET_BRIGHTNESS,
  contrast: TARGET_CONTRAST,
};

/** Tolerância relativa para considerar a densidade convergida. */
const IOD_TOLERANCE = 0.12;
/** Faixa morta do brilho — perseguir precisão maior só faz a exposição caçar. */
const BRIGHTNESS_DEADBAND = 0.08;
/** Passo máximo de zoom por iteração, como fração do valor atual. Amortece a
 *  malha: a relação zoom↔tamanho do rosto é quase linear, mas nem todo driver
 *  respeita a escala, e passo grande faz oscilar. */
const MAX_ZOOM_STEP_RATIO = 0.25;
/** Fração da faixa de brilho aplicada por iteração. */
const BRIGHTNESS_STEP_RATIO = 0.15;
/** Faixa morta e passo do contraste. Mesma lógica do brilho. */
const CONTRAST_DEADBAND = 0.05;
const CONTRAST_STEP_RATIO = 0.15;

function clampToRange(value: number, range: CapabilityRange): number {
  const v = Math.min(range.max, Math.max(range.min, value));
  if (!range.step || range.step <= 0) return v;
  const snapped = range.min + Math.round((v - range.min) / range.step) * range.step;
  return Math.min(range.max, Math.max(range.min, snapped));
}

/**
 * Snap à grade do driver SEM ultrapassar o alvo amortecido.
 *
 * `Math.round` da grade pode empurrar acima do limite de amortecimento (zoom
 * 1,25 com passo 0,1 arredondaria para 1,3), o que anula a proteção contra
 * oscilação. Aqui o arredondamento é sempre no sentido conservador.
 *
 * Caso de borda: com passo grosso, arredondar para trás pode não sair do lugar
 * e travar a malha. Quando isso acontece e ainda há folga na faixa, damos
 * exatamente UM passo — o menor movimento que o driver aceita.
 */
function snapTowards(bounded: number, current: number, range: CapabilityRange): number {
  if (!range.step || range.step <= 0) {
    return Math.min(range.max, Math.max(range.min, bounded));
  }
  const up = bounded > current;
  const raw = (bounded - range.min) / range.step;
  const idx = up ? Math.floor(raw + 1e-9) : Math.ceil(raw - 1e-9);
  let next = Math.min(range.max, Math.max(range.min, range.min + idx * range.step));

  if (Math.abs(next - current) < 1e-9 && Math.abs(bounded - current) > 1e-9) {
    const oneStep = current + (up ? range.step : -range.step);
    if (oneStep >= range.min - 1e-9 && oneStep <= range.max + 1e-9) {
      next = Math.min(range.max, Math.max(range.min, oneStep));
    }
  }
  return next;
}

export interface TuningStep {
  /** Constraints a aplicar. Vazio quando nada há a fazer. */
  constraints: Record<string, number | string>;
  /** Por que cada ajuste — texto de log/diagnóstico, não de UI. */
  reasons: string[];
  /** Medidas já dentro do alvo. */
  converged: boolean;
  /** Algum eixo bateu no limite do hardware e ainda não chegou no alvo. Quando
   *  true, o ganho restante só vem de ação física do cuidador. */
  atLimit: boolean;
  /** Ação física necessária, quando o software esgotou o que podia. */
  physicalAdvice: string | null;
}

/**
 * Calcula UM passo de ajuste. O chamador aplica, espera o driver assentar,
 * mede de novo e chama outra vez — malha fechada.
 *
 * Só age com rosto presente: sem rosto, `iodFraction` não significa nada e
 * ajustar zoom às cegas afastaria do alvo.
 */
export function planTuningStep(
  caps: CameraCapabilities,
  state: CameraState,
  measured: TuningMeasurement,
  target: TuningTarget = DEFAULT_TARGET,
): TuningStep {
  const constraints: Record<string, number | string> = {};
  const reasons: string[] = [];
  let atLimit = false;
  let physicalAdvice: string | null = null;

  if (!measured.hasFace || !(measured.iodFraction > 0)) {
    return {
      constraints: {},
      reasons: ['sem rosto detectado — ajuste suspenso'],
      converged: false,
      atLimit: false,
      physicalAdvice: null,
    };
  }

  // ── densidade do rosto (zoom) ──────────────────────────────────────────
  const iodErrorRatio = target.iodFraction / measured.iodFraction;
  const iodConverged = Math.abs(measured.iodFraction - target.iodFraction) / target.iodFraction <= IOD_TOLERANCE;

  if (!iodConverged) {
    if (caps.zoom) {
      // Piso positivo para a lei multiplicativa: `state.zoom` é `undefined`
      // em vários drivers e `zoom.min` costuma ser 0, e com `current = 0` o
      // passo proporcional nunca sai do lugar (e o app concluiria "zoom no
      // máximo"). O piso é o menor valor POSITIVO representável: o passo do
      // driver quando existe, senão 1% da amplitude.
      const pisoPositivo = caps.zoom.min > 0
        ? caps.zoom.min
        : (caps.zoom.step && caps.zoom.step > 0
            ? caps.zoom.step
            : Math.max(1e-6, (caps.zoom.max - caps.zoom.min) * 0.01));
      const bruto = state.zoom ?? caps.zoom.min;
      const current = bruto > 0 ? bruto : pisoPositivo;
      const desired = current * iodErrorRatio;
      // Amortecimento: nunca mais que MAX_ZOOM_STEP_RATIO por iteração.
      const maxStep = current * MAX_ZOOM_STEP_RATIO;
      const bounded = Math.min(current + maxStep, Math.max(current - maxStep, desired));
      const next = snapTowards(bounded, current, caps.zoom);
      if (Math.abs(next - current) > 1e-9) {
        constraints.zoom = next;
        reasons.push(
          `zoom ${current.toFixed(2)} → ${next.toFixed(2)} ` +
          `(rosto ocupa ${(measured.iodFraction * 100).toFixed(1)}% do frame, alvo ${(target.iodFraction * 100).toFixed(0)}%)`,
        );
      } else {
        atLimit = true;
        physicalAdvice = measured.iodFraction < target.iodFraction
          ? 'Zoom no máximo e o rosto ainda está pequeno. Aproxime a CÂMERA do rosto — mantenha a tela onde está.'
          : 'Zoom no mínimo e o rosto ainda está grande. Afaste um pouco a câmera.';
        reasons.push(`zoom no limite (${current.toFixed(2)})`);
      }
    } else {
      atLimit = true;
      physicalAdvice = measured.iodFraction < target.iodFraction
        ? 'Esta câmera não expõe controle de zoom. Aproxime a CÂMERA do rosto — mantenha a tela onde está.'
        : 'Esta câmera não expõe controle de zoom. Afaste um pouco a câmera.';
      reasons.push('driver não expõe zoom');
    }
  }

  // ── brilho ─────────────────────────────────────────────────────────────
  // Sem medição, o eixo é PULADO em vez de tratado como zero (ver
  // `TuningMeasurement.brightness`).
  const brilhoMedido = measured.brightness;
  const temBrilho = typeof brilhoMedido === 'number' && Number.isFinite(brilhoMedido);
  if (!temBrilho) reasons.push('brilho não medido — eixo de brilho ignorado neste passo');
  // Sem medida não há como afirmar convergência; tratar como convergido
  // impediria a malha de agir quando a medição voltasse, então o passo
  // simplesmente não mexe neste eixo e a malha tenta de novo no próximo frame.
  const brightnessConverged = temBrilho
    ? Math.abs(brilhoMedido - target.brightness) <= BRIGHTNESS_DEADBAND
    : false;
  if (temBrilho && !brightnessConverged && caps.brightness) {
    const range = caps.brightness;
    const current = state.brightness ?? (range.min + range.max) / 2;
    // Ganho PROPORCIONAL ao erro: com passo fixo a malha ultrapassava o alvo
    // de perto e demorava de longe, oscilando em torno da faixa morta.
    // `BRIGHTNESS_STEP_RATIO` é o passo MÁXIMO.
    const erro = target.brightness - brilhoMedido;
    const fracaoDoErro = Math.min(1, Math.abs(erro) / Math.max(target.brightness, 1e-6));
    const dir = erro > 0 ? 1 : -1;
    const passo = (range.max - range.min) * BRIGHTNESS_STEP_RATIO * fracaoDoErro;
    const next = clampToRange(current + dir * passo, range);
    if (Math.abs(next - current) > 1e-9) {
      constraints.brightness = next;
      reasons.push(
        `brilho ${current.toFixed(1)} → ${next.toFixed(1)} ` +
        `(crop ocular em ${brilhoMedido.toFixed(3)}, alvo ${target.brightness.toFixed(2)})`,
      );
    } else if (brilhoMedido < target.brightness) {
      atLimit = true;
      physicalAdvice = physicalAdvice ??
        'Brilho da câmera no máximo e o rosto ainda escuro. Ilumine de FRENTE, com luminária difusa atrás do monitor.';
    }
  } else if (temBrilho && !brightnessConverged && !caps.brightness && brilhoMedido < target.brightness) {
    atLimit = true;
    physicalAdvice = physicalAdvice ??
      'Esta câmera não expõe controle de brilho. Ilumine o rosto de FRENTE, com luminária difusa atrás do monitor.';
  }

  // ── contraste ──────────────────────────────────────────────────────────
  // Desacoplado da convergência do brilho: condicionar um eixo ao outro
  // deixava o contraste congelado sempre que o brilho oscilava. A oscilação
  // cruzada (em muitos drivers o contraste altera o brilho aparente) é
  // tratada pelo ganho proporcional e pelas faixas mortas; se sobrar
  // acoplamento, o lugar de resolver é a constante de passo.
  // Sem medida, o eixo é pulado, como no brilho.
  const contrasteMedido = measured.contrast;
  const temContraste = typeof contrasteMedido === 'number' && Number.isFinite(contrasteMedido);
  if (!temContraste) reasons.push('contraste não medido — eixo de contraste ignorado neste passo');
  const contrastConverged = temContraste
    ? Math.abs(contrasteMedido - target.contrast) <= CONTRAST_DEADBAND
    : false;
  if (temContraste && !contrastConverged && caps.contrast) {
    const range = caps.contrast;
    const current = state.contrast ?? (range.min + range.max) / 2;
    const dir = contrasteMedido < target.contrast ? 1 : -1;
    const bounded = current + dir * (range.max - range.min) * CONTRAST_STEP_RATIO;
    const next = snapTowards(bounded, current, range);
    if (Math.abs(next - current) > 1e-9) {
      constraints.contrast = next;
      reasons.push(
        `contraste ${current.toFixed(1)} → ${next.toFixed(1)} ` +
        `(crop ocular em ${contrasteMedido.toFixed(3)}, alvo ${target.contrast.toFixed(2)})`,
      );
    } else if (contrasteMedido < target.contrast) {
      atLimit = true;
      physicalAdvice = physicalAdvice ??
        'Contraste da câmera no máximo e a borda da íris continua mole. Melhore a luz frontal.';
    }
  } else if (temContraste && !contrastConverged && !caps.contrast && contrasteMedido < target.contrast) {
    atLimit = true;
    physicalAdvice = physicalAdvice ??
      'Esta câmera não expõe controle de contraste. Melhore a luz frontal e desligue a correção automática de luz no painel da webcam.';
  }

  return {
    constraints,
    reasons,
    converged: iodConverged && brightnessConverged && contrastConverged,
    atLimit,
    physicalAdvice,
  };
}

/**
 * Constraints de estabilização, aplicadas UMA vez depois que a imagem
 * convergiu.
 *
 * Motivo: a correção automática de luz da webcam reajusta exposição e balanço
 * de branco continuamente, e cada reajuste muda o contraste da borda da íris —
 * que é exatamente o que o landmark usa para se posicionar. Sobre um sinal de
 * ~7 px, essa oscilação pesa. Travar depois da convergência mantém o benefício
 * da auto-exposição (achar o ponto certo) sem o custo (ficar caçando).
 *
 * Só devolve modos que o driver declarou suportar — pedir um modo inexistente
 * faz `applyConstraints` rejeitar o lote inteiro, inclusive o que funcionaria.
 */
export function planStabilizationStep(
  caps: CameraCapabilities,
  /** Rede inferida pelo `flickerDetector`. Quando presente e suportada pelo
   *  driver, corrigir aqui elimina o batimento na origem — melhor que pedir ao
   *  cuidador para trocar a lâmpada. */
  powerLineHz?: 50 | 60 | null,
): TuningStep {
  const constraints: Record<string, number | string> = {};
  const reasons: string[] = [];
  if (powerLineHz && caps.powerLineFrequency?.includes(powerLineHz)) {
    constraints.powerLineFrequency = powerLineHz;
    reasons.push(`powerLineFrequency → ${powerLineHz} Hz (cintilação detectada)`);
  }
  const want: [keyof CameraCapabilities, string][] = [
    ['exposureMode', 'manual'],
    ['whiteBalanceMode', 'manual'],
    ['focusMode', 'manual'],
  ];
  for (const [key, mode] of want) {
    const supported = caps[key] as readonly string[] | undefined;
    if (supported?.includes(mode)) {
      constraints[key] = mode;
      reasons.push(`${key} → ${mode}`);
    }
  }
  return {
    constraints,
    reasons: reasons.length ? reasons : ['driver não expõe modos manuais — exposição segue automática'],
    converged: true,
    atLimit: reasons.length === 0,
    physicalAdvice: reasons.length === 0
      ? 'Se a webcam tiver painel próprio, desligue a "correção automática de luz" por lá.'
      : null,
  };
}

/**
 * Campo de visão horizontal a partir de uma medição conhecida.
 *
 * Nenhuma API do browser expõe o FOV. Mas se o cuidador medir a distância UMA
 * vez com fita métrica, a geometria devolve o FOV — e a partir daí o programa
 * estima a distância sozinho em toda sessão futura, que é o que o indicador
 * de distância precisa.
 *
 * `iodPx` e `videoWidth` do mesmo frame; `distanceCm` medida de verdade.
 */
export function deriveHorizontalFovDeg(
  iodPx: number,
  videoWidth: number,
  distanceCm: number,
  canthalDistanceCm: number = CANTHAL_DISTANCE_CM,
): number | null {
  return fovHorizontalDeg(iodPx, videoWidth, distanceCm, canthalDistanceCm);
}
