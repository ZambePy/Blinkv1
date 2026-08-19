import { buildL2CSBlock } from './l2cs/block';
import { EXPERIMENT } from './config/experiment';

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

export interface QualityFeatures {
  detectorConfidence: number;
  brightnessEstimate: number;
  contrastEstimate: number;
  blurEstimate: number;
  occlusionEstimate: number;
  irisVisibilityPercentage: number;
  // A1-5 — fração de pixels do crop ocular com luminância > SPECULAR_LUMINANCE
  // (default 0.95). Pele e esclera raramente saturam sob exposição correta;
  // lente refletindo a tela, sim. Opcional para compat com testes/perfis
  // antigos serializados antes de A1-5.
  specularRatio?: number;
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
}

// EyeTrax Indices
const LEFT_EYE_INDICES = [
  107,  66, 105,  63,  70,  55,  65,  52,  53,  46, 468, 469, 470, 471, 472,
  133,  33, 173, 157, 158, 159, 160, 161, 246, 155, 154, 153, 145, 144, 163,   7,
  243, 190,  56,  28,  27,  29,  30, 247, 130,  25, 110,  24,  23,  22,  26, 112,
  244, 189, 221, 222, 223, 224, 225, 113, 226,  31, 228, 229, 230, 231, 232, 233,
  193, 245, 128, 121, 120, 119, 118, 117, 111,  35, 124, 143, 156
];

const RIGHT_EYE_INDICES = [
  336, 296, 334, 293, 300, 285, 295, 282, 283, 276, 473, 476, 475, 474, 477,
  362, 263, 398, 384, 385, 386, 387, 388, 466, 382, 381, 380, 374, 373, 390, 249,
  463, 414, 286, 258, 257, 259, 260, 467, 359, 255, 339, 254, 253, 252, 256, 341,
  464, 413, 441, 442, 443, 444, 445, 342, 446, 261, 448, 449, 450, 451, 452, 453,
  417, 465, 357, 350, 349, 348, 347, 346, 340, 265, 353, 372, 383
];

const MUTUAL_INDICES = [
  4, 10, 151, 9, 152, 234, 454, 58, 288
];

// Vector Math Helpers
function sub(v1: Point3D, v2: Point3D): Point3D { return { x: v1.x - v2.x, y: v1.y - v2.y, z: v1.z - v2.z }; }
function add(v1: Point3D, v2: Point3D): Point3D { return { x: v1.x + v2.x, y: v1.y + v2.y, z: v1.z + v2.z }; }
function scale(v: Point3D, s: number): Point3D { return { x: v.x * s, y: v.y * s, z: v.z * s }; }
function norm(v: Point3D): number { return Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z); }
function normalize(v: Point3D): Point3D { 
  const n = norm(v) + 1e-9;
  return scale(v, 1/n);
}
function dot(v1: Point3D, v2: Point3D): number { return v1.x*v2.x + v1.y*v2.y + v1.z*v2.z; }
function cross(v1: Point3D, v2: Point3D): Point3D {
  return {
    x: v1.y * v2.z - v1.z * v2.y,
    y: v1.z * v2.x - v1.x * v2.z,
    z: v1.x * v2.y - v1.y * v2.x
  };
}
// BUG-3: dist2D foi substituída por dist3D no cálculo de EAR.
function dist3D(p1: Point3D, p2: Point3D): number {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2 + (p1.z - p2.z) ** 2);
}

// R^T * v = [dot(x_axis, v), dot(y_axis, v), dot(z_axis, v)]
function mulRT(xAxis: Point3D, yAxis: Point3D, zAxis: Point3D, v: Point3D): Point3D {
  return {
    x: dot(xAxis, v),
    y: dot(yAxis, v),
    z: dot(zAxis, v)
  };
}

// A2-4 — detector de piscada encapsulado em classe com reset() explícito.
// O design anterior usava um array `earHistory` de escopo de módulo que:
//   1. Nunca era resetado entre sessões (até o fix de A0-4 adicionar resetEarHistory)
//   2. Incluia frames de piscada no cálculo do threshold adaptativo —
//      criando realimentação: quanto mais piscadas → média EAR menor → threshold
//      menor → menos piscadas detectadas → frames de olho semifechado entram
//      no regressor como fixação válida. Em usuário com ELA (fadiga progressiva)
//      isso causa deriva de precisão ao longo da sessão.
//   3. Não tinha clamping — o threshold podia cair abaixo de 0.10 (nunca
//      detecta piscada) ou subir acima de 0.22 (detecta olho semi-fechado
//      como piscada em usuários com ptose).
//
// BlinkDetector corrige tudo isso. Sem flag — o comportamento anterior era
// indefensável.
export class BlinkDetector {
  private nonBlinkHistory: number[] = [];
  private readonly histLen: number;
  private readonly minHistory: number;
  private readonly blinkRatio: number;
  private readonly thrMin: number;
  private readonly thrMax: number;

  // thrMin/thrMax derivados da fisiologia: EAR mínimo do olho aberto
  // (0.10) e máximo prático para não confundir olho semi-fechado (ptose)
  // com piscada (0.22).
  constructor({
    histLen = 50,
    minHistory = 15,
    blinkRatio = 0.8,
    thrMin = 0.10,
    thrMax = 0.22,
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

  // Retorna true se o frame é piscada. Atualiza o histórico só com
  // frames de NÃO piscada (quebra a realimentação).
  update(ear: number): boolean {
    // Calcula threshold adaptativo sobre frames de não-piscada anteriores
    let thr = this.thrMax; // default conservador: só olho bem fechado conta
    if (this.nonBlinkHistory.length >= this.minHistory) {
      const mean = this.nonBlinkHistory.reduce((a, b) => a + b, 0) / this.nonBlinkHistory.length;
      thr = Math.max(this.thrMin, Math.min(this.thrMax, mean * this.blinkRatio));
    }
    const blink = ear < thr;

    // Só adiciona ao histórico quando não é piscada — garante que a média
    // representa o EAR de repouso, não a mistura com olho fechado.
    if (!blink) {
      this.nonBlinkHistory.push(ear);
      if (this.nonBlinkHistory.length > this.histLen) {
        this.nonBlinkHistory.shift();
      }
    }
    return blink;
  }

  reset(): void {
    this.nonBlinkHistory.length = 0;
  }

  /** Para testes: quantos frames de não-piscada estão no histórico. */
  get nonBlinkCount(): number {
    return this.nonBlinkHistory.length;
  }
}

// EAR Blink Detection — instância do módulo (compat com resetEarHistory)
const _blinkDetector = new BlinkDetector();

// BUG-1: earHistory era estado mutável de módulo nunca resetado entre sessões.
// Agora delega para BlinkDetector.reset().
export function resetEarHistory(): void {
  _blinkDetector.reset();
}

// A2-5 — versão do formato de calibração. Incrementar quando mudança de
// pipeline invalida perfis salvos (ex: ligar isotropicLandmarks muda o vetor).
export const RECORDING_FORMAT_VERSION = 2;

export function extractEyeFeatures(
  landmarks: Point3D[],
  faceMatrix?: Float32Array,
  videoWidth?: number,
  videoHeight?: number,
): ExtractorResult {
  if (landmarks.length < 478) {
    return { featuresLeft: [], featuresRight: [], blinkDetected: false };
  }

  // 1. Head Pose Normalization (EyeTrax Logic)
  //
  // A2-5 — correção de anisotropia de aspect ratio (atrás de flag).
  // O MediaPipe normaliza x por videoWidth e y por videoHeight. Em 1920×1080
  // a escala de x é 1.78× maior que a de y. Distâncias euclidianas que misturam
  // as duas ficam distorcidas: o vetor interocular muda de comprimento quando
  // a cabeça inclina, mesmo com distância física constante. Isso faz a escala
  // de normalização (`interEyeDistRaw`) oscilar com o roll da cabeça.
  //
  // Correção: multiplicar x (e z) por (W/H) para equalizar as escalas antes
  // de qualquer cálculo de distância. Só ativado quando
  // EXPERIMENT.isotropicLandmarks === true (default false).
  //
  // ⚠️ Atenção: quando ligado, perfis calibrados anteriormente são
  // incompatíveis — o vetor de features muda. RECORDING_FORMAT_VERSION
  // foi incrementado para forçar invalidação de perfis salvos (A2-7).
  let workingLandmarks = landmarks;
  if (EXPERIMENT.isotropicLandmarks && videoWidth && videoHeight && videoHeight > 0) {
    const aspectRatio = videoWidth / videoHeight;
    workingLandmarks = landmarks.map(p => ({
      ...p,
      x: p.x * aspectRatio,
      z: p.z * aspectRatio,
    }));
  }

  const leftCorner = workingLandmarks[33];
  const rightCorner = workingLandmarks[263];
  const topOfHead = workingLandmarks[10];

  const eyeCenter = scale(add(leftCorner, rightCorner), 0.5);
  
  let xAxis = sub(rightCorner, leftCorner);
  xAxis = normalize(xAxis);
  
  let yApprox = sub(topOfHead, eyeCenter);
  yApprox = normalize(yApprox);
  
  let yAxis = sub(yApprox, scale(xAxis, dot(yApprox, xAxis)));
  yAxis = normalize(yAxis);
  
  let zAxis = cross(xAxis, yAxis);
  zAxis = normalize(zAxis);

  // Rotate points using R^T
  const rotatedPoints: Point3D[] = [];
  for (let i = 0; i < workingLandmarks.length; i++) {
    const shifted = sub(workingLandmarks[i], eyeCenter);
    const rot = mulRT(xAxis, yAxis, zAxis, shifted);
    rotatedPoints.push(rot);
  }

  const leftCornerRot = mulRT(xAxis, yAxis, zAxis, sub(leftCorner, eyeCenter));
  const rightCornerRot = mulRT(xAxis, yAxis, zAxis, sub(rightCorner, eyeCenter));
  const interEyeDistRaw = norm(sub(rightCornerRot, leftCornerRot));

  if (interEyeDistRaw > 1e-7) {
    for (let i = 0; i < rotatedPoints.length; i++) {
      rotatedPoints[i] = scale(rotatedPoints[i], 1 / interEyeDistRaw);
    }
  }

  // Flatten subset features Binocularly
  const featuresLeft: number[] = [];
  const featuresRight: number[] = [];
  
  for (const idx of LEFT_EYE_INDICES) {
    const p = rotatedPoints[idx];
    featuresLeft.push(p.x, p.y, p.z);
  }
  for (const idx of RIGHT_EYE_INDICES) {
    const p = rotatedPoints[idx];
    featuresRight.push(p.x, p.y, p.z);
  }

  for (const idx of MUTUAL_INDICES) {
    const p = rotatedPoints[idx];
    featuresLeft.push(p.x, p.y, p.z);
    featuresRight.push(p.x, p.y, p.z);
  }

  // Basic Euler angles from landmarks
  let yaw = Math.atan2(xAxis.y, xAxis.x);
  let pitch = Math.atan2(-xAxis.z, Math.sqrt(yAxis.z ** 2 + zAxis.z ** 2));
  let roll = Math.atan2(yAxis.z, zAxis.z);

  let pos3D = eyeCenter;
  let scale3D = interEyeDistRaw;
  
  if (faceMatrix && faceMatrix.length === 16) {
    const r02 = faceMatrix[8];
    const r10 = faceMatrix[1], r11 = faceMatrix[5], r12 = faceMatrix[9];
    const r22 = faceMatrix[10];

    // Clamp para [-1,1] antes do asin — erros de ponto flutuante na matriz do
    // MediaPipe podem produzir |r12| ligeiramente > 1, fazendo Math.asin retornar NaN.
    // NaN corromperia o StandardScaler (mean/std=NaN) e degeneraria o regressor para
    // prever ~centro constante, causando cursor estático após calibração.
    pitch = Math.asin(Math.max(-1, Math.min(1, -r12)));
    yaw = Math.atan2(r02, r22);
    roll = Math.atan2(r10, r11);

    pos3D = { x: faceMatrix[12], y: faceMatrix[13], z: faceMatrix[14] };
  }

  featuresLeft.push(yaw, pitch, roll);
  featuresRight.push(yaw, pitch, roll);

  // ── Offset explícito da íris (feature de alta sinalização) ──────────────
  // O regressor linear precisa desta feature explícita porque o mapeamento
  // iris_coord_raw → gaze é mais linear quando expresso como deslocamento
  // relativo ao centro do olho (canto nasal + temporal) do que em coordenadas
  // brutas que incluem variação de pose da cabeça.

  const midXL = (rotatedPoints[33].x + rotatedPoints[133].x) * 0.5;
  const midYL = (rotatedPoints[33].y + rotatedPoints[133].y) * 0.5;
  const irisL = rotatedPoints[468];
  featuresLeft.push(
    irisL.x - midXL,  // offset horizontal da íris em relação ao centro do olho
    irisL.y - midYL,  // offset vertical
  );

  const midXR = (rotatedPoints[263].x + rotatedPoints[362].x) * 0.5;
  const midYR = (rotatedPoints[263].y + rotatedPoints[362].y) * 0.5;
  const irisR = rotatedPoints[473];
  featuresRight.push(
    irisR.x - midXR,
    irisR.y - midYR,
  );

  // 2. Blink Detection & Dimensions
  const lInner = landmarks[133], lOuter = landmarks[33], lTop = landmarks[159], lBottom = landmarks[145];
  const rInner = landmarks[362], rOuter = landmarks[263], rTop = landmarks[386], rBottom = landmarks[374];

  // BUG-3: dist2D perdia a componente Z dos landmarks 3D do MediaPipe.
  // Para cabeça inclinada (pitch > 0), a altura do olho em 2D parece menor
  // que a real → EAR artificialmente baixo → falsa piscada → frame rejeitado
  // na calibração. dist3D corrige isso sem custo adicional (já definida).
  const lWidth = dist3D(lOuter, lInner);
  const lHeight = dist3D(lTop, lBottom);
  const leftEAR = lHeight / (lWidth + 1e-9);

  const rWidth = dist3D(rOuter, rInner);
  const rHeight = dist3D(rTop, rBottom);
  const rightEAR = rHeight / (rWidth + 1e-9);

  const ear = (leftEAR + rightEAR) / 2;
  
  const blinkDetected = _blinkDetector.update(ear);

  // 3. Geometry Extractions
  const irisCenterL = landmarks[468];
  const irisCenterR = landmarks[473];
  
  const irisRadiusL = (dist3D(irisCenterL, landmarks[469]) + dist3D(irisCenterL, landmarks[471])) / 2;
  const irisRadiusR = (dist3D(irisCenterR, landmarks[474]) + dist3D(irisCenterR, landmarks[476])) / 2;
  
  const pEllL = { width: dist3D(landmarks[469], landmarks[471]), height: dist3D(landmarks[470], landmarks[472]) };
  const pEllR = { width: dist3D(landmarks[474], landmarks[476]), height: dist3D(landmarks[475], landmarks[477]) };

  const geometry: GeometryFeatures = {
    pupilCenterLeft: irisCenterL,
    pupilCenterRight: irisCenterR,
    irisRadiusLeft: irisRadiusL,
    irisRadiusRight: irisRadiusR,
    pupilEllipseLeft: pEllL,
    pupilEllipseRight: pEllR,
    interEyeDistance: interEyeDistRaw,
    eyeWidthLeft: lWidth,
    eyeHeightLeft: lHeight,
    eyeWidthRight: rWidth,
    eyeHeightRight: rHeight
  };

  const face: FaceFeatures = {
    pitch,
    yaw,
    roll,
    position3D: pos3D,
    scale: scale3D,
    cameraDistanceEstimate: 1.0 / (scale3D + 1e-9)
  };

  const quality: QualityFeatures = {
    detectorConfidence: 1.0,
    brightnessEstimate: 0.5,
    contrastEstimate: 0.5,
    blurEstimate: 0.0,
    occlusionEstimate: 0.0,
    irisVisibilityPercentage: Math.min(1.0, ear / 0.25),
    specularRatio: 0, // A1-5 — sobrescrito por qualityAnalyzer quando disponível
  };

  const advancedFeatures: AdvancedFrameFeatures = {
    geometry,
    face,
    quality
  };

  return { featuresLeft, featuresRight, blinkDetected, advancedFeatures };
}

// L2CS gaze data (E5/E6 do L2CS-NET.md). Interface local para evitar
// dependência do módulo l2cs — o extractor permanece agnóstico. Quem passar
// o objeto (engine.ts) sabe quando o gaze é válido e quando não é (cache
// stale, worker não pronto, etc).
export interface L2CSGazeInput {
  yaw: number;    // rad
  pitch: number;  // rad
  valid: boolean; // false → bloco de 7 zeros
}

export function extractCompactFeatures(
  landmarks: Point3D[],
  faceMatrix?: Float32Array,
  l2csGaze?: L2CSGazeInput | null,
): ExtractorResult {
  const baseResult = extractEyeFeatures(landmarks, faceMatrix);
  if (baseResult.featuresLeft.length === 0) return baseResult;

  const leftCorner = landmarks[33];
  const rightCorner = landmarks[263];
  const topOfHead = landmarks[10];

  const eyeCenter = scale(add(leftCorner, rightCorner), 0.5);
  let xAxis = normalize(sub(rightCorner, leftCorner));
  let yApprox = normalize(sub(topOfHead, eyeCenter));
  let yAxis = normalize(sub(yApprox, scale(xAxis, dot(yApprox, xAxis))));
  let zAxis = normalize(cross(xAxis, yAxis));

  const rot = (p: Point3D) => mulRT(xAxis, yAxis, zAxis, sub(p, eyeCenter));
  const interEyeDistRaw = norm(sub(rot(rightCorner), rot(leftCorner))) || 1;

  const rotS = (idx: number) => {
    const p = rot(landmarks[idx]);
    return { x: p.x / interEyeDistRaw, y: p.y / interEyeDistRaw };
  };

  const getEyeCompact = (
    irisCenter: number, irisP: number[],
    cInner: number, cOuter: number, cTop: number, cBot: number,
    pose: { yaw: number; pitch: number; roll: number; scale: number }
  ) => {
    const cI = rotS(cInner), cO = rotS(cOuter), cT = rotS(cTop), cB = rotS(cBot);
    const iC = rotS(irisCenter);

    const midX = (cI.x + cO.x) * 0.5;
    const midY = (cI.y + cO.y) * 0.5;
    const offsetX = iC.x - midX;
    const offsetY = iC.y - midY;

    const width = Math.sqrt((cO.x - cI.x)**2 + (cO.y - cI.y)**2) || 1e-9;
    const height = Math.sqrt((cT.x - cB.x)**2 + (cT.y - cB.y)**2) || 1e-9;
    const relX = offsetX / width;
    const relY = offsetY / height;

    const irisContour = irisP.flatMap(idx => {
      const p = rotS(idx);
      return [p.x, p.y];
    });

    const corners = [cI.x, cI.y, cO.x, cO.y, cT.x, cT.y, cB.x, cB.y];
    
    const ear = height / width;
    const irisRadius = Math.sqrt((rotS(irisP[0]).x - rotS(irisP[2]).x)**2 + (rotS(irisP[0]).y - rotS(irisP[2]).y)**2) / 2;

    // Sprint 3 — 6 termos originais (1ª ordem) + 6 termos de 2ª ordem.
    // Compensação de pose linear vs quadrática dentro de um modelo Ridge:
    // como todas as variáveis já estão calculadas, o custo é zero e o λ
    // por CV cuida do overfitting. Vetor por olho: ~31 → ~37 dims.
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
      ...interactions
    ];
  };

  const face = baseResult.advancedFeatures!.face;
  const pose = { yaw: face.yaw, pitch: face.pitch, roll: face.roll, scale: face.scale };

  const compLeft = getEyeCompact(468, [469, 470, 471, 472], 133, 33, 159, 145, pose);
  const compRight = getEyeCompact(473, [474, 475, 476, 477], 362, 263, 386, 374, pose);

  // E5/E6 do L2CS-NET.md — quando o engine passa gaze, ambos olhos ganham o
  // mesmo bloco de 7 dims (angulares são face-level, não per-eye). Se `null`
  // ou undefined, nada é anexado — mantém backward-compat com callers que não
  // participam do pipeline L2CS (parity test, calibrações antigas, etc).
  if (l2csGaze != null) {
    const block = buildL2CSBlock(
      l2csGaze.yaw,
      l2csGaze.pitch,
      l2csGaze.valid,
      face.cameraDistanceEstimate,
    );
    for (let i = 0; i < block.length; i++) {
      compLeft.push(block[i]);
      compRight.push(block[i]);
    }
  }

  return {
    featuresLeft: compLeft,
    featuresRight: compRight,
    blinkDetected: baseResult.blinkDetected,
    advancedFeatures: baseResult.advancedFeatures
  };
}
