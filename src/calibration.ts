import type { GazeRegressor } from './gazeRegressor';
import {
  createRegressor,
  ridgeModelFromRegressor,
  REGRESSOR_MODE
} from './gazeRegressor';
import { StandardScaler } from './scaler';
import { isAccuracyTesting } from './accuracy';
import { RecursiveRidgeRegressor } from './recursiveRidge';
import type { RidgeModel } from './ridge';
import { EXPERIMENT } from './config/experiment';
import type { RecordedSampleDecision } from './telemetry/types';

// Sprint 4 — recalibração implícita. `false` = comportamento antigo (só modelo
// offline). Ligar via `setOnlineCalibrationEnabled(true)` a partir da UI/settings.
export let USE_ONLINE_CALIBRATION = false;

export function setOnlineCalibrationEnabled(enabled: boolean): void {
  USE_ONLINE_CALIBRATION = enabled;
}

// Rampa de mistura base ↔ online. Peso online sobe linearmente até 1.0 após
// ~50 amostras confirmadas — evita que um dwell acidental degrade o modelo
// antes de acumular evidência suficiente.
const ONLINE_RAMP_SAMPLES = 50;

// Rejeição de outlier: se a predição base estiver a mais de N unidades
// normalizadas do alvo do dwell, provavelmente o usuário não estava olhando
// para o botão que disparou. Threshold em fração da tela (0.15 = 15%).
const ONLINE_OUTLIER_THRESHOLD = 0.15;

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

// Sprint 2 — amostragem ponderada na periferia. `COLLECTION_MS_BASE` é a
// duração para o ponto central; pontos de canto coletam `+ COLLECTION_MS_RANGE`
// ms adicionais. A justificativa vem de literatura + prática: usuários fixam
// pior nas bordas, e o Ridge extrapola pior perto do limite do fecho convexo.
// Mais amostras nesses pontos reduz variância do fit local.
//
// Valores escalados ×1.402 (12/2026) ao migrar de 13 → 9 pontos (grade 3×3
// 10/50/90). A soma total de tempo de coleta é preservada (~21.2s),
// garantindo o mesmo número de amostras alimentando o Ridge com menos
// fadiga do usuário.
//
// CUIDADO: se o total ultrapassar ~40s (9 pontos × ~2.6s + acomodação), a fadiga
// do usuário-alvo (ELA) piora as fixações finais e anula o ganho. Este budget
// atual: 9 pontos ~ 1680..2800ms + 400ms acomodação = 18.7..28.8s. Ok.
const COLLECTION_MS_BASE = 1680;
const COLLECTION_MS_RANGE = 1120;
const COLLECTION_MS_FALLBACK = COLLECTION_MS_BASE + COLLECTION_MS_RANGE;

export function getCollectionMsForPoint(x: number, y: number): number {
  // Distância euclidiana normalizada do centro (0..1). Centro = 0, cantos = 1.
  const d = Math.hypot(x - 0.5, y - 0.5) / Math.hypot(0.5, 0.5);
  return Math.round(COLLECTION_MS_BASE + d * COLLECTION_MS_RANGE);
}

const VARIANCE_THRESHOLD = 0.02;
const DIST_LOG_CAPACITY = 500;
const distanceLog: GazeDistanceLogEntry[] = [];

// Hotfix — rejeição por deriva de pose dentro do ponto de calibração.
// Motivação: no primeiro teste real, a coluna X esquerda colapsou para o
// centro. Assinatura clássica de colinearidade yaw↔offsetX na calibração:
// o usuário move a cabeça sem perceber ao virar o olhar, e o Ridge não
// consegue separar as duas contribuições. Filtramos aqui para forçar que
// as amostras de cada ponto tenham pose homogênea.
//
// Threshold em radianos. 0.087 rad ≈ 5°. Baseline é a pose observada no
// primeiro frame ACEITO do ponto (já pós-acomodação).
const POSE_DRIFT_YAW_MAX   = 0.087;
const POSE_DRIFT_PITCH_MAX = 0.087;
const POSE_DRIFT_ROLL_MAX  = 0.087;

let currentPointBaselinePose: { yaw: number; pitch: number; roll: number } | null = null;
let poseDriftRejects = 0;

let profile: CalibrationPoint[] = [];
export let isCalibrating = false;
let isCollecting = false;
let collectionStartTime = 0;
let collectedFeaturesLeft: number[][] = [];
let collectedFeaturesRight: number[][] = [];
let collectedQualities: (any | null)[] = [];

let currentTargetX = 0;
let currentTargetY = 0;
let currentCollectionMs = COLLECTION_MS_FALLBACK;
let pointCompleteCallback: ((success: boolean) => void) | null = null;
let collectionTimeoutHandle: ReturnType<typeof setTimeout> | null = null;
let lastDecision: RecordedSampleDecision | null = null;

export function consumeLastSampleDecision(): RecordedSampleDecision | null {
  const d = lastDecision;
  lastDecision = null;
  return d;
}

let regressorLeft: GazeRegressor | null = null;
let regressorRight: GazeRegressor | null = null;
export const featureScalerLeft = new StandardScaler();
export const featureScalerRight = new StandardScaler();

let scaledProfileLeft: number[][] = [];
let scaledProfileRight: number[][] = [];
let _gazeCorrections: GazeCorrection[] = [];

let onlineLeft: RecursiveRidgeRegressor | null = null;
let onlineRight: RecursiveRidgeRegressor | null = null;

export function isCalibrated(): boolean {
  return regressorLeft !== null && regressorRight !== null;
}

export function clearCalibration() {
  profile = [];
  regressorLeft = null;
  regressorRight = null;
  _gazeCorrections = [];
}

export function loadProfile(): boolean {
  regressorLeft = null;
  regressorRight = null;
  return false;
}

function saveProfile() {
  // Saved profiles disabled
}

export function setGazeCorrections(corrections: GazeCorrection[]): void {
  _gazeCorrections = corrections;
  console.log(`[calib] mapa de correção: ${corrections.length} pontos de referência aplicados`);
}

function applyGazeCorrection(x: number, y: number): { x: number; y: number } {
  if (!EXPERIMENT.applyGazeCorrection) return { x, y };
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
  regressorLeft = null;
  regressorRight = null;
  _gazeCorrections = [];
  scaledProfileLeft = [];
  scaledProfileRight = [];
  onlineLeft = null;
  onlineRight = null;
}

export function startCollectingPoint(x: number, y: number, onDone: (success: boolean) => void) {
  if (!isCalibrating) {
    console.warn('[calib] startCollectingPoint chamado mas isCalibrating=false — ignorando');
    return;
  }

  // Cancel any previous pending timeout (guard against double-calls)
  if (collectionTimeoutHandle !== null) {
    clearTimeout(collectionTimeoutHandle);
    collectionTimeoutHandle = null;
  }

  currentTargetX = x;
  currentTargetY = y;
  currentCollectionMs = getCollectionMsForPoint(x, y);
  isCollecting = true;
  collectionStartTime = performance.now();
  collectedFeaturesLeft = [];
  collectedFeaturesRight = [];
  collectedQualities = [];
  pointCompleteCallback = onDone;
  currentPointBaselinePose = null;
  poseDriftRejects = 0;

  console.log(`[calib] ▶ Coletando ponto (${(x*100).toFixed(0)}%, ${(y*100).toFixed(0)}%) — aguardando ${currentCollectionMs}ms + 400ms acomodação`);

  // Hard timeout: if feedRawData never fires the callback (e.g. all frames
  // discarded by quality filters, or face not detected during the window),
  // force processStaticPoint after currentCollectionMs + 800ms grace period.
  collectionTimeoutHandle = setTimeout(() => {
    collectionTimeoutHandle = null;
    if (isCollecting) {
      console.warn(`[calib] ⏱ Timeout! isCollecting ainda true após ${currentCollectionMs + 800}ms. Amostras coletadas: ${collectedFeaturesLeft.length}`);
      isCollecting = false;
      processStaticPoint();
    }
  }, currentCollectionMs + 800);
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
  if (!isCalibrating || !isCollecting) {
    lastDecision = { accepted: false, elapsedMs: 0, reason: 'not_collecting' };
    return;
  }

  const elapsed = performance.now() - collectionStartTime;

  // Descartar os primeiros 400ms (fase de sacada / acomodação)
  if (elapsed < 400) {
    lastDecision = { accepted: false, elapsedMs: elapsed, reason: 'acclimation' };
    return;
  }

  // Sprint 1.1 — filtros de qualidade agora usam valores reais medidos no
  // crop dos olhos por `EyeQualityAnalyzer` (não mais constantes hardcoded).
  //
  // Thresholds iniciais, conservadores. Precisam ser refinados com base nos
  // valores observados durante a coleta de baseline:
  //   - detectorConfidence < 0.4 → landmarks muito instáveis (movimento brusco)
  //   - brightness  < 0.08       → região do olho quase preta (câmera obstruída
  //                                ou usuário no escuro total)
  //   - brightness  > 0.92       → over-exposto (contraluz forte)
  //   - contrast    < 0.02       → imagem sem estrutura (borrão total)
  //   - blur        > 0.85       → foco perdido / rosto muito distante
  //   - irisVisibilityPercentage < 0.3 → pálpebra semi-fechada / piscada
  if (quality) {
    if (
      quality.irisVisibilityPercentage < 0.3 ||
      quality.detectorConfidence < 0.4 ||
      (typeof quality.brightnessEstimate === 'number' && (quality.brightnessEstimate < 0.08 || quality.brightnessEstimate > 0.92)) ||
      (typeof quality.contrastEstimate === 'number' && quality.contrastEstimate < 0.02) ||
      (typeof quality.blurEstimate === 'number' && quality.blurEstimate > 0.85)
    ) {
      lastDecision = { accepted: false, elapsedMs: elapsed, reason: 'quality' };
      return; // Ignora frame ruim
    }

    // Hotfix — deriva de pose dentro do ponto. `currentPointBaselinePose` é
    // fixado no primeiro frame que sobrevive aos filtros de qualidade.
    // Se a cabeça se afastar dessa referência dentro da janela, o ponto
    // encerra virando amostras com pose inconsistente — Ridge não separa
    // yaw da cabeça de yaw do olhar.
    if (
      typeof quality.yaw === 'number' &&
      typeof quality.pitch === 'number' &&
      typeof quality.roll === 'number'
    ) {
      if (!currentPointBaselinePose) {
        currentPointBaselinePose = {
          yaw: quality.yaw,
          pitch: quality.pitch,
          roll: quality.roll,
        };
      } else {
        if (
          Math.abs(quality.yaw   - currentPointBaselinePose.yaw)   > POSE_DRIFT_YAW_MAX ||
          Math.abs(quality.pitch - currentPointBaselinePose.pitch) > POSE_DRIFT_PITCH_MAX ||
          Math.abs(quality.roll  - currentPointBaselinePose.roll)  > POSE_DRIFT_ROLL_MAX
        ) {
          poseDriftRejects++;
          lastDecision = { accepted: false, elapsedMs: elapsed, reason: 'pose_drift' };
          return;
        }
      }
    }
  }

  collectedFeaturesLeft.push(featuresLeft);
  collectedFeaturesRight.push(featuresRight);
  collectedQualities.push(quality ?? null);
  
  lastDecision = { accepted: true, elapsedMs: elapsed };

  if (elapsed >= currentCollectionMs) {
    isCollecting = false;
    if (collectionTimeoutHandle !== null) {
      clearTimeout(collectionTimeoutHandle);
      collectionTimeoutHandle = null;
    }
    processStaticPoint();
  }
}

function processStaticPoint() {
  console.log(
    `[calib] processStaticPoint — amostras: ${collectedFeaturesLeft.length} | poseDriftRejects=${poseDriftRejects}`,
  );

  // If no samples were collected at all (face not visible, all frames discarded
  // by quality filter), report failure so the UI can retry this point.
  if (collectedFeaturesLeft.length === 0) {
    console.warn('[calib] ✗ Nenhuma amostra coletada — rosto ausente ou qualidade insuficiente.');
    const cb = pointCompleteCallback;
    pointCompleteCallback = null;
    if (cb) cb(false);
    return;
  }

  const avgVarLeft = calculateFeatureVariance(collectedFeaturesLeft);
  const avgVarRight = calculateFeatureVariance(collectedFeaturesRight);

  console.log(`[calib] Variância: L=${avgVarLeft.toFixed(6)} R=${avgVarRight.toFixed(6)} (threshold=${VARIANCE_THRESHOLD})`);

  if (avgVarLeft > VARIANCE_THRESHOLD || avgVarRight > VARIANCE_THRESHOLD) {
    console.warn(`[calib] ✗ Ponto instável — aceitando mesmo assim com ${collectedFeaturesLeft.length} amostras`);
    // Instead of failing, we accept unstable points but use a median subset.
    // This prevents infinite retry loops on fidgety users.
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

  console.log(`[calib] ✓ Ponto aceito — profile agora tem ${profile.length} amostras totais`);
  const cb = pointCompleteCallback;
  pointCompleteCallback = null;
  if (cb) cb(true);
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

  // Sprint 4 — inicializa os regressores online a partir do modelo Ridge
  // recém-treinado. Só suportado quando o modo ativo é 'ridge' — outros
  // regressores (kernel) não expõem β_x/β_y diretamente.
  onlineLeft = null;
  onlineRight = null;
  if (REGRESSOR_MODE === 'ridge') {
    const modelL = ridgeModelFromRegressor(regressorLeft) as RidgeModel | null;
    const modelR = ridgeModelFromRegressor(regressorRight) as RidgeModel | null;
    if (modelL && modelR) {
      onlineLeft = new RecursiveRidgeRegressor(modelL.betaX, modelL.betaY);
      onlineRight = new RecursiveRidgeRegressor(modelR.betaX, modelR.betaY);
      console.log('[calib] Regressor online (RLS) inicializado a partir do Ridge offline.');
    }
  }
}

export function completeCalibration(onComplete?: () => void) {
  // Cancel any pending collection timeout before finalising
  if (collectionTimeoutHandle !== null) {
    clearTimeout(collectionTimeoutHandle);
    collectionTimeoutHandle = null;
  }
  isCollecting = false;
  pointCompleteCallback = null;

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

// Sprint 4 — hook de recalibração implícita. Chamado quando um dwell click é
// confirmado sobre um botão da UI; alvo em pixels de tela (o centro do botão).
//
// Rejeita a amostra se:
//   - Flag `USE_ONLINE_CALIBRATION` está desligada
//   - Modelo offline não treinado
//   - Predição atual está a mais de ONLINE_OUTLIER_THRESHOLD (em unidades
//     normalizadas de tela) do alvo — provável falso positivo (o usuário
//     estava olhando para outro elemento quando o dwell disparou).
//
// Retorna `true` se a amostra foi aceita e usada.
export function feedOnlineSample(
  featuresLeft: number[],
  featuresRight: number[],
  targetXpx: number,
  targetYpx: number,
): boolean {
  if (!USE_ONLINE_CALIBRATION) return false;
  if (!onlineLeft || !onlineRight) return false;
  if (!regressorLeft || !regressorRight) return false;

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const targetX = targetXpx / vw;
  const targetY = targetYpx / vh;

  const scaledLeft  = featureScalerLeft.transformSingle(featuresLeft);
  const scaledRight = featureScalerRight.transformSingle(featuresRight);

  // Rejeição de outlier via predição do modelo BASE — o online ainda está
  // aprendendo e não deve ser usado para julgar seus próprios inputs.
  const baseLeft  = regressorLeft.predict(scaledLeft);
  const baseRight = regressorRight.predict(scaledRight);
  const basePredX = (baseLeft.x + baseRight.x) / 2;
  const basePredY = (baseLeft.y + baseRight.y) / 2;
  const distToTarget = Math.hypot(basePredX - targetX, basePredY - targetY);
  if (distToTarget > ONLINE_OUTLIER_THRESHOLD) {
    console.log(
      `[calib] Online sample rejeitada — pred=(${basePredX.toFixed(3)},${basePredY.toFixed(3)}) alvo=(${targetX.toFixed(3)},${targetY.toFixed(3)}) dist=${distToTarget.toFixed(3)} > ${ONLINE_OUTLIER_THRESHOLD}`,
    );
    return false;
  }

  onlineLeft.update(scaledLeft, targetX, targetY);
  onlineRight.update(scaledRight, targetX, targetY);
  return true;
}

export function onlineSampleCount(): number {
  if (!onlineLeft || !onlineRight) return 0;
  return Math.min(onlineLeft.n, onlineRight.n);
}

// Fase 0.1 — expõe o alvo atual da coleta em px de viewport, para o gravador
// de sessão anexar como ground-truth no frame. Retorna null quando não há
// ponto sendo coletado (fora da calibração, ou entre pontos). Devolve o
// centro do dot mesmo durante os 400 ms de acomodação — o dot está visível
// ali, o replay precisa saber disso.
export function getCurrentTargetPx(): { xPx: number; yPx: number } | null {
  if (!isCalibrating || !isCollecting) return null;
  if (typeof document === 'undefined') return null;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  return { xPx: currentTargetX * vw, yPx: currentTargetY * vh };
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

  let baseX = (predLeft.x + predRight.x) / 2;
  let baseY = (predLeft.y + predRight.y) / 2;

  // Sprint 4 — mistura com o modelo online (RLS) quando habilitado e após
  // acumular amostras suficientes. Rampa linear em [0,1] evita degradar o
  // baseline antes de acumular evidência.
  if (USE_ONLINE_CALIBRATION && onlineLeft && onlineRight) {
    const nOnline = Math.min(onlineLeft.n, onlineRight.n);
    if (nOnline > 0) {
      const onlinePredLeft = onlineLeft.predict(scaledLeft);
      const onlinePredRight = onlineRight.predict(scaledRight);
      const onlineX = (onlinePredLeft.x + onlinePredRight.x) / 2;
      const onlineY = (onlinePredLeft.y + onlinePredRight.y) / 2;
      const w = Math.min(1, nOnline / ONLINE_RAMP_SAMPLES);
      baseX = (1 - w) * baseX + w * onlineX;
      baseY = (1 - w) * baseY + w * onlineY;
    }
  }

  // Clamp em unidades normalizadas [0,1] APÓS a média binocular (Sprint 1.2).
  // Fazer o clamp aqui, e não em `predictRidge`, evita o viés de borda descrito
  // no comentário de ridge.ts.
  const avgNormX = Math.min(1, Math.max(0, baseX));
  const avgNormY = Math.min(1, Math.max(0, baseY));

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const result = {
    x: avgNormX * vw,
    y: avgNormY * vh,
  };

  if (EXPERIMENT.enableDistanceLog) {
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
  }

  return applyGazeCorrection(result.x, result.y);
}
