// Simulador determinístico do pipeline de olhar — SÓ PARA TESTE.
//
// Por que existe: `fixtures/replay` é gitignored, então não há gravação real
// versionada contra a qual medir precisão por região. Sem isto, qualquer
// afirmação sobre "melhorou nos cantos" seria opinião. Este módulo gera um
// vetor de features com a MESMA estrutura de `extractCompactFeatures`
// (44 dims/olho: 37 do bloco geométrico + 7 do bloco L2CS) a partir de um
// alvo de tela conhecido, para que `StandardScaler` + `RidgeRegressor` reais
// possam ser treinados e medidos ponta a ponta.
//
// O QUE ELE MODELA (e por quê):
//
//  1. **Geometria real da sessão medida** — 23,6" 16:9 a 60 cm, a mesma do
//     relatório `accuracy-report-1787682565489`. (O `telaPolegadas: 15,6` que
//     aparece no JSON é o hardcode da UI, não a tela do usuário; ver
//     `DEFAULT_SCREEN_DIAGONAL_IN` em calibration.ts.) O deslocamento da íris
//     é `sin(ângulo do olho)`, não linear na posição de tela.
//
//  2. **Hipometria dependente de excentricidade** — o achado central da
//     investigação. Com a geometria correta os DOIS eixos restringem a curva
//     em conjunto, o que a determina bem melhor do que um eixo só:
//
//       eixo Y: demanda 12,4° nos alvos e 7,0° na validação; ganho medido
//               0,930 ≈ 1 → nenhuma queda mensurável até 12,4°, ou seja
//               o JOELHO da curva está em ~12,4° ou acima.
//       eixo X: demanda 21,4° nos alvos e 12,3° na validação; ganho medido
//               1,294. Como 12,3° está abaixo do joelho, h(12,3°)=1 e
//               portanto h(21,4°) = 1/1,294 = 0,773.
//
//     Ajuste linear por partes: joelho em 12,43°, inclinação
//     (1 − 0,773)/(21,4 − 12,43) = 0,0253 por grau.
//
//  3. **Deriva lenta por dimensão** — random-walk contínuo por frame, que é
//     como o tracker de landmarks realmente se comporta. É a fonte de erro
//     que fica ALIASADA com a identidade do alvo (cada alvo é uma janela
//     contígua de ~2 s) e que o Ridge confunde com sinal de olhar.
//
//  4. **Ruído de landmark por frame** — calibrado para reproduzir o jitter RMS
//     de ~50 px que o relatório real mediu.
//
// ⚠️ LIMITE HONESTO: os itens 2 e 3 são MODELOS, não medidas. A curva de
// hipometria vem de dois pontos de uma única sessão. Números absolutos deste
// simulador não são previsões de campo — ele serve para comparar variantes do
// pipeline sob condições idênticas e para travar regressões por região.

/** PRNG determinístico (mulberry32) — mesma semente, mesma sequência. */
export function mulberry32(a: number): () => number {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const SIM_SCREEN_W_PX = 1920;
export const SIM_SCREEN_H_PX = 1080;
/** Diagonal física da tela da sessão medida. */
export const SIM_SCREEN_IN = 23.6;
export const SIM_DIST_CM = 60;
const DIAG_CM = SIM_SCREEN_IN * 2.54;
const ASPECT = Math.hypot(16, 9);
export const SCREEN_W_CM = (DIAG_CM * 16) / ASPECT;   // ≈ 52,25 cm
export const SCREEN_H_CM = (DIAG_CM * 9) / ASPECT;    // ≈ 29,39 cm
const DIST_CM = SIM_DIST_CM;

// Hipometria ajustada em conjunto pelos dois eixos (ver cabeçalho).
const HYPO_KNEE_DEG = 12.43;
const HYPO_SLOPE_PER_DEG = (1 - 0.773) / (21.4 - HYPO_KNEE_DEG);

/** Onde o olho realmente aponta quando o usuário TENTA olhar para `nominal`
 *  (fração de tela) num eixo de tamanho físico `sizeCm`. */
export function achievedFraction(nominal: number, sizeCm: number): number {
  const offset = nominal - 0.5;
  if (offset === 0) return 0.5;
  const demandRad = Math.atan((Math.abs(offset) * sizeCm) / DIST_CM);
  const demandDeg = (demandRad * 180) / Math.PI;
  const gain = Math.max(0.5, 1 - HYPO_SLOPE_PER_DEG * Math.max(0, demandDeg - HYPO_KNEE_DEG));
  const achievedRad = demandRad * gain;
  const achievedOffset = (Math.tan(achievedRad) * DIST_CM) / sizeCm;
  return 0.5 + Math.sign(offset) * achievedOffset;
}

export interface SimOptions {
  seed: number;
  /** Frames retidos por alvo de calibração. ~55 é o observado em campo. */
  framesPerPoint: number;
  /** Ruído gaussiano por frame nos landmarks normalizados. 0.008 reproduz o
   *  jitter RMS de ~50 px do relatório real. */
  landmarkNoise: number;
  /** Jitter de pose por frame (rad). */
  poseJitter: number;
  /** Random-walk de pose por ALVO (rad). */
  poseDriftPerPoint: number;
  /** Ruído do L2CS (rad). */
  l2csNoise: number;
  /** Deriva lenta independente por dimensão, acumulada ao longo de uma
   *  janela de `framesPerPoint` frames. */
  dimDrift: number;
  /** Liga a hipometria dependente de excentricidade. */
  hypometria: boolean;
}

export const SIM_DEFAULTS: SimOptions = {
  seed: 12345,
  framesPerPoint: 55,
  landmarkNoise: 0.008,
  poseJitter: 0.006,
  poseDriftPerPoint: 0.01,
  l2csNoise: 0.02,
  dimDrift: 0.005,
  hypometria: true,
};

const FEATURE_DIM = 44;

export class GazeSimSession {
  private rnd: () => number;
  private yaw = 0.08;
  private pitch = -0.09;
  private roll = -0.045;
  private drift: number[] = new Array(FEATURE_DIM).fill(0);
  private readonly o: SimOptions;

  constructor(options: Partial<SimOptions> = {}) {
    this.o = { ...SIM_DEFAULTS, ...options };
    this.rnd = mulberry32(this.o.seed);
  }

  private gauss(): number {
    let u = 0, v = 0;
    while (u === 0) u = this.rnd();
    while (v === 0) v = this.rnd();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  }

  /** Avança a deriva lenta de pose. Chamar UMA vez por alvo. */
  advancePoint(): void {
    this.yaw += this.gauss() * this.o.poseDriftPerPoint;
    this.pitch += this.gauss() * this.o.poseDriftPerPoint;
    this.roll += this.gauss() * this.o.poseDriftPerPoint * 0.6;
  }

  private stepDrift(): void {
    const step = this.o.dimDrift / Math.sqrt(Math.max(1, this.o.framesPerPoint));
    for (let i = 0; i < this.drift.length; i++) this.drift[i] += this.gauss() * step;
  }

  /** Um frame com o usuário TENTANDO olhar para (sx, sy) em fração de tela.
   *  Devolve `[featuresLeft, featuresRight]` com 44 dims cada. */
  frame(sx: number, sy: number): [number[], number[]] {
    this.stepDrift();
    const o = this.o;
    const g = () => this.gauss();

    const ex = o.hypometria ? achievedFraction(sx, SCREEN_W_CM) : sx;
    const ey = o.hypometria ? achievedFraction(sy, SCREEN_H_CM) : sy;
    const thX = Math.atan(((ex - 0.5) * SCREEN_W_CM) / DIST_CM);
    const thY = Math.atan(((ey - 0.5) * SCREEN_H_CM) / DIST_CM);

    const yaw = this.yaw + g() * o.poseJitter;
    const pitch = this.pitch + g() * o.poseJitter;
    const roll = this.roll + g() * o.poseJitter;
    const scale = 0.3 + g() * 0.0008;

    const build = (side: 1 | -1): number[] => {
      const n = () => g() * o.landmarkNoise;
      const eyeRadius = 0.42;
      const offsetX = eyeRadius * Math.sin(thX - yaw) + n();
      const offsetY = eyeRadius * Math.sin(thY - pitch) + n();
      const width = 0.3 + n();
      const height = 0.11 + n() - 0.02 * Math.abs(thY);
      const relX = offsetX / width;
      const relY = offsetY / height;
      const r = 0.055;
      const irisContour = [
        offsetX + r + n(), offsetY + n(),
        offsetX + n(), offsetY + r + n(),
        offsetX - r + n(), offsetY + n(),
        offsetX + n(), offsetY - r + n(),
      ];
      // Cantos do olho no frame da cabeça: SEM sinal de olhar, só pose e ruído.
      const corners = [
        side * 0.16 + 0.04 * roll + n(), 0.02 + 0.05 * pitch + n(),
        side * 0.46 + 0.04 * roll + n(), 0.01 + 0.05 * pitch + n(),
        side * 0.31 + n(), 0.07 + 0.03 * pitch + n(),
        side * 0.31 + n(), -0.04 + 0.03 * pitch + n(),
      ];
      const ear = height / width;
      const irisRadius = r + n() * 0.4;
      const interactions = [
        offsetX * yaw, offsetY * pitch, offsetX * scale, offsetY * scale,
        offsetX * roll, offsetY * roll,
        offsetX * yaw * yaw, offsetY * pitch * pitch,
        offsetX * yaw * scale, offsetY * pitch * scale,
        yaw * scale, pitch * scale,
      ];
      // Bloco L2CS: mesmo layout de `buildL2CSBlock`.
      const ty = Math.tan(thX + g() * o.l2csNoise);
      const tp = Math.tan(thY + g() * o.l2csNoise);
      const d = 1 / scale;
      const l2cs = [ty, tp, ty * d, tp * d, ty * ty, tp * tp, ty * tp];

      const vec = [
        offsetX, offsetY, relX, relY,
        ...irisContour, ...corners,
        ear, irisRadius, yaw, pitch, roll,
        ...interactions, ...l2cs,
      ];
      for (let i = 0; i < vec.length; i++) {
        vec[i] += this.drift[i] * (Math.abs(vec[i]) + 0.05);
      }
      return vec;
    };

    return [build(1), build(-1)];
  }
}

/** Coleta uma sessão de calibração completa em ordem embaralhada (como a UI). */
export function simulateCalibration(
  targets: readonly { x: number; y: number }[],
  options: Partial<SimOptions> = {},
): {
  session: GazeSimSession;
  featuresLeft: number[][];
  featuresRight: number[][];
  targetsX: number[];
  targetsY: number[];
} {
  const o = { ...SIM_DEFAULTS, ...options };
  const session = new GazeSimSession(o);
  const featuresLeft: number[][] = [];
  const featuresRight: number[][] = [];
  const targetsX: number[] = [];
  const targetsY: number[] = [];

  const order = targets.map((_, i) => i);
  let a = o.seed ^ 0x9e37;
  const rnd = () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff; };
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }

  for (const idx of order) {
    const t = targets[idx];
    session.advancePoint();
    for (let f = 0; f < o.framesPerPoint; f++) {
      const [l, r] = session.frame(t.x, t.y);
      featuresLeft.push(l);
      featuresRight.push(r);
      targetsX.push(t.x);
      targetsY.push(t.y);
    }
  }
  return { session, featuresLeft, featuresRight, targetsX, targetsY };
}
