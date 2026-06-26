import './style.css';
import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import * as calibration from './calibration';
import { feedAccuracyRaw, isAccuracyTesting } from './accuracy';
import { KalmanGaze2D } from './kalman';
import { updateDwell, resetDwell } from './dwell';
import { extractEyeFeatures } from './extractor';

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

const lerp = (start: number, end: number, factor: number) => {
  return start + (end - start) * factor;
};

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

      let matrixData: Float32Array | number[] | undefined;
      if (results.facialTransformationMatrixes && results.facialTransformationMatrixes.length > 0) {
        matrixData = results.facialTransformationMatrixes[0].data;
      }
      
      const features = extractEyeFeatures(landmarks, matrixData);

      // Envia coordenadas cruas para o sistema de calibração
      calibration.feedRawData(features);

      // Alimenta o módulo de precisão com as coordenadas cruas
      feedAccuracyRaw(features);

      // Tenta mapear o olhar usando o perfil calibrado
      const calibratedGaze = calibration.mapGaze(features);

      if (calibratedGaze) {
        targetX = calibratedGaze.x;
        targetY = calibratedGaze.y;
      } else {
        // Fallback enquanto não está calibrado (cursor central com pequenos movimentos relativos)
        const vw = document.documentElement.clientWidth;
        const vh = document.documentElement.clientHeight;
        const noseX = landmarks[1].x;
        const noseY = landmarks[1].y;
        targetX = (1.0 - noseX) * vw;
        targetY = noseY * vh;
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
