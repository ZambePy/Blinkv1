// Avaliação do posto de uso ANTES da calibração.
//
// POR QUE EXISTE
//
// A maior fonte de erro não-modelada do pipeline está no setup, e ele varia
// entre sessões sem ninguém perceber. O sinal útil é o deslocamento da íris no
// frame — medido em 6,8 px para a tela toda a 1280×720. Tudo que reduz pixels
// no olho ou desloca a cabeça consome esse orçamento minúsculo.
//
// Este módulo transforma sinais que o pipeline JÁ calcula (qualityAnalyzer,
// faceMatrix, landmarks) num veredito legível, para a tela de pré-calibração
// corrigir o setup antes de gastar 30 s de coleta com dado ruim.
//
// É puro e sem DOM de propósito: os limiares são a parte que precisa de teste,
// e testar UI para verificar um limiar é caro e frágil.
//
// Os limiares vêm de poucas instalações. São defensáveis porque derivam de
// medições, não de palpite, mas a faixa "ideal" precisa de re-medição com mais
// usuários.

/** Estado de um item da checagem. `unknown` = ainda sem dado (rosto ausente). */
export type CheckStatus = 'ok' | 'warn' | 'fail' | 'unknown';

export type CheckId =
  | 'face'
  | 'distanceRange'
  | 'flicker'
  | 'viewport'
  | 'resolution'
  | 'distance'
  | 'centering'
  | 'headPose'
  | 'lighting'
  | 'contraluz'
  | 'contrast'
  | 'glasses';

export interface ReadinessCheck {
  id: CheckId;
  status: CheckStatus;
  /** Valor medido na unidade que a mensagem cita. `null` quando indisponível. */
  value: number | null;
  /** Texto curto e ACIONÁVEL para o cuidador — o que fazer, não o que houve. */
  message: string;
}

/** Sinais de um frame. Todos já existem no `EngineDiagnostics`. */
export interface ReadinessSnapshot {
  hasFace: boolean;
  /** Distância entre os cantos externos dos olhos, em px de VÍDEO. */
  iod: number;
  videoWidth: number;
  videoHeight: number;
  /** Centro do rosto em coordenadas normalizadas do frame [0..1]. */
  faceCenter: { x: number; y: number };
  pose: { yaw: number; pitch: number; roll: number };
  brightness: number;
  contrast: number;
  /**
   * Razão entre a luminância do fundo e a do rosto, medida no quadro inteiro.
   *
   * Separada de `brightness` porque mede outra coisa: `brightness` é o crop
   * ocular DEPOIS da exposição automática, e é por isso que ele não enxerga
   * uma janela às costas do paciente. `undefined` = ainda não medido.
   */
  contraluz?: { razao: number; nivel: 'indefinido' | 'ok' | 'atencao' | 'forte' } | undefined;
  detectorConfidence: number;
  specularRatio: number;
  /**
   * Quanto a mancha de brilho fica PARADA entre quadros (Jaccard, 0..1).
   *
   * É o que separa assinatura de óculos de reflexo nocivo. Ver o bloco da
   * checagem `glasses` para por que a persistência sozinha não servia.
   */
  specularStability?: number;
  /** Fração dos frames da janela com reflexo acima do limiar. Só o agregado
   *  preenche. Distingue reflexo PERSISTENTE de lente (que atrapalha a sessão
   *  inteira) de brilho passageiro — um pisca-pisca não deve acusar óculos. */
  specularPersistence?: number;
  /** Viewport da janela do app, em px CSS. */
  viewportWidth?: number;
  viewportHeight?: number;
  /** Resolução da tela, em px CSS (`window.screen`). */
  screenWidth?: number;
  screenHeight?: number;
}

/** Sinais que não vêm de um frame só. */
export interface ReadinessContext {
  /** Faixa de distância em relação à calibração. Quando presente vira uma
   *  checagem própria: "dentro da faixa" (compensado) vs "fora". */
  distanceRange?: {
    status: 'ok' | 'warn' | 'out' | 'unknown';
    deltaCm: number | null;
    message: string;
  } | null;
  /** Campo de visão horizontal da câmera. Habilita a estimativa de
   *  distância e o alvo de posicionamento. */
  horizontalFovDeg?: number | null;
  /** Veredito do `flickerDetector` sobre a série de brilho. */
  flicker?: { detected: boolean; dominantHz: number; relativeAmplitude: number } | null;
  /** Rede elétrica inferida, quando a cintilação casa com 50 ou 60 Hz. */
  powerLineHz?: 50 | 60 | null;
}

export interface ReadinessReport {
  checks: ReadinessCheck[];
  /** Nenhum item em `fail`. Avisos (`warn`) NÃO bloqueiam. */
  canStart: boolean;
  /** `fail` que torna a calibração impossível, não apenas pior. */
  blockedHard: boolean;
  /** Resumo medido, para o relatório da sessão substituir os hardcodes. */
  measured: {
    /** iod / videoWidth. Métrica de densidade independente de resolução. */
    iodFraction: number;
    /** Só quando o campo de visão da câmera é conhecido. */
    estimatedDistanceCm: number | null;
    brightness: number;
    contrast: number;
    /** Reflexo especular persistente — assinatura de lente de óculos. */
    glassesLikely: boolean;
    /** Distância em que o rosto atingiria o tamanho-alvo no frame. `null` sem
     *  campo de visão conhecido. É o número que a tela mostra ao usuário. */
    idealDistanceCm: number | null;
  };
}

// ─── Limiares ────────────────────────────────────────────────────────────────

// Densidade do rosto no frame. A gravação que produziu 115 px de erro tinha
// iodFraction = 127/1280 = 0,099. O erro escala com o inverso desta fração,
// então 0,099 é explicitamente a faixa RUIM, não a aceitável.
const IOD_FRACTION_FAIL_LOW = 0.06;   // rosto pequeno demais: nada a fazer no software
const IOD_FRACTION_WARN_LOW = 0.13;   // ~1,3× melhor que a medição de 115 px
const IOD_FRACTION_WARN_HIGH = 0.32;  // rosto grande demais começa a sair do frame
const IOD_FRACTION_FAIL_HIGH = 0.42;

// Enquadramento. Fora disto o rosto encosta na borda e os landmarks degradam.
const CENTER_TOLERANCE_WARN = 0.14;
const CENTER_TOLERANCE_FAIL = 0.24;

// Pose. A diferença de 9° de pitch entre as duas gravações reais é maior que
// boa parte do erro que o pipeline tenta corrigir — daí o rigor aqui.
const POSE_WARN_RAD = 0.12;   // ~6,9°
const POSE_FAIL_RAD = 0.26;   // ~15°
const ROLL_WARN_RAD = 0.09;   // ~5,2°
const ROLL_FAIL_RAD = 0.20;

// Luz no crop ocular. Medido 0,236 nas duas gravações — subexposto. Borda de
// íris mole é exatamente o que vira tremor de landmark.
const BRIGHTNESS_FAIL_LOW = 0.10;
const BRIGHTNESS_WARN_LOW = 0.30;
const BRIGHTNESS_WARN_HIGH = 0.82;
const BRIGHTNESS_FAIL_HIGH = 0.92;

// Contraste medido: 0,094–0,107. Também na faixa baixa.
const CONTRAST_FAIL_LOW = 0.03;
const CONTRAST_WARN_LOW = 0.12;

// Mesmo limiar que `SPECULAR_FRAME_THRESHOLD` usa na calibração.
const SPECULAR_WARN = 0.02;
// Fração da janela com reflexo para chamar de PERSISTENTE. Mesmo valor que
// `SPECULAR_PERSISTENCE` na calibração — um reflexo em >30% dos frames é
// lente parada na frente do olho, não um brilho de passagem.
const SPECULAR_PERSISTENCE = 0.30;

/** Abaixo disto a mancha se moveu o bastante para atrapalhar. Espelha
 *  `ESPECULAR_ESTAVEL_MIN` do `qualityAnalyzer`, que produz a medida. */
const ESPECULAR_ESTAVEL_MIN = 0.6;

// A webcam do posto de referência faz 1920×1080 e o app pedia 720p. Ver
// `getUserMedia` em GazeContext.
const RESOLUTION_WARN_WIDTH = 1920;
const RESOLUTION_FAIL_WIDTH = 1280;

/** Viewport bem menor que a tela = app não está em tela cheia. A geometria
 *  física configurada descreve a TELA; se a janela ocupa menos, a conversão
 *  px→cm fica errada e o erro angular do relatório mente junto. */
const VIEWPORT_COVERAGE_WARN = 0.92;

/**
 * Distância entre cantos externos dos olhos num adulto (bi-ectocanthion).
 * O valor mora em `src/anthropometry.ts`; reexportado aqui para os
 * consumidores existentes.
 */
export { CANTHAL_DISTANCE_CM } from './anthropometry';
import { CANTHAL_DISTANCE_CM } from './anthropometry';

/**
 * FAIXA DE USO, EM CENTÍMETROS — a fonte da verdade da distância.
 *
 * Antes o critério vivia em `iodFraction` (fração da largura do frame ocupada
 * pelo rosto), com a faixa boa entre 0,13 e 0,32. Convertendo para centímetros
 * com o FOV de referência e a distância cantal de 9,0 cm:
 *
 *   iodFraction 0,32 (limite "perto demais")  →  20 cm
 *   iodFraction 0,20 (o ALVO perseguido)      →  32 cm
 *   iodFraction 0,13 (limite "longe demais")  →  50 cm
 *
 * A janela inteira de aprovação era 20–50 cm. Quem usa o app a 50–70 cm — a
 * distância confortável medida em uso real — ficava fora dela sempre, e a tela
 * mandava aproximar. O alvo de 0,20 significava, literalmente, sentar a 32 cm
 * da webcam.
 *
 * O erro passou despercebido porque o número em centímetros nunca chegava à
 * tela: nenhum chamador de produção passava `horizontalFovDeg`.
 */
/**
 * Onde as medições de fato aconteceram: 50–70 cm. O centro disso é o alvo.
 *
 * Separado da faixa TOLERADA de propósito. O alvo é para onde o zoom converge
 * e o que a instrução aponta; a tolerância é quando reclamar. Fundir os dois
 * faria o alvo escorregar toda vez que a tolerância fosse afrouxada, e o zoom
 * perseguiria um número que ninguém mediu.
 */
export const DISTANCIA_ALVO_CM = 60;

/**
 * Faixa aceita — fechada exatamente na faixa de medição, por escolha explícita.
 *
 * A largura desta faixa **não afeta a precisão**. O erro de landmark depende
 * de onde a pessoa senta, não de onde a tolerância termina; alargar a faixa não
 * piora medição nenhuma, só adia o aviso.
 *
 * O que ela governa é QUANDO avisar. Fechada em 50–70, o aviso funciona como
 * disciplina de protocolo: sair da posição em que as medições foram feitas é
 * sinalizado na hora, em vez de só depois de dez centímetros de deriva. Numa
 * ferramenta cujo produto é um relatório de erro angular, sinalizar cedo vale
 * mais que não incomodar.
 *
 * Para referência, o erro relativo ao alvo de 60 cm dentro e fora da faixa
 * (escala linear com a distância):
 *
 *   50 cm  −17%      60 cm  0%      70 cm  +17%      80 cm  +33%
 */
export const DISTANCIA_OK_MIN_CM = 50;
export const DISTANCIA_OK_MAX_CM = 70;

/** Margem de aviso em volta da faixa aceita. Fora dela, `fail`. */
const DISTANCIA_WARN_MIN_CM = 35;
const DISTANCIA_WARN_MAX_CM = 95;

/**
 * FOV usado para converter a faixa em `iodFraction` quando a câmera real não
 * informa o seu. É o mesmo default de `settings.cameraHorizontalFovDeg`.
 */
export const FOV_DE_REFERENCIA_DEG = 69.7;

/**
 * Fração do frame que o rosto ocupa a uma dada distância. Inversa exata de
 * `estimateDistanceCm`.
 *
 * Existe para que a faixa em centímetros e o alvo do zoom automático não sejam
 * dois números escolhidos à parte: um é derivado do outro.
 */
export function iodFractionParaDistancia(
  distanciaCm: number,
  horizontalFovDeg: number = FOV_DE_REFERENCIA_DEG,
  canthalDistanceCm: number = CANTHAL_DISTANCE_CM,
): number {
  const frameWidthCm = 2 * distanciaCm * Math.tan((horizontalFovDeg / 2) * (Math.PI / 180));
  return frameWidthCm > 0 ? canthalDistanceCm / frameWidthCm : 0;
}

/**
 * Densidade-alvo do rosto no frame, DERIVADA da distância-alvo.
 *
 * O `cameraTuner` persegue este número com o zoom. Enquanto ele era um 0,20
 * escolhido à parte, o zoom mirava 32 cm enquanto a tela pedia 60 — exatamente
 * a divergência que o comentário original deste bloco alertava e que ninguém
 * tinha checado em centímetros.
 */
export const TARGET_IOD_FRACTION = iodFractionParaDistancia(DISTANCIA_ALVO_CM);

/**
 * Distância em que o rosto atinge o tamanho-alvo no frame.
 *
 * É o número que responde "onde eu me sento?" — o que o usuário pediu e que
 * antes não existia: a tela dizia "aproxime" sem dizer até onde.
 *
 * Não depende da resolução: `iodFraction` já é normalizada pela largura.
 */
export function idealDistanceCm(
  horizontalFovDeg: number | null | undefined,
  targetIodFraction: number = TARGET_IOD_FRACTION,
  canthalDistanceCm: number = CANTHAL_DISTANCE_CM,
): number | null {
  if (!horizontalFovDeg || horizontalFovDeg <= 0 || horizontalFovDeg >= 180) return null;
  if (!(targetIodFraction > 0)) return null;
  const frameWidthCm = canthalDistanceCm / targetIodFraction;
  const d = frameWidthCm / (2 * Math.tan((horizontalFovDeg / 2) * (Math.PI / 180)));
  return Number.isFinite(d) && d > 0 ? d : null;
}

/**
 * Distância câmera→rosto a partir do tamanho do rosto no frame.
 *
 * Requer o campo de visão HORIZONTAL da câmera. Sem ele devolve `null` em vez
 * de inventar um número: uma distância errada é pior que nenhuma, porque
 * alimenta a conversão do erro para graus e a grade de calibração.
 *
 * DE ONDE O FOV VEM, E POR QUE NÃO SAI SOZINHO.
 *
 * Uma vista monocular de um objeto de tamanho conhecido dá UMA equação —
 * `tamanho_px / largura_px = tamanho_cm / (2 · D · tan(FOV/2))` — com DUAS
 * incógnitas, `D` e `FOV`. Nenhuma quantidade de quadros resolve isso; todos
 * trazem a mesma equação. O browser também não expõe o FOV: não há campo em
 * `getCapabilities()` nem em `getSettings()`.
 *
 * A saída que FUNCIONA é `deriveHorizontalFovDeg` em `cameraTuner.ts`: medir a
 * distância uma única vez com fita métrica fecha o sistema, e daí em diante a
 * distância sai sozinha em toda sessão. É uma etapa de setup, feita uma vez por
 * hardware.
 */
export function estimateDistanceCm(
  iodPx: number,
  videoWidth: number,
  horizontalFovDeg: number | null | undefined,
): number | null {
  if (!horizontalFovDeg || !(iodPx > 0) || !(videoWidth > 0)) return null;
  if (!(horizontalFovDeg > 0) || horizontalFovDeg >= 180) return null;
  const frameWidthCm = (videoWidth / iodPx) * CANTHAL_DISTANCE_CM;
  const halfFovRad = (horizontalFovDeg / 2) * (Math.PI / 180);
  const d = frameWidthCm / (2 * Math.tan(halfFovRad));
  return Number.isFinite(d) && d > 0 ? d : null;
}

/** Pior status entre os dois (ordem: ok < warn < fail; unknown é neutro). */
function worse(a: CheckStatus, b: CheckStatus): CheckStatus {
  const rank: Record<CheckStatus, number> = { unknown: 0, ok: 1, warn: 2, fail: 3 };
  return rank[a] >= rank[b] ? a : b;
}

function band(
  value: number,
  failLow: number, warnLow: number, warnHigh: number, failHigh: number,
): CheckStatus {
  if (value < failLow || value > failHigh) return 'fail';
  if (value < warnLow || value > warnHigh) return 'warn';
  return 'ok';
}

/**
 * Avalia um frame e devolve o veredito por item.
 *
 * `horizontalFovDeg` é opcional. Sem ele, a checagem de distância usa a
 * fração do frame ocupada pelo rosto — que é a grandeza que de fato governa
 * a precisão, e não depende de conhecer a lente.
 */
export function evaluateReadiness(
  snap: ReadinessSnapshot,
  ctx: ReadinessContext = {},
): ReadinessReport {
  const checks: ReadinessCheck[] = [];
  const horizontalFovDeg = ctx.horizontalFovDeg;

  // ── rosto ────────────────────────────────────────────────────────────────
  if (!snap.hasFace) {
    checks.push({
      id: 'face', status: 'fail', value: null,
      message: 'Rosto não detectado. Enquadre o rosto inteiro na câmera.',
    });
  } else if (snap.detectorConfidence < 0.85) {
    checks.push({
      id: 'face', status: 'warn', value: snap.detectorConfidence,
      message: 'Detecção instável. Verifique se nada cobre parte do rosto.',
    });
  } else {
    checks.push({
      id: 'face', status: 'ok', value: snap.detectorConfidence,
      message: 'Rosto detectado com estabilidade.',
    });
  }

  // ── resolução da câmera ──────────────────────────────────────────────────
  {
    const w = snap.videoWidth;
    const status: CheckStatus =
      w <= 0 ? 'unknown' : w < RESOLUTION_FAIL_WIDTH ? 'fail' : w < RESOLUTION_WARN_WIDTH ? 'warn' : 'ok';
    checks.push({
      id: 'resolution', status, value: w || null,
      message:
        status === 'ok' ? `Câmera em ${w}×${snap.videoHeight}.`
        : status === 'warn' ? `Câmera em ${w}×${snap.videoHeight}. Full HD (1920×1080) reduziria o erro em ~${(RESOLUTION_WARN_WIDTH / w).toFixed(1)}×.`
        : status === 'fail' ? `Câmera em ${w}×${snap.videoHeight} — resolução baixa demais para rastreamento confiável.`
        : 'Resolução da câmera desconhecida.',
    });
  }

  // ── janela em tela cheia ─────────────────────────────────────────────────
  if (snap.viewportWidth && snap.screenWidth && snap.viewportHeight && snap.screenHeight) {
    const cover = Math.min(
      snap.viewportWidth / snap.screenWidth,
      snap.viewportHeight / snap.screenHeight,
    );
    const status: CheckStatus = cover < VIEWPORT_COVERAGE_WARN ? 'warn' : 'ok';
    checks.push({
      id: 'viewport', status, value: cover,
      message: status === 'ok'
        ? 'Janela ocupando a tela inteira.'
        : `Janela ocupa ${(cover * 100).toFixed(0)}% da tela. A geometria física ` +
          `configurada descreve a TELA — com a janela menor, o erro em graus do ` +
          `relatório sai errado e os alvos ficam fora do lugar. Use tela cheia.`,
    });
  }

  const iodFraction = snap.videoWidth > 0 ? snap.iod / snap.videoWidth : 0;
  const estimatedDistanceCm = estimateDistanceCm(snap.iod, snap.videoWidth, horizontalFovDeg);

  if (snap.hasFace) {
    // ── distância / tamanho do rosto no frame ──────────────────────────────
    {
      // COM FOV: banda em centímetros, que é a grandeza que o cuidador
      // consegue ajustar e conferir com uma fita métrica.
      //
      // SEM FOV: cai na fração do frame. Não é equivalente, e é de propósito —
      // inventar centímetros a partir de um FOV desconhecido alimentaria a
      // conversão do erro para graus com um número que ninguém mediu.
      const emCm = estimatedDistanceCm !== null;

      // Banda sobre o valor ARREDONDADO, que é o mesmo que a mensagem exibe.
      //
      // Sem isto a tela pode dizer "50 cm" e no mesmo fôlego acusar "perto
      // demais", porque o valor cru era 49,999999999999986 — a ida-e-volta
      // px→cm carrega ~1e-14 de erro de ponto flutuante. Um veredito que
      // contradiz o número ao lado dele é pior que veredito nenhum: o cuidador
      // ajusta a posição tentando satisfazer uma regra invisível.
      const cmExibido = emCm ? Math.round(estimatedDistanceCm) : 0;

      const status = emCm
        ? band(
            cmExibido,
            DISTANCIA_WARN_MIN_CM, DISTANCIA_OK_MIN_CM,
            DISTANCIA_OK_MAX_CM, DISTANCIA_WARN_MAX_CM,
          )
        : band(
            iodFraction,
            IOD_FRACTION_FAIL_LOW, IOD_FRACTION_WARN_LOW,
            IOD_FRACTION_WARN_HIGH, IOD_FRACTION_FAIL_HIGH,
          );

      const faixa = `${DISTANCIA_OK_MIN_CM}–${DISTANCIA_OK_MAX_CM} cm`;
      const perto = emCm
        ? cmExibido < DISTANCIA_OK_MIN_CM
        : iodFraction > IOD_FRACTION_WARN_HIGH;
      const longe = emCm
        ? cmExibido > DISTANCIA_OK_MAX_CM
        : iodFraction < IOD_FRACTION_WARN_LOW;

      const medido = emCm ? `${cmExibido} cm` : null;

      checks.push({
        id: 'distance',
        status,
        value: emCm ? estimatedDistanceCm : iodFraction,
        message: emCm
          ? perto
            ? `Perto demais: ${medido}. Afaste-se até a faixa de ${faixa}.`
            : longe
            ? `Longe demais: ${medido}. Aproxime-se até a faixa de ${faixa}.`
            : `Distância boa: ${medido}, dentro da faixa de ${faixa}.`
          : longe
          ? 'Rosto pequeno no frame. Aproxime a CÂMERA do rosto — não a tela.'
          : perto
          ? 'Rosto muito grande no frame. Afaste um pouco a câmera.'
          : 'Rosto bem dimensionado no frame.',
      });
    }

    // ── centralização ──────────────────────────────────────────────────────
    {
      const dx = Math.abs(snap.faceCenter.x - 0.5);
      const dy = Math.abs(snap.faceCenter.y - 0.5);
      const d = Math.max(dx, dy);
      const status: CheckStatus =
        d > CENTER_TOLERANCE_FAIL ? 'fail' : d > CENTER_TOLERANCE_WARN ? 'warn' : 'ok';
      checks.push({
        id: 'centering', status, value: d,
        message: status === 'ok'
          ? 'Rosto centralizado no enquadramento.'
          : 'Rosto fora do centro. Alinhe a câmera à altura dos olhos, de frente.',
      });
    }

    // ── pose da cabeça ─────────────────────────────────────────────────────
    {
      const { yaw, pitch, roll } = snap.pose;
      const yp = Math.max(Math.abs(yaw), Math.abs(pitch));
      let status: CheckStatus =
        yp > POSE_FAIL_RAD ? 'fail' : yp > POSE_WARN_RAD ? 'warn' : 'ok';
      status = worse(status,
        Math.abs(roll) > ROLL_FAIL_RAD ? 'fail' : Math.abs(roll) > ROLL_WARN_RAD ? 'warn' : 'ok');
      const deg = (r: number) => ((r * 180) / Math.PI).toFixed(0);
      checks.push({
        id: 'headPose', status, value: yp,
        message: status === 'ok'
          ? 'Cabeça de frente para a tela.'
          : `Cabeça girada (${deg(yaw)}° lateral, ${deg(pitch)}° vertical, ${deg(roll)}° inclinação). ` +
            'Fique de frente — a calibração vale só para a postura em que foi feita.',
      });
    }

    // ── luz ────────────────────────────────────────────────────────────────
    {
      const status = band(
        snap.brightness,
        BRIGHTNESS_FAIL_LOW, BRIGHTNESS_WARN_LOW,
        BRIGHTNESS_WARN_HIGH, BRIGHTNESS_FAIL_HIGH,
      );
      checks.push({
        id: 'lighting', status, value: snap.brightness,
        message:
          snap.brightness < BRIGHTNESS_WARN_LOW
            ? 'Rosto escuro. Ilumine de FRENTE (luminária difusa atrás do monitor), sem luz forte atrás de você.'
            : snap.brightness > BRIGHTNESS_WARN_HIGH
            ? 'Rosto estourado de luz. Reduza a iluminação direta ou afaste a luminária.'
            : 'Iluminação adequada.',
      });
    }

    // ── contraluz ──────────────────────────────────────────────────────────
    //
    // A checagem que faltava. `lighting` mede o crop ocular já compensado pela
    // câmera; com uma janela atrás da pessoa, ele aprova um rosto em silhueta.
    // O sinal que denuncia isso é a razão fundo/rosto no quadro inteiro.
    {
      const c = snap.contraluz;
      if (!c) {
        checks.push({
          id: 'contraluz', status: 'unknown', value: null,
          message: 'Medindo a luz do ambiente…',
        });
      } else if (c.nivel === 'indefinido') {
        // Rosto escuro demais para a razão significar alguma coisa. Publicar
        // `ok` aqui seria afirmar "não há contraluz" sobre uma medição que não
        // aconteceu — e é justamente no quarto escuro com janela ao fundo que
        // isso mais mente.
        checks.push({
          id: 'contraluz', status: 'unknown', value: null,
          message: 'Rosto escuro demais para medir a luz do ambiente. Acenda uma luz de frente.',
        });
      } else {
        const status: CheckStatus = c.nivel === 'forte' ? 'fail' : c.nivel === 'atencao' ? 'warn' : 'ok';
        checks.push({
          id: 'contraluz', status, value: c.razao,
          message:
            c.nivel === 'forte'
              ? `Luz forte atrás de você: o fundo está ${c.razao.toFixed(1)}× mais claro que o rosto. Feche a cortina ou vire a cadeira de costas para a janela.`
              : c.nivel === 'atencao'
                ? `O fundo está ${c.razao.toFixed(1)}× mais claro que o rosto. Fechar a cortina ou acender uma luz de frente melhora a leitura da íris.`
                : 'Sem contraluz: o rosto está tão claro quanto o fundo.',
        });
      }
    }

    // ── contraste ──────────────────────────────────────────────────────────
    {
      const status: CheckStatus =
        snap.contrast < CONTRAST_FAIL_LOW ? 'fail'
        : snap.contrast < CONTRAST_WARN_LOW ? 'warn' : 'ok';
      checks.push({
        id: 'contrast', status, value: snap.contrast,
        message: status === 'ok'
          ? 'Contraste suficiente para localizar a íris.'
          : 'Pouco contraste na região dos olhos. Melhore a luz frontal e desligue a correção automática de luz da webcam.',
      });
    }

    // ── reflexo (óculos) ───────────────────────────────────────────────────
    {
      // O QUE SEPARA ÓCULOS DE REFLEXO NOCIVO É O MOVIMENTO, NÃO A PRESENÇA.
      //
      // Antes o veredito saía de `specularPersistence` — a fração de quadros
      // com brilho alto. Para separar reflexo de ruído passageiro aquilo
      // funciona. Para separar óculos de reflexo nocivo está invertido: o
      // brilho fixo de uma lente aparece em TODOS os quadros, marca
      // persistência ≈ 1,0 e dispara o aviso sempre — que era exatamente o
      // falso positivo relatado. O usuário calibrava apesar do aviso e o erro
      // saía normal, porque uma mancha parada não atrapalha: o detector
      // enxerga em volta dela a sessão inteira.
      //
      // Uma mancha que se MOVE é outra coisa — algo entrando e saindo do olho,
      // e é isso que faz o landmark da borda da íris escorregar.
      const persist = snap.specularPersistence;
      const estab = snap.specularStability;

      const haBrilho = persist !== undefined
        ? persist > SPECULAR_PERSISTENCE
        : snap.specularRatio > SPECULAR_WARN;

      // Sem a medida de estabilidade, cai no critério antigo: um snapshot de
      // código que ainda não preenche o campo não pode desligar a checagem.
      const parado = estab !== undefined && estab >= ESPECULAR_ESTAVEL_MIN;
      const incomoda = haBrilho && !parado;

      // Brilho móvel acusa mesmo com persistência baixa: um reflexo que entra e
      // sai é pouco persistente e muito nocivo — o caso que o critério antigo
      // deixava passar.
      const movelIntermitente =
        estab !== undefined &&
        estab < ESPECULAR_ESTAVEL_MIN &&
        snap.specularRatio > SPECULAR_WARN;

      const status: CheckStatus = incomoda || movelIntermitente ? 'warn' : 'ok';

      const temBrilho = snap.specularRatio > SPECULAR_WARN || (persist ?? 0) > 0;

      checks.push({
        id: 'glasses',
        status,
        value: estab ?? persist ?? snap.specularRatio,
        message:
          status === 'warn'
            ? 'Reflexo se movendo sobre os olhos. Incline a tela ~10° para baixo ' +
              'ou reduza luzes e janelas atrás de você.'
            : parado && temBrilho
              ? 'Reflexo fixo de lente de óculos — reconhecido e inofensivo: ' +
                'por ficar parado, o rastreamento enxerga em volta dele.'
              : 'Sem reflexo atrapalhando os olhos.',
      });
    }

    // ── faixa de distância em relação à calibração ─────────────────────────
    // Diferente do item `distance`, que pergunta "o rosto tem pixels
    // suficientes?". Este pergunta "a posição de agora está dentro da faixa que
    // a compensação cobre?". São restrições independentes: dá para estar bem
    // enquadrado e ainda assim longe demais da posição em que se calibrou.
    if (ctx.distanceRange && ctx.distanceRange.status !== 'unknown') {
      const dr = ctx.distanceRange;
      const status: CheckStatus =
        dr.status === 'ok' ? 'ok' : dr.status === 'warn' ? 'warn' : 'fail';
      checks.push({
        id: 'distanceRange', status, value: dr.deltaCm,
        message: dr.message,
      });
    }

    // ── cintilação da rede elétrica ────────────────────────────────────────
    if (ctx.flicker) {
      const f = ctx.flicker;
      const status: CheckStatus = f.detected ? 'warn' : 'ok';
      const rede = ctx.powerLineHz ? ` Compatível com rede de ${ctx.powerLineHz} Hz.` : '';
      checks.push({
        id: 'flicker', status, value: f.relativeAmplitude,
        message: status === 'ok'
          ? 'Sem cintilação de lâmpada no sensor.'
          : `Cintilação de ${f.dominantHz.toFixed(1)} Hz (${(f.relativeAmplitude * 100).toFixed(1)}% do brilho).${rede} ` +
            'O brilho da íris oscila frame a frame e o landmark escorrega junto. ' +
            'Ajuste a frequência anticintilação da webcam ou troque a lâmpada.',
      });
    }
  }

  const hasFail = checks.some((c) => c.status === 'fail');
  // Só "rosto ausente" e resolução inviável impedem de verdade. O resto piora o
  // resultado mas ainda produz calibração utilizável — e regra 2 do projeto diz
  // que a UI não pode prender o usuário. A tela oferece prosseguir mesmo assim.
  const blockedHard = checks.some(
    (c) => c.status === 'fail' && (c.id === 'face' || c.id === 'resolution'),
  );

  return {
    checks,
    canStart: !hasFail,
    blockedHard,
    measured: {
      iodFraction,
      estimatedDistanceCm,
      brightness: snap.brightness,
      contrast: snap.contrast,
      glassesLikely: snap.specularPersistence !== undefined
        ? snap.specularPersistence > SPECULAR_PERSISTENCE
        : snap.specularRatio > SPECULAR_WARN,
      idealDistanceCm: idealDistanceCm(horizontalFovDeg),
    },
  };
}

/**
 * Agrega N frames num snapshot estável (mediana por campo).
 *
 * A tela de pré-calibração lê a 10 Hz; julgar o setup por UM frame faria os
 * indicadores piscarem entre ok e warn a cada tremor de landmark. A mediana
 * sobre ~1 s também é o que faz a medição gravada no relatório representar a
 * sessão, e não um instante arbitrário.
 */
export function aggregateSnapshots(frames: readonly ReadinessSnapshot[]): ReadinessSnapshot | null {
  if (frames.length === 0) return null;
  const med = (pick: (s: ReadinessSnapshot) => number): number => {
    const v = frames.map(pick).filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
    if (v.length === 0) return 0;
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  const last = frames[frames.length - 1];
  return {
    // Basta um frame sem rosto para o indicador não afirmar que está tudo bem.
    hasFace: frames.every((f) => f.hasFace),
    iod: med((s) => s.iod),
    videoWidth: last.videoWidth,
    videoHeight: last.videoHeight,
    faceCenter: { x: med((s) => s.faceCenter.x), y: med((s) => s.faceCenter.y) },
    pose: { yaw: med((s) => s.pose.yaw), pitch: med((s) => s.pose.pitch), roll: med((s) => s.pose.roll) },
    brightness: med((s) => s.brightness),
    contrast: med((s) => s.contrast),
    detectorConfidence: med((s) => s.detectorConfidence),
    specularRatio: med((s) => s.specularRatio),
    // Fração da janela com reflexo — não é mediana, é contagem.
    specularPersistence:
      frames.filter((f) => f.specularRatio > SPECULAR_WARN).length / frames.length,
    viewportWidth: last.viewportWidth,
    viewportHeight: last.viewportHeight,
    screenWidth: last.screenWidth,
    screenHeight: last.screenHeight,
  };
}
