import './style.css';
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import * as calibration from './calibration';
import { feedAccuracyRaw, isAccuracyTesting } from './accuracy';
import { KalmanGaze2D } from './kalman';
import { updateDwell, resetDwell } from './dwell';

const video     = document.getElementById('webcam') as HTMLVideoElement;
const canvas    = document.getElementById('output_canvas') as HTMLCanvasElement;
const laser     = document.getElementById('laser') as HTMLDivElement;
const loadingMsg = document.getElementById('loading') as HTMLDivElement;

let faceLandmarker: FaceLandmarker;
let lastVideoTime = -1;

// Coordenadas para interpolação (Lerp)
let targetX  = document.documentElement.clientWidth / 2;
let targetY  = document.documentElement.clientHeight / 2;
let currentX = document.documentElement.clientWidth / 2;
let currentY = document.documentElement.clientHeight / 2;

// Rolling buffer de 6 frames para suavização ponderada (inspirado no EyeGestures engine)
// Reduz jitter especialmente nas bordas da tela onde o sinal é mais ruidoso
const BUFFER_SIZE    = 6;
const bufferX: number[] = [];
const bufferY: number[] = [];
// Pesos crescentes: frames mais recentes têm maior influência
const BUFFER_WEIGHTS = [1, 2, 3, 4, 5, 6];

function weightedBufferAvg(buf: number[]): number {
  const len = buf.length;
  if (len === 0) return 0;
  let weightSum = 0;
  let valueSum  = 0;
  for (let i = 0; i < len; i++) {
    const w = BUFFER_WEIGHTS[BUFFER_SIZE - len + i];
    valueSum  += buf[i] * w;
    weightSum += w;
  }
  return valueSum / weightSum;
}

// Filtro de Kalman 2D — inserido após o rolling buffer e antes do lerp (Adição A)
const kalmanGaze = new KalmanGaze2D();

// Limites padrão para calibração auto-adaptativa
const DEFAULT_MIN_X = 0.35;
const DEFAULT_MAX_X = 0.65;
const DEFAULT_MIN_Y = -0.07;
const DEFAULT_MAX_Y = 0.07;

let minX = DEFAULT_MIN_X;
let maxX = DEFAULT_MAX_X;
let minY = DEFAULT_MIN_Y;
let maxY = DEFAULT_MAX_Y;

// Fator de decaimento para fazer os limites retornarem lentamente aos padrões
const CALIBRATION_DECAY = 0.0001;

const lerp = (start: number, end: number, factor: number) => {
  return start + (end - start) * factor;
};

const clamp = (val: number, min: number, max: number) => Math.min(Math.max(val, min), max);

const mapRange = (val: number, inMin: number, inMax: number, outMin: number, outMax: number) => {
  return (val - inMin) * (outMax - outMin) / (inMax - inMin) + outMin;
};

// Extrai a submatriz 3x3 de rotação de uma matriz 4x4 column-major
function extractRotationMatrix(m: number[]): number[][] {
  return [
    [m[0], m[4], m[8]],
    [m[1], m[5], m[9]],
    [m[2], m[6], m[10]]
  ];
}

// Aplica uma matriz 3x3 a um ponto 3D
function applyMatrix3(R: number[][], p: { x: number; y: number; z: number }) {
  return {
    x: R[0][0] * p.x + R[0][1] * p.y + R[0][2] * p.z,
    y: R[1][0] * p.x + R[1][1] * p.y + R[1][2] * p.z,
    z: R[2][0] * p.x + R[2][1] * p.y + R[2][2] * p.z
  };
}

// ── FPS counter (Meta 4 §7) ───────────────────────────────────────────────────
let fpsFrameCount = 0;
let fpsLastTime   = performance.now();
let currentFps    = 0;

function tickFps(): void {
  fpsFrameCount++;
  const now     = performance.now();
  const elapsed = now - fpsLastTime;
  if (elapsed >= 1000) {
    currentFps    = Math.round(fpsFrameCount * 1000 / elapsed);
    fpsFrameCount = 0;
    fpsLastTime   = now;
    calibration.updateFpsDisplay(currentFps);
  }
}

// ── Signal Quality tracker: % de frames com face detectada nos últimos 5s (§8) ─
const SQ_WINDOW_MS   = 5000;
const signalTimestamps: { time: number; hasFace: boolean }[] = [];

function recordSignalFrame(hasFace: boolean): void {
  const now = performance.now();
  signalTimestamps.push({ time: now, hasFace });
  // Remove entradas fora da janela de 5s
  const cutoff = now - SQ_WINDOW_MS;
  while (signalTimestamps.length > 0 && signalTimestamps[0].time < cutoff) {
    signalTimestamps.shift();
  }
  // Atualiza painel a cada ~30 frames
  if (signalTimestamps.length % 30 === 0) {
    const pct = signalTimestamps.filter(s => s.hasFace).length / signalTimestamps.length;
    calibration.updateSignalQuality(Math.round(pct * 100));
  }
}

// ── Verificação de iluminação via brilho do frame de vídeo (§8) ──────────────
// A verificação periódica analisa um thumbnail do vídeo para estimar se a cena
// está muito escura. Um valor médio de luminância < 40 (de 0–255) corresponde a
// condições de iluminação abaixo de ~200 lux em câmeras típicas.
let lightingCheckCanvas: HTMLCanvasElement | null = null;

function checkLighting(): void {
  if (!video || video.videoWidth === 0) return;

  if (!lightingCheckCanvas) {
    lightingCheckCanvas = document.createElement('canvas');
    lightingCheckCanvas.width  = 32;
    lightingCheckCanvas.height = 18;
  }

  const ctx = lightingCheckCanvas.getContext('2d');
  if (!ctx) return;
  ctx.drawImage(video, 0, 0, 32, 18);
  const data = ctx.getImageData(0, 0, 32, 18).data;

  let lum = 0;
  for (let i = 0; i < data.length; i += 4) {
    lum += data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
  }
  lum /= data.length / 4;

  calibration.updateLightingWarning(lum < 40);
}

async function initMediaPipe() {
  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
  );

  faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task`,
      delegate: "GPU"
    },
    outputFaceBlendshapes: false,
    outputFacialTransformationMatrixes: true,
    runningMode: "VIDEO",
    numFaces: 1
  });

  loadingMsg.style.display = 'none';
  startCamera();
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { width: 1280, height: 720, facingMode: "user" }
    });
    video.srcObject = stream;
    video.addEventListener("loadeddata", () => {
      // Inicia verificação periódica de iluminação a cada 3 segundos
      setInterval(checkLighting, 3000);
      predictWebcam();
    });
  } catch (err) {
    console.error("Erro ao acessar a câmera:", err);
    loadingMsg.innerText = "Erro ao acessar a câmera.";
  }
}

async function predictWebcam() {
  if (canvas.width !== video.videoWidth) {
    canvas.width  = video.videoWidth;
    canvas.height = video.videoHeight;
  }

  tickFps();

  const startTimeMs = performance.now();
  if (lastVideoTime !== video.currentTime) {
    lastVideoTime = video.currentTime;

    const results = faceLandmarker.detectForVideo(video, startTimeMs);
    const hasFace = !!(results.faceLandmarks && results.faceLandmarks.length > 0);
    recordSignalFrame(hasFace);

    // Feed de métricas para a tela de pré-calibração
    if (!hasFace) {
      calibration.feedFaceMetrics(false, 0);
    }

    if (hasFace) {
      const landmarks = results.faceLandmarks[0];

      // IOD bruto para estimativa de distância (pré-calibração)
      const rawIod = Math.sqrt(
        (landmarks[33].x - landmarks[263].x) ** 2 +
        (landmarks[33].y - landmarks[263].y) ** 2
      );
      calibration.feedFaceMetrics(true, rawIod);

      // Compensa a pose da cabeça: M transforma do espaço canônico da cabeça para o espaço
      // da câmera (P_camera = M * P_head). A transposta R^T é a inversa para matrizes
      // de rotação, mapeando de volta para o espaço local da cabeça (P_head = R^T * P_camera).
      // Isso remove o efeito da rotação da cabeça dos landmarks antes de calcular os ratios.
      let Rinv: number[][] | null = null;
      if (results.facialTransformationMatrixes && results.facialTransformationMatrixes.length > 0) {
        const R = extractRotationMatrix(Array.from(results.facialTransformationMatrixes[0].data));
        Rinv = [
          [R[0][0], R[1][0], R[2][0]],
          [R[0][1], R[1][1], R[2][1]],
          [R[0][2], R[1][2], R[2][2]]
        ];
      }

      const toHead = (p: { x: number; y: number; z: number }) =>
        Rinv ? applyMatrix3(Rinv, p) : p;

      // ── Coleta dos pontos base em espaço de cabeça ────────────────────────
      // Olho Direito do Usuário (Lado esquerdo da imagem)
      const irisL_cam = {
        x: (landmarks[468].x + landmarks[469].x + landmarks[470].x + landmarks[471].x + landmarks[472].x) / 5,
        y: (landmarks[468].y + landmarks[469].y + landmarks[470].y + landmarks[471].y + landmarks[472].y) / 5,
        z: (landmarks[468].z + landmarks[469].z + landmarks[470].z + landmarks[471].z + landmarks[472].z) / 5
      };

      // Olho Esquerdo do Usuário (Lado direito da imagem)
      const irisR_cam = {
        x: (landmarks[473].x + landmarks[474].x + landmarks[475].x + landmarks[476].x + landmarks[477].x) / 5,
        y: (landmarks[473].y + landmarks[474].y + landmarks[475].y + landmarks[476].y + landmarks[477].y) / 5,
        z: (landmarks[473].z + landmarks[474].z + landmarks[475].z + landmarks[476].z + landmarks[477].z) / 5
      };

      const irisL_head    = toHead(irisL_cam);
      const eyeOuterL_head = toHead(landmarks[33]);
      const eyeInnerL_head = toHead(landmarks[133]);
      const irisR_head    = toHead(irisR_cam);
      const eyeOuterR_head = toHead(landmarks[263]);
      const eyeInnerR_head = toHead(landmarks[362]);

      // ── Adição C — Canonicalização inter-ocular ───────────────────────────
      // Normaliza todos os pontos pela distância inter-ocular (IOD) para tornar
      // as features invariantes à distância do usuário à câmera.
      // Fórmula (Arxiv 2603.12388):
      //   c = (p_33 + p_263) / 2,   s = ||p_263 - p_33||,   p_norm = (p - c) / (s + ε)
      //
      // Nota: como ratioX e dy são calculados como razões de posições relativas,
      // a normalização cancela algebricamente — mas torna a invariância explícita
      // no código e futuramente permite usar coordenadas absolutas sem regressão.
      const EPS = 1e-6;
      const cx  = (eyeOuterL_head.x + eyeOuterR_head.x) / 2;
      const cy  = (eyeOuterL_head.y + eyeOuterR_head.y) / 2;
      const iod = Math.sqrt(
        (eyeOuterL_head.x - eyeOuterR_head.x) ** 2 +
        (eyeOuterL_head.y - eyeOuterR_head.y) ** 2 +
        (eyeOuterL_head.z - eyeOuterR_head.z) ** 2
      ) + EPS;

      const norm = (p: { x: number; y: number; z: number }) => ({
        x: (p.x - cx) / iod,
        y: (p.y - cy) / iod,
        z:  p.z        / iod,
      });

      const irisL      = norm(irisL_head);
      const eyeOuterL  = norm(eyeOuterL_head);
      const eyeInnerL  = norm(eyeInnerL_head);
      const irisR      = norm(irisR_head);
      const eyeOuterR  = norm(eyeOuterR_head);
      const eyeInnerR  = norm(eyeInnerR_head);

      // ── Cálculo dos Gaze Ratios (Etapa 4) ────────────────────────────────
      const eyeWidthL   = Math.abs(eyeOuterL.x - eyeInnerL.x);
      const minEyeXL    = Math.min(eyeOuterL.x, eyeInnerL.x);
      let   ratioXL     = (irisL.x - minEyeXL) / eyeWidthL;
      ratioXL           = 1.0 - ratioXL;
      const stableCYL   = (eyeOuterL.y + eyeInnerL.y) / 2;
      const dyL         = (irisL.y - stableCYL) / eyeWidthL;

      const eyeWidthR   = Math.abs(eyeOuterR.x - eyeInnerR.x);
      const minEyeXR    = Math.min(eyeOuterR.x, eyeInnerR.x);
      let   ratioXR     = (irisR.x - minEyeXR) / eyeWidthR;
      ratioXR           = 1.0 - ratioXR;
      const stableCYR   = (eyeOuterR.y + eyeInnerR.y) / 2;
      const dyR         = (irisR.y - stableCYR) / eyeWidthR;

      // Média dos dois olhos para maior estabilidade
      const ratioX = (ratioXL + ratioXR) / 2;
      const dy     = (dyL + dyR) / 2;

      // Calibração auto-adaptativa: expande os limites dinamicamente se o usuário olhar além
      if (ratioX < minX) minX = ratioX;
      if (ratioX > maxX) maxX = ratioX;
      if (dy < minY) minY = dy;
      if (dy > maxY) maxY = dy;

      // Decaimento suave dos limites de calibração em direção aos valores padrão
      minX = lerp(minX, DEFAULT_MIN_X, CALIBRATION_DECAY);
      maxX = lerp(maxX, DEFAULT_MAX_X, CALIBRATION_DECAY);
      minY = lerp(minY, DEFAULT_MIN_Y, CALIBRATION_DECAY);
      maxY = lerp(maxY, DEFAULT_MAX_Y, CALIBRATION_DECAY);

      // Envia coordenadas cruas para o sistema de calibração (registra se estiver capturando)
      calibration.feedRawData(ratioX, dy);

      // Alimenta o módulo de precisão com as coordenadas cruas
      feedAccuracyRaw(ratioX, dy);

      // Tenta mapear o olhar usando o perfil calibrado
      const calibratedGaze = calibration.mapGaze(ratioX, dy);

      if (calibratedGaze) {
        targetX = calibratedGaze.x;
        targetY = calibratedGaze.y;
      } else {
        // Mapeamento dos limites dinâmicos (fallback) para a resolução da tela
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        const mappedX = mapRange(ratioX, minX, maxX, 0, vw);
        const mappedY = mapRange(dy, minY, maxY, 0, vh);
        targetX = clamp(mappedX, 0, vw);
        targetY = clamp(mappedY, 0, vh);
      }

      // Atualiza o rolling buffer com o target calculado
      // Durante teste de precisão, usa buffer menor para reduzir atraso
      const effectiveBufferSize = isAccuracyTesting ? 3 : BUFFER_SIZE;
      bufferX.push(targetX);
      bufferY.push(targetY);
      while (bufferX.length > effectiveBufferSize) bufferX.shift();
      while (bufferY.length > effectiveBufferSize) bufferY.shift();

      // Substitui targetX/Y pela média ponderada do buffer antes do Kalman
      targetX = weightedBufferAvg(bufferX);
      targetY = weightedBufferAvg(bufferY);

      // Aplica Filtro de Kalman após o rolling buffer e antes do lerp
      // Pula Kalman durante teste de precisão para evitar lag na medição
      if (!isAccuracyTesting) {
        const kalmanOut = kalmanGaze.update(targetX, targetY);
        targetX = kalmanOut.x;
        targetY = kalmanOut.y;
      }

      // Adição D — dwell time e detecção de piscada (apenas quando não calibrando)
      if (!calibration.isCalibrating) {
        updateDwell(landmarks, currentX, currentY, (evt) => {
          console.debug('[IrisFlow] DwellEvent:', evt.type, evt.x.toFixed(0), evt.y.toFixed(0));
        });
      } else {
        resetDwell();
      }
    }
  }

  // Suavizar o movimento (Lerp)
  // Durante teste de precisão, lerp mais responsivo para medição fiel
  const lerpFactor = isAccuracyTesting ? 0.25 : 0.08;
  currentX = lerp(currentX, targetX, lerpFactor);
  currentY = lerp(currentY, targetY, lerpFactor);

  // Ocultar laser durante calibração para evitar distração ocular do usuário
  if (calibration.isCalibrating) {
    laser.style.display = 'none';
  } else {
    laser.style.display = 'block';
    laser.style.left = `${currentX}px`;
    laser.style.top  = `${currentY}px`;
  }

  window.requestAnimationFrame(predictWebcam);
}

// Inicializa o painel de calibração e carrega perfis salvos
calibration.init();

initMediaPipe();
