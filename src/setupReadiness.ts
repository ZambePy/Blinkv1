// Etapa 2 — avaliação do posto de uso ANTES da calibração.
//
// POR QUE EXISTE
//
// A auditoria D10 mostrou que a maior fonte de erro não-modelada do pipeline
// não está no código: está no setup, e ele varia entre sessões sem ninguém
// perceber. Comparando as duas gravações reais do repositório:
//
//   distância interocular   127 px  vs  166 px   (30% de diferença)
//   pitch da cabeça        -0,033 rad vs +0,138 rad  (9 GRAUS de diferença)
//   brilho no crop ocular   0,236   vs  0,227    (ambos escuros)
//
// Calibrar sem reproduzir a postura é calibrar para outra geometria. E o
// sinal útil do pipeline inteiro é o deslocamento da íris no frame — medido em
// 6,8 px para a tela toda a 1280×720. Tudo que reduz pixels no olho ou desloca
// a cabeça consome esse orçamento minúsculo.
//
// Este módulo transforma sinais que o pipeline JÁ calcula (qualityAnalyzer,
// faceMatrix, landmarks) num veredito legível, para a tela de pré-calibração
// corrigir o setup antes de gastar 30 s de coleta com dado ruim.
//
// É puro e sem DOM de propósito: os limiares são a parte que precisa de teste,
// e testar UI para verificar um limiar é caro e frágil.
//
// ⚠️ Os limiares vêm de UMA instalação (N=1). São defensáveis porque derivam de
// medições, não de palpite, mas a faixa "ideal" precisa de re-medição com mais
// usuários. Cada constante abaixo diz de onde veio.

/** Estado de um item da checagem. `unknown` = ainda sem dado (rosto ausente). */
export type CheckStatus = 'ok' | 'warn' | 'fail' | 'unknown';

export type CheckId =
  | 'face'
  | 'flicker'
  | 'viewport'
  | 'resolution'
  | 'distance'
  | 'centering'
  | 'headPose'
  | 'lighting'
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
  detectorConfidence: number;
  specularRatio: number;
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
  /** Campo de visão horizontal da câmera (Etapa 1). Habilita a estimativa de
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
    /** Só quando o campo de visão da câmera é conhecido (Etapa 1). */
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

// Mesmo limiar que `SPECULAR_FRAME_THRESHOLD` usa na calibração (A1-5).
const SPECULAR_WARN = 0.02;
// Fração da janela com reflexo para chamar de PERSISTENTE. Mesmo valor que
// `SPECULAR_PERSISTENCE` na calibração — um reflexo em >30% dos frames é
// lente parada na frente do olho, não um brilho de passagem.
const SPECULAR_PERSISTENCE = 0.30;

// A webcam do posto de referência faz 1920×1080 e o app pedia 720p. Ver
// `getUserMedia` em GazeContext.
const RESOLUTION_WARN_WIDTH = 1920;
const RESOLUTION_FAIL_WIDTH = 1280;

/** Viewport bem menor que a tela = app não está em tela cheia. A geometria
 *  física configurada descreve a TELA; se a janela ocupa menos, a conversão
 *  px→cm fica errada e o erro angular do relatório mente junto. */
const VIEWPORT_COVERAGE_WARN = 0.92;

/** Distância entre cantos externos dos olhos num adulto (bi-ectocanthion). */
export const CANTHAL_DISTANCE_CM = 9.0;

/** Densidade-alvo do rosto no frame. Espelha `TARGET_IOD_FRACTION` do
 *  `cameraTuner` — os dois precisam concordar, senão a tela pede uma coisa
 *  e o ajuste automático persegue outra. */
export const TARGET_IOD_FRACTION = 0.20;

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
 * Requer o campo de visão HORIZONTAL da câmera, que o browser não expõe — a
 * Etapa 1 vai obtê-lo do sistema. Sem ele devolve `null` em vez de inventar
 * um número: uma distância errada é pior que nenhuma, porque alimenta a
 * conversão do erro para graus e a grade de calibração.
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
 * `horizontalFovDeg` é opcional (Etapa 1). Sem ele, a checagem de distância usa
 * a fração do frame ocupada pelo rosto — que é a grandeza que de fato governa a
 * precisão, e não depende de conhecer a lente.
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
      const status = band(
        iodFraction,
        IOD_FRACTION_FAIL_LOW, IOD_FRACTION_WARN_LOW,
        IOD_FRACTION_WARN_HIGH, IOD_FRACTION_FAIL_HIGH,
      );
      const ideal = idealDistanceCm(horizontalFovDeg);
      const dist = estimatedDistanceCm !== null ? ` (~${estimatedDistanceCm.toFixed(0)} cm)` : '';
      const alvo = ideal !== null ? ` Posicione a câmera a ~${ideal.toFixed(0)} cm do rosto.` : '';
      checks.push({
        id: 'distance', status, value: iodFraction,
        message:
          iodFraction < IOD_FRACTION_WARN_LOW
            ? `Rosto pequeno no frame${dist}. Aproxime a CÂMERA do rosto — não a tela.${alvo}`
            : iodFraction > IOD_FRACTION_WARN_HIGH
            ? `Rosto muito grande no frame${dist}. Afaste um pouco a câmera.${alvo}`
            : `Rosto bem dimensionado no frame${dist}.`,
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
      // Persistência distingue lente de brilho passageiro. Sem a janela
      // (chamada com um frame só), cai no critério instantâneo antigo.
      const persist = snap.specularPersistence;
      const persistente = persist !== undefined
        ? persist > SPECULAR_PERSISTENCE
        : snap.specularRatio > SPECULAR_WARN;
      const status: CheckStatus = persistente ? 'warn' : 'ok';
      checks.push({
        id: 'glasses', status, value: persist ?? snap.specularRatio,
        message: status === 'ok'
          ? 'Sem reflexo persistente nos olhos.'
          : `Reflexo em ${persist !== undefined ? `${(persist * 100).toFixed(0)}% dos frames` : 'cena'} — ` +
            'assinatura de lente de óculos. Incline a tela ~10° para baixo ou reduza luzes atrás de você.',
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

/**
 * Faixa em que uma distância olho→câmera é fisicamente plausível num posto de
 * uso. Fora disto o número quase certamente vem de um campo de visão mal
 * calibrado, não de alguém sentado num lugar esquisito.
 */
const PLAUSIBLE_DISTANCE_CM: readonly [number, number] = [25, 130];

export interface EffectiveDistance {
  /** Valor a usar no pipeline. */
  cm: number;
  /** De onde veio — entra no relatório para o leitor não confundir medida
   *  com digitação, que é o erro que a auditoria D9 encontrou. */
  source: 'measured' | 'configured';
  /** Preenchido quando a medição foi descartada, com o porquê. */
  rejectedReason?: string;
}

/**
 * Decide qual distância o pipeline usa.
 *
 * POR QUE IMPORTA: `viewingDistanceCm` não é decorativo — entra em
 * `computeCalibrationTargets` (posição dos alvos pelo orçamento de
 * excentricidade) e na conversão px→graus do relatório. Até aqui era SEMPRE
 * digitado, então se o paciente sentasse 10 cm mais perto, a grade continuava
 * montada para a distância de ontem. As duas gravações reais do repositório
 * diferiam 30% em tamanho de rosto — exatamente esse efeito.
 *
 * ⚠️ LIMITE HONESTO SOBRE O ABSOLUTO: a medição vem de `estimateDistanceCm`,
 * que depende do campo de visão, que por sua vez foi derivado de UMA medição
 * com fita. Se aquela fita errou por 10%, toda estimativa erra por 10% junto —
 * a cadeia não se conserta sozinha. O que a medição entrega de verdade é o
 * RELATIVO: mudanças de postura entre sessões passam a ser vistas, e é isso
 * que estava causando a irreprodutibilidade.
 */
export function effectiveViewingDistanceCm(
  measuredCm: number | null | undefined,
  configuredCm: number,
): EffectiveDistance {
  if (measuredCm == null || !Number.isFinite(measuredCm)) {
    return { cm: configuredCm, source: 'configured' };
  }
  const [lo, hi] = PLAUSIBLE_DISTANCE_CM;
  if (measuredCm < lo || measuredCm > hi) {
    return {
      cm: configuredCm,
      source: 'configured',
      rejectedReason:
        `distância medida (${measuredCm.toFixed(0)} cm) fora da faixa plausível ` +
        `[${lo}, ${hi}] — provável campo de visão mal calibrado`,
    };
  }
  return { cm: measuredCm, source: 'measured' };
}
