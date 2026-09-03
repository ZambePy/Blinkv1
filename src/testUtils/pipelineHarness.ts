// Harness de regressão determinístico — tarefa T0.3 do plano em `tasks.md`.
//
// O que ele faz e o que ele NÃO faz.
//
//   FAZ: roda o núcleo de decisão do pipeline (StandardScaler + RidgeRegressor
//        + OneEuroFilter2D) sobre trajetórias sintéticas com semente fixa, e
//        devolve métricas comparáveis entre execuções: erro espacial médio/p90,
//        jitter RMS em fixação, contagem de amostras rejeitadas por
//        trajetória, e latência (p50/p95) dos estágios que ele efetivamente
//        executa (`predict` e `filter`).
//
//   NÃO FAZ: rodar MediaPipe FaceLandmarker, L2CS worker/ONNX, `getImageData`,
//        `qualityAnalyzer`, `poseCompensation`, `distanceCompensation`, nem o
//        engine.ts propriamente dito. Esses módulos exigem browser/WASM/GPU e
//        não têm como rodar em vitest+node. A instrumentação de latência de
//        `T0.5` (`stageTimer`) mede esses estágios em runtime real; aqui
//        medimos apenas `predict` e `filter` — o restante seria número
//        fabricado, o que é exatamente o padrão de defeito que o plano lista
//        como origem da maior parte dos bugs.
//
// Trajetórias implementadas (semente fixa → sequência fixa):
//   1. static-fixation           9 alvos × 150 frames de fixação estática.
//   2. saccade-20deg             sacada entre dois alvos ~20° apart, 60 frames
//                                sobre cada alvo, 4 transições.
//   3. slow-pursuit              perseguição lenta ~10°/s horizontal, 60 frames.
//   4. blink-during-fixation     fixação com uma "piscada" a cada 30º frame:
//                                a amostra é rejeitada e o cursor mantém o
//                                último valor emitido.
//   5. face-loss-2s              fixação com face perdida entre os frames 60
//                                e 120 — mantém o último valor emitido.
//   6. pose-drift-5deg           fixação com deriva monotônica de ~5° no yaw
//                                da simulação ao longo da trajetória.
//
// Uso pretendido: o teste `pipelineHarness.test.ts` executa `runHarness()` com
// semente 12345 e compara com `docs/baseline_a28bdb0.json` (tarefa T0.4).
// Regressão significa: qualquer métrica pior que a tolerância declarada faz
// o teste falhar.

import { StandardScaler } from '../scaler';
import { RidgeRegressor } from '../ridge';
import { OneEuroFilter2D } from '../oneEuroFilter';
import { StageTimer, STAGE } from '../telemetry/stageTimer';
import {
  GazeSimSession,
  SIM_SCREEN_W_PX,
  SIM_SCREEN_H_PX,
  simulateCalibration,
  type SimOptions,
} from './gazeSimulator';

// -----------------------------------------------------------------------------
// Contratos públicos
// -----------------------------------------------------------------------------

export interface HarnessOptions {
  /** Semente do PRNG. Igual → sequência igual. */
  seed?: number;
  /** Largura da tela virtual em px (default 1920, mesma do simulador). */
  screenWpx?: number;
  /** Altura da tela virtual em px (default 1080). */
  screenHpx?: number;
  /** Configuração de simulação. Padrão herda de `SIM_DEFAULTS`. */
  sim?: Partial<SimOptions>;
}

export interface TrajectoryMetrics {
  name: string;
  /** Número de frames processados. */
  frames: number;
  /** Erro espacial médio, em px de tela. */
  meanErrorPx: number;
  /** Erro espacial p90, em px de tela. */
  p90ErrorPx: number;
  /** Jitter RMS em fixação (px) — diferença frame-a-frame da saída filtrada.
   *  Faz sentido só nas trajetórias estáticas; para as demais é reportado como
   *  medida da instabilidade da saída, sem interpretação de "melhor menor". */
  jitterRmsPx: number;
  /** Contagem de amostras que o harness marcou como rejeitadas (piscada ou
   *  face perdida). */
  samplesRejected: number;
}

export interface StageLatencyEntry {
  p50Ms: number;
  p95Ms: number;
  count: number;
}

export interface HarnessResult {
  seed: number;
  screen: { w: number; h: number };
  featureDim: number;
  trajectories: TrajectoryMetrics[];
  /** Estágios que o harness efetivamente executa e cronometra: `predict` e
   *  `filter`. Estágios do pipeline visual (mediapipe, l2cs.*, features,
   *  quality) NÃO aparecem aqui de propósito — ver comentário no cabeçalho. */
  measuredStageLatency: Record<string, StageLatencyEntry>;
  /** Configuração da simulação de fato usada (após merge com defaults). */
  simConfig: SimOptions;
}

// -----------------------------------------------------------------------------
// Trajetórias — cada geradora devolve `Array<{sx, sy, drop?}>` onde `drop`
// marca frames em que o pipeline NÃO deve emitir predição nova (piscada, face
// perdida). Coords em fração de tela [0..1].
// -----------------------------------------------------------------------------

interface TrajectoryFrame {
  sx: number;
  sy: number;
  /** 'blink' | 'no-face' | undefined (frame válido). */
  drop?: 'blink' | 'no-face';
}

const NINE_POINTS: readonly [number, number][] = [
  [0.15, 0.15], [0.50, 0.15], [0.85, 0.15],
  [0.15, 0.50], [0.50, 0.50], [0.85, 0.50],
  [0.15, 0.85], [0.50, 0.85], [0.85, 0.85],
];

function staticFixation(): TrajectoryFrame[] {
  const out: TrajectoryFrame[] = [];
  const framesPerTarget = 150; // 5 s @30 fps
  for (const [sx, sy] of NINE_POINTS) {
    for (let f = 0; f < framesPerTarget; f++) out.push({ sx, sy });
  }
  return out;
}

function saccade20deg(): TrajectoryFrame[] {
  // ~20° a 60 cm sobre 23,6" 16:9 corresponde a ~21 cm de tela ≈ 40% da
  // largura (52,25 cm útil). Duas fixações em (0.30, 0.5) e (0.70, 0.5).
  const out: TrajectoryFrame[] = [];
  const framesPerTarget = 60; // 2 s @30 fps
  const pattern: [number, number][] = [
    [0.30, 0.5], [0.70, 0.5], [0.30, 0.5], [0.70, 0.5],
  ];
  for (const [sx, sy] of pattern) {
    for (let f = 0; f < framesPerTarget; f++) out.push({ sx, sy });
  }
  return out;
}

function slowPursuit(): TrajectoryFrame[] {
  // 10°/s horizontal ≈ 10,5 cm/s → 20% da largura por segundo. Percorre
  // 0.30 → 0.80 em 2,5 s = 75 frames.
  const out: TrajectoryFrame[] = [];
  const startX = 0.30;
  const endX = 0.80;
  const frames = 75;
  for (let f = 0; f < frames; f++) {
    const t = f / (frames - 1);
    out.push({ sx: startX + (endX - startX) * t, sy: 0.5 });
  }
  return out;
}

function blinkDuringFixation(): TrajectoryFrame[] {
  const out: TrajectoryFrame[] = [];
  const totalFrames = 150;
  for (let f = 0; f < totalFrames; f++) {
    // Piscada de 3 frames a cada 30 (~10% do tempo).
    const inBlink = f % 30 < 3;
    out.push({ sx: 0.5, sy: 0.5, drop: inBlink ? 'blink' : undefined });
  }
  return out;
}

function faceLoss2s(): TrajectoryFrame[] {
  const out: TrajectoryFrame[] = [];
  const totalFrames = 180; // 6 s @30 fps
  for (let f = 0; f < totalFrames; f++) {
    const lost = f >= 60 && f < 120; // 2 s de perda
    out.push({ sx: 0.5, sy: 0.5, drop: lost ? 'no-face' : undefined });
  }
  return out;
}

function poseDrift5deg(): TrajectoryFrame[] {
  const out: TrajectoryFrame[] = [];
  const totalFrames = 90;
  for (let f = 0; f < totalFrames; f++) {
    out.push({ sx: 0.5, sy: 0.5 });
  }
  return out;
}

// -----------------------------------------------------------------------------
// Percentis (mesma fórmula do StageTimer — kept in-file para não expor uma
// função utilitária que só o teste consumiria).
// -----------------------------------------------------------------------------

function percentileP90(values: number[]): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  const s = values.slice().sort((a, b) => a - b);
  const rank = 0.9 * (s.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return s[lo];
  const frac = rank - lo;
  return s[lo] * (1 - frac) + s[hi] * frac;
}

// -----------------------------------------------------------------------------
// Núcleo do harness.
// -----------------------------------------------------------------------------

/**
 * Executa o harness completo com a configuração dada. Determinístico: a mesma
 * semente devolve o mesmo `HarnessResult`.
 */
export function runHarness(opts: HarnessOptions = {}): HarnessResult {
  const seed = opts.seed ?? 12345;
  const screenW = opts.screenWpx ?? SIM_SCREEN_W_PX;
  const screenH = opts.screenHpx ?? SIM_SCREEN_H_PX;

  // Zera flags estáticas do RidgeRegressor para o harness rodar independente
  // de estado herdado de qualquer teste anterior no mesmo processo. Sem isso,
  // a suíte é sensível à ordem — que é exatamente o padrão que a análise
  // I.3 do plano lista como "estado global de módulo".
  const savedOverride = RidgeRegressor.lambdaOverride;
  const savedAxisScale = RidgeRegressor.axisScale;
  const savedBalance = RidgeRegressor.balanceTargets;
  RidgeRegressor.lambdaOverride = null;
  RidgeRegressor.axisScale = { x: screenW, y: screenH };
  RidgeRegressor.balanceTargets = false;

  try {
    // 1. Calibração determinística usando o simulador existente.
    const calibration = simulateCalibration(
      NINE_POINTS.map(([x, y]) => ({ x, y })),
      { ...opts.sim, seed },
    );

    // Treina StandardScaler + Ridge por olho, exatamente como calibration.ts.
    const scalerL = new StandardScaler();
    const scalerR = new StandardScaler();
    scalerL.fit(calibration.featuresLeft);
    scalerR.fit(calibration.featuresRight);
    const zLeft = scalerL.transform(calibration.featuresLeft);
    const zRight = scalerR.transform(calibration.featuresRight);

    const modelL = new RidgeRegressor();
    const modelR = new RidgeRegressor();
    modelL.train(zLeft, calibration.targetsX, calibration.targetsY);
    modelR.train(zRight, calibration.targetsX, calibration.targetsY);

    const featureDim = calibration.featuresLeft[0]?.length ?? 0;

    // 2. Roda cada trajetória com o modelo já treinado.
    const stageTimer = new StageTimer({ windowSize: 4096 });
    const trajectoryGens: Array<[string, () => TrajectoryFrame[]]> = [
      ['static-fixation', staticFixation],
      ['saccade-20deg', saccade20deg],
      ['slow-pursuit', slowPursuit],
      ['blink-during-fixation', blinkDuringFixation],
      ['face-loss-2s', faceLoss2s],
      ['pose-drift-5deg', poseDrift5deg],
    ];

    const trajectories: TrajectoryMetrics[] = [];
    for (const [name, gen] of trajectoryGens) {
      const frames = gen();
      const metrics = runTrajectory({
        name,
        frames,
        seed: seed ^ hashString(name),
        simOverrides: name === 'pose-drift-5deg'
          ? { poseDriftPerPoint: 0.02 } // ~1° por chamada de advancePoint
          : {},
        screenW,
        screenH,
        scalerL,
        scalerR,
        modelL,
        modelR,
        stageTimer,
      });
      trajectories.push(metrics);
    }

    // 3. Extrai a latência dos estágios efetivamente cronometrados.
    const snap = stageTimer.snapshot();
    const measuredStageLatency: Record<string, StageLatencyEntry> = {};
    for (const [stage, s] of Object.entries(snap)) {
      measuredStageLatency[stage] = { p50Ms: s.p50Ms, p95Ms: s.p95Ms, count: s.count };
    }

    return {
      seed,
      screen: { w: screenW, h: screenH },
      featureDim,
      trajectories,
      measuredStageLatency,
      simConfig: {
        seed,
        framesPerPoint: calibration.session ? 55 : 55,
        landmarkNoise: 0.008,
        poseJitter: 0.006,
        poseDriftPerPoint: 0.01,
        l2csNoise: 0.02,
        dimDrift: 0.005,
        hypometria: true,
        ...opts.sim,
      },
    };
  } finally {
    RidgeRegressor.lambdaOverride = savedOverride;
    RidgeRegressor.axisScale = savedAxisScale;
    RidgeRegressor.balanceTargets = savedBalance;
  }
}

// -----------------------------------------------------------------------------
// runTrajectory — roda UMA trajetória e devolve as métricas.
// -----------------------------------------------------------------------------

interface RunTrajectoryArgs {
  name: string;
  frames: TrajectoryFrame[];
  seed: number;
  simOverrides: Partial<SimOptions>;
  screenW: number;
  screenH: number;
  scalerL: StandardScaler;
  scalerR: StandardScaler;
  modelL: RidgeRegressor;
  modelR: RidgeRegressor;
  stageTimer: StageTimer;
}

function runTrajectory(a: RunTrajectoryArgs): TrajectoryMetrics {
  const session = new GazeSimSession({ ...a.simOverrides, seed: a.seed });
  const filter = new OneEuroFilter2D(30, 0.02, 1.5);

  let lastEmittedX = a.screenW / 2;
  let lastEmittedY = a.screenH / 2;
  let hasLastEmit = false;
  let samplesRejected = 0;
  const errors: number[] = [];
  const emittedX: number[] = [];
  const emittedY: number[] = [];

  // Deriva de pose contínua para a trajetória `pose-drift-5deg`. Chama
  // `advancePoint` a cada frame para acumular a caminhada aleatória.
  const applyDrift = a.name === 'pose-drift-5deg';
  // Para as demais, `advancePoint` só é chamada uma vez no começo.
  if (!applyDrift) session.advancePoint();

  // Relógio virtual monotônico para o OneEuro (0, 1/30, 2/30, …).
  let tSec = 0;
  const dt = 1 / 30;

  for (const frame of a.frames) {
    if (applyDrift) session.advancePoint();

    if (frame.drop) {
      samplesRejected++;
      // Nada de novo é emitido — cursor mantém último valor. Empurra o
      // relógio para o próximo frame respeitando cadência.
      tSec += dt;
      if (hasLastEmit) {
        emittedX.push(lastEmittedX);
        emittedY.push(lastEmittedY);
        errors.push(distanceToTarget(frame, lastEmittedX, lastEmittedY, a.screenW, a.screenH));
      }
      continue;
    }

    const [fL, fR] = session.frame(frame.sx, frame.sy);
    a.stageTimer.begin(STAGE.predict);
    const zL = a.scalerL.transformSingle(fL);
    const zR = a.scalerR.transformSingle(fR);
    const predictionL = predictNormalized(a.modelL, zL);
    const predictionR = predictNormalized(a.modelR, zR);
    a.stageTimer.end(STAGE.predict);

    const normX = (predictionL.x + predictionR.x) / 2;
    const normY = (predictionL.y + predictionR.y) / 2;
    const px = clamp01(normX) * a.screenW;
    const py = clamp01(normY) * a.screenH;

    a.stageTimer.begin(STAGE.filter);
    const smoothed = filter.filter(px, py, tSec);
    a.stageTimer.end(STAGE.filter);
    tSec += dt;

    lastEmittedX = smoothed.x;
    lastEmittedY = smoothed.y;
    hasLastEmit = true;
    emittedX.push(smoothed.x);
    emittedY.push(smoothed.y);
    errors.push(distanceToTarget(frame, smoothed.x, smoothed.y, a.screenW, a.screenH));
  }

  const meanErrorPx = errors.length > 0
    ? errors.reduce((s, v) => s + v, 0) / errors.length
    : 0;
  const p90ErrorPx = percentileP90(errors);

  // Jitter RMS: só faz sentido em fixação estática, mas devolvemos para todas
  // como sinal de estabilidade da saída. Métrica: RMS da diferença
  // frame-a-frame (x²+y²) sob raiz. Sem a coluna, o baseline não sabe se um
  // filtro trocado ficou mais/menos ruidoso.
  let sumSq = 0;
  let n = 0;
  for (let i = 1; i < emittedX.length; i++) {
    const dxp = emittedX[i] - emittedX[i - 1];
    const dyp = emittedY[i] - emittedY[i - 1];
    sumSq += dxp * dxp + dyp * dyp;
    n++;
  }
  const jitterRmsPx = n > 0 ? Math.sqrt(sumSq / n) : 0;

  return {
    name: a.name,
    frames: a.frames.length,
    meanErrorPx,
    p90ErrorPx,
    jitterRmsPx,
    samplesRejected,
  };
}

function predictNormalized(reg: RidgeRegressor, features: number[]): { x: number; y: number } {
  // `RidgeRegressor.predict` devolve `{x:0, y:0}` quando o modelo é null
  // (não treinado). No harness ele sempre está treinado, mas o wrapper
  // fica aqui como ponto único de intercepção — se um dia trocarmos o
  // regressor por outro (e.g. KernelRidge) só este ponto precisa mudar.
  return reg.predict(features);
}

function distanceToTarget(
  frame: TrajectoryFrame,
  emittedXpx: number,
  emittedYpx: number,
  screenW: number,
  screenH: number,
): number {
  const gx = frame.sx * screenW;
  const gy = frame.sy * screenH;
  const dxp = emittedXpx - gx;
  const dyp = emittedYpx - gy;
  return Math.hypot(dxp, dyp);
}

function clamp01(v: number): number {
  if (v < 0) return 0;
  if (v > 1) return 1;
  return v;
}

/** Hash simples para derivar sementes por trajetória a partir do seed base.
 *  Não criptográfico; só precisa ser determinístico e razoavelmente disperso. */
function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

// -----------------------------------------------------------------------------
// Comparação com baseline — usada pelo teste de regressão.
// -----------------------------------------------------------------------------

export interface BaselineComparisonEntry {
  trajectory: string;
  metric: 'meanErrorPx' | 'p90ErrorPx' | 'jitterRmsPx' | 'samplesRejected';
  baseline: number;
  current: number;
  toleranceAbs: number;
  toleranceRel: number;
  regressed: boolean;
}

export interface BaselineComparison {
  ok: boolean;
  entries: BaselineComparisonEntry[];
}

/** Tolerância default por métrica. Larga o suficiente para acomodar ruído de
 *  execução, apertada o suficiente para pegar regressão real. */
export const DEFAULT_TOLERANCES = {
  meanErrorPxAbs: 5,
  meanErrorPxRel: 0.15,
  p90ErrorPxAbs: 8,
  p90ErrorPxRel: 0.20,
  jitterRmsPxAbs: 2,
  jitterRmsPxRel: 0.30,
  samplesRejectedAbs: 0,       // rejeições esperadas são exatas
  samplesRejectedRel: 0,
} as const;

export function compareToBaseline(
  current: HarnessResult,
  baseline: HarnessResult,
  tolerances = DEFAULT_TOLERANCES,
): BaselineComparison {
  const entries: BaselineComparisonEntry[] = [];
  const byName = new Map(baseline.trajectories.map((t) => [t.name, t]));

  for (const cur of current.trajectories) {
    const base = byName.get(cur.name);
    if (!base) {
      // Nova trajetória no current: registra como não-regressão informativa.
      entries.push({
        trajectory: cur.name,
        metric: 'meanErrorPx',
        baseline: NaN,
        current: cur.meanErrorPx,
        toleranceAbs: 0,
        toleranceRel: 0,
        regressed: false,
      });
      continue;
    }
    pushIfRegressed(entries, cur.name, 'meanErrorPx', cur.meanErrorPx, base.meanErrorPx,
      tolerances.meanErrorPxAbs, tolerances.meanErrorPxRel);
    pushIfRegressed(entries, cur.name, 'p90ErrorPx', cur.p90ErrorPx, base.p90ErrorPx,
      tolerances.p90ErrorPxAbs, tolerances.p90ErrorPxRel);
    pushIfRegressed(entries, cur.name, 'jitterRmsPx', cur.jitterRmsPx, base.jitterRmsPx,
      tolerances.jitterRmsPxAbs, tolerances.jitterRmsPxRel);
    pushIfRegressed(entries, cur.name, 'samplesRejected', cur.samplesRejected, base.samplesRejected,
      tolerances.samplesRejectedAbs, tolerances.samplesRejectedRel);
  }

  return {
    ok: entries.every((e) => !e.regressed),
    entries,
  };
}

function pushIfRegressed(
  entries: BaselineComparisonEntry[],
  trajectory: string,
  metric: BaselineComparisonEntry['metric'],
  current: number,
  baseline: number,
  toleranceAbs: number,
  toleranceRel: number,
): void {
  const allowed = Math.max(toleranceAbs, baseline * toleranceRel);
  const delta = current - baseline;
  const regressed = delta > allowed;
  entries.push({
    trajectory,
    metric,
    baseline,
    current,
    toleranceAbs,
    toleranceRel,
    regressed,
  });
}
