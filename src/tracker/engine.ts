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
import { createCropContext, cropFaceToTensor, eyeRegionInCrop, type CropContext } from '../l2cs/crop';
// Sprint 4 — etapas 1 e 2 do pipeline. Todos entram atrás de flag em
// `experiment.ts`, com o comportamento atual como default.
import { applyPreprocessRGBA } from '../preprocess/pipeline';
import { GammaCorrector } from '../preprocess/gamma';
import { RoiCache, type RoiReason } from '../preprocess/roiCache';
import { FrameRing } from '../capture/frameRing';
// P5.2 — head pose por PnP, alternativa medida à matriz do MediaPipe.
import { solvePnP, pontosPnPDeLandmarks } from '../pose/solvePnP';
// P5.7 — compensação aditiva em ângulo, alternativa à geométrica em pixels.
import { gazeAbsoluto, ReferenciaNeutra } from '../pose/absoluteGaze';
import { L2CSHealthMonitor } from '../l2cs/block';
import type { L2CSGazeInput } from '../extractor';
import { getRecentBlinkRatePerMinute, ACTIVE_FEATURE_SET, resetEarHistory } from '../extractor';
import * as recorder from '../telemetry/recorder';
import type { RecordedQuality, RecordedTarget } from '../telemetry/types';
import { EXPERIMENT } from '../config/experiment';
import {
  runLoopBody,
  emitToSubscribers,
  resetLoopErrorState,
  getLoopErrorCount,
  getConsecutiveLoopErrors,
} from './loopGuard';
import { StageTimer, STAGE, type StageSnapshot } from '../telemetry/stageTimer';

// Status do subsistema L2CS. Exposto via engine.getL2CSStatus() para a UI
// poder bloquear calibração enquanto o worker não estiver 'ready' — calibrar
// com o worker 'loading' treina o Ridge com o bloco de 7 dims em zero
// (buildL2CSBlock(valid=false)) e depois, quando o worker liga, o vetor muda
// e o modelo fica dessincronizado.
/** `disabled` é o estado default: o caminho do L2CS não é iniciado
 *  porque a saída dele não entra no vetor de features ativo. Distinto de
 *  `error`, que é o worker tendo tentado e falhado. */
export type L2CSStatus = 'loading' | 'ready' | 'error' | 'disabled';

export interface GazeSample {
  x: number;
  y: number;
  timestamp: number;
  hasFace: boolean;
  // true quando o engine está no estado 'degraded': calibração feita
  // mas mapGaze devolveu null por >DEGRADED_THRESHOLD_MS seguidos. Consumidores
  // devem tratar o cursor como não-confiável (é o fallback do nariz, não gaze),
  // desabilitar dwell exceto para elementos data-emergency, e mostrar aparência
  // distinta. Opcional para compat com consumidores anteriores.
  degraded?: boolean;
  /**
   * `true` quando NUNCA houve calibração: o ponto emitido é o fallback
   * do nariz, que não tem relação com a direção do olhar. Distinto de
   * `degraded` (calibrado, mas a predição falhou), porque a política de
   * interação é diferente: em `degraded` a emergência continua permitida; em
   * `uncalibrated` nada é clicável, nem a emergência — clicar sobre um sinal
   * que não segue o olhar é disparar alarme por acaso.
   */
  uncalibrated?: boolean;
  /**
   * Estado ocular do frame. O engine antes não emitia NADA durante a
   * piscada, e o dwell (que media relógio de parede) completava sozinho: fechar
   * os olhos 2 s sobre um botão clicava ao reabrir. Com o estado explícito, o
   * dispatcher pausa em vez de continuar contando.
   */
  eyeState?: 'open' | 'closed';
}

// Estado 'degraded' distingue "sistema não sabe onde o olhar está" de
// "sistema funcionando". Usuário-alvo ELA não pode desdizer um clique feito
// sob cursor errado; melhor bloquear a UI que aceitar seleção aleatória.
/**
 * `error` (B2.4) — o loop falhou de forma persistente (N exceções
 * consecutivas, tipicamente contexto WebGL perdido) e o engine está tentando
 * reinicializar o detector, ou já desistiu.
 *
 * Distinto de `no_face` e de `degraded`: nesses dois o pipeline está vivo e
 * apenas sem sinal útil; em `error` o pipeline em si quebrou. A UI deve
 * mostrar mensagem explícita — antes desta transição o app ficava em
 * `'tracking'` com o cursor congelado, indistinguível de travamento para quem
 * não tem como abrir o console.
 */
export type EngineState = 'idle' | 'loading' | 'tracking' | 'calibrating' | 'no_face' | 'degraded' | 'uncalibrated' | 'error';

// Quanto tempo mapGaze pode devolver null antes de considerarmos que
// a predição está degradada. 500 ms = ~15 frames a 30 fps — tolera glitch
// isolado de 1-2 frames mas pega bug persistente (features degeneradas,
// exceção repetida silenciada por _dimErrorLogged em calibration.ts).
export const DEGRADED_THRESHOLD_MS = 500;

// Lógica pura do timer de degradação, testável sem rAF/DOM/worker.
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

// Re-export para a UI consumir sem depender diretamente de calibration.ts.
export type { CalibrationOutcome } from '../calibration';

export interface CalibrationApi {
  // `opts` opcional. `quick=true` reduz a calibração para
  // 4 cantos (recalibração rápida do cuidador, sem repetir 9 pontos completos).
  // `opticalCondition` grava a condição do usuário no perfil salvo.
  startCalibrationMode(opts?: {
    quick?: boolean;
    opticalCondition?: import('../calibrationProfiles').OpticalCondition;
    label?: string;
    // Geometria física da tela/usuário. Posiciona a grade dentro do
    // orçamento de excentricidade angular; ver `computeCalibrationTargets`.
    geometry?: Partial<import('../calibration').CalibrationGeometry>;
  }): void;
  // Alvos ativos para renderização na UI. Reflete a lista de 4 cantos
  // (quick) ou grade 3×3 (full) da sessão em curso. Antes de iniciar, retorna
  // a lista full por default.
  getCalibrationTargets(): readonly { x: number; y: number }[];
  getCalibrationMode(): 'full' | 'quick' | null;
  startCollectingPoint(x: number, y: number, onDone: (success: boolean) => void): void;
  /** Compensação de distância. Ver `distanceCompensation.ts`. */
  setCameraFovDeg(fov: number | null): void;
  setCalibrationDistancesCm(cameraCm: number | null, screenCm: number | null): void;
  /** Distâncias registradas na calibração (P6.9). O aviso de fora-de-faixa
   *  compara a distância ATUAL contra `screenCm`; sem ela não há referência e
   *  o aviso permanece em 'desconhecido'. */
  getCalibrationDistancesCm(): { cameraCm: number | null; screenCm: number | null };
  getCurrentCameraDistanceCm(): number | null;
  getDistanceRange(): import('../distanceCompensation').DistanceRange | null;
  /** Avisa quando a calibração foi descartada em tempo de execução por
   *  incompatibilidade de pipeline. A UI deve pedir recalibração. */
  onInvalidated(cb: (e: import('../calibration').CalibrationInvalidated) => void): () => void;
  // Outcome tipado. Callback opcional; se fornecido, recebe { ok: true }
  // no sucesso ou { ok: false, reason, detail } em qualquer falha do treino
  // (matriz singular, features degeneradas, amostras insuficientes, etc.).
  completeCalibration(onComplete?: (outcome: import('../calibration').CalibrationOutcome) => void): void;
  /**
   * Veredito sobre a deriva de pose da calibração recém-treinada.
   * `null` = deriva abaixo do limiar, ou alvos insuficientes para medir.
   *
   * Só faz sentido logo após `completeCalibration`. A tela de calibração usa
   * para avisar antes de deixar o usuário seguir com um modelo treinado sobre
   * uma postura que mudou no meio da coleta.
   */
  getPoseDriftVerdict(): import('../calibration').VeredictoDeriva | null;
  /**
   * Encerra uma calibração em curso SEM treinar e sem descartar o
   * modelo anterior. A tela chama no unmount e quando a janela perde o foco;
   * sem isto, sair no meio da coleta prendia o app em `calibrating`.
   */
  abort(): void;
  clear(): void;
  isCalibrated(): boolean;
  // Recalibração implícita a partir de dwell clicks confirmados.
  // O consumidor (GazeContext) chama isso ao completar um dwell, passando o
  // centro do elemento como alvo supervisionado.
  feedOnlineSample(targetXpx: number, targetYpx: number): boolean;
  setOnlineCalibrationEnabled(enabled: boolean): void;
  onlineSampleCount(): number;
  // Dominância ocular do usuário. 'both' = fusão puramente por qualidade;
  // 'left'/'right' aplica multiplicador ao olho escolhido. Setter refletido
  // no `mapGaze` no próximo frame. Não requer recalibração.
  setEyeDominance(dominance: 'left' | 'right' | 'both'): void;
  // Correção de bias em sessão (drift EMA a partir de dwell clicks).
  // Enabled por default; desligar volta ao comportamento pré-melhoria.
  setSessionBiasEnabled(enabled: boolean): void;
  resetSessionBias(): void;
  // O valor do bias EMA acumulado na sessão + contagem de
  // amostras. Consumido pelo indicador de drift que sugere recalibração
  // quando |bias| ultrapassa ~5–6% da tela. Reset em cada calibração nova.
  getSessionBias(): { x: number; y: number; samples: number };
  // Camada 3 do conforto visual — piscadas por minuto na janela recente.
  // Consumido pela UI de calibração para alertar sobre fadiga/brilho
  // excessivo. Default 60000 ms (1 min); janelas menores dão resposta
  // mais rápida ao custo de variância maior.
  getRecentBlinkRatePerMinute(windowMs?: number): number;
  // Condição óptica do perfil ativo. Consumido pelo AUTO_TEST_META do
  // fluxo pós-calibração para preencher `RunMeta.oculos` em vez de hardcode.
  getActiveOpticalCondition(): import('../calibrationProfiles').OpticalCondition;
}

// API do gravador de sessão exposta pelo engine. Existe para que
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
    // Média rolling da confidence (1 - H/H_max da softmax
    // por eixo, agregada por min(yaw, pitch)) das últimas ~20 inferências.
    // 0 antes de qualquer resultado válido. Exposto para observabilidade;
    // downstream ainda NÃO consome.
    confidence: number;
    /** Inferências submetidas e ainda sem resposta (B1.2). Com o backpressure
     *  ativo o valor fica em {0, 1}. Valor preso em 1 com `hz` em 0 indica
     *  deadlock do slot — o worker morreu sem responder. */
    pendingCount: number;
    /** Execution provider ativo no worker (P5.5): `'wasm'`, `'webgpu'`, ou
     *  `null` antes do `ready`. Comparar latências sem conferir este campo é
     *  como medir duas condições que podem ser a mesma. */
    executionProvider: string | null;
  };
  gaze: {
    yaw: number;
    pitch: number;
  };
  pose: {
    yaw: number;
    pitch: number;
    roll: number;
    /** Qual método produziu os ângulos acima (P5.2). */
    source: 'matrix' | 'pnp';
    /**
     * Discordância PnP − matriz, em GRAUS, mais o resíduo de reprojeção do
     * PnP. Publicado mesmo com a fonte em `'matrix'`: é a série que `F8.4`
     * precisa para escolher entre os dois, e ela não existiria se só fosse
     * computada depois da escolha já feita.
     *
     * `null` = ainda não houve comparação neste ciclo, ou o PnP falhou.
     */
    deltaPnpDeg: { yaw: number; pitch: number; roll: number; reprojectionErrorPx: number } | null;
    /** Modo de compensação vigente (P5.7). */
    compensationMode: 'geometric' | 'additive' | 'both';
    /** Vezes que a compensação aditiva bateu no clamp de ±30°. Crescendo,
     *  a pose saiu do regime em que a aproximação de primeira ordem vale. */
    additiveClamps: number;
    /**
     * Referência neutra (P5.8). `updates` conta as trocas desta sessão — é o
     * número que explica, no Dia 7, uma mudança de erro no meio da sessão.
     * `current` é `null` quando a referência dinâmica está desligada ou ainda
     * não adotou nenhuma pose (aí vale a da calibração).
     */
    neutralReference: {
      dynamic: boolean;
      updates: number;
      current: { yaw: number; pitch: number; roll?: number } | null;
    };
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
  framing: {
    hasFace: boolean;
    iod: number;
    faceCenter: { x: number; y: number };
    specularRatio: number;
    /** Distância entre os cantos externos dos olhos em PIXELS DE
     *  VÍDEO. Diferente de `iod`, que é normalizado (e anisotrópico, porque x
     *  divide por largura e y por altura). A avaliação de setup precisa da
     *  grandeza em px porque o que governa a precisão é quantos pixels de
     *  sensor caem sobre o olho. */
    iodPx: number;
  };
  /**
   * Qualidade do crop ocular no frame corrente.
   *
   * **Todos os campos são opcionais (B3.3.)** `undefined` significa
   * *não medido* e a UI deve mostrar isso, não um número.
   *
   * O engine fazia `?? 0` em cada campo, desfazendo a decisão deliberada do
   * `qualityAnalyzer` de devolver `{}` em vez de zeros quando não consegue
   * medir. O resultado publicado era `specular: 0` (ótimo), `blur: 0` (ótimo)
   * e `brightness: 0` (péssimo) ao mesmo tempo — fisicamente impossível, e
   * mostrado ao cuidador na pré-calibração como se fosse leitura de sensor.
   */
  quality: {
    brightness?: number;
    contrast?: number;
    blur?: number;
    detectorConfidence?: number;
  };
  /** Resolução REAL negociada com a câmera. */
  video: { width: number; height: number };
  /** Histórico recente do brilho do crop ocular, na CADÊNCIA DE
   *  FRAME (não amostrado pela UI). O detector de cintilação precisa disso:
   *  amostrar a 10 Hz na tela faria o batimento de 10 Hz da rede de 50 Hz
   *  aliasar para 0 e desaparecer. Mais antigo primeiro. */
  brightnessHistory: number[];
  /** fps efetivo da série acima, para converter bin em Hz. */
  brightnessHistoryFps: number;
  /** Latência p50/p95 por estágio do pipeline (instrumentação de T0.5).
   *  Janela deslizante de ~120 amostras (≈4 s a 30 fps). Cada chave é o nome
   *  do estágio conforme `STAGE` em `src/telemetry/stageTimer.ts`.
   *
   *  Estágios instrumentados hoje:
   *  - `loop.total`    tempo total do body do rAF, do primeiro ao último passo
   *  - `mediapipe`     `detectForVideo` (WASM + GPU)
   *  - `l2cs.crop`     `getImageData` + `cropFaceToTensor` (só quando canSubmit)
   *  - `l2cs.read`     leitura do cache do worker (`getLatestGaze`)
   *  - `features`      `extractFeatures`
   *  - `quality`       `qualityAnalyzer.analyze` do crop dos olhos
   *  - `predict`       `calibration.mapGaze` + fallback
   *  - `filter`        `oneEuro.filter`
   *  - `emit`          `emitToSubscribers`
   *
   *  O consumidor não deve assumir que todas as chaves existem sempre:
   *  estágios que não rodaram no frame corrente permanecem sem entrada até
   *  ganharem a primeira amostra da sessão. */
  stageLatency: StageSnapshot;
  /**
   * Ring buffer de captura (`P4.1`).
   *
   * ⚠️ `active: false` significa que o estágio NÃO RODOU — não que ele rodou
   * sem descarte. A distinção é a mesma de `B3.3`: ausência de medida não é
   * medida de ausência.
   *
   * E mesmo com `captureRingBuffer` ligado, os contadores só saem de zero
   * quando existe um PRODUTOR separado do consumidor, isto é, com
   * `captureWorker` também ligado. No caminho de hoje (rAF lendo
   * `videoEl.currentTime` no thread principal) produtor e consumidor são o
   * mesmo laço: não há fila, e portanto não há descarte a contar.
   */
  capture: {
    active: boolean;
    droppedFrames: number;
    ringOccupancy: number;
    ringHighWaterMark: number;
    capacity: number;
  };
  /** Cache de ROI (`P4.8`). `cropsAvoided` é o numerador da economia que
   *  `T0.5` precisa medir — o denominador é `stageLatency['l2cs.crop']`. */
  roi: {
    active: boolean;
    reuseRate: number;
    cropsAvoided: number;
    refreshByReason: Record<string, number>;
    /** Frames em que o CLAHE foi pulado por não haver região ocular
     *  determinável. Crescendo junto com a contagem de frames, indica
     *  landmarks ruins — não um problema do pré-processamento. */
    preprocessSkippedNoRegion: number;
  };
  /** Saúde do loop de rastreamento (B2.4). `consecutive > 0` com o estado em
   *  `'tracking'` significa que o loop está lançando agora. */
  loop: {
    /** Exceções desde o último `start()`. */
    errorsTotal: number;
    /** Exceções seguidas, sem sucesso no meio. Zera no primeiro frame bom. */
    errorsConsecutive: number;
  };
}

export interface GazeEngine {
  start(video: HTMLVideoElement): Promise<void>;
  stop(): void;
  /** Libera recursos pesados: fecha o `FaceLandmarker` (heap WASM + contexto
   *  GPU), para o worker L2CS (~91 MB de sessão ONNX) e solta os canvases.
   *  Chama `stop()` internamente. Idempotente — o cleanup do React pode
   *  disparar mais de uma vez. Ver B1.7. */
  dispose(): void;
  subscribe(cb: (sample: GazeSample) => void): () => void;
  onStateChange(cb: (state: EngineState) => void): () => void;
  getState(): EngineState;
  // Tempo desde o `start()` bem-sucedido, em ms (performance.now-based).
  // 0 antes do primeiro start. Consumido pelo AUTO_TEST_META para preencher
  // `RunMeta.minutosDeSessao` em vez de hardcode 0. Reinicia a cada stop→start.
  getSessionUptimeMs(): number;
  // Troca em tempo real do preset do filtro temporal.
  // `estavel`/`balanceado`/`responsivo` alteram mincutoff, beta e o buffer
  // ponderado. Ver FILTER_PRESETS em oneEuroFilter.ts.
  // Presets v2 (sufixo '-v2') filtram em espaço normalizado [0,1]
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

// Helpers do gravador de sessão. Ficam em escopo de módulo pra
// não realocar closures a 30 Hz.
function flattenLandmarks(landmarks: readonly { x: number; y: number; z: number }[]): number[] {
  // 478 × 3 = 1434 números. Achatado (não array de objetos) porque
  // reduz o JSON serializado em ~30% (sem repetir chaves x/y/z).
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
  // Marca do `performance.now()` no start bem-sucedido. Consumido por
  // getSessionUptimeMs() para o AUTO_TEST_META refletir o tempo real de uso
  // em vez de hardcode 0. Null antes do primeiro start; reset a cada start.
  let sessionStartMs: number | null = null;

  // Default é 'balanceado-v2' (espaço normalizado). Os presets v1 legados
  // filtram em pixels e produzem alpha≈0.99 a 30fps — o filtro passa quase
  // intacto e o cursor fica jittery. Ver FILTER_PRESETS_V2 em oneEuroFilter.ts.
  // Trocável em tempo real via setFilterPreset.
  let activePreset: FilterPreset | FilterPresetV2 = 'balanceado-v2';
  let activeConfig = activePreset.endsWith('-v2')
    ? FILTER_PRESETS_V2[activePreset as FilterPresetV2]
    : FILTER_PRESETS[activePreset as FilterPreset];
  const oneEuro = new OneEuroFilter2D(60, activeConfig.mincutoff, activeConfig.beta);
  const qualityAnalyzer = new EyeQualityAnalyzer();
  const bufferX: number[] = [];
  const bufferY: number[] = [];

  // Cache das últimas features extraídas. `feedOnlineSample` no
  // dwell click precisa das features do último frame válido; assim evitamos
  // rebuildar do zero (extractFeatures não é barato).
  let latestFeaturesLeft: number[] = [];
  let latestFeaturesRight: number[] = [];
  let targetX = 0;
  let targetY = 0;
  let lastEmittedX = 0;
  let lastEmittedY = 0;
  let lastEmitHadFace = false;

  // Timestamp do primeiro frame consecutivo em que mapGaze devolveu
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

  // ── Sprint 4 — pré-processamento e ROI (P4.5, P4.6, P4.8) ─────────────────
  //
  // Instanciados sempre, consultados só sob flag. Criá-los aqui custa alguns
  // bytes e evita um `if` de inicialização no caminho quente; o `GammaCorrector`
  // em particular PRECISA sobreviver entre frames, porque é nele que mora a
  // histerese — reconstruí-lo por frame devolveria a oscilação que `P4.6`
  // existe para remover.
  const gammaCorrector = new GammaCorrector();
  const roiCache = new RoiCache<true>({ requireStored: true });
  /**
   * Ring de captura (`P4.1`).
   *
   * O PRODUTOR dele é o worker de captura (`P4.2`), que ainda não roda em
   * produção. No caminho de hoje o rAF é produtor e consumidor no mesmo tick:
   * não existe fila, então empurrar e retirar aqui só adicionaria custo para
   * contar zeros. O ring é criado sob flag para que o diagnóstico saiba
   * distinguir "não rodou" de "rodou sem descarte" — ver `EngineDiagnostics.capture`.
   */
  const frameRing = EXPERIMENT.captureRingBuffer ? new FrameRing<number>() : null;
  /** Último tensor submetido, para reuso quando o `roiCache` autoriza. */
  let ultimoTensorL2CS: Float32Array | null = null;
  let roiCropsEvitados = 0;
  /** Frames em que o CLAHE foi pulado por não haver região ocular determinável. */
  let preprocessSemRegiao = 0;
  /** Última comparação PnP × matriz, em GRAUS. `null` = ainda não comparado,
   *  ou o PnP falhou no último quadro em que foi tentado (P5.2). */
  let diagPnpDelta: { yaw: number; pitch: number; roll: number; reprojectionErrorPx: number } | null = null;
  let ultimoPnpMs = 0;
  /** Quantas vezes a compensação aditiva bateu no clamp de ±30° (P5.7/B3.12).
   *  Crescendo, indica pose fora do regime em que a aproximação vale. */
  let diagPoseClamps = 0;
  /**
   * Referência neutra dinâmica (P5.8). Instanciada sempre, consultada só sob
   * flag — o custo é um ring de poses, e ter a instância evita um `if` de
   * inicialização no caminho quente.
   */
  const referenciaNeutra = new ReferenciaNeutra();
  let diagRefUpdates = 0;
  /** Cadência da comparação PnP quando ele NÃO é a fonte. 1 Hz basta para a
   *  série que o Dia 7 vai analisar, e mantém o caminho quente barato. */
  const PNP_DIAG_INTERVALO_MS = 1000;
  let l2csStatus: L2CSStatus = 'loading';
  const l2csStatusSubscribers = new Set<(s: L2CSStatus) => void>();
  let l2csFramesSubmitted = 0;
  let l2csFramesValid = 0;
  let l2csFramesStale = 0;
  // Vigia de saída travada. Ver `L2CSHealthMonitor`.
  const l2csHealth = new L2CSHealthMonitor();

  // Diagnostics counters
  let diagRenderFps = 0;
  let diagL2csHz = 0;
  let diagL2csStalePct = 0;
  let diagLastUpdateMs = performance.now();
  let diagFramesSeen = 0;
  let diagL2csValidFrames = 0;
  let diagL2csTotalFrames = 0;
  let diagPose: { yaw: number; pitch: number; roll: number } = { yaw: 0, pitch: 0, roll: 0 };
  let latestIod = 0;
  let latestFaceCenter = { x: 0.5, y: 0.5 };
  let latestSpecularRatio = 0;
  let latestIodPx = 0;
  let latestQuality: EngineDiagnostics["quality"] = {};
  // Anel de brilho na cadência de frame, para o detector de
  // cintilação. 96 amostras a ~30 fps ≈ 3,2 s: suficiente para resolver 10 Hz
  // com folga e barato de manter.
  const BRIGHTNESS_HISTORY_LEN = 96;
  const brightnessHistory: number[] = [];
  const brightnessHistoryTs: number[] = [];
  let latestHasFace = false;
  let diagBlink = false;
  let diagL2csYaw = 0;
  let diagL2csPitch = 0;
  /** Já avisamos sobre features vazias nesta sessão? (B2.3) Sem o latch o
   *  console recebe 30 linhas por segundo e a mensagem some no ruído. */
  let avisouFeaturesVazias = false;
  /**
   * Inferências do L2CS efetivamente CONCLUÍDAS (B3.26).
   *
   * Distinto de `l2csFramesValid`, que conta leituras do cache no rAF (~30/s).
   * O worker produz ~10/s, então o HUD reportava 3× a taxa real — escondendo o
   * gargalo que `P5.5` precisa medir. Detectado pela mudança do timestamp de
   * captura, que só avança quando um resultado novo chega.
   */
  let l2csInferencias = 0;
  let ultimoL2csTimestamp = -1;
  let diagL2csInferencias = 0;
  /** Cronômetro PRÓPRIO do log de FPS (B3.26). Antes ele dividia `lastStatMs`
   *  com o log de estatísticas de 3 s, e um sobrescrevia o outro — o FPS saía
   *  60 com o loop a 30. */
  let lastFpsLogMs = 0;
  let diagFpsLogFrames = 0;

  // Instrumentação de latência por estágio (T0.5). Janela de 120 amostras
  // (~4 s a 30 fps). O reset acontece no `resetSessionState()`.
  const stageTimer = new StageTimer({ windowSize: 120 });

  /**
   * Token de geração do ciclo de vida (B1.6).
   *
   * `start()` é async e faz `await initMediaPipe()` — segundos baixando WASM
   * e o `.task`. A guarda `if (running) return` era avaliada ANTES desse
   * await, então um `stop()` durante a espera rodava com `running === false`
   * (no-op), o await resolvia, `running = true`, e o rAF arrancava sobre um
   * `<video>` já removido com as tracks encerradas. O loop nunca mais parava —
   * e como `calibration`, `accuracy` e `recorder` são singletons de módulo, o
   * engine zumbi seguia alimentando os mesmos singletons que o engine novo.
   *
   * Cada `start()` incrementa o token e guarda o seu. Depois de cada `await`,
   * compara: se o token mudou (outro `start()`) ou foi invalidado (`stop()`
   * zera para -1), aborta sem agendar nada.
   */
  let startGeneration = 0;

  /** `dispose()` já rodou. Impede que uma inicialização em voo publique um
   *  `FaceLandmarker` num engine que o consumidor já descartou. */
  let disposed = false;

  /**
   * Zera todo o estado que pertence a UMA sessão (B1.7).
   *
   * `stop()` não zerava nada. A segunda sessão da mesma página começava
   * contaminada: `mapGazeNullSinceMs` da sessão anterior fazia o primeiro
   * frame entrar em `degraded` sem a janela de 500 ms; o limiar adaptativo de
   * piscada começava calibrado no EAR de repouso de outro rosto; e
   * `latestFeaturesLeft/Right` sobreviviam, de modo que um `feedOnlineSample`
   * logo após o restart treinava o modelo com features da sessão anterior.
   */
  function resetSessionState(): void {
    lastVideoTime = -1;
    framesSeen = 0;
    framesWithFace = 0;
    framesEmitted = 0;
    lastStatMs = 0;
    lastEmittedX = 0;
    lastEmittedY = 0;
    lastEmitHadFace = false;
    mapGazeNullSinceMs = null;
    targetX = 0;
    targetY = 0;
    bufferX.length = 0;
    bufferY.length = 0;
    oneEuro.reset();
    brightnessHistory.length = 0;
    brightnessHistoryTs.length = 0;
    latestFeaturesLeft = [];
    latestFeaturesRight = [];
    latestHasFace = false;
    latestIod = 0;
    latestIodPx = 0;
    latestFaceCenter = { x: 0.5, y: 0.5 };
    latestSpecularRatio = 0;
    latestQuality = {};
    l2csFramesSubmitted = 0;
    l2csFramesValid = 0;
    l2csFramesStale = 0;
    l2csHealth.reset();
    diagRenderFps = 0;
    diagL2csHz = 0;
    diagL2csStalePct = 0;
    diagLastUpdateMs = performance.now();
    diagFramesSeen = 0;
    diagL2csValidFrames = 0;
    diagL2csTotalFrames = 0;
    diagPose = { yaw: 0, pitch: 0, roll: 0 };
    diagBlink = false;
    diagL2csYaw = 0;
    diagL2csPitch = 0;
    avisouFeaturesVazias = false;
    l2csInferencias = 0;
    ultimoL2csTimestamp = -1;
    diagL2csInferencias = 0;
    lastFpsLogMs = 0;
    diagFpsLogFrames = 0;
    stageTimer.reset();
    // Sprint 4 — mesmo argumento do `resetEarHistory` abaixo: estado de
    // pré-processamento herdado é pior que nenhum. Um γ calibrado para a
    // iluminação da sessão anterior chega errado e leva vários frames de
    // histerese para sair do lugar; um ROI guardado descreve um enquadramento
    // que não existe mais.
    gammaCorrector.reset();
    roiCache.reset();
    ultimoTensorL2CS = null;
    roiCropsEvitados = 0;
    preprocessSemRegiao = 0;
    diagPnpDelta = null;
    ultimoPnpMs = 0;
    diagPoseClamps = 0;
    referenciaNeutra.reset();
    diagRefUpdates = 0;
    // Singleton de módulo do detector de piscada: sem este reset o limiar
    // adaptativo herda o EAR de repouso do rosto da sessão anterior, e leva
    // ~1,7 s de piscadas falsas ou perdidas para reconvergir.
    resetEarHistory();
    resetLoopErrorState();
  }

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
    // Um subscriber que lança não pode abortar a entrega aos demais nem
    // derrubar o frame. O dispatcher de dwell é um subscriber e chama `.click()`,
    // executando código React arbitrário: era a rota mais provável de morte.
    emitToSubscribers(gazeSubscribers, sample);
  }

  /**
   * Inicialização do MediaPipe, DESDUPLICADA (B1.6).
   *
   * `initMediaPipe` leva segundos (WASM + o `.task` de 3,6 MB). Sem esta
   * promessa compartilhada, dois `start()` concorrentes — o caso do StrictMode
   * — disparavam DUAS chamadas a `FaceLandmarker.createFromOptions` e criavam
   * duas instâncias. Só a última ficava em `faceLandmarker`; a outra vazava
   * com seu heap WASM e seu contexto GPU, sem nenhuma referência que
   * permitisse fechá-la depois.
   *
   * O token de geração impede o loop zumbi, mas não impede esse desperdício:
   * são coisas diferentes, e as duas precisavam ser resolvidas.
   */
  let initMediaPipePromise: Promise<void> | null = null;

  async function initMediaPipe(): Promise<void> {
    if (faceLandmarker) return;
    if (initMediaPipePromise) return initMediaPipePromise;

    initMediaPipePromise = (async () => {
      const base = mediapipeBaseUrl ?? new URL('./mediapipe', location.href).href;
      const vision = await FilesetResolver.forVisionTasks(`${base}/wasm`);
      const criado = await FaceLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath: `${base}/models/face_landmarker.task`,
          delegate: 'GPU',
        },
        outputFaceBlendshapes: false,
        outputFacialTransformationMatrixes: true,
        runningMode: 'VIDEO',
        numFaces: 1,
      });
      // `dispose()` pode ter rodado durante a criação. Fechar aqui é melhor
      // que publicar uma instância que ninguém pediu mais.
      if (disposed) {
        try { criado.close(); } catch { /* já fechado */ }
        return;
      }
      faceLandmarker = criado;
    })();

    try {
      await initMediaPipePromise;
    } finally {
      // Libera a promessa para que uma falha de rede possa ser tentada de
      // novo num `start()` posterior, em vez de ficar presa no rejeito.
      initMediaPipePromise = null;
    }
  }

  // E6 — inicialização fire-and-forget do L2CS. Nunca bloqueia engine.start()
  // porque o loop rAF precisa começar já para o cursor não ficar parado.
  // Se init falhar, marca status='error' — a UI deve consultar via
  // getL2CSStatus() e mostrar erro/impedir calibração.
  function initL2CSAsync(): void {
    if (l2csClient) return; // já iniciado
    // O caminho inteiro é opcional, e o default é DESLIGADO.
    //
    // O bloco angular do L2CS ocupa os índices [37..43] do vetor completo, e
    // `ACTIVE_FEATURE_SET = 'iris12'` seleciona [0..11]. A saída não chega ao
    // modelo. Enquanto isso custa 91 MB de download, `getImageData` de 448² a
    // 10 Hz e um worker por quadro.
    if (!EXPERIMENT.enableL2CS) {
      setL2CSStatus('disabled');
      console.log(
        '[L2CS] desligado (EXPERIMENT.enableL2CS=false) — o bloco angular não entra ' +
        `em '${ACTIVE_FEATURE_SET}', então o worker seria custo puro.`,
      );
      return;
    }
    // P5.5a — o canvas nasce do tamanho da flag e passa a ser a fonte única:
    // `cropFaceToTensor` lê o lado do próprio canvas, e o worker o deduz do tensor.
    cropCtx = createCropContext(EXPERIMENT.l2csInputSize);
    l2csClient = createL2CSClient();
    l2csClient.start().then(
      () => { setL2CSStatus('ready'); console.log('[L2CS] worker ready'); },
      (err) => {
        setL2CSStatus('error');
        console.error('[L2CS] worker init FAILED — pipeline degradado (bloco angular zerado). Motivo:', err);
      },
    );
  }

  // `loop()` passou a ser só o invólucro resiliente; o corpo real é
  // `loopBody()`. O reagendamento vive no `finally` de `runLoopBody`, então
  // nenhuma exceção de etapa (MediaPipe, qualidade, worker, subscriber) pode
  // mais matar o rastreamento em silêncio.
  function loop(): void {
    if (!running || !videoEl || !faceLandmarker) return;
    const r = runLoopBody(loopBody, () => { rafHandle = requestAnimationFrame(loop); });
    // B2.4 — o contador de erros do loopGuard passa a ser CONSUMIDO em
    // produção. Antes ele só existia para os testes: o loop girava a 60 fps
    // lançando em todo frame, com o estado em 'tracking' e o cursor congelado,
    // e nada além de uma linha de console a cada 2 s denunciava.
    if (r.fatal) void recoverFromFatalLoopErrors();
  }

  /**
   * Reação a uma sequência de exceções no loop (B2.4).
   *
   * A causa dominante é perda do contexto WebGL — troca de GPU, sleep/wake do
   * notebook — que faz `detectForVideo` lançar indefinidamente. Recriar o
   * `FaceLandmarker` é o único caminho de volta; não há API de "restaurar
   * contexto" exposta pelo MediaPipe Tasks.
   *
   * O estado vai para `'error'` ANTES da tentativa: se a recriação demorar ou
   * falhar, o cuidador precisa ver que algo está errado em vez de encarar um
   * cursor parado.
   */
  async function recoverFromFatalLoopErrors(): Promise<void> {
    setState('error');
    console.warn('[IrisFlow] tentando reinicializar o FaceLandmarker após falha persistente do loop.');
    const geracao = startGeneration;
    try {
      if (faceLandmarker) {
        try { faceLandmarker.close(); } catch { /* contexto já perdido */ }
        faceLandmarker = null;
      }
      await initMediaPipe();
      // Outro `start()`/`stop()` aconteceu durante o await: não pisar no
      // ciclo de vida novo (mesma disciplina de B1.6).
      if (geracao !== startGeneration || !running) return;
      resetLoopErrorState();
      setState('tracking');
      console.log('[IrisFlow] FaceLandmarker reinicializado; rastreamento retomado.');
    } catch (e) {
      console.error(
        '[IrisFlow] falha ao reinicializar o detector. O rastreamento não vai se recuperar sozinho — ' +
        'é necessário recarregar o aplicativo.',
        e,
      );
      setState('error');
    }
  }

  /**
   * Monta o pré-processador do frame (P4.5, P4.6, P4.7), ou `undefined` quando
   * ambas as flags estão desligadas — que é o default.
   *
   * Devolver `undefined` importa: `cropFaceToTensor` pula o hook inteiro e o
   * RGBA vai direto para a normalização, sem cópia. Um pré-processador que não
   * faz nada ainda custaria 800 KB de cópia por frame.
   */
  function preprocessadorDoFrame(
    landmarks: readonly { x: number; y: number }[],
  ): ((rgba: Uint8ClampedArray, size: number) => Uint8ClampedArray) | undefined {
    if (!EXPERIMENT.claheEyeRegion && !EXPERIMENT.dynamicGamma) return undefined;
    return (rgba, size) => {
      stageTimer.begin(STAGE.preprocess);
      try {
        let regiao = null;
        if (EXPERIMENT.claheEyeRegion) {
          regiao = eyeRegionInCrop(
            landmarks,
            videoEl?.videoWidth ?? 0,
            videoEl?.videoHeight ?? 0,
            EXPERIMENT.expandFactor,
            IS_VIDEO_MIRRORED,
            size,   // vem do crop; acompanha `l2csInputSize` sem repetir a flag
          );
          if (!regiao) {
            // Sem região determinável, o CLAHE é PULADO — não promovido ao
            // crop inteiro. Promover custaria 9× mais (5,93 ms contra 0,67 ms
            // medidos) e equalizaria pele e sobrancelha, que é uma condição
            // experimental diferente e não medida. Ver o ADR de P4.4.
            preprocessSemRegiao++;
          }
        }
        const r = applyPreprocessRGBA(rgba, size, size, {
          clahe: EXPERIMENT.claheEyeRegion && !!regiao,
          eyeRegion: regiao,
          gamma: EXPERIMENT.dynamicGamma ? gammaCorrector : null,
        });
        return r.rgba;
      } finally {
        stageTimer.end(STAGE.preprocess);
      }
    };
  }

  function loopBody(): void {
    if (!running || !videoEl || !faceLandmarker) return;

    stageTimer.begin(STAGE.loopTotal);
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

      stageTimer.begin(STAGE.mediapipe);
      const results = faceLandmarker.detectForVideo(videoEl, startTimeMs);
      stageTimer.end(STAGE.mediapipe);
      const hasFace = !!(results.faceLandmarks && results.faceLandmarks.length > 0);
      if (hasFace) framesWithFace++;

      if (!hasFace) {
        calibration.feedFaceMetrics(false, 0);
        latestHasFace = false;
        latestIod = 0;
        latestFaceCenter = { x: 0.5, y: 0.5 };
        latestSpecularRatio = 0;
        latestIodPx = 0;
        // Face perdida zera o timer de degradação; sem rosto o problema
        // é 'no_face', não 'degraded'. Quando o rosto voltar, começa uma nova
        // janela de 500 ms antes de considerar degradado novamente.
        mapGazeNullSinceMs = null;
        if (state === 'tracking' || state === 'degraded') setState('no_face');
        // B2.5 — emite a CADA frame sem rosto, não uma vez por episódio.
        //
        // A guarda `if (lastEmitHadFace)` fazia o engine emitir `hasFace:false`
        // uma única vez e depois silenciar. O dispatcher de dwell, que decide
        // entre pausar e zerar comparando a idade da perda, nunca recebia o
        // segundo frame — e ficava em PAUSA INDEFINIDA. Um paciente com
        // 1400/1500 ms sobre um botão, com o rosto perdido por 5 minutos,
        // completava o dwell em ~2 frames ao reaparecer.
        //
        // Emitir sempre custa uma chamada de callback por frame sem rosto, o
        // que é irrelevante perto de manter o dwell coerente. E é o que torna
        // a tolerância de `lostResetMs` observável do lado do dispatcher.
        emit({
          x: lastEmittedX,
          y: lastEmittedY,
          timestamp: performance.now(),
          hasFace: false,
          // O dispatcher trata `uncalibrated` como bloqueio total;
          // omitir aqui deixaria a amostra de perda de rosto parecer válida.
          uncalibrated: !calibration.isCalibrated(),
        });
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
        const landmarks = results.faceLandmarks[0];
        const rawIod = Math.sqrt(
          (landmarks[33].x - landmarks[263].x) ** 2 +
          (landmarks[33].y - landmarks[263].y) ** 2,
        );
        calibration.feedFaceMetrics(true, rawIod);
        latestHasFace = true;
        latestIod = rawIod;
        // Versão em px de vídeo. `rawIod` acima mistura escalas (x
        // normalizado por largura, y por altura); aqui desfazemos isso antes
        // de medir, senão a distância muda com a inclinação da cabeça.
        latestIodPx = Math.hypot(
          (landmarks[33].x - landmarks[263].x) * (videoEl?.videoWidth ?? 0),
          (landmarks[33].y - landmarks[263].y) * (videoEl?.videoHeight ?? 0),
        );
        latestFaceCenter = { x: landmarks[1].x, y: landmarks[1].y };
        // Alimenta a compensação de distância. Dois números por quadro;
        // `mapGaze` converte para cm usando o campo de visão calibrado.
        // Altura e ponta do nariz também, para a compensação de
        // translação lateral. `latestFaceCenter` já é o landmark 1.
        calibration.setCurrentFrameGeometry(
          latestIodPx, videoEl?.videoWidth ?? 0, videoEl?.videoHeight ?? 0, latestFaceCenter,
        );

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
            // P4.8 — o crop pode ser reusado quando a cabeça não mexeu. A pose
            // consultada é a do frame ANTERIOR (`diagPose`), que é o que a
            // especificação pede: a pose deste frame só existe depois do
            // estágio de features, que roda abaixo.
            let reusarRoi = false;
            let motivoRoi: RoiReason = 'primeiro-frame';
            if (EXPERIMENT.dynamicRoiCache) {
              stageTimer.begin(STAGE.roiDecide);
              const decisao = roiCache.decide({
                nowMs: startTimeMs,
                pose: { yaw: diagPose.yaw, pitch: diagPose.pitch, roll: diagPose.roll },
                faceCenter: latestFaceCenter,
                iodPx: latestIodPx,
                videoWidth: videoEl.videoWidth,
                videoHeight: videoEl.videoHeight,
              });
              stageTimer.end(STAGE.roiDecide);
              reusarRoi = decisao.reuse && ultimoTensorL2CS !== null;
              motivoRoi = decisao.reason;
            }

            if (reusarRoi && ultimoTensorL2CS) {
              // Resubmete o MESMO tensor. Não pular a submissão é deliberado:
              // pular reduziria a taxa de inferência e deixaria o gaze mais
              // velho, trocando 1–2 ms de crop por centenas de ms de
              // staleness. O que se economiza aqui é o `getImageData` + a
              // normalização, não a inferência.
              if (l2csClient.submitTensor(ultimoTensorL2CS)) l2csFramesSubmitted++;
              roiCropsEvitados++;
            } else {
              try {
                stageTimer.begin(STAGE.l2csCrop);
                const tensor = cropFaceToTensor(videoEl, {
                  landmarks,
                  isMirrored: IS_VIDEO_MIRRORED,
                  context: cropCtx,
                  expandFactor: EXPERIMENT.expandFactor,
                  preprocessRGBA: preprocessadorDoFrame(landmarks),
                });
                stageTimer.end(STAGE.l2csCrop);
                ultimoTensorL2CS = tensor;
                if (EXPERIMENT.dynamicRoiCache) roiCache.store(true);
                if (l2csClient.submitTensor(tensor)) l2csFramesSubmitted++;
              } catch (e) {
                // Ex.: getImageData tainted, video not ready. Não afeta o resto
                // do pipeline — extractor recebe null e não anexa bloco.
                stageTimer.end(STAGE.l2csCrop);
                // Um crop que falhou não pode virar base de reuso: o cache
                // ficaria apontando para um tensor de outro instante.
                ultimoTensorL2CS = null;
                console.warn('[L2CS] crop failed:', e, `(roi: ${motivoRoi})`);
              }
            }
          }
          stageTimer.begin(STAGE.l2csRead);
          const g = l2csClient.getLatestGaze(startTimeMs);
          stageTimer.end(STAGE.l2csRead);
          l2csGaze = { yaw: g.yaw, pitch: g.pitch, valid: g.valid, confidence: g.confidence };

          // ── P5.7 — compensação ADITIVA, antes do Ridge ───────────────────
          //
          // A geométrica atua na SAÍDA (pixels, depois do Ridge); esta atua na
          // ENTRADA (radianos, antes). Por isso o lugar é aqui, no gaze que
          // vira as features [4] e [5] do vetor.
          //
          // ⚠️ LIMITAÇÃO CONHECIDA: `diagPose` é a pose do quadro ANTERIOR. A
          // pose deste quadro só existe depois de `extractFeatures`, que roda
          // abaixo — e o gaze precisa ser compensado antes de entrar nela. São
          // ~33 ms de defasagem a 30 fps. Para postura (o que esta compensação
          // corrige) isso é irrelevante; numa virada rápida de cabeça, não. É
          // um fator que `F8.4` precisa considerar ao comparar os modos, e está
          // aqui em vez de escondido.
          //
          // O modo `'both'` NÃO aplica: ele existe para medir os dois em
          // paralelo, e aplicar as duas compensaria a rotação duas vezes.
          if (EXPERIMENT.poseCompensationMode === 'additive' && l2csGaze.valid) {
            // P5.8 — a referência pode ser a da calibração (default) ou a
            // dinâmica. A dinâmica só assume DEPOIS de ter passado pelas três
            // guardas e adotado uma pose; enquanto ela for `null`, a da
            // calibração continua valendo. Nunca há um instante sem referência.
            const refDinamica = EXPERIMENT.dynamicNeutralReference
              ? referenciaNeutra.referencia
              : null;
            const refPose = refDinamica ?? calibration.getCalibrationReferencePose?.() ?? null;
            const abs = gazeAbsoluto(
              { yaw: l2csGaze.yaw, pitch: l2csGaze.pitch },
              latestHasFace ? diagPose : null,
              refPose,
            );
            l2csGaze = { ...l2csGaze, yaw: abs.yaw, pitch: abs.pitch };
            if (abs.clamped) diagPoseClamps++;
          }
          if (g.valid) l2csFramesValid++; else l2csFramesStale++;
          // B3.26 — conta INFERÊNCIAS, não leituras. O timestamp é a hora da
          // captura (B2.1), então ele só muda quando um resultado novo chega.
          if (g.valid && g.timestamp !== ultimoL2csTimestamp) {
            ultimoL2csTimestamp = g.timestamp;
            l2csInferencias++;
          }
          // 2.5 — saída idêntica por segundos é pipeline quebrado, não fisiologia.
          //
          // B2.2 — `observe` recebe o relógio do frame e conta TEMPO, não
          // quadros. Antes, com o limiar de 60 repetições e a leitura do cache
          // rodando a 60 Hz no rAF, uma única inferência lenta de ~1 s já
          // disparava o alarme — e o latch de mão única bloqueava a calibração
          // pelo resto da sessão.
          if (l2csHealth.observe(g.yaw, g.valid, startTimeMs)) {
            setL2CSStatus('error');
            console.error(
              `[L2CS] SAÍDA TRAVADA — yaw constante em ${g.yaw.toFixed(4)} rad ` +
              `(${((g.yaw * 180) / Math.PI).toFixed(1)}°) por mais de 6 s. ` +
              `O modelo está inferindo sobre imagem inútil (crop preto ou congelado).`,
            );
          } else if (l2csHealth.recuperou) {
            // B2.2 — o gaze voltou a variar: o pipeline se recuperou sozinho.
            // Sem esta transição o status ficava preso em 'error' e
            // `CalibrationCheck` bloqueava a calibração até o F5.
            setL2CSStatus('ready');
            console.log('[L2CS] saída voltou a variar — status restaurado para ready.');
          }
          diagL2csYaw = g.yaw;
          diagL2csPitch = g.pitch;
        }

        stageTimer.begin(STAGE.features);
        const extractorResult = extractFeatures(
          landmarks,
          faceMatrix,
          l2csGaze,
          videoEl?.videoWidth,
          videoEl?.videoHeight
        );
        stageTimer.end(STAGE.features);
        diagBlink = extractorResult.blinkDetected;

        let recordedPredicted: { x: number; y: number } | undefined;
        let recordedQuality: RecordedQuality | undefined;

        if (!extractorResult.blinkDetected && extractorResult.featuresLeft.length > 0) {
          const featuresLeft = extractorResult.featuresLeft;
          const featuresRight = extractorResult.featuresRight;

          // Sobrescreve brightness/contrast/blur/confidence
          // com valores reais medidos no crop dos olhos. Mantém o
          // irisVisibilityPercentage (EAR) que continua sendo calculado
          // no extractor.
          stageTimer.begin(STAGE.quality);
          const cropQuality = qualityAnalyzer.analyze(videoEl, landmarks);
          stageTimer.end(STAGE.quality);
          latestSpecularRatio = cropQuality.specularRatio ?? 0;
          // B3.3 — `undefined` é PROPAGADO, não convertido em zero.
          //
          // O `?? 0` desfazia a decisão deliberada do `qualityAnalyzer` de não
          // fabricar medição. Ele devolve `{}` (ou só `detectorConfidence`)
          // quando não conseguiu medir; o engine transformava isso em
          // `specular: 0` (ótimo), `blur: 0` (ótimo) e `brightness: 0`
          // (péssimo) SIMULTANEAMENTE — um estado fisicamente impossível,
          // exibido ao cuidador na pré-calibração como se fosse leitura.
          //
          // Com `undefined`, a UI mostra "não medido" e o cuidador sabe que
          // precisa olhar para a câmera, não para a lâmpada.
          latestQuality = {
            brightness: cropQuality.brightnessEstimate,
            contrast: cropQuality.contrastEstimate,
            blur: cropQuality.blurEstimate,
            detectorConfidence: cropQuality.detectorConfidence,
          };
          // O histórico de brilho alimenta a DFT do detector de cintilação.
          // Um `undefined` ali viraria NaN e contaminaria todos os bins, então
          // frames sem medição simplesmente não entram na série — que é o
          // tratamento correto para dado ausente numa análise espectral.
          if (typeof latestQuality.brightness === 'number') {
            brightnessHistory.push(latestQuality.brightness);
            brightnessHistoryTs.push(performance.now());
          }
          while (brightnessHistory.length > BRIGHTNESS_HISTORY_LEN) {
            brightnessHistory.shift();
            brightnessHistoryTs.shift();
          }
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
            // Proxy de distância câmera-rosto para `mapGaze` computar
            // ratio de correção geométrica (flag off por default). Viaja
            // junto do `quality` pra não exigir um novo canal só pra isso.
            cameraDistanceEstimate: face?.cameraDistanceEstimate,
            // Centro facial e escala viajam junto do `quality` pelo mesmo
            // motivo que `cameraDistanceEstimate`: evita um canal novo só para
            // isso, e assim entram em `profile[].quality`, que é de onde a
            // referência de calibração é calculada.
            faceCenterX: latestFaceCenter.x,
            faceCenterY: latestFaceCenter.y,
            iodPx: latestIodPx,
          };

          if (face) {
            diagPose = { yaw: face.yaw, pitch: face.pitch, roll: face.roll };

            // P5.8 — alimenta a referência neutra dinâmica.
            //
            // Alimentada SEMPRE que a flag está ligada, inclusive durante a
            // calibração: o módulo precisa saber que está calibrando para
            // descartar as amostras, e essa decisão é dele, não do chamador.
            // Passar `calibrando` e deixá-lo ignorar é diferente de não
            // chamar — a segunda opção deixaria o relógio de estabilidade
            // rodando por baixo.
            if (EXPERIMENT.dynamicNeutralReference) {
              const troca = referenciaNeutra.atualizar(
                { yaw: face.yaw, pitch: face.pitch, roll: face.roll },
                startTimeMs,
                { calibrando: calibration.isCalibrating },
              );
              if (troca) {
                diagRefUpdates++;
                const grau = 180 / Math.PI;
                // Registro obrigatório (P5.8). Sem ele, o Dia 7 vê o erro
                // mudar no meio da sessão e não tem como explicar.
                console.log(
                  `[pose] referência neutra atualizada em ${troca.timestampMs.toFixed(0)} ms: ` +
                  `Δyaw=${(troca.delta.yaw * grau).toFixed(2)}° ` +
                  `Δpitch=${(troca.delta.pitch * grau).toFixed(2)}° ` +
                  `(${troca.amostras} amostras)`,
                );
              }
            }

            // P5.2 — pose por PnP, para comparação ou como fonte.
            //
            // Custo medido: 0,175 ms p50 (0,31 ms p95), 13 iterações. Barato o
            // bastante para o caminho quente, mas rodar por quadro só para
            // alimentar um diagnóstico seria desperdício — daí a cadência de
            // 1 Hz quando a fonte é a matriz. Com `headPoseSource: 'pnp'` ele
            // roda todo quadro, porque aí é a fonte de verdade.
            const usandoPnp = EXPERIMENT.headPoseSource === 'pnp';
            const horaDeComparar = startTimeMs - ultimoPnpMs >= PNP_DIAG_INTERVALO_MS;
            if (usandoPnp || horaDeComparar) {
              ultimoPnpMs = startTimeMs;
              stageTimer.begin(STAGE.pnp);
              const pontos = pontosPnPDeLandmarks(
                landmarks, videoEl?.videoWidth ?? 0, videoEl?.videoHeight ?? 0,
              );
              const pnp = pontos
                ? solvePnP(pontos, videoEl?.videoWidth ?? 0, videoEl?.videoHeight ?? 0)
                : null;
              stageTimer.end(STAGE.pnp);

              if (pnp) {
                // O delta é publicado SEMPRE, inclusive com a flag em
                // 'matrix'. É a série que `F8.4` precisa para decidir entre os
                // dois métodos — e ela não existiria se só fosse computada
                // depois de alguém já ter escolhido o PnP.
                const grau = 180 / Math.PI;
                diagPnpDelta = {
                  yaw: (pnp.yaw - face.yaw) * grau,
                  pitch: (pnp.pitch - face.pitch) * grau,
                  roll: (pnp.roll - face.roll) * grau,
                  reprojectionErrorPx: pnp.reprojectionErrorPx,
                };
                if (usandoPnp) {
                  diagPose = { yaw: pnp.yaw, pitch: pnp.pitch, roll: pnp.roll };
                }
              } else if (usandoPnp) {
                // A flag pede PnP e ele falhou. NÃO cair em silêncio para a
                // matriz: isso faria a medição do Dia 7 comparar métodos que
                // se misturam. `diagPose` fica com a matriz, e o delta some —
                // que é o sinal de que o PnP não está entregando.
                diagPnpDelta = null;
              }
            }
          }
          // Pose do quadro para a compensação geométrica em `mapGaze`.
          // Enviada sempre, inclusive `null`: a flag decide se é usada, e uma
          // pose velha guardada de um quadro sem rosto compensaria pelo lugar
          // errado.
          calibration.setCurrentFramePose(
            face ? { yaw: face.yaw, pitch: face.pitch, roll: face.roll } : null,
          );

          calibration.feedRawData(featuresLeft, featuresRight, quality);
          latestFeaturesLeft = featuresLeft;
          latestFeaturesRight = featuresRight;

          // Peso por olho para a fusão binocular. EAR "aberto" de referência
          // ~0.25; abaixo disso o olho está fechando. Clamp em [0..1] transforma
          // isso em confiança, que o `mapGaze` combina com a dominância
          // ocular do usuário. Sem EARs (extractor antigo/parity test), o
          // peso fica indefinido e `mapGaze` volta para a média simples.
          const EAR_OPEN = 0.25;
          const perEyeWeight =
            typeof extractorResult.leftEAR === 'number' &&
            typeof extractorResult.rightEAR === 'number'
              ? {
                  left:  Math.max(0, Math.min(1, extractorResult.leftEAR  / EAR_OPEN)),
                  right: Math.max(0, Math.min(1, extractorResult.rightEAR / EAR_OPEN)),
                }
              : undefined;

          feedAccuracyRaw(
            featuresLeft,
            featuresRight,
            perEyeWeight,
            face ? { yaw: face.yaw, pitch: face.pitch, roll: face.roll } : undefined,
          );

          // O quarto argumento é herança: `mapGaze` não o lê mais (a
          // compensação de distância passou a usar `setCurrentFrameGeometry` +
          // `setCameraFovDeg`, que dão centímetros). Mantido na chamada só
          // porque a assinatura ainda o aceita, por compatibilidade com os
          // testes de regressão.
          stageTimer.begin(STAGE.predict);
          const calibrated = calibration.mapGaze(
            featuresLeft,
            featuresRight,
            perEyeWeight,
            face?.cameraDistanceEstimate ?? null,
          );
          stageTimer.end(STAGE.predict);
          if (calibrated) {
            targetX = calibrated.x;
            targetY = calibrated.y;
          } else {
            const vw = document.documentElement.clientWidth;
            const vh = document.documentElement.clientHeight;
            targetX = (1.0 - landmarks[1].x) * vw;
            targetY = landmarks[1].y * vh;
          }
          // Atualiza o timer de degradação. Só conta null como
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

          // O buffer rolling adicionava lag e (em teste) não
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
          // Quando filterInNormalizedSpace está ligado, filtrar em [0,1]
          // antes de converter para pixel. O filtro se torna independente da
          // resolução da tela: mincutoff=0.5 produz alpha≈0.50 em vez de 0.99.
          // Desligado por default — só os presets "-v2" ativam essa flag.
          let smoothed: { x: number; y: number };
          stageTimer.begin(STAGE.filter);
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
          stageTimer.end(STAGE.filter);

          // Decide entre 'calibrating' | 'degraded' | 'tracking' | 'uncalibrated'.
          // 'degraded' entra quando mapGaze devolveu null por >500ms seguidos
          // após a calibração estar completa. Sai automaticamente no primeiro
          // frame bem-sucedido.
          // `uncalibrated` é um estado próprio. Antes, um app sem
          // nenhuma calibração emitia o fallback do nariz como se fosse gaze
          // (`degraded:false`), e o dwell clicava em qualquer botão sob a ponta
          // do nariz — com o cursor invisível, porque a UI o esconde quando
          // não há calibração.
          const semCalibracao = !calibration.isCalibrated();
          if (calibration.isCalibrating) {
            setState('calibrating');
          } else if (semCalibracao) {
            setState('uncalibrated');
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
            uncalibrated: semCalibracao,
            eyeState: 'open',
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
        } else if (extractorResult.blinkDetected) {
          // Piscada passa a EMITIR, na última posição conhecida e com
          // `eyeState:'closed'`.
          //
          // Antes o engine simplesmente não emitia durante a piscada, e o
          // dispatcher media o dwell por relógio de parede: fechar os olhos por
          // 2 s sobre um botão disparava o clique ao reabrir, porque o tempo
          // decorrido bastava. Fechamento prolongado é comum em fadiga, que é
          // exatamente a condição do público-alvo.
          //
          // A posição NÃO é atualizada (o olho fechado não informa direção); só
          // o estado muda, para o dispatcher poder pausar em vez de contar.
          const semCalibracaoBlink = !calibration.isCalibrated();
          // B3.4 — usa o MESMO critério de degradação do resto do pipeline.
          //
          // Aqui estava `degraded: mapGazeNullSinceMs !== null`, que ignora o
          // limiar de 500 ms respeitado em todos os outros ramos: bastava UM
          // frame com `mapGaze` nulo antes da piscada para a amostra sair
          // marcada como degradada. O dispatcher então zerava o dwell — dois
          // segundos de fixação perdidos por um frame ruim seguido de uma
          // piscada, que é uma sequência corriqueira.
          //
          // `updateDegradedTimer` é a única fonte de verdade sobre o que conta
          // como degradação; consultá-la aqui (sem avançar o timer, já que a
          // piscada não é falha de predição) devolve o veredito coerente.
          const degradadoNaPiscada = updateDegradedTimer({
            mapGazeReturnedNull: mapGazeNullSinceMs !== null,
            isCalibrated: calibration.isCalibrated(),
            isCalibrating: calibration.isCalibrating,
            currentNullSinceMs: mapGazeNullSinceMs,
            now: performance.now(),
          }).isDegraded;
          emit({
            x: lastEmittedX,
            y: lastEmittedY,
            timestamp: performance.now(),
            hasFace: true,
            degraded: !semCalibracaoBlink && degradadoNaPiscada,
            uncalibrated: semCalibracaoBlink,
            eyeState: 'closed',
          });
        } else {
          // B2.3 — features VAZIAS sem piscada: o ramo que não existia.
          //
          // `extractEyeFeatures` devolve arrays vazios com
          // `blinkDetected: false` quando `landmarks.length < 478` — modelo sem
          // refinamento de íris, `.task` trocado, ou qualquer variante de 468
          // pontos (exatamente o cenário C4 da especificação nova).
          //
          // Sem este `else`, o frame caía num buraco: nenhum `emit`, nenhum
          // `setState`, `updateDegradedTimer` NUNCA chamado (então
          // `mapGazeNullSinceMs` ficava `null` para sempre e o sistema JAMAIS
          // degradava), `latestQuality` congelado. O resultado observável era
          // `hasFace: true`, estado `'tracking'`, cursor parado, sem banner,
          // sem log, sem contador. É o modo de falha exato que o estado
          // `degraded` foi criado para evitar.
          //
          // Agora emite amostra inválida e força a degradação, para o
          // dispatcher bloquear o dwell e a UI mostrar o que está acontecendo.
          const semCalibracaoVazio = !calibration.isCalibrated();
          const degradadoUpdate = updateDegradedTimer({
            mapGazeReturnedNull: true,
            isCalibrated: calibration.isCalibrated(),
            isCalibrating: calibration.isCalibrating,
            currentNullSinceMs: mapGazeNullSinceMs,
            now: performance.now(),
          });
          mapGazeNullSinceMs = degradadoUpdate.newNullSinceMs;

          if (!avisouFeaturesVazias) {
            avisouFeaturesVazias = true;
            console.error(
              `[IrisFlow] extractor devolveu vetor VAZIO com rosto presente e sem piscada ` +
              `(landmarks=${landmarks.length}). O modelo de landmarks provavelmente não tem ` +
              `refinamento de íris — o pipeline exige 478 pontos. O rastreamento fica degradado.`,
            );
          }

          if (calibration.isCalibrating) setState('calibrating');
          else if (semCalibracaoVazio) setState('uncalibrated');
          else setState('degraded');

          emit({
            x: lastEmittedX,
            y: lastEmittedY,
            timestamp: performance.now(),
            hasFace: true,
            degraded: !semCalibracaoVazio && degradadoUpdate.isDegraded,
            uncalibrated: semCalibracaoVazio,
            // `eyeState` OMITIDO de propósito: sem features não há como saber
            // se o olho está aberto ou fechado. Declarar 'open' seria fabricar
            // medição; o dispatcher trata a ausência como desconhecido.
          });
        }

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
              ? { yaw: l2csGaze.yaw, pitch: l2csGaze.pitch, valid: l2csGaze.valid, confidence: l2csGaze.confidence }
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

      // B3.26 — os diagnósticos rodam FORA do ramo `hasFace`.
      //
      // O bloco inteiro estava dentro do `else` (indentação quebrada por um
      // merge), então FPS, taxa do L2CS e percentual de stale CONGELAVAM
      // exatamente quando o rosto se perdia — o momento em que o cuidador mais
      // precisa saber o que está acontecendo.
      atualizarDiagnosticos();

      // `loop.total` fecha AQUI, dentro do ramo de quadro novo.
      //
      // ── Por que isto importa, e como foi descoberto ────────────────────────
      //
      // O `end` estava fora do `if`, então TODA iteração do rAF gerava uma
      // amostra — inclusive as em que `videoEl.currentTime` não mudou e o corpo
      // não fez nada. Com rAF a ~60 Hz e vídeo a 30 fps, **metade das amostras
      // era de quadros sem trabalho**, valendo ~0 ms.
      //
      // O efeito é uma mediana sem significado: medido em campo, `loop.total`
      // reportava p50 = 21,45 ms enquanto `mediapipe` (19,1) + `quality`
      // (12,7) já somavam 31,8 ms no mesmo quadro. O total aparecia MENOR que
      // suas próprias partes, o que é impossível — e é o sinal de que duas
      // populações estavam sendo misturadas numa métrica só, o mesmo defeito
      // que `B3.7` corrigiu em `accuracy.ts`.
      //
      // Fechando aqui, a amostra passa a existir só quando houve trabalho, e o
      // p50 volta a ser comparável com o dos estágios que ele contém.
      stageTimer.end(STAGE.loopTotal);
    }
  }

  /**
   * Atualiza os contadores do HUD a cada 250 ms (B3.26).
   *
   * Três defeitos corrigidos aqui:
   *
   *  1. **Dois cronômetros escreviam em `lastStatMs`** — o log de estatísticas
   *     a cada 3 s e o log de FPS a cada 60 frames. Um sobrescrevia o outro, e
   *     o FPS reportado saía **60 com o loop rodando a 30**.
   *
   *  2. **`diagL2csHz` contava leituras do CACHE**, não inferências.
   *     `l2csFramesValid` incrementa em todo frame do rAF que lê um gaze
   *     válido (~30/s), enquanto o worker produz ~10/s. O HUD mostrava 3× a
   *     taxa real, escondendo justamente o gargalo que `P5.5` vai medir.
   *
   *  3. O bloco vivia dentro do ramo `hasFace` — ver o chamador.
   */
  function atualizarDiagnosticos(): void {
    const now = performance.now();

    // Log periódico de FPS, com cronômetro PRÓPRIO.
    if (lastFpsLogMs === 0) {
      lastFpsLogMs = now;
      diagFpsLogFrames = framesSeen;
    } else if (framesSeen - diagFpsLogFrames >= 60) {
      const deltaSec = (now - lastFpsLogMs) / 1000;
      const frames = framesSeen - diagFpsLogFrames;
      if (deltaSec > 0) {
        console.log(
          `[IrisFlow] FPS: ${(frames / deltaSec).toFixed(1)} ` +
          `| Face: ${((framesWithFace / framesSeen) * 100).toFixed(0)}% ` +
          `| L2CS: ${l2csInferencias} inferências (${l2csFramesValid} leituras válidas, ` +
          `${l2csFramesStale} stale)`,
        );
      }
      lastFpsLogMs = now;
      diagFpsLogFrames = framesSeen;
    }

    if (now - diagLastUpdateMs < 250) return;
    const deltaMs = now - diagLastUpdateMs;
    diagRenderFps = ((framesSeen - diagFramesSeen) * 1000) / deltaMs;
    const l2csTotal = (l2csFramesValid + l2csFramesStale) - diagL2csTotalFrames;
    const l2csValid = l2csFramesValid - diagL2csValidFrames;
    // Taxa de INFERÊNCIAS concluídas, não de leituras do cache.
    diagL2csHz = ((l2csInferencias - diagL2csInferencias) * 1000) / deltaMs;
    diagL2csStalePct = l2csTotal > 0 ? ((l2csTotal - l2csValid) / l2csTotal) * 100 : 0;

    diagFramesSeen = framesSeen;
    diagL2csValidFrames = l2csFramesValid;
    diagL2csTotalFrames = l2csFramesValid + l2csFramesStale;
    diagL2csInferencias = l2csInferencias;
    diagLastUpdateMs = now;
  }

  return {
    async start(video: HTMLVideoElement): Promise<void> {
      if (running) return;
      // `dispose()` é terminal por contrato. Reiniciar um engine descartado
      // exigiria recriar o FaceLandmarker e o worker L2CS, que é exatamente o
      // que `createGazeEngine()` faz — então avisar alto é melhor que fingir
      // que iniciou e deixar o consumidor com um cursor parado sem explicação.
      if (disposed) {
        console.warn('[IrisFlow] start() ignorado: este engine já sofreu dispose(). Crie um novo com createGazeEngine().');
        return;
      }

      // B1.6 — token desta tentativa de start. Qualquer `stop()` ou `start()`
      // concorrente invalida o token e faz esta chamada abortar após o await
      // em vez de agendar um rAF órfão.
      const myGen = ++startGeneration;

      videoEl = video;
      setState('loading');

      if (!faceLandmarker) {
        await initMediaPipe();
      }

      // B1.6 — a checagem que faltava. Entre o `await` acima e esta linha
      // podem ter passado segundos, e o consumidor pode ter desmontado.
      if (myGen !== startGeneration) {
        console.log('[IrisFlow] start() abortado: stop() ou novo start() durante a inicialização.');
        return;
      }

      calibration.init();
      initL2CSAsync();
      // B1.7 — a sessão começa limpa. Ver `resetSessionState`.
      resetSessionState();
      running = true;
      sessionStartMs = performance.now();
      setState('tracking');
      rafHandle = requestAnimationFrame(loop);
    },

    stop(): void {
      // B1.6 — invalida qualquer `start()` em voo. Sem isto, um start()
      // suspenso no await do MediaPipe resolveria depois deste stop() e
      // arrancaria um loop sobre um <video> já removido.
      startGeneration++;
      running = false;
      if (rafHandle) cancelAnimationFrame(rafHandle);
      rafHandle = 0;
      // B1.7 — o estado de sessão morre com a sessão. Sem isto a próxima
      // sessão nascia degradada, com o limiar de piscada de outro rosto e
      // com as features do último frame da sessão anterior.
      resetSessionState();
      // Preserva `l2csClient` e `cropCtx` entre start/stop de propósito:
      // recarregar o ONNX de 91 MB a cada troca de rota seria pior que o
      // custo de mantê-los. Quem libera de fato é `dispose()`.
      setState('idle');
    },

    /**
     * Libera os recursos pesados (B1.7).
     *
     * Separado de `stop()` porque as duas operações respondem a perguntas
     * diferentes: `stop()` é "pare de rastrear, posso recomeçar já"; `dispose()`
     * é "este engine não será mais usado".
     *
     * O que era vazado antes desta função existir:
     *   - `faceLandmarker` nunca recebia `.close()` — heap WASM + contexto GPU
     *     vivos por mount.
     *   - `l2csClient.stop()` nunca era chamado em lugar nenhum do código; o
     *     worker com ~91 MB de sessão ONNX ficava vivo indefinidamente. Dois
     *     mounts = ~182 MB.
     *   - `cropCtx` (canvas 448² com `willReadFrequently`) e o canvas em
     *     resolução plena do `EyeQualityAnalyzer` ficavam retidos.
     *
     * Idempotente: o cleanup do React pode disparar mais de uma vez.
     */
    dispose(): void {
      disposed = true;
      this.stop();
      if (faceLandmarker) {
        try {
          faceLandmarker.close();
        } catch (e) {
          // Fechar duas vezes ou fechar um contexto GPU já perdido não pode
          // derrubar o cleanup do consumidor.
          console.warn('[IrisFlow] faceLandmarker.close() falhou:', e);
        }
        faceLandmarker = null;
      }
      if (l2csClient) {
        try {
          l2csClient.stop();
        } catch (e) {
          console.warn('[IrisFlow] l2csClient.stop() falhou:', e);
        }
        l2csClient = null;
      }
      cropCtx = null;
      qualityAnalyzer.dispose?.();
      setL2CSStatus('disabled');
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

    getSessionUptimeMs(): number {
      return sessionStartMs === null ? 0 : Math.max(0, performance.now() - sessionStartMs);
    },

    setFilterPreset(preset: FilterPreset | FilterPresetV2): void {
      activePreset = preset;
      // Resolve o config de presets v1 (pixel) ou v2 (normalizado)
      const isV2 = preset.endsWith('-v2');
      const oldConfig = activeConfig;
      activeConfig = isV2
        ? FILTER_PRESETS_V2[preset as FilterPresetV2]
        : FILTER_PRESETS[preset as FilterPreset];
      oneEuro.setParams(activeConfig.mincutoff, activeConfig.beta);
      if (oldConfig && oldConfig.filterInNormalizedSpace !== activeConfig.filterInNormalizedSpace) {
        oneEuro.reset();
      }
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
          confidence: l2csClient?.getAverageConfidence() ?? 0,
          pendingCount: l2csClient?.getPendingCount() ?? 0,
          // P5.5 — o provider EFETIVAMENTE ativo. `null` antes do `ready`.
          // Sem este campo, uma medição de WebGPU que caiu para wasm seria
          // lida como "a GPU não ajudou" — a conclusão invertida.
          executionProvider: l2csClient?.getExecutionProvider() ?? null,
        },
        gaze: {
          yaw: diagL2csYaw,
          pitch: diagL2csPitch,
        },
        pose: {
          ...diagPose,
          // P5.2 — de onde a pose publicada veio, e quanto o outro método
          // discordaria. `deltaPnpDeg` é `null` enquanto não houve comparação.
          source: EXPERIMENT.headPoseSource,
          deltaPnpDeg: diagPnpDelta,
          compensationMode: EXPERIMENT.poseCompensationMode,
          additiveClamps: diagPoseClamps,
          neutralReference: {
            dynamic: EXPERIMENT.dynamicNeutralReference,
            updates: diagRefUpdates,
            current: EXPERIMENT.dynamicNeutralReference ? referenciaNeutra.referencia : null,
          },
        },
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
        // Sprint 4 — P4.1 e P4.8. Os números só ficam diferentes de zero com
        // as flags ligadas; com elas desligadas, o bloco documenta que o
        // estágio não rodou, que é diferente de ter rodado sem custo.
        capture: (() => {
          const ring = frameRing;
          if (!ring) {
            return { active: false, droppedFrames: 0, ringOccupancy: 0, ringHighWaterMark: 0, capacity: 0 };
          }
          const s = ring.stats();
          return {
            active: true,
            droppedFrames: s.dropped,
            ringOccupancy: s.occupancy,
            ringHighWaterMark: s.highWaterMark,
            capacity: s.capacity,
          };
        })(),
        roi: (() => {
          const s = roiCache.stats();
          return {
            active: EXPERIMENT.dynamicRoiCache,
            reuseRate: s.reuseRate,
            cropsAvoided: roiCropsEvitados,
            refreshByReason: s.refreshByReason,
            preprocessSkippedNoRegion: preprocessSemRegiao,
          };
        })(),
        framing: {
          hasFace: latestHasFace,
          iod: latestIod,
          faceCenter: latestFaceCenter,
          specularRatio: latestSpecularRatio,
          iodPx: latestIodPx,
        },
        quality: latestQuality,
        video: {
          width: videoEl?.videoWidth ?? 0,
          height: videoEl?.videoHeight ?? 0,
        },
        brightnessHistory: [...brightnessHistory],
        // fps medido da própria série, não o nominal: se o loop cair para 24
        // fps o aliasing muda, e converter bin→Hz com 30 daria a frequência
        // errada — e frequência errada leva à rede elétrica errada.
        brightnessHistoryFps: (() => {
          const n = brightnessHistoryTs.length;
          if (n < 2) return 0;
          // MEDIANA dos intervalos, não o vão total dividido por N-1.
          //
          // A série só cresce quando há rosto e não há piscada. Uma perda de
          // rosto de 2 s deixa um buraco no meio: pelo vão total, 96 amostras
          // em 5,2 s dariam ~18 fps, quando a taxa real era 30. E como o
          // detector de cintilação converte bin→Hz usando este fps, um erro
          // aqui vira frequência errada, que vira REDE ELÉTRICA errada — e o
          // ajuste automático mandaria a câmera para 50 Hz quando era 60.
          const gaps: number[] = [];
          for (let i = 1; i < n; i++) gaps.push(brightnessHistoryTs[i] - brightnessHistoryTs[i - 1]);
          gaps.sort((a, b) => a - b);
          const mid = gaps.length >> 1;
          const medianGap = gaps.length % 2 ? gaps[mid] : (gaps[mid - 1] + gaps[mid]) / 2;
          if (!(medianGap > 0)) return 0;
          // Descarta a série inteira se houver buraco grande: amostragem
          // irregular espalha energia por todos os bins da DFT e produziria
          // uma "frequência dominante" que não existe.
          const maxGap = gaps[gaps.length - 1];
          if (maxGap > medianGap * 4) return 0;
          return 1000 / medianGap;
        })(),
        stageLatency: stageTimer.snapshot(),
        loop: {
          errorsTotal: getLoopErrorCount(),
          errorsConsecutive: getConsecutiveLoopErrors(),
        },
      };
    },

    calibration: {
      startCalibrationMode(opts?: {
        quick?: boolean;
        opticalCondition?: import('../calibrationProfiles').OpticalCondition;
        label?: string;
        geometry?: Partial<import('../calibration').CalibrationGeometry>;
      }): void {
        calibration.startCalibrationMode(opts);
      },
      getCalibrationTargets(): readonly { x: number; y: number }[] {
        return calibration.getCalibrationTargets();
      },
      getCalibrationMode(): 'full' | 'quick' | null {
        return calibration.getCalibrationMode();
      },
      setCameraFovDeg(fov: number | null): void {
        calibration.setCameraFovDeg(fov);
      },
      getCalibrationDistancesCm() {
        return calibration.getCalibrationDistancesCm();
      },
      setCalibrationDistancesCm(cameraCm: number | null, screenCm: number | null): void {
        calibration.setCalibrationDistancesCm(cameraCm, screenCm);
      },
      getCurrentCameraDistanceCm(): number | null {
        return calibration.getCurrentCameraDistanceCm();
      },
      getDistanceRange() {
        return calibration.getDistanceRange();
      },
      onInvalidated(cb) {
        return calibration.onCalibrationInvalidated(cb);
      },
      startCollectingPoint(x: number, y: number, onDone: (success: boolean) => void): void {
        calibration.startCollectingPoint(x, y, onDone);
      },
      completeCalibration(onComplete?: (outcome: import('../calibration').CalibrationOutcome) => void): void {
        calibration.completeCalibration(onComplete);
      },
      getPoseDriftVerdict() {
        return calibration.avaliarDerivaDePose(calibration.getSessionPoseDrift());
      },
      abort(): void {
        calibration.abortCalibration();
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
      setEyeDominance(dominance: 'left' | 'right' | 'both'): void {
        calibration.setEyeDominance(dominance);
      },
      setSessionBiasEnabled(enabled: boolean): void {
        calibration.setSessionBiasEnabled(enabled);
      },
      resetSessionBias(): void {
        calibration.resetSessionBias();
      },
      getSessionBias(): { x: number; y: number; samples: number } {
        return calibration.getSessionBias();
      },
      getRecentBlinkRatePerMinute(windowMs?: number): number {
        return getRecentBlinkRatePerMinute(windowMs);
      },
      getActiveOpticalCondition(): import('../calibrationProfiles').OpticalCondition {
        return calibration.getActiveProfileMeta()?.opticalCondition ?? 'desconhecido';
      },
    },

    // API do gravador. O engine preenche o header com dados que
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
