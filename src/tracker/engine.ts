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
import { createL2CSClient, type L2CSClient } from '../l2cs/client';
import { createCropContext, cropFaceToTensor, type CropContext } from '../l2cs/crop';
import type { L2CSGazeInput } from '../extractor';

// Status do subsistema L2CS. Exposto via engine.getL2CSStatus() para a UI
// poder bloquear calibração enquanto o worker não estiver 'ready' — calibrar
// com o worker 'loading' treina o Ridge com o bloco de 7 dims em zero
// (buildL2CSBlock(valid=false)) e depois, quando o worker liga, o vetor muda
// e o modelo fica dessincronizado.
export type L2CSStatus = 'loading' | 'ready' | 'error';

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
  // Estado do subsistema L2CS. UI deve bloquear calibração enquanto != 'ready'.
  // getL2CSStatus é síncrono (para leituras pontuais); onL2CSStatusChange
  // dispara o cb no ato da subscrição com o valor atual + em cada transição
  // (mesmo padrão de onStateChange).
  getL2CSStatus(): L2CSStatus;
  onL2CSStatusChange(cb: (status: L2CSStatus) => void): () => void;
  calibration: CalibrationApi;
}

const BUFFER_SIZE = 6;
const BUFFER_WEIGHTS = [1, 2, 3, 4, 5, 6];

// E1 do L2CS-NET.md — orientação dos pixels do vídeo.
//
// O L2CS foi treinado com a imagem "como a câmera vê" (não espelhada). Esta
// constante descreve se os pixels do HTMLVideoElement entregue ao engine já
// estão espelhados horizontalmente antes de chegar aqui. É consumida por
// cropFaceToTensor (src/l2cs/crop.ts) em E6 — quando true, o crop faz o flip
// horizontal antes de mandar para a inferência.
//
// EVIDÊNCIA para o valor `false` no setup atual do IrisFlow:
//   1. GazeContext.tsx cria o <video> sem `transform: scaleX(-1)` (linhas 244-253).
//   2. getUserMedia({ facingMode: 'user' }) devolve pixels crus da câmera —
//      nenhum browser aplica mirror por padrão nos pixels (só na exibição CSS,
//      quando o dev pede).
//   3. axis_validation empírico com foto `look_right` (usuário olhou para a
//      direita dele) → yaw = +26° do L2CS. Se os pixels estivessem espelhados,
//      o L2CS interpretaria o gaze como "esquerda" e devolveria yaw negativo.
//      Sinal positivo confirma pixels não espelhados.
//
// A doc §E1 do L2CS-NET.md interpreta a inversão `(1.0 - landmarks[1].x) * vw`
// abaixo como sinal de mirror — na prática essa inversão é um proxy de gaze a
// partir da pose da cabeça (nariz à esquerda da imagem = usuário virou a cabeça
// à direita = alvo deve ir à direita da tela), não evidência de pixel mirror.
//
// QUANDO trocar para `true`:
//   - Se adicionar `transform: scaleX(-1)` no elemento <video> exibido ao usuário
//     E o mesmo elemento (não uma cópia) for entregue ao engine, OS PIXELS
//     ainda não mudam — só a exibição. Manter `false`.
//   - Se algum estágio pré-engine desenhar o vídeo em canvas espelhado e passar
//     esse canvas como source, aí sim `true`.
//   - Se algum driver/OS aplicar mirror nível-driver (raro), rodar
//     axis_validation com os 3 fotos e checar sinal do yaw — se `look_right`
//     virar yaw negativo, trocar para `true`.
export const IS_VIDEO_MIRRORED = false;

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

  // E6 do L2CS-NET.md — cliente + contexto de crop. L2CS é obrigatório no
  // pipeline atual (não há fallback A/B). O worker carrega uma única vez;
  // não é recreado entre start/stop múltiplos pra evitar recarregar o ONNX
  // de 91 MB. Se a inicialização falhar, l2csStatus fica 'error' e a UI
  // deve exibir isso; o loop rAF continua rodando (com bloco zerado) só
  // para o cursor não travar completamente.
  let l2csClient: L2CSClient | null = null;
  let cropCtx: CropContext | null = null;
  let l2csStatus: L2CSStatus = 'loading';
  const l2csStatusSubscribers = new Set<(s: L2CSStatus) => void>();
  let l2csFramesSubmitted = 0;
  let l2csFramesValid = 0;
  let l2csFramesStale = 0;

  function setState(next: EngineState): void {
    if (state === next) return;
    state = next;
    stateSubscribers.forEach(cb => cb(state));
  }

  function setL2CSStatus(next: L2CSStatus): void {
    if (l2csStatus === next) return;
    l2csStatus = next;
    l2csStatusSubscribers.forEach(cb => cb(l2csStatus));
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

  // E6 — inicialização fire-and-forget do L2CS. Nunca bloqueia engine.start()
  // porque o loop rAF precisa começar já para o cursor não ficar parado.
  // Se init falhar, marca status='error' — a UI deve consultar via
  // getL2CSStatus() e mostrar erro/impedir calibração.
  function initL2CSAsync(): void {
    if (l2csClient) return; // já iniciado
    cropCtx = createCropContext();
    l2csClient = createL2CSClient();
    l2csClient.start().then(
      () => { setL2CSStatus('ready'); console.log('[L2CS] worker ready'); },
      (err) => {
        setL2CSStatus('error');
        console.error('[L2CS] worker init FAILED — pipeline degradado (bloco angular zerado). Motivo:', err);
      },
    );
  }

  function loop(): void {
    if (!running || !videoEl || !faceLandmarker) return;

    const startTimeMs = performance.now();

    // Diagnóstico periódico: se o loop está rodando mas nunca detecta face,
    // isso ajuda a distinguir "câmera parada" de "sem rosto no frame".
    if (startTimeMs - lastStatMs > 3000) {
      console.log(
        `[IrisFlow] engine stats — frames=${framesSeen} face=${framesWithFace} emit=${framesEmitted} videoTime=${videoEl.currentTime.toFixed(3)} paused=${videoEl.paused} l2cs=${l2csStatus} submit=${l2csFramesSubmitted} valid=${l2csFramesValid} stale=${l2csFramesStale}`,
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

        // E6 — L2CS: submete tensor throttled (10 Hz) e lê o último gaze
        // válido do cache. O loop rAF nunca aguarda; se stale ou worker off,
        // o extractor recebe {valid: false} e anexa 7 zeros (degradação
        // graciosa, §E4). O crop só é construído quando canSubmit()=true
        // pra não desperdiçar ~5ms/frame com getImageData de 448².
        let l2csGaze: L2CSGazeInput | null = null;
        if (l2csClient && cropCtx && videoEl) {
          if (l2csClient.canSubmit(startTimeMs)) {
            try {
              const tensor = cropFaceToTensor(videoEl, {
                landmarks,
                isMirrored: IS_VIDEO_MIRRORED,
                context: cropCtx,
              });
              if (l2csClient.submitTensor(tensor)) l2csFramesSubmitted++;
            } catch (e) {
              // Ex.: getImageData tainted, video not ready. Não afeta o resto
              // do pipeline — extractor recebe null e não anexa bloco.
              console.warn('[L2CS] crop failed:', e);
            }
          }
          const g = l2csClient.getLatestGaze(startTimeMs);
          l2csGaze = { yaw: g.yaw, pitch: g.pitch, valid: g.valid };
          if (g.valid) l2csFramesValid++; else l2csFramesStale++;
        }

        const extractorResult = extractFeatures(landmarks, faceMatrix, l2csGaze);
        if (!extractorResult.blinkDetected && extractorResult.featuresLeft.length > 0) {
          const featuresLeft = extractorResult.featuresLeft;
          const featuresRight = extractorResult.featuresRight;

          // Sprint 1.1 — sobrescreve brightness/contrast/blur/confidence
          // com valores reais medidos no crop dos olhos. Mantém o
          // irisVisibilityPercentage (EAR) que continua sendo calculado
          // no extractor.
          const cropQuality = qualityAnalyzer.analyze(videoEl, landmarks);
          // Hotfix — pose viaja no `quality` para que `feedRawData` possa
          // rejeitar amostras de calibração cuja cabeça se afastou do
          // baseline do ponto (fonte principal do colapso da coluna
          // esquerda observado no primeiro teste real).
          const face = extractorResult.advancedFeatures?.face;
          const quality = {
            ...(extractorResult.advancedFeatures?.quality ?? {}),
            ...cropQuality,
            yaw:   face?.yaw,
            pitch: face?.pitch,
            roll:  face?.roll,
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
      initL2CSAsync();
      running = true;
      setState('tracking');
      rafHandle = requestAnimationFrame(loop);
    },

    stop(): void {
      running = false;
      if (rafHandle) cancelAnimationFrame(rafHandle);
      rafHandle = 0;
      // Preserva l2csClient e cropCtx entre start/stop para evitar recarregar
      // o ONNX de 91 MB. Só é liberado se o consumidor destruir o engine
      // inteiro (não expomos API pra isso ainda).
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

    getL2CSStatus(): L2CSStatus {
      return l2csStatus;
    },

    onL2CSStatusChange(cb: (s: L2CSStatus) => void): () => void {
      l2csStatusSubscribers.add(cb);
      // Emite o valor atual imediatamente para o subscriber não precisar
      // combinar getL2CSStatus() + subscribe (mesmo padrão de onStateChange).
      cb(l2csStatus);
      return () => { l2csStatusSubscribers.delete(cb); };
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
