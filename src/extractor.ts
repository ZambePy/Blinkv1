// Extração de features por olho a partir dos 478 landmarks do Face Mesh.
//
// O vetor completo por olho tem 37 dimensões de geometria (offset da íris,
// contorno, cantos, pose da cabeça, interações) mais o bloco angular do L2CS
// quando o engine o passa. O modelo só vê a projeção no conjunto ativo — as 4
// dimensões destiladas de íris e as 2 angulares de 1ª ordem do L2CS. O resto
// existe porque a telemetria grava o vetor inteiro e porque as medições
// offline podem projetar outros conjuntos sobre a mesma gravação.

import { buildL2CSBlock } from './l2cs/block';
import { EXPERIMENT } from './config/experiment';
import {
  OLHO_ESQUERDO, OLHO_DIREITO, IRIS_ESQUERDA, IRIS_DIREITA,
  TESTA_TOPO, assertFaceMeshCompleto, meshAusenteOuParcial,
} from './faceLandmarks';

export type Point3D = { x: number; y: number; z: number; visibility?: number };

export interface GeometryFeatures {
  pupilCenterLeft: Point3D;
  pupilCenterRight: Point3D;
  irisRadiusLeft: number;
  irisRadiusRight: number;
  pupilEllipseLeft: { width: number; height: number };
  pupilEllipseRight: { width: number; height: number };
  interEyeDistance: number;
  eyeWidthLeft: number;
  eyeHeightLeft: number;
  eyeWidthRight: number;
  eyeHeightRight: number;
}

export interface FaceFeatures {
  pitch: number;
  yaw: number;
  roll: number;
  position3D: Point3D;
  scale: number;
  cameraDistanceEstimate: number;
}

/** Campos opcionais de propósito: ausente significa "não medido". Quem mede
 *  os pixels do crop é o `EyeQualityAnalyzer`; aqui só sai o que vem do EAR. */
export interface QualityFeatures {
  detectorConfidence?: number;
  brightnessEstimate?: number;
  contrastEstimate?: number;
  blurEstimate?: number;
  occlusionEstimate?: number;
  irisVisibilityPercentage?: number;
  specularRatio?: number;
  /** Quanto a mancha de brilho fica parada entre quadros. 1 = imóvel
   *  (assinatura de óculos, inócua); baixo = reflexo se movendo. */
  specularStability?: number;
}

export interface AdvancedFrameFeatures {
  geometry: GeometryFeatures;
  face: FaceFeatures;
  quality: QualityFeatures;
}

export interface ExtractorResult {
  featuresLeft: number[];
  featuresRight: number[];
  blinkDetected: boolean;
  advancedFeatures?: AdvancedFrameFeatures;
  /** EAR por olho, para o engine ponderar a fusão binocular. */
  leftEAR?: number;
  rightEAR?: number;
}

// ── Vetores ────────────────────────────────────────────────────────────────

function sub(v1: Point3D, v2: Point3D): Point3D { return { x: v1.x - v2.x, y: v1.y - v2.y, z: v1.z - v2.z }; }
function add(v1: Point3D, v2: Point3D): Point3D { return { x: v1.x + v2.x, y: v1.y + v2.y, z: v1.z + v2.z }; }
function scale(v: Point3D, s: number): Point3D { return { x: v.x * s, y: v.y * s, z: v.z * s }; }
function norm(v: Point3D): number { return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z); }
function normalize(v: Point3D): Point3D { return scale(v, 1 / (norm(v) + 1e-9)); }
function dot(v1: Point3D, v2: Point3D): number { return v1.x * v2.x + v1.y * v2.y + v1.z * v2.z; }
function cross(v1: Point3D, v2: Point3D): Point3D {
  return {
    x: v1.y * v2.z - v1.z * v2.y,
    y: v1.z * v2.x - v1.x * v2.z,
    z: v1.x * v2.y - v1.y * v2.x,
  };
}
function dist3D(p1: Point3D, p2: Point3D): number {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2 + (p1.z - p2.z) ** 2);
}
function aspectoValido(w?: number, h?: number): boolean {
  return typeof w === 'number' && typeof h === 'number' &&
    Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0;
}
/** Rᵀ·v, com R = [xAxis | yAxis | zAxis]. */
function mulRT(xAxis: Point3D, yAxis: Point3D, zAxis: Point3D, v: Point3D): Point3D {
  return { x: dot(xAxis, v), y: dot(yAxis, v), z: dot(zAxis, v) };
}

// ── Detecção de piscada ────────────────────────────────────────────────────

/** Piso do limiar adaptativo (escala isotrópica do EAR): abaixo disto o olho
 *  está fechado em qualquer pessoa. Evita que quadros ruins arrastem o limiar a zero. */
export const EAR_THR_MIN = 0.12;

/** Teto do limiar adaptativo. Precisa ficar acima de `repouso × blinkRatio`
 *  (≈ 0,31 × 0,8) para a adaptação acontecer, e abaixo do repouso de um olho
 *  aberto para ptose não virar piscada permanente. */
export const EAR_THR_MAX = 0.28;

/** Limiar absoluto de olho fechado, usado só no bootstrap (antes de haver
 *  histórico para adaptar). ~57% do repouso mediano. */
export const EAR_CLOSED_ABSOLUTE = 0.18;

/** Quadros que o bootstrap tolera sem acumular histórico antes de concluir que
 *  o limiar absoluto não vale para esta pessoa (~2 s a 30 fps). */
const BOOTSTRAP_MAX_FRAMES = 60;

/**
 * Detector de piscada com limiar adaptativo ao EAR de repouso da pessoa.
 * O histórico só recebe quadros sem piscada, senão o limiar realimenta a si
 * mesmo e olhos semi-fechados viram fixação válida.
 */
export class BlinkDetector {
  private nonBlinkHistory: number[] = [];
  private readonly histLen: number;
  private readonly minHistory: number;
  private readonly blinkRatio: number;
  private readonly thrMin: number;
  private readonly thrMax: number;
  /** Início de cada piscada (borda abriu→fechou), para a taxa por minuto. */
  private blinkStartTimestamps: number[] = [];
  private wasBlinking = false;
  private quadrosSemHistorico = 0;
  private avisouBootstrap = false;
  private static readonly TIMESTAMP_RETENTION_MS = 5 * 60 * 1000;

  constructor({
    histLen = 50,
    minHistory = 15,
    blinkRatio = 0.8,
    thrMin = EAR_THR_MIN,
    thrMax = EAR_THR_MAX,
  }: {
    histLen?: number;
    minHistory?: number;
    blinkRatio?: number;
    thrMin?: number;
    thrMax?: number;
  } = {}) {
    this.histLen = histLen;
    this.minHistory = minHistory;
    this.blinkRatio = blinkRatio;
    this.thrMin = thrMin;
    this.thrMax = thrMax;
  }

  /** true se o quadro é piscada. `nowMs` é injetável para testes. */
  update(ear: number, nowMs: number = Date.now()): boolean {
    let thr = EAR_CLOSED_ABSOLUTE;
    if (this.nonBlinkHistory.length >= this.minHistory) {
      const mean = this.nonBlinkHistory.reduce((a, b) => a + b, 0) / this.nonBlinkHistory.length;
      thr = Math.max(this.thrMin, Math.min(this.thrMax, mean * this.blinkRatio));
    }
    let blink = ear < thr;

    // Ptose severa: olho aberto abaixo do limiar absoluto. Sem esta guarda o
    // bootstrap trava — todo quadro vira piscada e o histórico nunca enche.
    if (blink && this.nonBlinkHistory.length < this.minHistory) {
      this.quadrosSemHistorico++;
      if (this.quadrosSemHistorico >= BOOTSTRAP_MAX_FRAMES) {
        blink = false;
        if (!this.avisouBootstrap) {
          this.avisouBootstrap = true;
          console.warn(
            `[blink] nenhum quadro acima de ${EAR_CLOSED_ABSOLUTE} em ` +
            `${this.quadrosSemHistorico} quadros (EAR atual ${ear.toFixed(3)}). ` +
            'Adotando o valor observado como repouso — provável ptose ou abertura reduzida.',
          );
        }
      }
    } else if (!blink) {
      this.quadrosSemHistorico = 0;
    }

    if (blink && !this.wasBlinking) {
      this.blinkStartTimestamps.push(nowMs);
      const cutoff = nowMs - BlinkDetector.TIMESTAMP_RETENTION_MS;
      while (this.blinkStartTimestamps.length > 0 && this.blinkStartTimestamps[0] < cutoff) {
        this.blinkStartTimestamps.shift();
      }
    }
    this.wasBlinking = blink;

    if (!blink) {
      this.nonBlinkHistory.push(ear);
      if (this.nonBlinkHistory.length > this.histLen) this.nonBlinkHistory.shift();
    }
    return blink;
  }

  reset(): void {
    this.nonBlinkHistory.length = 0;
    this.blinkStartTimestamps.length = 0;
    this.wasBlinking = false;
    this.quadrosSemHistorico = 0;
    this.avisouBootstrap = false;
  }

  /** Piscadas por minuto na janela recente. Repouso ≈ 15–20/min; acima de
   *  ~25/min sustentado sugere fadiga, brilho excessivo ou olho seco. */
  getBlinkRatePerMinute(windowMs: number = 60000, nowMs: number = Date.now()): number {
    const cutoff = nowMs - windowMs;
    let count = 0;
    for (let i = this.blinkStartTimestamps.length - 1; i >= 0; i--) {
      if (this.blinkStartTimestamps[i] >= cutoff) count++;
      else break;
    }
    return count * (60000 / windowMs);
  }

  get nonBlinkCount(): number {
    return this.nonBlinkHistory.length;
  }

  /** EAR de repouso desta pessoa; `null` enquanto não há histórico suficiente. */
  get restingEar(): number | null {
    if (this.nonBlinkHistory.length < this.minHistory) return null;
    return this.nonBlinkHistory.reduce((a, b) => a + b, 0) / this.nonBlinkHistory.length;
  }
}

/** Fração da abertura de repouso visível neste quadro. `undefined` sem base
 *  observada — nem 0 (íris oculta) nem 1 (visível) seriam medições. */
export function irisVisibilityFromEar(ear: number, earDeRepouso: number | null): number | undefined {
  if (earDeRepouso === null || !Number.isFinite(earDeRepouso) || earDeRepouso <= 0) return undefined;
  if (!Number.isFinite(ear)) return undefined;
  return Math.min(1, Math.max(0, ear / earDeRepouso));
}

const _blinkDetector = new BlinkDetector();

export function resetEarHistory(): void {
  _blinkDetector.reset();
}

export function getRecentBlinkRatePerMinute(windowMs: number = 60000): number {
  return _blinkDetector.getBlinkRatePerMinute(windowMs);
}

// ── Conjunto de features ───────────────────────────────────────────────────
//
// Layout do vetor completo por olho:
//   [0]      offsetX      íris vs. centro do olho, horizontal
//   [1]      offsetY      idem vertical
//   [2]      relX         offsetX / largura do olho
//   [3]      relY         offsetY / altura do olho
//   [4..11]  contorno da íris — 4 pontos × (x,y)
//   [12..19] cantos do olho — interno, externo, topo, base × (x,y)
//   [20]     ear
//   [21]     irisRadius
//   [22..24] yaw, pitch, roll da cabeça
//   [25..36] interações pose × offset
//   [37..43] bloco L2CS — só quando o engine passa gaze
//
// O modelo usa `irisCore` (+ as duas dims angulares do L2CS). Medido em
// gravações reais: 9 alvos não determinam 45 parâmetros por olho, e as
// dimensões extras dão ao Ridge liberdade para memorizar aglomerados
// (140 px com 12 dims contra 322 px com 44). A pose fica fora do vetor de
// propósito — ela é correlacionada com a ordem de coleta e viraria atalho;
// quem trata pose é a compensação geométrica na saída.

/** Versão da semântica do vetor. Incrementar quando a interpretação de
 *  qualquer dimensão mudar — é o que invalida perfis salvos. */
export const FEATURE_FORMAT_VERSION = 2;

export type FeatureSet = 'irisCore' | 'irisCore+l2cs' | 'irisCore+l2csFull' | 'compact';

const FEATURE_SET_INDICES: Record<Exclude<FeatureSet, 'compact'>, readonly number[]> = {
  'irisCore': [0, 1, 2, 3],
  'irisCore+l2cs': [0, 1, 2, 3, 37, 38],
  /**
   * O bloco angular INTEIRO (sprint S7).
   *
   * O conjunto de produção leva só `tan yaw` e `tan pitch` do bloco de sete
   * dimensões. A expansão polinomial de grau 2 recria os quadrados e o cruzado
   * dessas duas — mas NÃO recria os produtos com a distância (índices 39 e 40),
   * que são justamente os que carregam geometria: o mesmo ângulo de olhar
   * aponta para lugares diferentes conforme a cabeça esteja perto ou longe.
   *
   * Onze dimensões viram 77 depois da expansão, contra 27 hoje. Com nove alvos
   * e ~15 amostras por alvo isso é território de decorar, e a validação cruzada
   * leave-one-target-out é a única defesa. Se o λ escolhido encostar no teto da
   * grade (1e3), o modelo está dizendo que não quer estas dimensões — e a
   * resposta certa é aceitar, não insistir.
   *
   * Conjunto de ABLAÇÃO, não de produção: trocar o conjunto muda o
   * `FEATURE_VECTOR_ID` e invalida os perfis salvos, por construção.
   */
  'irisCore+l2csFull': [0, 1, 2, 3, 37, 38, 39, 40, 41, 42, 43],
};

const FEATURE_SET_MIN_LENGTH: Record<Exclude<FeatureSet, 'compact'>, number> = {
  'irisCore': 4,
  'irisCore+l2cs': 39,
  'irisCore+l2csFull': 44,
};

/** Índices do bloco L2CS no vetor completo. */
const L2CS_FULL_INDICES: readonly number[] = [37, 38, 39, 40, 41, 42, 43];

/** Conjunto ativo. Resolvido uma vez no boot: sem L2CS, o modelo vê só as
 *  quatro dimensões de íris. */
export const ACTIVE_FEATURE_SET: FeatureSet =
  EXPERIMENT.l2cs === 'off'
    ? 'irisCore'
    : EXPERIMENT.blocoL2csCompleto
      ? 'irisCore+l2csFull'
      : 'irisCore+l2cs';

/** Posições do bloco L2CS dentro do vetor já projetado (vazio quando o
 *  conjunto não carrega bloco angular). */
export function l2csSlotsInSet(set: FeatureSet = ACTIVE_FEATURE_SET): number[] {
  if (set === 'compact') return [...L2CS_FULL_INDICES];
  const indices = FEATURE_SET_INDICES[set];
  const slots: number[] = [];
  for (let pos = 0; pos < indices.length; pos++) {
    if (L2CS_FULL_INDICES.includes(indices[pos])) slots.push(pos);
  }
  return slots;
}

/** Dimensões por olho que o conjunto entrega ao modelo (`compact` é variável). */
export function activeFeatureDims(set: FeatureSet = ACTIVE_FEATURE_SET): number | 'var' {
  return set === 'compact' ? 'var' : FEATURE_SET_INDICES[set].length;
}

/** Identidade do vetor que este build produz; vai no cabeçalho das gravações
 *  e na chave dos perfis salvos. */
export const FEATURE_VECTOR_ID = `${ACTIVE_FEATURE_SET}:${activeFeatureDims()}`;

export function featureVectorId(set: FeatureSet = ACTIVE_FEATURE_SET): string {
  return `${set}:${activeFeatureDims(set)}`;
}

/**
 * Projeta o vetor completo no conjunto ativo.
 *
 * Vetor vazio (quadro sem rosto) devolve vazio. Vetor curto demais LANÇA: o
 * fallback silencioso deixava um vetor de 37 dims (sem o bloco angular) chegar
 * ao Ridge sob a identidade de 6 dims, e o paciente perdia a calibração no
 * meio da sessão com um `RangeError` no primeiro quadro.
 */
export function projectFeatureSet(
  full: number[],
  set: FeatureSet = ACTIVE_FEATURE_SET,
): number[] {
  if (set === 'compact') return full;
  if (full.length === 0) return [];
  const min = FEATURE_SET_MIN_LENGTH[set];
  if (full.length < min) {
    throw new RangeError(
      `[extractor] projectFeatureSet: conjunto '${set}' exige comprimento >= ${min}, ` +
      `recebeu ${full.length}. O bloco angular do L2CS não foi anexado — o worker ` +
      `ainda não saiu de 'loading' ou o engine passou l2csGaze=null.`,
    );
  }
  const idx = FEATURE_SET_INDICES[set];
  const out = new Array<number>(idx.length);
  for (let i = 0; i < idx.length; i++) out[i] = full[idx[i]];
  return out;
}

// ── Análise do rosto ───────────────────────────────────────────────────────

export interface FaceAnalysis {
  /** false quando o quadro não tem rosto ou o mesh está parcial. */
  present: boolean;
  blinkDetected: boolean;
  advancedFeatures?: AdvancedFrameFeatures;
  leftEAR?: number;
  rightEAR?: number;
}

/**
 * Pose da cabeça, EAR, piscada e geometria ocular de um quadro.
 *
 * Lança `FaceMeshTopologyError` quando o mesh tem 468 pontos (modelo sem íris,
 * condição permanente); devolve `present: false` quando o quadro está sem
 * rosto ou parcial (transitório).
 */
export function analyzeFace(
  landmarks: Point3D[],
  faceMatrix?: Float32Array,
  videoWidth?: number,
  videoHeight?: number,
  blinkDetector?: BlinkDetector,
): FaceAnalysis {
  assertFaceMeshCompleto(landmarks);
  if (meshAusenteOuParcial(landmarks)) {
    return { present: false, blinkDetected: false };
  }

  // Referencial da cabeça: eixo x entre os cantos externos, y para o topo da
  // testa, z = x × y. A distância intercantal rotacionada é a escala.
  const leftCorner = landmarks[OLHO_ESQUERDO.externo];
  const rightCorner = landmarks[OLHO_DIREITO.externo];
  const topOfHead = landmarks[TESTA_TOPO];
  const eyeCenter = scale(add(leftCorner, rightCorner), 0.5);
  const xAxis = normalize(sub(rightCorner, leftCorner));
  const yApprox = normalize(sub(topOfHead, eyeCenter));
  const yAxis = normalize(sub(yApprox, scale(xAxis, dot(yApprox, xAxis))));
  const zAxis = normalize(cross(xAxis, yAxis));

  const leftCornerRot = mulRT(xAxis, yAxis, zAxis, sub(leftCorner, eyeCenter));
  const rightCornerRot = mulRT(xAxis, yAxis, zAxis, sub(rightCorner, eyeCenter));
  const interEyeDistRaw = norm(sub(rightCornerRot, leftCornerRot));

  // Euler a partir dos landmarks, para quando não há matriz facial. Os
  // landmarks vêm em coordenadas de imagem (y para baixo, z para a câmera) e a
  // matriz em coordenadas métricas (y para cima): passar de um para o outro é
  // negar y e z, o que dá estas fórmulas — as mesmas do ramo da matriz.
  let pitch = Math.asin(Math.max(-1, Math.min(1, zAxis.y)));
  let yaw = Math.atan2(zAxis.x, -zAxis.z);
  let roll = Math.atan2(-xAxis.y, -yAxis.y);
  let pos3D = eyeCenter;

  if (faceMatrix && faceMatrix.length === 16) {
    const r02 = faceMatrix[8];
    const r10 = faceMatrix[1], r11 = faceMatrix[5], r12 = faceMatrix[9];
    const r22 = faceMatrix[10];
    // Clamp antes do asin: |r12| ligeiramente > 1 por ponto flutuante daria
    // NaN, e um NaN corrompe o StandardScaler inteiro.
    pitch = Math.asin(Math.max(-1, Math.min(1, -r12)));
    yaw = Math.atan2(r02, r22);
    roll = Math.atan2(r10, r11);
    pos3D = { x: faceMatrix[12], y: faceMatrix[13], z: faceMatrix[14] };
  }

  // EAR por olho, em 3D (a componente z importa quando a cabeça inclina) e na
  // escala isotrópica: o MediaPipe normaliza x pela largura e y pela altura do
  // vídeo, então o EAR cru sai inflado por W/H (1,78× em 16:9). Sem as
  // dimensões do vídeo o valor fica cru em vez de corrigido com um chute.
  const lInner = landmarks[OLHO_ESQUERDO.interno], lOuter = landmarks[OLHO_ESQUERDO.externo];
  const lTop = landmarks[OLHO_ESQUERDO.superior], lBottom = landmarks[OLHO_ESQUERDO.inferior];
  const rInner = landmarks[OLHO_DIREITO.interno], rOuter = landmarks[OLHO_DIREITO.externo];
  const rTop = landmarks[OLHO_DIREITO.superior], rBottom = landmarks[OLHO_DIREITO.inferior];
  const lWidth = dist3D(lOuter, lInner);
  const lHeight = dist3D(lTop, lBottom);
  const rWidth = dist3D(rOuter, rInner);
  const rHeight = dist3D(rTop, rBottom);
  const earAspecto = aspectoValido(videoWidth, videoHeight)
    ? (videoHeight as number) / (videoWidth as number)
    : 1;
  const leftEAR = (lHeight / (lWidth + 1e-9)) * earAspecto;
  const rightEAR = (rHeight / (rWidth + 1e-9)) * earAspecto;
  const ear = (leftEAR + rightEAR) / 2;

  const detector = blinkDetector ?? _blinkDetector;
  const blinkDetected = detector.update(ear);
  // Lido depois do `update`: com o olho aberto o quadro entra na média e a
  // razão dá 1; numa piscada o quadro não entra e a razão despenca.
  const earDeRepouso = detector.restingEar;

  const irisCenterL = landmarks[IRIS_ESQUERDA.centro];
  const irisCenterR = landmarks[IRIS_DIREITA.centro];
  // Raio pelo eixo horizontal do anel, que é o menos afetado pela pálpebra.
  const irisRadiusL = (dist3D(irisCenterL, landmarks[IRIS_ESQUERDA.direita])
                     + dist3D(irisCenterL, landmarks[IRIS_ESQUERDA.esquerda])) / 2;
  const irisRadiusR = (dist3D(irisCenterR, landmarks[IRIS_DIREITA.direita])
                     + dist3D(irisCenterR, landmarks[IRIS_DIREITA.esquerda])) / 2;

  const geometry: GeometryFeatures = {
    pupilCenterLeft: irisCenterL,
    pupilCenterRight: irisCenterR,
    irisRadiusLeft: irisRadiusL,
    irisRadiusRight: irisRadiusR,
    pupilEllipseLeft: {
      width: dist3D(landmarks[IRIS_ESQUERDA.direita], landmarks[IRIS_ESQUERDA.esquerda]),
      height: dist3D(landmarks[IRIS_ESQUERDA.superior], landmarks[IRIS_ESQUERDA.inferior]),
    },
    pupilEllipseRight: {
      width: dist3D(landmarks[IRIS_DIREITA.direita], landmarks[IRIS_DIREITA.esquerda]),
      height: dist3D(landmarks[IRIS_DIREITA.superior], landmarks[IRIS_DIREITA.inferior]),
    },
    interEyeDistance: interEyeDistRaw,
    eyeWidthLeft: lWidth,
    eyeHeightLeft: lHeight,
    eyeWidthRight: rWidth,
    eyeHeightRight: rHeight,
  };

  const face: FaceFeatures = {
    pitch,
    yaw,
    roll,
    position3D: pos3D,
    scale: interEyeDistRaw,
    cameraDistanceEstimate: 1.0 / (interEyeDistRaw + 1e-9),
  };

  const quality: QualityFeatures = {
    irisVisibilityPercentage: irisVisibilityFromEar(ear, earDeRepouso),
  };

  return {
    present: true,
    blinkDetected,
    advancedFeatures: { geometry, face, quality },
    leftEAR,
    rightEAR,
  };
}

/** Gaze do L2CS como o engine entrega: radianos, com validade e confiança. */
export interface L2CSGazeInput {
  yaw: number;
  pitch: number;
  valid: boolean;
  confidence?: number;
}

/** Vetor completo por olho (37 dims + bloco L2CS quando `l2csGaze` é passado). */
export function extractCompactFeatures(
  landmarks: Point3D[],
  faceMatrix?: Float32Array,
  l2csGaze?: L2CSGazeInput | null,
  blinkDetector?: BlinkDetector,
  videoWidth?: number,
  videoHeight?: number,
): ExtractorResult {
  const analysis = analyzeFace(landmarks, faceMatrix, videoWidth, videoHeight, blinkDetector);
  if (!analysis.present) return { featuresLeft: [], featuresRight: [], blinkDetected: false };

  const leftCorner = landmarks[OLHO_ESQUERDO.externo];
  const rightCorner = landmarks[OLHO_DIREITO.externo];
  const topOfHead = landmarks[TESTA_TOPO];

  const eyeCenter = scale(add(leftCorner, rightCorner), 0.5);
  const xAxis = normalize(sub(rightCorner, leftCorner));
  const yApprox = normalize(sub(topOfHead, eyeCenter));
  const yAxis = normalize(sub(yApprox, scale(xAxis, dot(yApprox, xAxis))));
  const zAxis = normalize(cross(xAxis, yAxis));

  const rot = (p: Point3D) => mulRT(xAxis, yAxis, zAxis, sub(p, eyeCenter));
  const interEyeDistRaw = norm(sub(rot(rightCorner), rot(leftCorner))) || 1;
  const rotS = (idx: number) => {
    const p = rot(landmarks[idx]);
    return { x: p.x / interEyeDistRaw, y: p.y / interEyeDistRaw };
  };

  const face = analysis.advancedFeatures!.face;
  const pose = { yaw: face.yaw, pitch: face.pitch, roll: face.roll, scale: face.scale };

  const eyeVector = (
    irisCenter: number, irisP: number[],
    cInner: number, cOuter: number, cTop: number, cBot: number,
  ) => {
    const cI = rotS(cInner), cO = rotS(cOuter), cT = rotS(cTop), cB = rotS(cBot);
    const iC = rotS(irisCenter);

    const midX = (cI.x + cO.x) * 0.5;
    const midY = (cI.y + cO.y) * 0.5;
    const offsetX = iC.x - midX;
    const offsetY = iC.y - midY;

    const width = Math.sqrt((cO.x - cI.x) ** 2 + (cO.y - cI.y) ** 2) || 1e-9;
    const height = Math.sqrt((cT.x - cB.x) ** 2 + (cT.y - cB.y) ** 2) || 1e-9;
    const relX = offsetX / width;
    const relY = offsetY / height;

    const irisContour = irisP.flatMap((idx) => {
      const p = rotS(idx);
      return [p.x, p.y];
    });
    const corners = [cI.x, cI.y, cO.x, cO.y, cT.x, cT.y, cB.x, cB.y];
    const ear = height / width;
    const irisRadius = Math.sqrt(
      (rotS(irisP[0]).x - rotS(irisP[2]).x) ** 2 + (rotS(irisP[0]).y - rotS(irisP[2]).y) ** 2,
    ) / 2;

    const interactions = [
      offsetX * pose.yaw,
      offsetY * pose.pitch,
      offsetX * pose.scale,
      offsetY * pose.scale,
      offsetX * pose.roll,
      offsetY * pose.roll,
      offsetX * pose.yaw * pose.yaw,
      offsetY * pose.pitch * pose.pitch,
      offsetX * pose.yaw * pose.scale,
      offsetY * pose.pitch * pose.scale,
      pose.yaw * pose.scale,
      pose.pitch * pose.scale,
    ];

    return [
      offsetX, offsetY,
      relX, relY,
      ...irisContour,
      ...corners,
      ear, irisRadius,
      pose.yaw, pose.pitch, pose.roll,
      ...interactions,
    ];
  };

  const compLeft = eyeVector(
    IRIS_ESQUERDA.centro, [IRIS_ESQUERDA.direita, IRIS_ESQUERDA.superior, IRIS_ESQUERDA.esquerda, IRIS_ESQUERDA.inferior],
    OLHO_ESQUERDO.interno, OLHO_ESQUERDO.externo, OLHO_ESQUERDO.superior, OLHO_ESQUERDO.inferior,
  );
  const compRight = eyeVector(
    IRIS_DIREITA.centro, [IRIS_DIREITA.direita, IRIS_DIREITA.superior, IRIS_DIREITA.esquerda, IRIS_DIREITA.inferior],
    OLHO_DIREITO.interno, OLHO_DIREITO.externo, OLHO_DIREITO.superior, OLHO_DIREITO.inferior,
  );

  // O bloco angular é do rosto, não do olho: os dois lados recebem o mesmo.
  // Sem gaze nada é anexado, e a projeção no conjunto ativo lança.
  if (l2csGaze != null) {
    const block = buildL2CSBlock(
      l2csGaze.yaw,
      l2csGaze.pitch,
      l2csGaze.valid,
      face.cameraDistanceEstimate,
      l2csGaze.confidence,
    );
    for (let i = 0; i < block.length; i++) {
      compLeft.push(block[i]);
      compRight.push(block[i]);
    }
  }

  return {
    featuresLeft: compLeft,
    featuresRight: compRight,
    blinkDetected: analysis.blinkDetected,
    advancedFeatures: analysis.advancedFeatures,
    leftEAR: analysis.leftEAR,
    rightEAR: analysis.rightEAR,
  };
}
