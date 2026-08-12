// GazeEngine — wrapper de biblioteca sobre o loop rAF + MediaPipe + Ridge.
// Consumido pelo React (frontend/src/context/GazeContext.tsx) via subscribe.
// Não escreve no DOM; entrega GazeSample por callback para o consumidor renderizar.

import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import * as calibration from '../calibration';
import { OneEuroFilter2D, FILTER_PRESETS } from '../oneEuroFilter';
import type { FilterPreset } from '../oneEuroFilter';
import { extractFeatures } from '../featurePipeline';
import { feedAccuracyRaw } from '../accuracy';
import { EyeQualityAnalyzer } from '../qualityAnalyzer';

export interface GazeSample {
  x: number;
  y: number;
  timestamp: number;
  hasFace: boolean;
}

export type EngineState = 'idle' | 'loading' | 'tracking' | 'calibrating' | 'no_face';

export interface CalibrationApi {
  startCalibrationMode(): void;
  startCollectingPoint(x: number, y: number, onDone: (success: boolean) => void): void;
  completeCalibration(onComplete?: () => void): void;
  clear(): void;
  isCalibrated(): boolean;
  // Sprint 4 — recalibração implícita a partir de dwell clicks confirmados.
  // O consumidor (GazeContext) chama isso ao completar um dwell, passando o
  // centro do elemento como alvo supervisionado.
  feedOnlineSample(targetXpx: number, targetYpx: number): boolean;
  setOnlineCalibrationEnabled(enabled: boolean): void;
  onlineSampleCount(): number;
}

export interface GazeEngine {
  start(video: HTMLVideoElement): Promise<void>;
  stop(): void;
  subscribe(cb: (sample: GazeSample) => void): () => void;
  onStateChange(cb: (state: EngineState) => void): () => void;
  getState(): EngineState;
  // Sprint 5 — troca em tempo real do preset do filtro temporal.
  // `estavel`/`balanceado`/`responsivo` alteram mincutoff, beta e o buffer
  // ponderado. Ver FILTER_PRESETS em oneEuroFilter.ts.
  setFilterPreset(preset: FilterPreset): void;
  calibration: CalibrationApi;
}

const BUFFER_SIZE = 6;
const BUFFER_WEIGHTS = [1, 2, 3, 4, 5, 6];

function weightedBufferAvg(buf: number[]): number {
  const len = buf.length;
  if (len === 0) return 0;
  let weightSum = 0;
  let valueSum = 0;
  for (let i = 0; i < len; i++) {
    const w = BUFFER_WEIGHTS[BUFFER_SIZE - len + i];
    valueSum += buf[i] * w;
    weightSum += w;
  }
  return valueSum / weightSum;
}

export function createGazeEngine(mediapipeBaseUrl?: string): GazeEngine {
  const gazeSubscribers = new Set<(s: GazeSample) => void>();
  const stateSubscribers = new Set<(s: EngineState) => void>();
  let state: EngineState = 'idle';
  let faceLandmarker: FaceLandmarker | null = null;
  let videoEl: HTMLVideoElement | null = null;
  let rafHandle = 0;
  let lastVideoTime = -1;
  let running = false;

  // Sprint 5 — inicia no preset balanceado (equivalente aos parâmetros
  // pré-Sprint 5, para não regredir a percepção de suavidade em quem já
  // conhecia o app). Trocável em tempo real via setFilterPreset.
  let activePreset: FilterPreset = 'balanceado';
  let activeConfig = FILTER_PRESETS[activePreset];
  const oneEuro = new OneEuroFilter2D(60, activeConfig.mincutoff, activeConfig.beta);
  const qualityAnalyzer = new EyeQualityAnalyzer();
  const bufferX: number[] = [];
  const bufferY: number[] = [];

  // Sprint 4 — cache das últimas features extraídas. `feedOnlineSample` no
  // dwell click precisa das features do último frame válido; assim evitamos
  // rebuildar do zero (extractFeatures não é barato).
  let latestFeaturesLeft: number[] = [];
  let latestFeaturesRight: number[] = [];
  let targetX = 0;
  let targetY = 0;
  let lastEmittedX = 0;
  let lastEmittedY = 0;
  let lastEmitHadFace = false;

  // Diagnóstico [IrisFlow]: quantifica se o loop rAF está processando vídeo.
  let framesSeen = 0;
  let framesWithFace = 0;
  let framesEmitted = 0;
  let lastStatMs = 0;

  function setState(next: EngineState): void {
    if (state === next) return;
    state = next;
    stateSubscribers.forEach(cb => cb(state));
  }

  function emit(sample: GazeSample): void {
    if (sample.hasFace) {
      lastEmittedX = sample.x;
      lastEmittedY = sample.y;
    }
    lastEmitHadFace = sample.hasFace;
    gazeSubscribers.forEach(cb => cb(sample));
  }

  async function initMediaPipe(): Promise<void> {
    const base = mediapipeBaseUrl ?? new URL('./mediapipe', location.href).href;
    const vision = await FilesetResolver.forVisionTasks(`${base}/wasm`);
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: `${base}/models/face_landmarker.task`,
        delegate: 'GPU',
      },
      outputFaceBlendshapes: false,
      outputFacialTransformationMatrixes: true,
      runningMode: 'VIDEO',
      numFaces: 1,
    });
  }

  function loop(): void {
    if (!running || !videoEl || !faceLandmarker) return;

    const startTimeMs = performance.now();

    // Diagnóstico periódico: se o loop está rodando mas nunca detecta face,
    // isso ajuda a distinguir "câmera parada" de "sem rosto no frame".
    if (startTimeMs - lastStatMs > 3000) {
      console.log(
        `[IrisFlow] engine stats — frames=${framesSeen} face=${framesWithFace} emit=${framesEmitted} videoTime=${videoEl.currentTime.toFixed(3)} paused=${videoEl.paused}`,
      );
      lastStatMs = startTimeMs;
    }

    if (lastVideoTime !== videoEl.currentTime) {
      lastVideoTime = videoEl.currentTime;
      framesSeen++;

      const results = faceLandmarker.detectForVideo(videoEl, startTimeMs);
      const hasFace = !!(results.faceLandmarks && results.faceLandmarks.length > 0);
      if (hasFace) framesWithFace++;

      if (!hasFace) {
        calibration.feedFaceMetrics(false, 0);
        if (state === 'tracking') setState('no_face');
        if (lastEmitHadFace) {
          emit({
            x: lastEmittedX,
            y: lastEmittedY,
            timestamp: performance.now(),
            hasFace: false,
          });
        }
      } else {
        const landmarks = results.faceLandmarks[0];
        const rawIod = Math.sqrt(
          (landmarks[33].x - landmarks[263].x) ** 2 +
          (landmarks[33].y - landmarks[263].y) ** 2,
        );
        calibration.feedFaceMetrics(true, rawIod);

        const rawMatrix = results.facialTransformationMatrixes?.[0]?.data;
        const faceMatrix = rawMatrix ? new Float32Array(rawMatrix) : undefined;

        const extractorResult = extractFeatures(landmarks, faceMatrix);
        if (!extractorResult.blinkDetected && extractorResult.featuresLeft.length > 0) {
          const featuresLeft = extractorResult.featuresLeft;
          const featuresRight = extractorResult.featuresRight;

          // Sprint 1.1 — sobrescreve brightness/contrast/blur/confidence
          // com valores reais medidos no crop dos olhos. Mantém o
          // irisVisibilityPercentage (EAR) que continua sendo calculado
          // no extractor.
          const cropQuality = qualityAnalyzer.analyze(videoEl, landmarks);
          const quality = {
            ...(extractorResult.advancedFeatures?.quality ?? {}),
            ...cropQuality,
          };

          calibration.feedRawData(featuresLeft, featuresRight, quality);
          feedAccuracyRaw(featuresLeft, featuresRight);
          latestFeaturesLeft = featuresLeft;
          latestFeaturesRight = featuresRight;

          const calibrated = calibration.mapGaze(featuresLeft, featuresRight);
          if (calibrated) {
            targetX = calibrated.x;
            targetY = calibrated.y;
          } else {
            const vw = document.documentElement.clientWidth;
            const vh = document.documentElement.clientHeight;
            targetX = (1.0 - landmarks[1].x) * vw;
            targetY = landmarks[1].y * vh;
          }

          // Sprint 5 — o buffer rolling adicionava lag e (em teste) não
          // aumentava a estabilidade em cima do One Euro. Só permanece quando
          // o preset ativo pede — no preset "estavel" é útil combinar com
          // mincutoff baixo para reduzir jitter de baixa amplitude.
          if (activeConfig.useRollingBuffer) {
            bufferX.push(targetX);
            bufferY.push(targetY);
            while (bufferX.length > BUFFER_SIZE) bufferX.shift();
            while (bufferY.length > BUFFER_SIZE) bufferY.shift();
            targetX = weightedBufferAvg(bufferX);
            targetY = weightedBufferAvg(bufferY);
          } else if (bufferX.length > 0) {
            bufferX.length = 0;
            bufferY.length = 0;
          }

          const now = performance.now() / 1000.0;
          const smoothed = oneEuro.filter(targetX, targetY, now);

          if (calibration.isCalibrating) {
            setState('calibrating');
          } else {
            setState('tracking');
          }

          emit({
            x: smoothed.x,
            y: smoothed.y,
            timestamp: performance.now(),
            hasFace: true,
          });
          framesEmitted++;
        }
      }
    }

    rafHandle = requestAnimationFrame(loop);
  }

  return {
    async start(video: HTMLVideoElement): Promise<void> {
      if (running) return;
      videoEl = video;
      setState('loading');

      if (!faceLandmarker) {
        await initMediaPipe();
      }

      calibration.init();
      running = true;
      setState('tracking');
      rafHandle = requestAnimationFrame(loop);
    },

    stop(): void {
      running = false;
      if (rafHandle) cancelAnimationFrame(rafHandle);
      rafHandle = 0;
      setState('idle');
    },

    subscribe(cb: (sample: GazeSample) => void): () => void {
      gazeSubscribers.add(cb);
      return () => { gazeSubscribers.delete(cb); };
    },

    onStateChange(cb: (s: EngineState) => void): () => void {
      stateSubscribers.add(cb);
      cb(state);
      return () => { stateSubscribers.delete(cb); };
    },

    getState(): EngineState {
      return state;
    },

    setFilterPreset(preset: FilterPreset): void {
      activePreset = preset;
      activeConfig = FILTER_PRESETS[preset];
      oneEuro.setParams(activeConfig.mincutoff, activeConfig.beta);
      // Purga o buffer se acabou de desligar — evita mescla estranha entre
      // o histórico buffered antigo e as amostras filtradas pelo One Euro puro.
      if (!activeConfig.useRollingBuffer) {
        bufferX.length = 0;
        bufferY.length = 0;
      }
      console.log(`[IrisFlow] filtro → ${preset} (mincutoff=${activeConfig.mincutoff}, beta=${activeConfig.beta}, buffer=${activeConfig.useRollingBuffer})`);
    },

    calibration: {
      startCalibrationMode(): void {
        calibration.startCalibrationMode();
      },
      startCollectingPoint(x: number, y: number, onDone: (success: boolean) => void): void {
        calibration.startCollectingPoint(x, y, onDone);
      },
      completeCalibration(onComplete?: () => void): void {
        calibration.completeCalibration(onComplete);
      },
      clear(): void {
        calibration.clearCalibration();
      },
      isCalibrated(): boolean {
        return calibration.isCalibrated();
      },
      feedOnlineSample(targetXpx: number, targetYpx: number): boolean {
        if (latestFeaturesLeft.length === 0 || latestFeaturesRight.length === 0) {
          return false;
        }
        return calibration.feedOnlineSample(
          latestFeaturesLeft,
          latestFeaturesRight,
          targetXpx,
          targetYpx,
        );
      },
      setOnlineCalibrationEnabled(enabled: boolean): void {
        calibration.setOnlineCalibrationEnabled(enabled);
      },
      onlineSampleCount(): number {
        return calibration.onlineSampleCount();
      },
    },
  };
}
