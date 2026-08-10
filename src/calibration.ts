import type { GazeRegressor } from './gazeRegressor';
import {
  createRegressor,
  ridgeRegressorFromModel,
  ridgeModelFromRegressor,
  kernelRidgeRegressorFromModel,
  kernelRidgeModelFromRegressor,
  REGRESSOR_MODE
} from './gazeRegressor';
import { StandardScaler } from './scaler';
import { USE_COMPACT_FEATURES } from './featurePipeline';
import { isAccuracyTesting } from './accuracy';

export interface CalibrationPoint {
  screenX: number;
  screenY: number;
  featuresLeft: number[];
  featuresRight: number[];
  quality?: any | null;
}

export interface GazeCorrection {
  refX: number;
  refY: number;
  offsetX: number;
  offsetY: number;
}

export interface GazeDistanceLogEntry {
  timestamp: number;
  phase: string;
  screenX: number;
  screenY: number;
  nearestDistLeft: number;
  nearestDistRight: number;
  nearestDistAvg: number;
}

let profile: CalibrationPoint[] = [];
export let isCalibrating = false;
let isCollecting = false;
let collectionStartTime = 0;
let collectedFeaturesLeft: number[][] = [];
let collectedFeaturesRight: number[][] = [];
let collectedQualities: (any | null)[] = [];

let currentTargetX = 0;
let currentTargetY = 0;
let pointCompleteCallback: ((success: boolean) => void) | null = null;

let regressorLeft: GazeRegressor | null = null;
let regressorRight: GazeRegressor | null = null;
export const featureScalerLeft = new StandardScaler();
export const featureScalerRight = new StandardScaler();

let scaledProfileLeft: number[][] = [];
let scaledProfileRight: number[][] = [];
let _gazeCorrections: GazeCorrection[] = [];

const COLLECTION_MS = 1500;
const VARIANCE_THRESHOLD = 0.0005;
const DIST_LOG_CAPACITY = 500;
const distanceLog: GazeDistanceLogEntry[] = [];

export function isCalibrated(): boolean {
  return regressorLeft !== null && regressorRight !== null;
}

export function clearCalibration() {
  profile = [];
  regressorLeft = null;
  regressorRight = null;
  _gazeCorrections = [];
  localStorage.removeItem("calibrationProfile");
  localStorage.removeItem("accuracyResult");
}

export function loadProfile(): boolean {
  try {
    const saved = localStorage.getItem("calibrationProfile");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.modelLeft && parsed.modelRight && parsed.scalerParamsLeft && parsed.scalerParamsRight) {
        const savedDims = parsed.featureDims ?? parsed.scalerParamsLeft.means?.length;
        const currentDims = USE_COMPACT_FEATURES ? 31 : 260;
        if (savedDims !== currentDims) {
          console.warn(`[calib] modelo salvo com ${savedDims} features (atual: ${currentDims}) — recalibração necessária`);
          clearCalibration();
          return false;
        }
        if (parsed.regressorMode === 'kernel_ridge') {
          regressorLeft = kernelRidgeRegressorFromModel(parsed.modelLeft);
          regressorRight = kernelRidgeRegressorFromModel(parsed.modelRight);
        } else {
          regressorLeft = ridgeRegressorFromModel(parsed.modelLeft);
          regressorRight = ridgeRegressorFromModel(parsed.modelRight);
        }
        featureScalerLeft.setParams(parsed.scalerParamsLeft.means, parsed.scalerParamsLeft.stds);
        featureScalerRight.setParams(parsed.scalerParamsRight.means, parsed.scalerParamsRight.stds);
        return true;
      }
    }
  } catch (e) {
    console.error("Erro ao carregar calibrationProfile:", e);
  }
  regressorLeft = null;
  regressorRight = null;
  return false;
}

function saveProfile() {
  if (regressorLeft && regressorRight) {
    let modelLeft, modelRight;
    if (REGRESSOR_MODE === 'kernel_ridge') {
      modelLeft = kernelRidgeModelFromRegressor(regressorLeft);
      modelRight = kernelRidgeModelFromRegressor(regressorRight);
    } else {
      modelLeft = ridgeModelFromRegressor(regressorLeft);
      modelRight = ridgeModelFromRegressor(regressorRight);
    }

    if (modelLeft && modelRight) {
      const scalerParamsLeft = featureScalerLeft.getParams();
      localStorage.setItem("calibrationProfile", JSON.stringify({
        regressorMode: REGRESSOR_MODE,
        featureDims: scalerParamsLeft.means.length,
        modelLeft: modelLeft,
        modelRight: modelRight,
        scalerParamsLeft,
        scalerParamsRight: featureScalerRight.getParams()
      }));
    }
  }
}

export function setGazeCorrections(corrections: GazeCorrection[]): void {
  _gazeCorrections = corrections;
  console.log(`[calib] mapa de correção: ${corrections.length} pontos de referência aplicados`);
}

function applyGazeCorrection(x: number, y: number): { x: number; y: number } {
  if (_gazeCorrections.length < 3) return { x, y };

  let sumW = 0, cx = 0, cy = 0;
  for (const c of _gazeCorrections) {
    const dx = x - c.refX;
    const dy = y - c.refY;
    const w = 1.0 / (dx * dx + dy * dy + 1.0);
    cx += c.offsetX * w;
    cy += c.offsetY * w;
    sumW += w;
  }
  cx /= sumW;
  cy /= sumW;

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  return {
    x: Math.max(0, Math.min(vw, x + cx)),
    y: Math.max(0, Math.min(vh, y + cy)),
  };
}

function nearestDistance(vec: number[], pool: number[][]): number {
  if (pool.length === 0) return NaN;
  let best = Infinity;
  for (const p of pool) {
    let sumSq = 0;
    for (let i = 0; i < vec.length; i++) {
      const d = vec[i] - p[i];
      sumSq += d * d;
    }
    const dist = Math.sqrt(sumSq);
    if (dist < best) best = dist;
  }
  return best;
}

function currentGazePhase(): string {
  if (isCalibrating) return 'calibration';
  if (isAccuracyTesting) return 'accuracy_test';
  return 'live';
}

function logGazeDistance(entry: GazeDistanceLogEntry): void {
  distanceLog.push(entry);
  if (distanceLog.length > DIST_LOG_CAPACITY) distanceLog.shift();
}

export function getGazeDistanceLog(): GazeDistanceLogEntry[] {
  return distanceLog.slice();
}

export function exportGazeDistanceLog(): void {
  const json = JSON.stringify(distanceLog, null, 2);
  const blob = new Blob([json], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `gaze-distance-log-${Date.now()}.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// ── Headless Calibration API ──────────────────────────────────────────────────

export function startCalibrationMode() {
  isCalibrating = true;
  profile = [];
}

export function startCollectingPoint(x: number, y: number, onDone: (success: boolean) => void) {
  if (!isCalibrating) return;
  currentTargetX = x;
  currentTargetY = y;
  isCollecting = true;
  collectionStartTime = performance.now();
  collectedFeaturesLeft = [];
  collectedFeaturesRight = [];
  collectedQualities = [];
  pointCompleteCallback = onDone;
}

function calculateFeatureVariance(features: number[][]): number {
  if (features.length < 2) return 0;
  const numFeatures = features[0].length;
  let totalVariance = 0;
  for (let f = 0; f < numFeatures; f++) {
    let sum = 0;
    for (let i = 0; i < features.length; i++) {
      sum += features[i][f];
    }
    const mean = sum / features.length;
    let sumSq = 0;
    for (let i = 0; i < features.length; i++) {
      const diff = features[i][f] - mean;
      sumSq += diff * diff;
    }
    totalVariance += sumSq / (features.length - 1);
  }
  return totalVariance / numFeatures;
}

export function feedRawData(featuresLeft: number[], featuresRight: number[], quality?: any | null) {
  if (!isCalibrating || !isCollecting) return;

  const elapsed = performance.now() - collectionStartTime;
  
  // Descartar os primeiros 400ms (fase de sacada / acomodação)
  if (elapsed < 400) return;

  // Descartar amostras de baixa qualidade / piscadas
  if (quality) {
    if (quality.irisVisibilityPercentage < 0.3 || quality.detectorConfidence < 0.5) {
      return; // Ignora frame ruim
    }
  }

  collectedFeaturesLeft.push(featuresLeft);
  collectedFeaturesRight.push(featuresRight);
  collectedQualities.push(quality ?? null);

  if (elapsed >= COLLECTION_MS) {
    isCollecting = false;
    processStaticPoint();
  }
}

function processStaticPoint() {
  const avgVarLeft = calculateFeatureVariance(collectedFeaturesLeft);
  const avgVarRight = calculateFeatureVariance(collectedFeaturesRight);

  if (avgVarLeft > VARIANCE_THRESHOLD || avgVarRight > VARIANCE_THRESHOLD) {
    console.warn(`[calib] Ponto instável | varL=${avgVarLeft.toFixed(6)} varR=${avgVarRight.toFixed(6)}`);
    if (pointCompleteCallback) pointCompleteCallback(false);
    return;
  }

  for (let i = 0; i < collectedFeaturesLeft.length; i++) {
    profile.push({
      screenX: currentTargetX,
      screenY: currentTargetY,
      featuresLeft: collectedFeaturesLeft[i],
      featuresRight: collectedFeaturesRight[i],
      quality: collectedQualities[i] ?? null,
    });
  }

  if (pointCompleteCallback) pointCompleteCallback(true);
}

function trainScalersAndRegressors(trainingProfile: CalibrationPoint[]): void {
  const trainFeaturesLeft  = trainingProfile.map(p => p.featuresLeft);
  const trainFeaturesRight = trainingProfile.map(p => p.featuresRight);
  const trainTargets = trainingProfile.map(p => ({ screenX: p.screenX, screenY: p.screenY }));

  featureScalerLeft.fit(trainFeaturesLeft);
  featureScalerRight.fit(trainFeaturesRight);

  const scaledFeaturesLeft  = featureScalerLeft.transform(trainFeaturesLeft);
  const scaledFeaturesRight = featureScalerRight.transform(trainFeaturesRight);

  const targetsX = trainTargets.map(t => t.screenX);
  const targetsY = trainTargets.map(t => t.screenY);

  regressorLeft = createRegressor(REGRESSOR_MODE);
  regressorLeft.train(scaledFeaturesLeft, targetsX, targetsY);
  regressorRight = createRegressor(REGRESSOR_MODE);
  regressorRight.train(scaledFeaturesRight, targetsX, targetsY);
  
  scaledProfileLeft  = scaledFeaturesLeft;
  scaledProfileRight = scaledFeaturesRight;
}

export function completeCalibration(onComplete?: () => void) {
  try {
    trainScalersAndRegressors(profile);
    saveProfile();
  } catch (e) {
    console.error('[calib] Erro fatal no treinamento:', e);
  } finally {
    isCalibrating = false;
    if (onComplete) onComplete();
  }
}

export function init() {
  loadProfile();
  try {
    const saved = localStorage.getItem("accuracyResult");
    if (saved && isCalibrated()) {
      // O React consumirá isso futuramente
    }
  } catch (_) {}

  (window as unknown as Record<string, unknown>).__exportGazeDistanceLog = exportGazeDistanceLog;
}

export function feedFaceMetrics(_detected: boolean, _iod: number): void {
  // O React agora consome isso diretamente via engine e Context
}

export function mapGaze(
  featuresLeft: number[],
  featuresRight: number[],
): { x: number; y: number } | null {
  if (!regressorLeft || !regressorRight) return null;

  const scaledLeft  = featureScalerLeft.transformSingle(featuresLeft);
  const scaledRight = featureScalerRight.transformSingle(featuresRight);

  const predLeft = regressorLeft.predict(scaledLeft);
  const predRight = regressorRight.predict(scaledRight);

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const result = {
    x: ((predLeft.x + predRight.x) / 2) * vw,
    y: ((predLeft.y + predRight.y) / 2) * vh
  };

  const nearestDistLeft  = nearestDistance(scaledLeft, scaledProfileLeft);
  const nearestDistRight = nearestDistance(scaledRight, scaledProfileRight);
  logGazeDistance({
    timestamp: Date.now(),
    phase: currentGazePhase(),
    screenX: result.x,
    screenY: result.y,
    nearestDistLeft,
    nearestDistRight,
    nearestDistAvg: (nearestDistLeft + nearestDistRight) / 2,
  });

  return applyGazeCorrection(result.x, result.y);
}
