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
function dist2D(p1: Point3D, p2: Point3D): number {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2);
}
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

// EAR Blink Detection History
const earHistory: number[] = [];
const EAR_HISTORY_LEN = 50;
const BLINK_THRESHOLD_RATIO = 0.8;
const MIN_HISTORY = 15;

export function extractEyeFeatures(landmarks: Point3D[], faceMatrix?: Float32Array): ExtractorResult {
  if (landmarks.length < 478) {
    return { featuresLeft: [], featuresRight: [], blinkDetected: false };
  }

  // 1. Head Pose Normalization (EyeTrax Logic)
  const leftCorner = landmarks[33];
  const rightCorner = landmarks[263];
  const topOfHead = landmarks[10];

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
  for (let i = 0; i < landmarks.length; i++) {
    const shifted = sub(landmarks[i], eyeCenter);
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

    pitch = Math.asin(-r12);
    yaw = Math.atan2(r02, r22);
    roll = Math.atan2(r10, r11);

    pos3D = { x: faceMatrix[12], y: faceMatrix[13], z: faceMatrix[14] };
  }

  featuresLeft.push(yaw, pitch, roll);
  featuresRight.push(yaw, pitch, roll);

  // 2. Blink Detection & Dimensions
  const lInner = landmarks[133], lOuter = landmarks[33], lTop = landmarks[159], lBottom = landmarks[145];
  const rInner = landmarks[362], rOuter = landmarks[263], rTop = landmarks[386], rBottom = landmarks[374];

  const lWidth = dist2D(lOuter, lInner);
  const lHeight = dist2D(lTop, lBottom);
  const leftEAR = lHeight / (lWidth + 1e-9);

  const rWidth = dist2D(rOuter, rInner);
  const rHeight = dist2D(rTop, rBottom);
  const rightEAR = rHeight / (rWidth + 1e-9);

  const ear = (leftEAR + rightEAR) / 2;
  
  earHistory.push(ear);
  if (earHistory.length > EAR_HISTORY_LEN) {
    earHistory.shift();
  }

  let thr = 0.2;
  if (earHistory.length >= MIN_HISTORY) {
    const meanEar = earHistory.reduce((a, b) => a + b, 0) / earHistory.length;
    thr = meanEar * BLINK_THRESHOLD_RATIO;
  }

  const blinkDetected = ear < thr;

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
    irisVisibilityPercentage: Math.min(1.0, ear / 0.25)
  };

  const advancedFeatures: AdvancedFrameFeatures = {
    geometry,
    face,
    quality
  };

  return { featuresLeft, featuresRight, blinkDetected, advancedFeatures };
}
