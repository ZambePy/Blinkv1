// GazeEngine — wrapper de biblioteca sobre o loop rAF + MediaPipe + Ridge.
// Consumido pelo React (frontend/src/context/GazeContext.tsx) via subscribe.
// Não escreve no DOM; entrega GazeSample por callback para o consumidor renderizar.

import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import * as calibration from '../calibration';
import { OneEuroFilter2D, FILTER_PRESETS, FILTER_PRESETS_V2 } from '../oneEuroFilter';
import type { FilterPreset, FilterPresetV2 } from '../oneEuroFilter';
import { extractFeatures } from '../featurePipeline';
import { feedAccuracyRaw, getCurrentTargetPx as getAccuracyTargetPx } from '../accuracy';
import { EyeQualityAnalyzer } from '../qualityAnalyzer';
import { createL2CSClient, type L2CSClient } from '../l2cs/client';
import { createCropContext, cropFaceToTensor, type CropContext } from '../l2cs/crop';
import type { L2CSGazeInput } from '../extractor';
import * as recorder from '../telemetry/recorder';
import type { RecordedQuality, RecordedTarget } from '../telemetry/types';
import { EXPERIMENT } from '../config/experiment';

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
  // A1-4 — true quando o engine está no estado 'degraded': calibração feita
  // mas mapGaze devolveu null por >DEGRADED_THRESHOLD_MS seguidos. Consumidores
  // devem tratar o cursor como não-confiável (é o fallback do nariz, não gaze),
  // desabilitar dwell exceto para elementos data-emergency, e mostrar aparência
  // distinta. Opcional para compat com consumidores anteriores a A1-4.
  degraded?: boolean;
}

// A1-4 — estado 'degraded' distingue "sistema não sabe onde o olhar está" de
// "sistema funcionando". Usuário-alvo ELA não pode desdizer um clique feito
// sob cursor errado; melhor bloquear a UI que aceitar seleção aleatória.
export type EngineState = 'idle' | 'loading' | 'tracking' | 'calibrating' | 'no_face' | 'degraded';

// A1-4 — quanto tempo mapGaze pode devolver null antes de considerarmos que
// a predição está degradada. 500 ms = ~15 frames a 30 fps — tolera glitch
// isolado de 1-2 frames mas pega bug persistente (features degeneradas,
// exceção repetida silenciada por _dimErrorLogged em calibration.ts).
export const DEGRADED_THRESHOLD_MS = 500;

// A1-4 — lógica pura do timer de degradação, testável sem rAF/DOM/worker.
// Retorna o novo `nullSinceMs` (null se o timer foi zerado) e se o estado
// deveria ser 'degraded' agora.
//
// Casos:
// - Frame com predição válida (mapGazeReturnedNull=false) → zera timer, não degraded
// - Sem calibração ativa ou em modo de calibração → zera timer (null não conta)
// - Com calibração e mapGaze null → inicia/mantém timer; degrada se >threshold
export function updateDegradedTimer(input: {
  mapGazeReturnedNull: boolean;
  isCalibrated: boolean;
  isCalibrating: boolean;
  currentNullSinceMs: number | null;
  now: number;
  thresholdMs?: number;
}): { newNullSinceMs: number | null; isDegraded: boolean } {
  const threshold = input.thresholdMs ?? DEGRADED_THRESHOLD_MS;
  if (!input.mapGazeReturnedNull) {
    return { newNullSinceMs: null, isDegraded: false };
  }
  const activeCalibration = input.isCalibrated && !input.isCalibrating;
  if (!activeCalibration) {
    return { newNullSinceMs: null, isDegraded: false };
  }
  const nullSince = input.currentNullSinceMs ?? input.now;
  const isDegraded = input.now - nullSince > threshold;
  return { newNullSinceMs: nullSince, isDegraded };
}

// A1-1 — re-export para a UI consumir sem depender diretamente de calibration.ts.
export type { CalibrationOutcome } from '../calibration';

export interface CalibrationApi {
  startCalibrationMode(): void;
  startCollectingPoint(x: number, y: number, onDone: (success: boolean) => void): void;
  // A1-1 — outcome tipado. Callback opcional; se fornecido, recebe { ok: true }
  // no sucesso ou { ok: false, reason, detail } em qualquer falha do treino
  // (matriz singular, features degeneradas, amostras insuficientes, etc.).
  completeCalibration(onComplete?: (outcome: import('../calibration').CalibrationOutcome) => void): void;
  clear(): void;
  isCalibrated(): boolean;
  // Sprint 4 — recalibração implícita a partir de dwell clicks confirmados.
  // O consumidor (GazeContext) chama isso ao completar um dwell, passando o
  // centro do elemento como alvo supervisionado.
  feedOnlineSample(targetXpx: number, targetYpx: number): boolean;
  setOnlineCalibrationEnabled(enabled: boolean): void;
  onlineSampleCount(): number;
}

// Fase 0.1 — API do gravador de sessão exposta pelo engine. Existe para que
// a UI (SettingsScreen) não precise conhecer o singleton do recorder nem os
// detalhes do que compõe o header (video res, l2cs meta) — o engine já tem
// esses dados em mão.
export interface RecordingApi {
  start(): void;
  stop(): void;
  isActive(): boolean;
  getStats(): { frames: number; dropped: number };
  exportAsJSONL(): string;
  clear(): void;
}

export interface EngineDiagnostics {
  fpsRender: number;
  l2cs: {
    status: L2CSStatus;
    hz: number;
    latencyMs: number;
    stalePct: number;
  };
  gaze: {
    yaw: number;
    pitch: number;
  };
  pose: {
    yaw: number;
    pitch: number;
    roll: number;
  };
  features: {
    dims: number;
    blink: boolean;
  };
  prediction: {
    x: number;
    y: number;
  };
  calibration: {
    calibrated: boolean;
    lambda: number;
    samples: number;
  };
  experiment: {
    expandFactor: number;
    cadenceMs: number;
    applyGazeCorrection: boolean;
  };
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
  // A2-1 — presets v2 (sufixo '-v2') filtram em espaço normalizado [0,1]
  // antes de converter para pixel — desligado por default.
  setFilterPreset(preset: FilterPreset | FilterPresetV2): void;
  // Estado do subsistema L2CS. UI deve bloquear calibração enquanto != 'ready'.
  // getL2CSStatus é síncrono (para leituras pontuais); onL2CSStatusChange
  // dispara o cb no ato da subscrição com o valor atual + em cada transição
  // (mesmo padrão de onStateChange).
  getL2CSStatus(): L2CSStatus;
  onL2CSStatusChange(cb: (status: L2CSStatus) => void): () => void;
  getDiagnostics(): EngineDiagnostics;
  calibration: CalibrationApi;
  recording: RecordingApi;
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

// Fase 0.1 — helpers do gravador de sessão. Ficam em escopo de módulo pra
// não realocar closures a 30 Hz.
function flattenLandmarks(landmarks: readonly { x: number; y: number; z: number }[]): number[] {
  // 478 × 3 = 1434 números. Achatado (não array de objetos) porque:
  //   (a) reduz o JSON serializado em ~30% (sem repetir chaves x/y/z),
  //   (b) o replay decodifica em Float64 sequencial de qualquer jeito.
  const out = new Array<number>(landmarks.length * 3);
  for (let i = 0; i < landmarks.length; i++) {
    const p = landmarks[i];
    const j = i * 3;
    out[j] = p.x;
    out[j + 1] = p.y;
    out[j + 2] = p.z;
  }
  return out;
}

function getRecorderTarget(): RecordedTarget | undefined {
  const cal = calibration.getCurrentTargetPx();
  if (cal) return { kind: 'calibration', xPx: cal.xPx, yPx: cal.yPx };
  const acc = getAccuracyTargetPx();
  if (acc) return { kind: 'accuracy', xPx: acc.xPx, yPx: acc.yPx, label: acc.label };
  return undefined;
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
  let activePreset: FilterPreset | FilterPresetV2 = 'balanceado';
  let activeConfig = FILTER_PRESETS[activePreset as FilterPreset];
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

  // A1-4 — timestamp do primeiro frame consecutivo em que mapGaze devolveu
  // null (após a calibração estar completa). Zerado no primeiro sucesso.
  let mapGazeNullSinceMs: number | null = null;

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

  // Diagnostics counters
  let diagRenderFps = 0;
  let diagL2csHz = 0;
  let diagL2csStalePct = 0;
  let diagLastUpdateMs = performance.now();
  let diagFramesSeen = 0;
  let diagL2csValidFrames = 0;
  let diagL2csTotalFrames = 0;
  let diagPose: { yaw: number; pitch: number; roll: number } = { yaw: 0, pitch: 0, roll: 0 };
  let diagBlink = false;
  let diagL2csYaw = 0;
  let diagL2csPitch = 0;

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
        // A1-4 — face perdida zera o timer de degradação; sem rosto o problema
        // é 'no_face', não 'degraded'. Quando o rosto voltar, começa uma nova
        // janela de 500 ms antes de considerar degradado novamente.
        mapGazeNullSinceMs = null;
        if (state === 'tracking' || state === 'degraded') setState('no_face');
        if (lastEmitHadFace) {
          emit({
            x: lastEmittedX,
            y: lastEmittedY,
            timestamp: performance.now(),
            hasFace: false,
          });
        }
        // Fase 0.1 — mesmo sem rosto, gravamos o frame para o replay saber
        // que houve perda de tracking (dwell precisa distinguir "sem sinal"
        // de "sinal fraco" — congelamento de piscada vs. rosto perdido).
        if (recorder.isRecording()) {
          recorder.recordFrame({
            captureTs: startTimeMs,
            emitTs: performance.now(),
            frameIdx: framesSeen,
            hasFace: false,
            predicted: lastEmitHadFace
              ? { x: lastEmittedX, y: lastEmittedY }
              : undefined,
            target: getRecorderTarget(),
          });
        }
      } else {
        if (framesSeen === 1) {
        lastStatMs = performance.now();
      } else if (framesSeen % 60 === 0) {
        const nowMs = performance.now();
        const deltaSec = (nowMs - lastStatMs) / 1000;
        console.log(
          `[IrisFlow] FPS: ${(60 / deltaSec).toFixed(1)} ` +
          `| Face: ${(framesWithFace / framesSeen * 100).toFixed(0)}% ` +
          `| L2CS: ${l2csFramesValid}/${l2csFramesSubmitted} (stale: ${l2csFramesStale})`,
        );
        lastStatMs = nowMs;
      }

      const now = performance.now();
      if (now - diagLastUpdateMs >= 250) {
        const deltaMs = now - diagLastUpdateMs;
        diagRenderFps = (framesSeen - diagFramesSeen) * 1000 / deltaMs;
        const l2csTotal = (l2csFramesValid + l2csFramesStale) - diagL2csTotalFrames;
        const l2csValid = l2csFramesValid - diagL2csValidFrames;
        diagL2csHz = l2csValid * 1000 / deltaMs;
        diagL2csStalePct = l2csTotal > 0 ? ((l2csTotal - l2csValid) / l2csTotal) * 100 : 0;
        
        diagFramesSeen = framesSeen;
        diagL2csValidFrames = l2csFramesValid;
        diagL2csTotalFrames = l2csFramesValid + l2csFramesStale;
        diagLastUpdateMs = now;
      }  const landmarks = results.faceLandmarks[0];
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
                expandFactor: EXPERIMENT.expandFactor,
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
          diagL2csYaw = g.yaw;
          diagL2csPitch = g.pitch;
        }

        const extractorResult = extractFeatures(landmarks, faceMatrix, l2csGaze);
        diagBlink = extractorResult.blinkDetected;

        // Fase 0.1 — snapshot para o gravador. As duas variáveis abaixo são
        // preenchidas dentro do bloco de emissão; fora dele ficam undefined
        // (sinalizando "frame processado mas sem predição" — tipicamente
        // piscada ou features vazias). O recorder call único no fim do
        // branch hasFace consome esse snapshot.
        let recordedPredicted: { x: number; y: number } | undefined;
        let recordedQuality: RecordedQuality | undefined;

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

          if (face) {
            diagPose = { yaw: face.yaw, pitch: face.pitch, roll: face.roll };
          }

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
          // A1-4 — atualiza o timer de degradação. Só conta null como
          // degradação após a calibração estar completa e fora do modo de
          // coleta (durante calibração null é normal).
          const degradedUpdate = updateDegradedTimer({
            mapGazeReturnedNull: calibrated === null,
            isCalibrated: calibration.isCalibrated(),
            isCalibrating: calibration.isCalibrating,
            currentNullSinceMs: mapGazeNullSinceMs,
            now: performance.now(),
          });
          mapGazeNullSinceMs = degradedUpdate.newNullSinceMs;
          const isDegraded = degradedUpdate.isDegraded;

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
          // A2-1 — quando filterInNormalizedSpace está ligado, filtrar em [0,1]
          // antes de converter para pixel. O filtro se torna independente da
          // resolução da tela: mincutoff=0.5 produz alpha≈0.50 em vez de 0.99.
          // Desligado por default — só os presets "-v2" ativam essa flag.
          let smoothed: { x: number; y: number };
          if (activeConfig.filterInNormalizedSpace) {
            const vwN = document.documentElement.clientWidth || 1;
            const vhN = document.documentElement.clientHeight || 1;
            const normX = targetX / vwN;
            const normY = targetY / vhN;
            const smoothedNorm = oneEuro.filter(normX, normY, now);
            smoothed = { x: smoothedNorm.x * vwN, y: smoothedNorm.y * vhN };
          } else {
            smoothed = oneEuro.filter(targetX, targetY, now);
          }

          // A1-4 — decide entre 'calibrating' | 'degraded' | 'tracking'.
          // 'degraded' entra quando mapGaze devolveu null por >500ms seguidos
          // após a calibração estar completa. Sai automaticamente no primeiro
          // frame bem-sucedido.
          if (calibration.isCalibrating) {
            setState('calibrating');
          } else if (isDegraded) {
            setState('degraded');
          } else {
            setState('tracking');
          }

          emit({
            x: smoothed.x,
            y: smoothed.y,
            timestamp: performance.now(),
            hasFace: true,
            degraded: isDegraded,
          });
          framesEmitted++;

          recordedPredicted = { x: smoothed.x, y: smoothed.y };
          recordedQuality = {
            brightnessEstimate: cropQuality.brightnessEstimate,
            contrastEstimate: cropQuality.contrastEstimate,
            blurEstimate: cropQuality.blurEstimate,
            detectorConfidence: cropQuality.detectorConfidence,
            irisVisibilityPercentage:
              extractorResult.advancedFeatures?.quality?.irisVisibilityPercentage,
            yaw: face?.yaw, pitch: face?.pitch, roll: face?.roll,
          };
        }

        // Fase 0.1 — recorder hook único do branch hasFace. Fica FORA do
        // if (!blink && features) para cobrir também os frames de piscada
        // (que carregam blink=true e ausência de predição — informação que
        // o replay usa para depurar o portão de confiança da Fase 3).
        if (recorder.isRecording()) {
          recorder.recordFrame({
            captureTs: startTimeMs,
            emitTs: performance.now(),
            frameIdx: framesSeen,
            hasFace: true,
            blink: extractorResult.blinkDetected,
            landmarks: flattenLandmarks(landmarks),
            faceMatrix: faceMatrix ? Array.from(faceMatrix) : undefined,
            l2cs: l2csGaze
              ? { yaw: l2csGaze.yaw, pitch: l2csGaze.pitch, valid: l2csGaze.valid }
              : undefined,
            featuresLeft: extractorResult.featuresLeft.length
              ? extractorResult.featuresLeft.slice()
              : undefined,
            featuresRight: extractorResult.featuresRight.length
              ? extractorResult.featuresRight.slice()
              : undefined,
            quality: recordedQuality,
            predicted: recordedPredicted,
            target: getRecorderTarget(),
            sampleDecision: calibration.consumeLastSampleDecision() ?? undefined,
          });
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

    setFilterPreset(preset: FilterPreset | FilterPresetV2): void {
      activePreset = preset;
      // A2-1 — resolve o config de presets v1 (pixel) ou v2 (normalizado)
      const isV2 = preset.endsWith('-v2');
      activeConfig = isV2
        ? FILTER_PRESETS_V2[preset as FilterPresetV2]
        : FILTER_PRESETS[preset as FilterPreset];
      oneEuro.setParams(activeConfig.mincutoff, activeConfig.beta);
      // Purga o buffer se acabou de desligar — evita mescla estranha entre
      // o histórico buffered antigo e as amostras filtradas pelo One Euro puro.
      if (!activeConfig.useRollingBuffer) {
        bufferX.length = 0;
        bufferY.length = 0;
      }
      console.log(`[IrisFlow] filtro → ${preset} (mincutoff=${activeConfig.mincutoff}, beta=${activeConfig.beta}, buffer=${activeConfig.useRollingBuffer}, normalized=${activeConfig.filterInNormalizedSpace})`);
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

    getDiagnostics(): EngineDiagnostics {
      return {
        fpsRender: diagRenderFps,
        l2cs: {
          status: l2csStatus,
          hz: diagL2csHz,
          latencyMs: l2csClient?.getAverageLatencyMs() ?? 0,
          stalePct: diagL2csStalePct,
        },
        gaze: {
          yaw: diagL2csYaw,
          pitch: diagL2csPitch,
        },
        pose: diagPose,
        features: {
          dims: latestFeaturesLeft.length * 2,
          blink: diagBlink,
        },
        prediction: {
          x: lastEmittedX,
          y: lastEmittedY,
        },
        calibration: {
          calibrated: calibration.isCalibrated(),
          lambda: calibration.getCurrentLambda(),
          samples: calibration.getSampleCount(),
        },
        experiment: {
          expandFactor: EXPERIMENT.expandFactor,
          cadenceMs: EXPERIMENT.l2csCadenceMs,
          applyGazeCorrection: EXPERIMENT.applyGazeCorrection,
        },
      };
    },

    calibration: {
      startCalibrationMode(): void {
        calibration.startCalibrationMode();
      },
      startCollectingPoint(x: number, y: number, onDone: (success: boolean) => void): void {
        calibration.startCollectingPoint(x, y, onDone);
      },
      completeCalibration(onComplete?: (outcome: import('../calibration').CalibrationOutcome) => void): void {
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

    // Fase 0.1 — API do gravador. O engine preenche o header com dados que
    // só ele conhece (resolução de vídeo + metadados do L2CS) para a UI
    // não precisar plumar isso.
    recording: {
      start(): void {
        const meta = l2csClient?.getMeta() ?? null;
        recorder.startRecording({
          resolution: {
            w: typeof document !== 'undefined' ? document.documentElement.clientWidth : 0,
            h: typeof document !== 'undefined' ? document.documentElement.clientHeight : 0,
          },
          videoResolution: {
            w: videoEl?.videoWidth ?? 0,
            h: videoEl?.videoHeight ?? 0,
          },
          l2cs: meta
            ? {
                dataset: meta.dataset,
                inputSize: meta.inputSize,
                binWidth: meta.binWidth,
                binOffset: meta.binOffset,
              }
            : undefined,
        });
      },
      stop(): void {
        recorder.stopRecording();
      },
      isActive(): boolean {
        return recorder.isRecording();
      },
      getStats(): { frames: number; dropped: number } {
        return {
          frames: recorder.getFrameCount(),
          dropped: recorder.getDroppedCount(),
        };
      },
      exportAsJSONL(): string {
        return recorder.exportAsJSONL();
      },
      clear(): void {
        recorder.clearRecording();
      },
    },
  };
}
