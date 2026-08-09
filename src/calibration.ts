import type { GazeRegressor } from './gazeRegressor';
import { createRegressor, ridgeRegressorFromModel, ridgeModelFromRegressor, kernelRidgeRegressorFromModel, kernelRidgeModelFromRegressor, svrRegressorFromModel, svrModelFromRegressor, REGRESSOR_MODE } from './gazeRegressor';
import { startAccuracyTest, isAccuracyTesting } from './accuracy';
import { StandardScaler } from './scaler';
import { FEATURE_MODE } from './featurePipeline';

export interface CalibrationPoint {
  screenX: number;
  screenY: number;
  featuresLeft: number[];
  featuresRight: number[];
  fusedLeft?: number[] | null;
  fusedRight?: number[] | null;
  quality?: any | null;
}



// ── Grade 3×3 (9 pontos) — foco nos cantos, bordas e centro ──────────────────
const TARGET_POINTS = [
  { name: "Canto Superior Esquerdo",  screenX: 0.05, screenY: 0.05 },
  { name: "Superior Centro",          screenX: 0.50, screenY: 0.05 },
  { name: "Canto Superior Direito",   screenX: 0.95, screenY: 0.05 },
  { name: "Médio Esquerdo",           screenX: 0.05, screenY: 0.50 },
  { name: "Centro",                   screenX: 0.50, screenY: 0.50 },
  { name: "Médio Direito",            screenX: 0.95, screenY: 0.50 },
  { name: "Canto Inferior Esquerdo",  screenX: 0.05, screenY: 0.95 },
  { name: "Inferior Centro",          screenX: 0.50, screenY: 0.95 },
  { name: "Canto Inferior Direito",   screenX: 0.95, screenY: 0.95 },
];

const COLLECTION_MS        = 1500;
const TRANSITION_MS        = 1000;


let profile: CalibrationPoint[] = [];
export let isCalibrating = false;
let currentPointIndex = 0;
let isCollecting = false;
let collectionStartTime = 0;
let collectedFeaturesLeft: number[][] = [];
let collectedFeaturesRight: number[][] = [];

let collectedFusedLeft: (number[] | null)[] = [];
let collectedFusedRight: (number[] | null)[] = [];
let collectedQualities: (any | null)[] = [];


// ── Gaze regressors (implementation selected via GazeRegressor interface) ────
let regressorLeft: GazeRegressor | null = null;
let regressorRight: GazeRegressor | null = null;
export const featureScalerLeft = new StandardScaler();
export const featureScalerRight = new StandardScaler();

// ── Dev-only: configs B e C para sprint de validação comparativa ─────────────
// Treinados sobre os mesmos dados de calibração que Config A; nunca persistidos.
// Config B: KernelRidge + geo (mesmo scaler de A)
// Config C: KernelRidge + fused (scaler separado, 276 dims)
let devConfigB: { left: GazeRegressor; right: GazeRegressor } | null = null;
let devConfigC: { left: GazeRegressor; right: GazeRegressor } | null = null;
let devConfigCReason: string | null = null;
export const fusedScalerLeft  = new StandardScaler();
export const fusedScalerRight = new StandardScaler();
// Contador de inferências Config C logadas (diagnóstico temporário — resetado a cada treino).
let _configCPredLogCount = 0;

// ── Diagnóstico: distância ao ponto de calibração mais próximo ──────────────
// Instrumentação PURAMENTE ADITIVA para investigar a hipótese de extrapolação
// do Ridge fora do fecho convexo dos pontos de calibração. Não influencia em
// nada o valor retornado por mapGaze/predictRidge — apenas observa.
// Fase em que a amostra foi capturada, a partir do estado que calibration.ts
// já rastreia internamente (isCalibrating/isDynamicCalibrating) + a flag
// isAccuracyTesting exportada por accuracy.ts. 'live' cobre o rastreamento
// contínuo normal (main.ts) fora da calibração e fora do teste de validação.
// Nota: 'calibration' e 'dynamic' nunca aparecerão na prática, porque
// ridgeModelLeft/Right só existem DEPOIS que o treino termina — e mapGaze
// retorna null (antes de logar) sempre que os modelos ainda não existem.
// Mantidos mesmo assim para representar o estado real, sem mentir sobre ele.
export type GazeLogPhase = 'calibration' | 'dynamic' | 'validation' | 'live';

export interface GazeDistanceLogEntry {
  timestamp: number;
  phase: GazeLogPhase;
  screenX: number;
  screenY: number;
  nearestDistLeft: number;
  nearestDistRight: number;
  nearestDistAvg: number;
}

function currentGazePhase(): GazeLogPhase {
  if (isAccuracyTesting) return 'validation';
  if (isCalibrating) return 'calibration';
  return 'live';
}

const DIST_LOG_CAPACITY = 500;
const distanceLog: GazeDistanceLogEntry[] = [];

// Cache das features de calibração já normalizadas pelo StandardScaler
// (mesmo espaço em que o Ridge opera), preenchido ao final do treino.
let scaledProfileLeft: number[][] = [];
let scaledProfileRight: number[][] = [];

// ── Mapa de correção de olhar (gerado após teste de precisão) ────────────────
// Armazena os offsets de correção dos 9 pontos de validação. Durante o tracking
// ao vivo, a correção mais próxima (IDW) é aplicada à predição bruta do SVR,
// eliminando o erro sistemático medido no teste de validação.
export interface GazeCorrection {
  refX: number;    // posição X onde o modelo previu (referência no espaço de pixels)
  refY: number;
  offsetX: number; // correção necessária: groundTruth - prediction
  offsetY: number;
}

let _gazeCorrections: GazeCorrection[] = [];

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
    // IDW com decaimento 1/d² — pontos mais próximos têm influência maior
    const w = 1.0 / (dx * dx + dy * dy + 1.0);
    cx    += c.offsetX * w;
    cy    += c.offsetY * w;
    sumW  += w;
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

function logGazeDistance(entry: GazeDistanceLogEntry): void {
  distanceLog.push(entry);
  if (distanceLog.length > DIST_LOG_CAPACITY) distanceLog.shift();
}

/** Retorna uma cópia do buffer circular de diagnóstico (últimas até 500 amostras). */
export function getGazeDistanceLog(): GazeDistanceLogEntry[] {
  return distanceLog.slice();
}

/** Baixa o buffer de diagnóstico atual como um arquivo JSON, para inspeção manual. */
export function exportGazeDistanceLog(): void {
  // TEMPORÁRIO (debug): visibilidade do estado no momento do export, para
  // investigar por que o buffer pode vir vazio. Remover depois do diagnóstico.
  console.log(
    '[gaze-distance-log] buffer size:', distanceLog.length,
    '| isCalibrated():', isCalibrated(),
    '| regressorLeft null?', regressorLeft === null,
    '| regressorRight null?', regressorRight === null,
    '| scaledProfileLeft.length:', scaledProfileLeft.length,
    '| scaledProfileRight.length:', scaledProfileRight.length,
  );

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

// ── Session counter ──────────────────────────────────────────────────────────
let sessionCount = 0;

function loadSessionCount(): void {
  try {
    sessionCount = parseInt(localStorage.getItem('irisflowSession') ?? '0', 10) + 1;
    localStorage.setItem('irisflowSession', String(sessionCount));
  } catch (_) {}
}

// ── Pré-calibração: métricas de rosto ────────────────────────────────────────
export let isPreCalibrating = false;

// Intervalo ideal do IOD normalizado (em coordenadas de imagem 0-1)
// ~0.05 a ~0.12 corresponde a ~40cm a ~90cm de distância
const IOD_MIN = 0.045;
const IOD_MAX = 0.13;
const IOD_IDEAL_MIN = 0.06;
const IOD_IDEAL_MAX = 0.10;

export function feedFaceMetrics(detected: boolean, iod: number): void {
  if (isPreCalibrating) {
    updatePreCalibrationUI(detected, iod);
  }
}

// Versão atual do vetor de features (258 geo + 2 iris-offset por olho = 260).
// Incrementar aqui sempre que o número de features mudar, para invalidar
// modelos salvos com dimensões incompatíveis e forçar recalibração.
const CURRENT_FEATURE_DIMS = 260;

export function loadProfile(): boolean {
  try {
    const saved = localStorage.getItem("calibrationProfile");
    if (saved) {
      const parsed = JSON.parse(saved);
      if (parsed.modelLeft && parsed.modelRight && parsed.scalerParamsLeft && parsed.scalerParamsRight) {
        // Rejeita modelos salvos com dimensão diferente da atual
        const savedDims = parsed.featureDims ?? parsed.scalerParamsLeft.means?.length;
        if (savedDims !== CURRENT_FEATURE_DIMS) {
          console.warn(`[calib] modelo salvo com ${savedDims} features (atual: ${CURRENT_FEATURE_DIMS}) — recalibração necessária`);
          localStorage.removeItem("calibrationProfile");
          return false;
        }
        if (parsed.regressorMode === 'svr') {
          regressorLeft = svrRegressorFromModel(parsed.modelLeft);
          regressorRight = svrRegressorFromModel(parsed.modelRight);
        } else if (parsed.regressorMode === 'kernel_ridge') {
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
    if (REGRESSOR_MODE === 'svr') {
      modelLeft = svrModelFromRegressor(regressorLeft);
      modelRight = svrModelFromRegressor(regressorRight);
    } else if (REGRESSOR_MODE === 'kernel_ridge') {
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

export function clearCalibration() {
  profile    = [];
  regressorLeft = null;
  regressorRight = null;
  devConfigB = null;
  devConfigC = null;
  devConfigCReason = null;
  _configCPredLogCount = 0;
  _gazeCorrections = [];
  localStorage.removeItem("calibrationProfile");
  localStorage.removeItem("accuracyResult");
  updateStatusUI();
}

export function isCalibrated(): boolean {
  return regressorLeft !== null && regressorRight !== null;
}

// ── Pré-Calibração: tela de setup antes da calibração ────────────────────────

export function startPreCalibration() {
  if (isCalibrating || isPreCalibrating) return;
  isPreCalibrating = true;
  createPreCalibrationOverlay();
}

function createPreCalibrationOverlay() {
  if (document.getElementById("precalib-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "precalib-overlay";
  overlay.className = "precalib-overlay";
  overlay.innerHTML = `
    <div class="precalib-card">
      <div class="precalib-title">Preparação para Calibração</div>
      <div class="precalib-subtitle">Verifique as condições antes de iniciar</div>

      <div class="precalib-checklist">
        <div class="precalib-item" id="precalib-face">
          <div class="precalib-icon" id="precalib-face-icon">○</div>
          <div class="precalib-text">
            <div class="precalib-item-title">Rosto Detectado</div>
            <div class="precalib-item-desc" id="precalib-face-desc">Posicione-se de frente para a câmera</div>
          </div>
        </div>

        <div class="precalib-item" id="precalib-distance">
          <div class="precalib-icon" id="precalib-distance-icon">○</div>
          <div class="precalib-text">
            <div class="precalib-item-title">Distância Adequada</div>
            <div class="precalib-item-desc" id="precalib-distance-desc">Sente-se a ~60cm da tela</div>
          </div>
          <div class="precalib-distance-bar-wrap">
            <div class="precalib-distance-zone precalib-zone-far">Longe</div>
            <div class="precalib-distance-zone precalib-zone-ideal">Ideal</div>
            <div class="precalib-distance-zone precalib-zone-close">Perto</div>
            <div class="precalib-distance-indicator" id="precalib-dist-indicator"></div>
          </div>
        </div>

        <div class="precalib-item" id="precalib-light">
          <div class="precalib-icon" id="precalib-light-icon">○</div>
          <div class="precalib-text">
            <div class="precalib-item-title">Iluminação</div>
            <div class="precalib-item-desc" id="precalib-light-desc">Garanta iluminação frontal adequada</div>
          </div>
        </div>
      </div>

      <div class="precalib-tips">
        <div class="precalib-tips-title">💡 Dicas para melhor precisão</div>
        <ul>
          <li>Centralize seu rosto na câmera</li>
          <li>Evite luz forte atrás de você (contraluz)</li>
          <li>Mantenha a cabeça parada durante a calibração</li>
          <li>Olhe fixamente para cada ponto sem piscar</li>
        </ul>
      </div>

      <div class="precalib-actions">
        <button id="btn-precalib-start" class="btn btn-primary precalib-start-btn">Iniciar Calibração</button>
        <button id="btn-precalib-cancel" class="btn btn-secondary">Cancelar</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  document.getElementById("btn-precalib-start")?.addEventListener("click", () => {
    closePreCalibration();
    startCalibrationMode();
  });

  document.getElementById("btn-precalib-cancel")?.addEventListener("click", () => {
    closePreCalibration();
  });
}

function updatePreCalibrationUI(detected: boolean, iod: number) {
  // Face detection
  const faceIcon = document.getElementById("precalib-face-icon");
  const faceDesc = document.getElementById("precalib-face-desc");
  if (faceIcon && faceDesc) {
    if (detected) {
      faceIcon.textContent = "✓";
      faceIcon.className = "precalib-icon precalib-ok";
      faceDesc.textContent = "Rosto detectado com sucesso";
    } else {
      faceIcon.textContent = "✗";
      faceIcon.className = "precalib-icon precalib-fail";
      faceDesc.textContent = "Posicione-se de frente para a câmera";
    }
  }

  // Distance
  const distIcon = document.getElementById("precalib-distance-icon");
  const distDesc = document.getElementById("precalib-distance-desc");
  const distIndicator = document.getElementById("precalib-dist-indicator");

  if (distIcon && distDesc && distIndicator) {
    if (!detected) {
      distIcon.textContent = "○";
      distIcon.className = "precalib-icon";
      distDesc.textContent = "Aguardando detecção do rosto...";
      distIndicator.style.display = "none";
    } else {
      distIndicator.style.display = "block";
      // Mapear IOD para posição na barra (0% = muito longe, 100% = muito perto)
      const pct = Math.min(Math.max((iod - IOD_MIN) / (IOD_MAX - IOD_MIN), 0), 1) * 100;
      distIndicator.style.left = `${pct}%`;

      if (iod >= IOD_IDEAL_MIN && iod <= IOD_IDEAL_MAX) {
        distIcon.textContent = "✓";
        distIcon.className = "precalib-icon precalib-ok";
        distDesc.textContent = "Distância ideal (~60cm)";
      } else if (iod < IOD_IDEAL_MIN) {
        distIcon.textContent = "⚠";
        distIcon.className = "precalib-icon precalib-warn";
        distDesc.textContent = "Muito longe — aproxime-se da tela";
      } else {
        distIcon.textContent = "⚠";
        distIcon.className = "precalib-icon precalib-warn";
        distDesc.textContent = "Muito perto — afaste-se um pouco";
      }
    }
  }

  // Lighting (usa o estado do warning de iluminação já existente)
  const lightIcon = document.getElementById("precalib-light-icon");
  const lightDesc = document.getElementById("precalib-light-desc");
  const lightingWarning = document.getElementById("lighting-warning");
  const isDark = lightingWarning ? lightingWarning.style.display !== 'none' : false;

  if (lightIcon && lightDesc) {
    if (!detected) {
      lightIcon.textContent = "○";
      lightIcon.className = "precalib-icon";
    } else if (isDark) {
      lightIcon.textContent = "✗";
      lightIcon.className = "precalib-icon precalib-fail";
      lightDesc.textContent = "Iluminação insuficiente — aproxime-se de uma luz";
    } else {
      lightIcon.textContent = "✓";
      lightIcon.className = "precalib-icon precalib-ok";
      lightDesc.textContent = "Iluminação adequada";
    }
  }
}

function closePreCalibration() {
  isPreCalibrating = false;
  document.getElementById("precalib-overlay")?.remove();
}

function calculateFeatureVariance(featuresList: number[][]): number {
  if (featuresList.length === 0) return 0;
  const numFeatures = featuresList[0].length;
  let totalVar = 0;
  for (let j = 0; j < numFeatures; j++) {
    let sum = 0;
    for (let i = 0; i < featuresList.length; i++) sum += featuresList[i][j];
    const mean = sum / featuresList.length;
    let sumSq = 0;
    for (let i = 0; i < featuresList.length; i++) {
      const diff = featuresList[i][j] - mean;
      sumSq += diff * diff;
    }
    totalVar += sumSq / featuresList.length;
  }
  return totalVar / numFeatures;
}

// ── Calibração Estática (9 pontos) ───────────────────────────────────────────

export function startCalibrationMode() {
  if (isCalibrating) return;
  isCalibrating = true;
  currentPointIndex = 0;
  isCollecting = false;
  profile = [];
  collectedFeaturesLeft = [];
  collectedFeaturesRight = [];
  collectedFusedLeft = [];
  collectedFusedRight = [];
  regressorLeft = null;
  regressorRight = null;
  devConfigB = null;
  devConfigC = null;
  devConfigCReason = null;
  _configCPredLogCount = 0;

  createCalibrationOverlay();
  startCountdown();
}

let countdownTimer: number | null = null;
function startCountdown() {
  const overlay = document.getElementById("calibration-overlay");
  if (!overlay) return;

  const instruction = document.getElementById("calibration-instruction");
  if (instruction) {
    instruction.innerHTML = `
      Prepare-se! A calibração começará em breve.<br>
      <span class="highlight">Foque no ponto que aparecerá e não desvie o olhar.</span>
    `;
  }

  let count = 5;
  const countDisplay = document.createElement("div");
  countDisplay.id = "calibration-countdown";
  countDisplay.style.position = "absolute";
  countDisplay.style.top = "50%";
  countDisplay.style.left = "50%";
  countDisplay.style.transform = "translate(-50%, -50%)";
  countDisplay.style.fontSize = "6rem";
  countDisplay.style.color = "#00fff0";
  countDisplay.style.fontWeight = "bold";
  countDisplay.style.textShadow = "0 0 20px rgba(0, 255, 240, 0.5)";
  countDisplay.innerText = count.toString();
  overlay.appendChild(countDisplay);

  countdownTimer = window.setInterval(() => {
    count--;
    if (count > 0) {
      countDisplay.innerText = count.toString();
    } else {
      if (countdownTimer) clearInterval(countdownTimer);
      countDisplay.remove();
      showNextPoint();
    }
  }, 1000);
}

function runAccuracyTest() {
  setTimeout(() => {
    startAccuracyTest((result) => updateStatusUI(result));
  }, 800);
}

function cancelCalibration() {
  cleanupOverlay();
  loadProfile();
  updateStatusUI();
  isCalibrating = false;
  if (countdownTimer) clearInterval(countdownTimer);
}

function createCalibrationOverlay() {
  if (document.getElementById("calibration-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "calibration-overlay";
  overlay.className = "calibration-overlay";
  overlay.innerHTML = `
    <div id="calibration-instruction" class="calibration-instruction"></div>
    <button id="btn-cancel-calibration" class="btn btn-secondary cancel-btn">Cancelar</button>
  `;
  document.body.appendChild(overlay);

  document.getElementById("btn-cancel-calibration")?.addEventListener("click", (e) => {
    e.stopPropagation();
    cancelCalibration();
  });
}

function cleanupOverlay() {
  document.getElementById("calibration-overlay")?.remove();
}

function showNextPoint() {
  const overlay = document.getElementById("calibration-overlay");
  if (!overlay) return;

  document.getElementById("calibration-dot")?.remove();

  const point = TARGET_POINTS[currentPointIndex];
  const dot = document.createElement("div");
  dot.id = "calibration-dot";
  dot.className = "calibration-dot";
  dot.style.left = `${point.screenX * 100}vw`;
  dot.style.top  = `${point.screenY * 100}vh`;
  dot.innerHTML = `
    <div class="dot-inner"></div>
    <div class="dot-pulse"></div>
    <svg class="countdown-ring" viewBox="0 0 56 56" xmlns="http://www.w3.org/2000/svg">
      <circle class="ring-track" cx="28" cy="28" r="24"/>
      <circle class="ring-fill"  cx="28" cy="28" r="24"/>
    </svg>
  `;
  overlay.appendChild(dot);

  const instruction = document.getElementById("calibration-instruction");
  if (instruction) {
    instruction.innerHTML = `
      Olhe fixamente para o ponto <span class="highlight">${currentPointIndex + 1}/${TARGET_POINTS.length}</span>
    `;
  }

  // Transição Automática após um breve momento visual
  setTimeout(() => {
    startCollection();
  }, TRANSITION_MS);
}

function startCollection() {
  if (isCollecting || !isCalibrating) return;
  isCollecting = true;
  collectionStartTime = performance.now();
  collectedFeaturesLeft = [];
  collectedFeaturesRight = [];
  collectedFusedLeft = [];
  collectedFusedRight = [];
  collectedQualities = [];

  const dot = document.getElementById("calibration-dot");
  if (dot) {
    dot.classList.remove("capturing", "unstable", "captured");
    void (dot as HTMLElement).offsetWidth;
    dot.classList.add("capturing");
  }
}

// ── Funções Removidas ────────────────────────────────────────────

export function feedRawData(
  featuresLeft: number[],
  featuresRight: number[],
  fusedLeft?: number[] | null,
  fusedRight?: number[] | null,
  quality?: any | null,
) {
  

  if (!isCalibrating || !isCollecting) return;

  collectedFeaturesLeft.push(featuresLeft);
  collectedFeaturesRight.push(featuresRight);
  collectedFusedLeft.push(fusedLeft ?? null);
  collectedFusedRight.push(fusedRight ?? null);
  collectedQualities.push(quality ?? null);

  if (performance.now() - collectionStartTime >= COLLECTION_MS) {
    isCollecting = false;
    processStaticPoint();
  }
}

function processStaticPoint() {
  // Descartar os últimos 3 frames de cada ponto para remover ruído de transição do olhar (GazeFollower approach)
  const DROP_FRAMES = 3;
  if (collectedFeaturesLeft.length > DROP_FRAMES) {
    collectedFeaturesLeft.length -= DROP_FRAMES;
    collectedFeaturesRight.length -= DROP_FRAMES;
    collectedFusedLeft.length -= DROP_FRAMES;
    collectedFusedRight.length -= DROP_FRAMES;
    collectedQualities.length -= DROP_FRAMES;
  }

  const avgVarLeft = calculateFeatureVariance(collectedFeaturesLeft);
  const avgVarRight = calculateFeatureVariance(collectedFeaturesRight);

  const VARIANCE_THRESHOLD = 0.0005; // Sensibilidade para distração (cabeça ou olhos)

  if (avgVarLeft > VARIANCE_THRESHOLD || avgVarRight > VARIANCE_THRESHOLD) {
    console.warn('[calib] ponto %d "%s" INSTÁVEL — retentando | frames=%d | varL=%.6f varR=%.6f | threshold=%.6f',
      currentPointIndex + 1, TARGET_POINTS[currentPointIndex].name,
      collectedFeaturesLeft.length, avgVarLeft, avgVarRight, VARIANCE_THRESHOLD);
    const instruction = document.getElementById("calibration-instruction");
    if (instruction) {
      instruction.innerHTML = `<span class="highlight" style="color: #ff3366;">Atenção! Você se distraiu ou piscou muito.</span><br>Reiniciando este ponto...`;
    }
    const dot = document.getElementById("calibration-dot");
    if (dot) dot.classList.add("unstable");

    // Reinicia o mesmo ponto após um feedback visual
    setTimeout(() => {
      showNextPoint();
    }, 2000);
    return;
  }

  // Em vez de extrair mediana, adicionamos todos os frames do ponto no profile
  // O Standard Scaler e Ridge L2 vão tratar ruídos e redundâncias
  const targetX = TARGET_POINTS[currentPointIndex].screenX;
  const targetY = TARGET_POINTS[currentPointIndex].screenY;

  for (let i = 0; i < collectedFeaturesLeft.length; i++) {
    profile.push({
      screenX: targetX,
      screenY: targetY,
      featuresLeft: collectedFeaturesLeft[i],
      featuresRight: collectedFeaturesRight[i],
      fusedLeft:  collectedFusedLeft[i]  ?? null,
      fusedRight: collectedFusedRight[i] ?? null,
      quality: collectedQualities[i] ?? null,
    });
  }

  const fusedFrameCount = collectedFusedLeft.filter(f => f !== null).length;
  
  // Calculate average quality metrics
  let avgBrightness = 0;
  let avgConfidence = 0;
  let qCount = 0;
  for (const q of collectedQualities) {
    if (q) {
      avgBrightness += q.brightnessEstimate ?? 0;
      avgConfidence += q.detectorConfidence ?? 0;
      qCount++;
    }
  }
  if (qCount > 0) {
    avgBrightness /= qCount;
    avgConfidence /= qCount;
  }

  console.log(`[calib] ponto ${currentPointIndex + 1}/${TARGET_POINTS.length} "${TARGET_POINTS[currentPointIndex].name}" aceito: frames=${collectedFeaturesLeft.length} (fused=${fusedFrameCount}/${collectedFeaturesLeft.length}) | varL=${avgVarLeft.toFixed(6)} varR=${avgVarRight.toFixed(6)} | threshold=${VARIANCE_THRESHOLD.toFixed(6)} | brightness=${(avgBrightness*100).toFixed(1)}% confidence=${(avgConfidence*100).toFixed(1)}%`);

  currentPointIndex++;

  const dot = document.getElementById("calibration-dot");
  if (dot) {
    dot.classList.remove("capturing");
    dot.classList.add("captured");
  }

  setTimeout(() => {
    if (currentPointIndex < TARGET_POINTS.length) {
      showNextPoint();
    } else {
      completeCalibration();
    }
  }, TRANSITION_MS);
}

// Warnings removidos

function handleGlobalKeyDown(e: KeyboardEvent) {
  if (!isCalibrating || isCollecting ) return;
  if (e.code === "Space" || e.code === "Enter") {
    e.preventDefault();
    startCollection();
  }
}

// LOO-CV do KernelRidge é O(n⁴) — projetado para n≤25.
const MAX_KR_SAMPLES = 25;

function subsampleIndices(total: number, maxN: number): number[] {
  if (total <= maxN) return Array.from({ length: total }, (_, i) => i);
  return Array.from({ length: maxN }, (_, i) => Math.round(i * (total - 1) / (maxN - 1)));
}

function trainScalersAndRegressors(trainingProfile: CalibrationPoint[]): {
  scaledFeaturesLeft: number[][];
  scaledFeaturesRight: number[][];
  targetsX: number[];
  targetsY: number[];
} {
  const trainFeaturesLeft  = trainingProfile.map(p => p.featuresLeft);
  const trainFeaturesRight = trainingProfile.map(p => p.featuresRight);
  const trainTargets = trainingProfile.map(p => ({ screenX: p.screenX, screenY: p.screenY }));

  featureScalerLeft.fit(trainFeaturesLeft);
  featureScalerRight.fit(trainFeaturesRight);

  const scaledFeaturesLeft  = featureScalerLeft.transform(trainFeaturesLeft);
  const scaledFeaturesRight = featureScalerRight.transform(trainFeaturesRight);

  const targetsX = trainTargets.map(t => t.screenX);
  const targetsY = trainTargets.map(t => t.screenY);

  if (FEATURE_MODE === 'fused') {
    const fusedRowsL: number[][] = [];
    const fusedRowsR: number[][] = [];
    const fusedTgtsX: number[]  = [];
    const fusedTgtsY: number[]  = [];
    for (let i = 0; i < trainingProfile.length; i++) {
      const fl = trainingProfile[i].fusedLeft;
      const fr = trainingProfile[i].fusedRight;
      if (fl && fr) {
        fusedRowsL.push(fl);
        fusedRowsR.push(fr);
        fusedTgtsX.push(trainTargets[i].screenX);
        fusedTgtsY.push(trainTargets[i].screenY);
      }
    }
    if (fusedRowsL.length < 9) {
      throw new Error(`[calibration] FEATURE_MODE='fused' mas apenas \${fusedRowsL.length}/\${trainingProfile.length} amostras têm embedding`);
    }
    fusedScalerLeft.fit(fusedRowsL);
    fusedScalerRight.fit(fusedRowsR);
    const scaledFL = fusedScalerLeft.transform(fusedRowsL);
    const scaledFR = fusedScalerRight.transform(fusedRowsR);
    regressorLeft = createRegressor(REGRESSOR_MODE);
    regressorLeft.train(scaledFL, fusedTgtsX, fusedTgtsY);
    regressorRight = createRegressor(REGRESSOR_MODE);
    regressorRight.train(scaledFR, fusedTgtsX, fusedTgtsY);
    scaledProfileLeft  = scaledFL;
    scaledProfileRight = scaledFR;
  } else {
    regressorLeft = createRegressor(REGRESSOR_MODE);
    regressorLeft.train(scaledFeaturesLeft, targetsX, targetsY);
    regressorRight = createRegressor(REGRESSOR_MODE);
    regressorRight.train(scaledFeaturesRight, targetsX, targetsY);
    scaledProfileLeft  = scaledFeaturesLeft;
    scaledProfileRight = scaledFeaturesRight;
  }

  return { scaledFeaturesLeft, scaledFeaturesRight, targetsX, targetsY };
}

export function runCalibrationTraining(testProfile: CalibrationPoint[]): void {
  trainScalersAndRegressors(testProfile);
}

function completeCalibration() {
  // Invalida correções da sessão anterior — a nova calibração gera novo modelo
  // e o teste de precisão subsequente produzirá correções atualizadas.
  _gazeCorrections = [];
  let trainingOk = false;

  try {
    // Treina scalers e regressores; retorna features geométricas escaladas (usadas por Config B)
    const { scaledFeaturesLeft, scaledFeaturesRight, targetsX, targetsY } =
      trainScalersAndRegressors(profile);

    // ── Dev: Config B (KernelRidge + geo, mesmo scaler de A) ────────────────────
    try {
      const idxB  = subsampleIndices(scaledFeaturesLeft.length, MAX_KR_SAMPLES);
      const sfBL  = idxB.map((i: number) => scaledFeaturesLeft[i]);
      const sfBR  = idxB.map((i: number) => scaledFeaturesRight[i]);
      const tBX   = idxB.map((i: number) => targetsX[i]);
      const tBY   = idxB.map((i: number) => targetsY[i]);
      const krLeft  = createRegressor('kernel_ridge');
      const krRight = createRegressor('kernel_ridge');
      krLeft.train(sfBL,  tBX, tBY);
      krRight.train(sfBR, tBX, tBY);
      devConfigB = { left: krLeft, right: krRight };
      console.log('[comparison] Config B (KR+geo) treinada — %d/%d amostras',
        idxB.length, scaledFeaturesLeft.length);
    } catch (e) {
      console.warn('[comparison] Config B falhou:', e);
      devConfigB = null;
    }

    // ── Dev: Config C (KernelRidge + fused, scaler separado 276 dims) ───────────
    const fusedRowsLeft:  number[][] = [];
    const fusedRowsRight: number[][] = [];
    const fusedTgtsX: number[] = [];
    const fusedTgtsY: number[] = [];
    for (let i = 0; i < profile.length; i++) {
      const fl = profile[i].fusedLeft;
      const fr = profile[i].fusedRight;
      if (fl && fr) {
        fusedRowsLeft.push(fl);
        fusedRowsRight.push(fr);
        fusedTgtsX.push(profile[i].screenX);
        fusedTgtsY.push(profile[i].screenY);
      }
    }
    if (fusedRowsLeft.length >= 9) {
      try {
        // Fit scaler no conjunto completo (para estatísticas de normalização corretas),
        // depois subsampla para o treino do KR que é O(n⁴).
        fusedScalerLeft.fit(fusedRowsLeft);
        fusedScalerRight.fit(fusedRowsRight);
        const scaledFLAll = fusedScalerLeft.transform(fusedRowsLeft);
        const scaledFRAll = fusedScalerRight.transform(fusedRowsRight);
        const idxC   = subsampleIndices(scaledFLAll.length, MAX_KR_SAMPLES);
        const scaledFL = idxC.map((i: number) => scaledFLAll[i]);
        const scaledFR = idxC.map((i: number) => scaledFRAll[i]);
        const cTgtsX   = idxC.map((i: number) => fusedTgtsX[i]);
        const cTgtsY   = idxC.map((i: number) => fusedTgtsY[i]);
        const krFL = createRegressor('kernel_ridge');
        const krFR = createRegressor('kernel_ridge');
        krFL.train(scaledFL, cTgtsX, cTgtsY);
        krFR.train(scaledFR, cTgtsX, cTgtsY);
        devConfigC = { left: krFL, right: krFR };
        devConfigCReason = null;
        console.log('[comparison] Config C (KR+fused %d dims) treinada — %d/%d amostras',
          fusedRowsLeft[0].length, idxC.length, fusedRowsLeft.length);

        // Diagnóstico temporário: verifica se o embedding CNN varia entre frames de calibração.
        // Se pcaVarianceMean ≈ 0, o encoder gera embeddings constantes independente do gaze →
        // Config C degenera para comportamento igual a Config B (só geometria).
        const pcaDimsC = fusedRowsLeft[0].length - scaledFeaturesLeft[0].length;
        let pcaVarAccum = 0;
        for (let d = 0; d < pcaDimsC; d++) {
          let s = 0;
          for (let r = 0; r < fusedRowsLeft.length; r++) s += fusedRowsLeft[r][d];
          const m = s / fusedRowsLeft.length;
          let sq = 0;
          for (let r = 0; r < fusedRowsLeft.length; r++) {
            const diff = fusedRowsLeft[r][d] - m;
            sq += diff * diff;
          }
          pcaVarAccum += sq / fusedRowsLeft.length;
        }
        const pcaVarianceMean = pcaVarAccum / pcaDimsC;
        const embStatus = pcaVarianceMean < 1e-8
          ? 'CONSTANTE (bug: CNN não variando — C degenerará para B)'
          : pcaVarianceMean < 0.001
            ? 'quase constante (suspeito — verificar eyeCrop/encoder)'
            : 'variando (OK)';
        console.log(`[comparison] Config C diagnóstico treino: dims=${fusedRowsLeft[0].length} (pca=${pcaDimsC} + geo=${scaledFeaturesLeft[0].length}) | pcaVarianceMean=${pcaVarianceMean.toFixed(8)} | embedding: ${embStatus}`);
        const midIdx = Math.floor(fusedRowsLeft.length / 2);
        console.log('[comparison] Config C PCA[0..2]: row[0]=%s | row[mid]=%s | row[-1]=%s',
          JSON.stringify(fusedRowsLeft[0].slice(0, 3).map((v: number) => +v.toFixed(4))),
          JSON.stringify(fusedRowsLeft[midIdx].slice(0, 3).map((v: number) => +v.toFixed(4))),
          JSON.stringify(fusedRowsLeft[fusedRowsLeft.length - 1].slice(0, 3).map((v: number) => +v.toFixed(4))));
        _configCPredLogCount = 0;
      } catch (e) {
        console.warn('[comparison] Config C falhou:', e);
        devConfigC = null;
        devConfigCReason = 'erro durante treinamento do KR+fused';
      }
    } else {
      console.warn('[comparison] Config C ignorada: %d/%d amostras com fused features',
        fusedRowsLeft.length, profile.length);
      devConfigC = null;
      devConfigCReason = `embedding insuficiente: ${fusedRowsLeft.length}/${profile.length} amostras com fused disponíveis (mínimo 9)`;
    }

    saveProfile();
    trainingOk = true;
  } catch (e) {
    console.error('[calibration] Erro fatal na finalização da calibração — UI será desbloqueada:', e);
  } finally {
    cleanupOverlay();
    isCalibrating = false;
    window.removeEventListener("keydown", handleGlobalKeyDown);
  }

  if (trainingOk) runAccuracyTest();
}

// ── Painel de Controle ───────────────────────────────────────────────────────

export function createControlPanel() {
  if (document.getElementById("calibration-control-panel")) return;

  const panel = document.createElement("div");
  panel.id = "calibration-control-panel";
  panel.className = "calibration-control-panel";
  panel.innerHTML = `
    <div class="panel-header">
      Calibração Ocular
      <span id="session-counter" class="session-counter">Sessão ${sessionCount}</span>
    </div>
    <div class="panel-status">
      Status: <span id="calibration-status-badge" class="badge">Não Calibrado</span>
    </div>
    <div id="signal-quality-row" class="signal-quality-row">
      <span class="sq-label">Sinal</span>
      <div class="sq-bar-wrap"><div id="sq-bar" class="sq-bar"></div></div>
      <span id="sq-pct" class="sq-pct">—</span>
    </div>
    <div id="fps-row" class="fps-row">
      <span class="fps-label">FPS</span>
      <span id="fps-value" class="fps-value">—</span>
    </div>
    <div id="lighting-warning" class="lighting-warning" style="display:none">
      ⚠ Iluminação insuficiente (&lt;200 lux estimado). Aproxime-se de uma fonte de luz.
    </div>
    <div id="accuracy-result-area"></div>
    <div class="panel-actions">
      <button id="btn-start-calibration" class="btn btn-primary">Iniciar</button>
      <button id="btn-clear-calibration" class="btn btn-secondary">Limpar</button>
    </div>
    <div class="privacy-note">🔒 Todo processamento ocorre localmente. Nenhum dado de vídeo ou olhar é transmitido.</div>
  `;
  document.body.appendChild(panel);

  // Botão "Iniciar" agora abre a tela de pré-calibração
  document.getElementById("btn-start-calibration")?.addEventListener("click", startPreCalibration);
  document.getElementById("btn-clear-calibration")?.addEventListener("click", clearCalibration);
}

// ── Atualização da qualidade do sinal de landmarks ───────────────────────────
export function updateSignalQuality(pct: number): void {
  const bar  = document.getElementById("sq-bar");
  const text = document.getElementById("sq-pct");
  if (bar)  bar.style.width  = `${pct}%`;
  if (bar)  bar.className    = `sq-bar ${pct >= 80 ? 'sq-good' : pct >= 50 ? 'sq-ok' : 'sq-poor'}`;
  if (text) text.textContent = `${pct}%`;
}

// ── Atualização do FPS display ───────────────────────────────────────────────
export function updateFpsDisplay(fps: number): void {
  const el = document.getElementById("fps-value");
  if (el) el.textContent = String(fps);
}

// ── Atualização do alerta de iluminação ──────────────────────────────────────
export function updateLightingWarning(isDark: boolean): void {
  const el = document.getElementById("lighting-warning");
  if (el) el.style.display = isDark ? 'block' : 'none';
}

export function updateStatusUI(accuracyResult?: {
  meanError: number;
  maxError: number;
  score: string;
  colorClass: string;
  meanErrorDeg?: number;
}) {
  const badge    = document.getElementById("calibration-status-badge");
  const clearBtn = document.getElementById("btn-clear-calibration") as HTMLButtonElement;

  if (badge) {
    if (isCalibrated()) {
      badge.innerText = "Calibrado";
      badge.className = "badge status-calibrated";
      if (clearBtn) clearBtn.disabled = false;
    } else {
      badge.innerText = "Não Calibrado";
      badge.className = "badge status-uncalibrated";
      if (clearBtn) clearBtn.disabled = true;
      const area = document.getElementById("accuracy-result-area");
      if (area) area.innerHTML = "";
    }
  }

  if (accuracyResult) {
    const area = document.getElementById("accuracy-result-area");
    if (area) {
      const degLine = accuracyResult.meanErrorDeg !== undefined
        ? `<div class="accuracy-detail">Erro angular: <strong>${accuracyResult.meanErrorDeg.toFixed(2)}°</strong></div>`
        : '';
      area.innerHTML = `
        <div class="accuracy-result ${accuracyResult.colorClass}">
          <div class="accuracy-label">Precisão</div>
          <div class="accuracy-score">${accuracyResult.score}</div>
          <div class="accuracy-detail">Erro médio: <strong>${Math.round(accuracyResult.meanError)}px</strong></div>
          <div class="accuracy-detail">Erro máximo: <strong>${Math.round(accuracyResult.maxError)}px</strong></div>
          ${degLine}
        </div>
      `;
    }
  }
}

export function init() {
  loadSessionCount();
  loadProfile();
  createControlPanel();
  updateStatusUI();
  try {
    const saved = localStorage.getItem("accuracyResult");
    if (saved && isCalibrated()) updateStatusUI(JSON.parse(saved));
  } catch (_) {}

  // TEMPORÁRIO (debug): botão removido da tela do cursor; export continua
  // disponível via console do DevTools enquanto o diagnóstico está em
  // andamento: window.__exportGazeDistanceLog()
  (window as unknown as Record<string, unknown>).__exportGazeDistanceLog = exportGazeDistanceLog;

  // TEMPORÁRIO (debug): contador periódico do buffer de diagnóstico, para
  // observar ao vivo no console se/quando ele começa a crescer. Remover
  // depois de confirmar a causa do buffer vazio.
  let lastLoggedSize = -1;
  setInterval(() => {
    if (distanceLog.length !== lastLoggedSize) {
      lastLoggedSize = distanceLog.length;
      console.log(
        '[gaze-distance-log] buffer size agora:', distanceLog.length,
        '| isCalibrated():', isCalibrated(),
      );
    }
  }, 2000);
}

// ── Mapeamento de Olhar ───────────────────────────────────────────────────────

/** Prediz usando Config B (KR+geo) ou C (KR+fused) — apenas para comparação dev. */
export function mapGazeWithConfig(
  config: 'B' | 'C',
  featuresLeft: number[],
  featuresRight: number[],
  fusedLeft?: number[] | null,
  fusedRight?: number[] | null,
): { x: number; y: number } | null {
  if (config === 'B') {
    if (!devConfigB) return null;
    const sl = featureScalerLeft.transformSingle(featuresLeft);
    const sr = featureScalerRight.transformSingle(featuresRight);
    const pl = devConfigB.left.predict(sl);
    const pr = devConfigB.right.predict(sr);
    return { x: (pl.x + pr.x) / 2, y: (pl.y + pr.y) / 2 };
  }
  if (config === 'C') {
    if (!devConfigC || !fusedLeft || !fusedRight) return null;
    // Log das primeiras 3 inferências: confirma dimensão e que PCA[0..2] varia entre pontos.
    if (_configCPredLogCount < 3) {
      _configCPredLogCount++;
      console.log('[comparison] Config C inferência #%d: fusedLeft.length=%d | pca[0..2]=%s',
        _configCPredLogCount, fusedLeft.length,
        JSON.stringify(fusedLeft.slice(0, 3).map(v => +v.toFixed(4))));
    }
    const sl = fusedScalerLeft.transformSingle(fusedLeft);
    const sr = fusedScalerRight.transformSingle(fusedRight);
    const pl = devConfigC.left.predict(sl);
    const pr = devConfigC.right.predict(sr);
    return { x: (pl.x + pr.x) / 2, y: (pl.y + pr.y) / 2 };
  }
  return null;
}

/** Indica quais configs dev estão disponíveis e por que C pode estar ausente. */
export function hasDevConfigs(): { B: boolean; C: boolean; cReason: string | null } {
  return { B: devConfigB !== null, C: devConfigC !== null, cReason: devConfigCReason };
}

export function mapGaze(
  featuresLeft: number[],
  featuresRight: number[],
  fusedLeft?: number[] | null,
  fusedRight?: number[] | null,
): { x: number; y: number } | null {
  if (!regressorLeft || !regressorRight) return null;

  let scaledLeft: number[];
  let scaledRight: number[];

  if (FEATURE_MODE === 'fused' && fusedLeft && fusedRight) {
    scaledLeft  = fusedScalerLeft.transformSingle(fusedLeft);
    scaledRight = fusedScalerRight.transformSingle(fusedRight);
  } else {
    scaledLeft  = featureScalerLeft.transformSingle(featuresLeft);
    scaledRight = featureScalerRight.transformSingle(featuresRight);
  }

  const predLeft = regressorLeft.predict(scaledLeft);
  const predRight = regressorRight.predict(scaledRight);

  const result = {
    x: (predLeft.x + predRight.x) / 2,
    y: (predLeft.y + predRight.y) / 2
  };

  // Diagnóstico aditivo: distância (no espaço normalizado pelo scaler) ao
  // ponto de calibração mais próximo do perfil salvo. Não afeta `result`.
  const nearestDistLeft = nearestDistance(scaledLeft, scaledProfileLeft);
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

  // Aplica mapa de correção IDW gerado pelo teste de validação.
  // Pulado durante o próprio teste para reportar o erro real do modelo.
  if (!isAccuracyTesting && _gazeCorrections.length >= 3) {
    return applyGazeCorrection(result.x, result.y);
  }

  return result;
}
