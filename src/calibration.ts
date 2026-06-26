import { trainRidgeModel, predictRidge } from './ridge';
import type { RidgeModel } from './ridge';
import { startAccuracyTest } from './accuracy';

interface CalibrationPoint {
  screenX: number;
  screenY: number;
  rawX: number;
  rawY: number;
}

interface DynamicSample {
  screenX: number;
  screenY: number;
  rawX: number;
  rawY: number;
  weight: number;
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

const GRID_NORM = [0.0, 0.5, 1.0];

const COLLECTION_MS        = 1500;
const TRANSITION_MS        = 1000;
const DYN_MOVE_MS          = 1200;
const DYN_PULSE_MS         = 1500;
const STD_THRESHOLD_X      = 0.015;
const STD_THRESHOLD_Y      = 0.010;
const MAX_UNSTABLE_RETRIES = 2;

// Snake path 3×3 cobrindo toda a tela
const DYNAMIC_WAYPOINTS = [
  { x: 0.05, y: 0.05 },
  { x: 0.50, y: 0.05 },
  { x: 0.95, y: 0.05 },
  { x: 0.95, y: 0.50 },
  { x: 0.50, y: 0.50 },
  { x: 0.05, y: 0.50 },
  { x: 0.05, y: 0.95 },
  { x: 0.50, y: 0.95 },
  { x: 0.95, y: 0.95 },
];

let profile: CalibrationPoint[] = [];
export let isCalibrating = false;
let isDynamicCalibrating = false;
let currentPointIndex = 0;
let isCollecting = false;
let collectionStartTime = 0;
let collectedRawX: number[] = [];
let collectedRawY: number[] = [];
let unstableRetries = 0;

let dynamicSamples: DynamicSample[] = [];
let dynamicBallX = 0.5;
let dynamicBallY = 0.5;
let dynamicIsFixation = false;

// ── Ridge Regression model ───────────────────────────────────────────────────
let ridgeModel: RidgeModel | null = null;

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

export function loadProfile(): boolean {
  try {
    const saved = localStorage.getItem("calibrationProfile");
    if (saved) {
      profile = JSON.parse(saved);
      if (profile.length === 9) {
        ridgeModel = trainRidgeModel(profile);
        return true;
      }
    }
  } catch (e) {
    console.error("Erro ao carregar calibrationProfile:", e);
  }
  profile    = [];
  ridgeModel = null;
  return false;
}

function saveProfile() {
  localStorage.setItem("calibrationProfile", JSON.stringify(profile));
}

export function clearCalibration() {
  profile    = [];
  ridgeModel = null;
  localStorage.removeItem("calibrationProfile");
  localStorage.removeItem("accuracyResult");
  updateStatusUI();
}

export function isCalibrated(): boolean {
  return profile.length === 9;
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

// ── Calibração Estática (9 pontos) ───────────────────────────────────────────

export function startCalibrationMode() {
  if (isCalibrating) return;
  isCalibrating = true;
  currentPointIndex = 0;
  isCollecting = false;
  unstableRetries = 0;
  profile    = [];
  ridgeModel = null;

  createCalibrationOverlay();
  showNextPoint();
  window.addEventListener("keydown", handleGlobalKeyDown);
}

function runAccuracyTest() {
  setTimeout(() => {
    startAccuracyTest((result) => updateStatusUI(result));
  }, 800);
}

function cancelCalibration() {
  isDynamicCalibrating = false;
  dynamicSamples = [];
  cleanupOverlay();
  loadProfile();
  updateStatusUI();
  isCalibrating = false;
  window.removeEventListener("keydown", handleGlobalKeyDown);
}

function createCalibrationOverlay() {
  if (document.getElementById("calibration-overlay")) return;

  const overlay = document.createElement("div");
  overlay.id = "calibration-overlay";
  overlay.className = "calibration-overlay";
  overlay.innerHTML = `
    <div id="calibration-instruction" class="calibration-instruction">
      Olhe fixamente para o ponto e pressione Espaço ou clique
    </div>
    <button id="btn-cancel-calibration" class="btn btn-secondary cancel-btn">Cancelar</button>
  `;
  document.body.appendChild(overlay);

  overlay.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).id === "btn-cancel-calibration") return;
    startCollection();
  });
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
      Olhe fixamente para o ponto <span class="highlight">${currentPointIndex + 1}/${TARGET_POINTS.length}</span><br>
      <span class="action-highlight">ESPAÇO</span> ou <span class="action-highlight">Clique</span> para capturar
    `;
  }
}

function startCollection() {
  if (isDynamicCalibrating || isCollecting || !isCalibrating) return;
  collectedRawX = [];
  collectedRawY = [];
  isCollecting = true;
  collectionStartTime = performance.now();

  const dot = document.getElementById("calibration-dot");
  if (dot) {
    dot.classList.remove("capturing", "unstable", "captured");
    void (dot as HTMLElement).offsetWidth;
    dot.classList.add("capturing");
  }
}

function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((s, v) => s + v, 0) / values.length;
  return Math.sqrt(values.reduce((s, v) => s + (v - mean) ** 2, 0) / values.length);
}

// ── Funções estatísticas robustas ────────────────────────────────────────────

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 !== 0 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function filterOutliers(values: number[]): number[] {
  if (values.length < 6) return values;
  const med = median(values);
  const deviations = values.map(v => Math.abs(v - med));
  const mad = median(deviations);
  // MAD-based filtering: ~2× MAD corresponde a ~1.5 desvios padrão
  const threshold = Math.max(mad * 2.5, 1e-6);
  return values.filter(v => Math.abs(v - med) <= threshold);
}

export function feedRawData(ratioX: number, dy: number) {
  if (isDynamicCalibrating) {
    dynamicSamples.push({
      screenX: dynamicBallX,
      screenY: dynamicBallY,
      rawX: ratioX,
      rawY: dy,
      weight: dynamicIsFixation ? 3.0 : 1.0
    });
    return;
  }

  if (!isCalibrating || !isCollecting) return;

  collectedRawX.push(ratioX);
  collectedRawY.push(dy);

  if (performance.now() - collectionStartTime >= COLLECTION_MS) {
    isCollecting = false;
    processStaticPoint();
  }
}

function processStaticPoint() {
  const isUnstable =
    stdDev(collectedRawX) > STD_THRESHOLD_X ||
    stdDev(collectedRawY) > STD_THRESHOLD_Y;

  if (isUnstable && unstableRetries < MAX_UNSTABLE_RETRIES) {
    unstableRetries++;
    showInstableWarning();
    return;
  }

  unstableRetries = 0;

  // Filtra outliers e usa mediana para robustez (especialmente nos cantos)
  const filteredX = filterOutliers(collectedRawX);
  const filteredY = filterOutliers(collectedRawY);

  const avgX = median(filteredX);
  const avgY = median(filteredY);

  profile.push({
    screenX: TARGET_POINTS[currentPointIndex].screenX,
    screenY: TARGET_POINTS[currentPointIndex].screenY,
    rawX: avgX,
    rawY: avgY
  });

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
      transitionToDynamicPhase();
    }
  }, TRANSITION_MS);
}

function showInstableWarning() {
  const dot = document.getElementById("calibration-dot");
  if (dot) {
    dot.classList.remove("capturing");
    dot.classList.add("unstable");
  }

  const instruction = document.getElementById("calibration-instruction");
  if (instruction) {
    instruction.innerHTML = `
      <span class="warning-text">Movimento detectado — olhe fixamente e tente novamente</span><br>
      <span class="highlight">${currentPointIndex + 1}/${TARGET_POINTS.length}</span> &nbsp;
      <span class="action-highlight">ESPAÇO</span> ou <span class="action-highlight">Clique</span>
    `;
  }
}

function handleGlobalKeyDown(e: KeyboardEvent) {
  if (!isCalibrating || isCollecting || isDynamicCalibrating) return;
  if (e.code === "Space" || e.code === "Enter") {
    e.preventDefault();
    startCollection();
  }
}

// ── Fase 2: Calibração Dinâmica ──────────────────────────────────────────────

function transitionToDynamicPhase() {
  document.getElementById("calibration-dot")?.remove();

  const instruction = document.getElementById("calibration-instruction");
  if (instruction) {
    instruction.innerHTML = `
      <span class="phase-badge">Fase 1 concluída ✓</span>
      <p class="phase-sub">Preparando calibração dinâmica…</p>
    `;
  }

  setTimeout(startDynamicCalibration, 2000);
}

function startDynamicCalibration() {
  isDynamicCalibrating = true;
  dynamicSamples = [];

  const overlay = document.getElementById("calibration-overlay");
  if (!overlay) return;
  overlay.classList.add("dynamic-phase");

  const instruction = document.getElementById("calibration-instruction");
  if (instruction) {
    instruction.innerHTML = `
      <span class="phase-badge">Fase 2 / 2 — Calibração Dinâmica</span>
      <p class="phase-sub">Acompanhe a bolinha com os olhos suavemente</p>
    `;
  }

  // Indicador de progresso
  const progressEl = document.createElement("div");
  progressEl.id = "dynamic-progress";
  progressEl.className = "dynamic-progress";
  DYNAMIC_WAYPOINTS.forEach((_, i) => {
    const d = document.createElement("div");
    d.className = "progress-dot" + (i === 0 ? " active" : "");
    d.id = `pdot-${i}`;
    progressEl.appendChild(d);
  });
  overlay.appendChild(progressEl);

  // Bolinha no primeiro waypoint
  const ball = document.createElement("div");
  ball.id = "dynamic-ball";
  ball.className = "dynamic-ball";
  const wp0 = DYNAMIC_WAYPOINTS[0];
  ball.style.left = `${wp0.x * window.innerWidth}px`;
  ball.style.top  = `${wp0.y * window.innerHeight}px`;
  dynamicBallX = wp0.x;
  dynamicBallY = wp0.y;
  overlay.appendChild(ball);

  setTimeout(() => pulseBall(ball, () => runDynamicSequence(1)), 500);
}

function runDynamicSequence(index: number) {
  if (index >= DYNAMIC_WAYPOINTS.length) {
    completeDynamicCalibration();
    return;
  }

  const prev = document.getElementById(`pdot-${index - 1}`);
  if (prev) { prev.classList.remove("active"); prev.classList.add("done"); }
  const curr = document.getElementById(`pdot-${index}`);
  if (curr) curr.classList.add("active");

  const ball = document.getElementById("dynamic-ball") as HTMLElement | null;
  if (!ball) return;

  moveBallSmoothly(ball, DYNAMIC_WAYPOINTS[index], () => {
    pulseBall(ball, () => runDynamicSequence(index + 1));
  });
}

function moveBallSmoothly(
  ball: HTMLElement,
  target: { x: number; y: number },
  onComplete: () => void
) {
  const startX = dynamicBallX * window.innerWidth;
  const startY = dynamicBallY * window.innerHeight;
  const endX   = target.x * window.innerWidth;
  const endY   = target.y * window.innerHeight;
  const t0     = performance.now();

  dynamicIsFixation = false;

  function frame() {
    const t = Math.min((performance.now() - t0) / DYN_MOVE_MS, 1.0);
    const e = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;

    dynamicBallX = (startX + (endX - startX) * e) / window.innerWidth;
    dynamicBallY = (startY + (endY - startY) * e) / window.innerHeight;
    ball.style.left = `${dynamicBallX * window.innerWidth}px`;
    ball.style.top  = `${dynamicBallY * window.innerHeight}px`;

    if (t < 1.0) {
      requestAnimationFrame(frame);
    } else {
      dynamicBallX = target.x;
      dynamicBallY = target.y;
      onComplete();
    }
  }

  requestAnimationFrame(frame);
}

function pulseBall(ball: HTMLElement, onComplete: () => void) {
  dynamicIsFixation = true;
  ball.classList.remove("pulsing");
  void ball.offsetWidth;
  ball.classList.add("pulsing");

  setTimeout(() => {
    ball.classList.remove("pulsing");
    dynamicIsFixation = false;
    onComplete();
  }, DYN_PULSE_MS);
}

function completeDynamicCalibration() {
  isDynamicCalibrating = false;
  if (dynamicSamples.length >= 20) refineDynamicProfile();

  // Treina o modelo Ridge após refinamento dinâmico
  ridgeModel = trainRidgeModel(profile);

  saveProfile();
  cleanupOverlay();
  isCalibrating = false;
  window.removeEventListener("keydown", handleGlobalKeyDown);
  runAccuracyTest();
}

function refineDynamicProfile() {
  const SIGMA    = 0.15;
  const MAX_DIST = 0.35;

  for (const pt of profile) {
    let totalW = 0, sumX = 0, sumY = 0;

    for (const s of dynamicSamples) {
      const dx   = s.screenX - pt.screenX;
      const dy   = s.screenY - pt.screenY;
      const dist = Math.sqrt(dx * dx + dy * dy);
      if (dist > MAX_DIST) continue;
      const w = Math.exp(-(dist * dist) / (2 * SIGMA * SIGMA)) * s.weight;
      totalW += w;
      sumX   += s.rawX * w;
      sumY   += s.rawY * w;
    }

    if (totalW > 5) {
      // Influência dinâmica conservadora: máximo 30% de ajuste
      const alpha = Math.min((totalW - 5) / 200, 0.30);
      pt.rawX = pt.rawX * (1 - alpha) + (sumX / totalW) * alpha;
      pt.rawY = pt.rawY * (1 - alpha) + (sumY / totalW) * alpha;
    }
  }
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
}

// ── Mapeamento de Olhar ───────────────────────────────────────────────────────

export function mapGaze(ratioX: number, dy: number): { x: number; y: number } | null {
  if (profile.length !== 9) return null;

  // Usa Ridge Regression se o modelo estiver disponível
  if (ridgeModel) {
    return predictRidge(ridgeModel, ratioX, dy);
  }

  // Fallback: interpolação bilinear 3×3 (9 pontos)
  const lerpVal     = (a: number, b: number, t: number) => a + (b - a) * t;
  const clampVal    = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);
  const mapRangeVal = (v: number, iMin: number, iMax: number, oMin: number, oMax: number) => {
    if (Math.abs(iMax - iMin) < 1e-6) return oMin;
    return (v - iMin) * (oMax - oMin) / (iMax - iMin) + oMin;
  };

  const pt = profile;

  function getColRawX(col: number, y: number): number {
    const rows = [pt[col], pt[col + 3], pt[col + 6]];
    for (let i = 0; i < 2; i++) {
      const a = rows[i], b = rows[i + 1];
      if (y <= Math.max(a.rawY, b.rawY) || i === 1) {
        if (Math.abs(a.rawY - b.rawY) < 1e-6) return a.rawX;
        return lerpVal(a.rawX, b.rawX, clampVal((y - a.rawY) / (b.rawY - a.rawY), 0, 1));
      }
    }
    return rows[0].rawX;
  }

  function getRowRawY(row: number, x: number): number {
    const cols = [pt[row * 3], pt[row * 3 + 1], pt[row * 3 + 2]];
    for (let i = 0; i < 2; i++) {
      const a = cols[i], b = cols[i + 1];
      if (x <= Math.max(a.rawX, b.rawX) || i === 1) {
        if (Math.abs(a.rawX - b.rawX) < 1e-6) return a.rawY;
        return lerpVal(a.rawY, b.rawY, clampVal((x - a.rawX) / (b.rawX - a.rawX), 0, 1));
      }
    }
    return cols[0].rawY;
  }

  const c0 = getColRawX(0, dy), c1 = getColRawX(1, dy), c2 = getColRawX(2, dy);

  let normX: number;
  if (ratioX <= c1) normX = mapRangeVal(ratioX, c0, c1, GRID_NORM[0], GRID_NORM[1]);
  else              normX = mapRangeVal(ratioX, c1, c2, GRID_NORM[1], GRID_NORM[2]);

  const r0 = getRowRawY(0, ratioX), r1 = getRowRawY(1, ratioX), r2 = getRowRawY(2, ratioX);

  let normY: number;
  if (dy <= r1) normY = mapRangeVal(dy, r0, r1, GRID_NORM[0], GRID_NORM[1]);
  else          normY = mapRangeVal(dy, r1, r2, GRID_NORM[1], GRID_NORM[2]);

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  return {
    x: clampVal(normX, 0, 1) * vw,
    y: clampVal(normY, 0, 1) * vh,
  };
}
