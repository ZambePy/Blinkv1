// GazeEngine — wrapper de biblioteca sobre o loop rAF + MediaPipe + Ridge.
// Consumido pelo React (frontend/src/context/GazeContext.tsx) via subscribe.
// Não escreve no DOM; entrega GazeSample por callback para o consumidor renderizar.

import { FilesetResolver, FaceLandmarker } from '@mediapipe/tasks-vision';
import * as calibration from '../calibration';
import { OneEuroFilter2D, FILTER_PRESETS, FILTER_PRESETS_V2 } from '../oneEuroFilter';
import { FilterChain } from '../filters/filterChain';
import { BlinkHold } from '../filters/blinkHold';
import { MedidorDeContraluz, type MedidaDeContraluz } from '../contraluz';
import { geometriaDeDiagonal, type GeometriaDeTela } from '../filters/angularVelocity';
import type { FilterPreset, FilterPresetV2 } from '../oneEuroFilter';
import { extractFeatures } from '../featurePipeline';
import { feedAccuracyRaw, feedAccuracyFiltered, getCurrentTargetPx as getAccuracyTargetPx } from '../accuracy';
import { EyeQualityAnalyzer } from '../qualityAnalyzer';
import { createL2CSClient, type L2CSClient } from '../l2cs/client';
import { createCropContext, cropFaceToTensor, type CropContext } from '../l2cs/crop';
import { L2CSHealthMonitor } from '../l2cs/block';
import { NARIZ_PONTA, OLHO_ESQUERDO, OLHO_DIREITO } from '../faceLandmarks';
import type { L2CSGazeInput } from '../extractor';
import { getRecentBlinkRatePerMinute, resetEarHistory } from '../extractor';
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
 * `error` — o loop falhou de forma persistente (N exceções consecutivas,
 * tipicamente contexto WebGL perdido) e o engine está tentando reinicializar
 * o detector, ou já desistiu.
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
  /** Distâncias registradas na calibração. O aviso de fora-de-faixa
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
   * Diagnóstico do ajuste da última calibração — erro de treino, LOO, λ e os
   * alvos que ficaram de fora. `null` antes de qualquer treino.
   */
  getCalibrationFitDiagnostics(): import('../calibration').CalibrationFitDiagnostics | null;
  /** Alvos planejados que não entraram no treino. Barato. */
  getTargetsSkipped(): { x: number; y: number }[];
  /**
   * Encerra uma calibração em curso SEM treinar e sem descartar o
   * modelo anterior. A tela chama no unmount e quando a janela perde o foco;
   * sem isto, sair no meio da coleta prendia o app em `calibrating`.
   */
  abort(): void;
  clear(): void;
  isCalibrated(): boolean;
  // Dominância ocular do usuário. 'both' = fusão puramente por qualidade;
  // 'left'/'right' aplica multiplicador ao olho escolhido. Setter refletido
  // no `mapGaze` no próximo frame. Não requer recalibração.
  setEyeDominance(dominance: 'left' | 'right' | 'both'): void;
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
    /** Inferências submetidas e ainda sem resposta. Com o backpressure
     *  ativo o valor fica em {0, 1}. Valor preso em 1 com `hz` em 0 indica
     *  deadlock do slot — o worker morreu sem responder. */
    pendingCount: number;
    /** Execution provider ativo no worker (`'wasm'` ou `'webgpu'`); `null`
     *  antes do `ready`. */
    executionProvider: string | null;
    /** true quando o modo `auto` não conseguiu WebGPU e caiu para WASM. */
    fallback: boolean;
    /** Idade máxima aceita para um resultado, em ms (cresce com a latência). */
    staleMs: number;
  };
  gaze: {
    yaw: number;
    pitch: number;
  };
  /** A cadeia de filtragem que está governando de fato. */
  filtro: {
    pedido: 'oneEuro' | 'kalman' | 'kalmanEma';
    /** Pode diferir de `pedido`: `kalmanEma` sem geometria vira `kalman`. */
    efetivo: 'oneEuro' | 'kalman' | 'kalmanEma';
    degradado: boolean;
    geometriaConhecida: boolean;
    /** Preset do One Euro, ou `null` quando a cadeia Kalman está ativa —
     *  os presets não a parametrizam. */
    preset: string | null;
  };
  /** Pose da cabeça no quadro corrente (radianos), da matriz facial do MediaPipe. */
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
  };
  framing: {
    hasFace: boolean;
    iod: number;
    faceCenter: { x: number; y: number };
    /** Fração do crop ocular saturada. `undefined` = não medido neste quadro. */
    specularRatio?: number;
    /** Quanto a mancha de brilho fica parada entre quadros. 1 = imóvel
     *  (assinatura de óculos, inócua); baixo = reflexo se movendo. */
    specularStability?: number;
    /** Distância entre os cantos externos dos olhos em PIXELS DE
     *  VÍDEO. Diferente de `iod`, que é normalizado (e anisotrópico, porque x
     *  divide por largura e y por altura). A avaliação de setup precisa da
     *  grandeza em px porque o que governa a precisão é quantos pixels de
     *  sensor caem sobre o olho. */
    iodPx: number;
    /**
     * Contraluz medida no QUADRO INTEIRO — razão entre o fundo e o rosto.
     *
     * Não sai do `qualityAnalyzer` porque ele lê só o crop dos olhos, e é
     * justamente isso que torna a checagem de luz cega para uma janela às
     * costas do paciente: o crop já vem compensado pela exposição automática.
     * `undefined` = ainda não medido neste posto de uso.
     */
    contraluz?: MedidaDeContraluz;
  };
  /**
   * Qualidade do crop ocular no frame corrente.
   *
   * Todos os campos são opcionais: `undefined` significa *não medido* e a UI
   * deve mostrar isso, não um número. Um `?? 0` aqui publicaria `blur: 0`
   * (ótimo) e `brightness: 0` (péssimo) ao mesmo tempo, como se fosse
   * leitura de sensor.
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
  /** Latência p50/p95 por estágio do pipeline. Janela deslizante de ~120
   *  amostras (≈4 s a 30 fps). Cada chave é o nome do estágio conforme
   *  `STAGE` em `src/telemetry/stageTimer.ts`.
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
   *
   *  O consumidor não deve assumir que todas as chaves existem sempre:
   *  estágios que não rodaram no frame corrente permanecem sem entrada até
   *  ganharem a primeira amostra da sessão. */
  stageLatency: StageSnapshot;
  /** Saúde do loop de rastreamento. `errorsConsecutive > 0` com o estado em
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
   *  disparar mais de uma vez. */
  dispose(): void;
  subscribe(cb: (sample: GazeSample) => void): () => void;
  onStateChange(cb: (state: EngineState) => void): () => void;
  getState(): EngineState;
  // Tempo desde o `start()` bem-sucedido, em ms (performance.now-based).
  // 0 antes do primeiro start. Consumido pelo AUTO_TEST_META para preencher
  // `RunMeta.minutosDeSessao` em vez de hardcode 0. Reinicia a cada stop→start.
  getSessionUptimeMs(): number;
  // Troca em tempo real do preset do filtro temporal.
  // `estavel`/`balanceado`/`responsivo` alteram mincutoff e beta. Ver
  // FILTER_PRESETS em oneEuroFilter.ts.
  // Presets v2 (sufixo '-v2') filtram em espaço normalizado [0,1]
  // antes de converter para pixel — desligado por default.
  setFilterPreset(preset: FilterPreset | FilterPresetV2): void;
  /** Geometria física da tela (diagonal e distância), para as cadeias de
   *  filtragem que trabalham em graus. Chamado quando as configurações
   *  carregam e a cada mudança; sem isto o `kalmanEma` degrada para Kalman puro. */
  setScreenGeometry(screenDiagonalIn: number, viewingDistanceCm: number): void;
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

// Orientação dos pixels do vídeo entregue ao engine.
//
// O L2CS foi treinado com a imagem "como a câmera vê" (não espelhada).
// `cropFaceToTensor` faz o flip horizontal quando isto é `true`. O valor é
// `false` porque `getUserMedia` devolve pixels crus (nenhum browser espelha
// os pixels, só a exibição via CSS) e o `<video>` do GazeContext não é
// desenhado num canvas espelhado antes de chegar aqui — confirmado
// empiricamente: olhar para a direita dá yaw positivo no L2CS.
//
// Só vira `true` se algum estágio pré-engine passar um canvas já espelhado
// como fonte. Um `transform: scaleX(-1)` no elemento exibido NÃO muda os
// pixels.
export const IS_VIDEO_MIRRORED = false;

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
  // filtram em pixels com τ de vários segundos — ver FILTER_PRESETS em
  // oneEuroFilter.ts. Trocável em tempo real via setFilterPreset.
  let activePreset: FilterPreset | FilterPresetV2 = 'balanceado-v2';
  let activeConfig = activePreset.endsWith('-v2')
    ? FILTER_PRESETS_V2[activePreset as FilterPresetV2]
    : FILTER_PRESETS[activePreset as FilterPreset];
  const oneEuro = new OneEuroFilter2D(60, activeConfig.mincutoff, activeConfig.beta);

  // Cadeia alternativa de filtragem (Kalman / Kalman+EMA), selecionada por
  // `EXPERIMENT.filterMode`. O One Euro NÃO passa pela cadeia: fica no caminho
  // de sempre, com os presets v1/v2, o espaço normalizado e o
  // `setFilterPreset` em tempo real — nada disso se aplica ao Kalman.
  /** Instante do último quadro filtrado, em segundos. `null` antes do
   *  primeiro — o Kalman precisa de `dt` REAL, não do nominal de 1/30: a
   *  câmera entrega 30 fps nominais e quadros irregulares na prática, e um
   *  `dt` fixo faria a velocidade estimada errar na mesma proporção do desvio. */
  let ultimoFiltroSec: number | null = null;
  let geometriaDeTela: GeometriaDeTela | null = null;
  let cadeia: FilterChain | null = null;
  // Projeta a posição pelo Kalman durante a piscada, em vez de congelar. Só
  // tem efeito quando há Kalman — nunca no modo `'oneEuro'`.
  const blinkHold = new BlinkHold();
  // Contraluz é propriedade do POSTO de uso, não do instante: ela muda quando
  // alguém abre uma cortina, não entre dois quadros. Por isso o medidor tem
  // intervalo próprio e não paga o custo de ler pixels 30 vezes por segundo.
  const medidorDeContraluz = new MedidorDeContraluz();
  let latestContraluz: MedidaDeContraluz | undefined;

  /** Constrói (ou reconstrói) a cadeia. Chamada quando a geometria aparece. */
  function montarCadeia(): void {
    if (EXPERIMENT.filterMode === 'oneEuro') { cadeia = null; return; }
    cadeia = new FilterChain({
      mode: EXPERIMENT.filterMode,
      geometria: geometriaDeTela,
    });
  }
  montarCadeia();

  function aplicarGeometria(screenDiagonalIn: number, viewingDistanceCm: number): void {
    if (!(screenDiagonalIn > 0) || !(viewingDistanceCm > 0)) return;
    const nova = geometriaDeDiagonal(
      document.documentElement.clientWidth || 0,
      document.documentElement.clientHeight || 0,
      screenDiagonalIn,
      viewingDistanceCm,
    );
    if (!nova) return;
    const mudou = !geometriaDeTela
      || nova.larguraCm !== geometriaDeTela.larguraCm
      || nova.distanciaCm !== geometriaDeTela.distanciaCm
      || nova.larguraPx !== geometriaDeTela.larguraPx;
    geometriaDeTela = nova;
    // Reconstruir descarta o estado interno; é o certo quando a escala em
    // graus mudou.
    if (mudou) montarCadeia();
  }
  const qualityAnalyzer = new EyeQualityAnalyzer();

  /** Dimensão do último vetor válido, para o diagnóstico. */
  let latestFeatureDims = 0;
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

  // Cliente + contexto de crop do L2CS. O worker carrega uma única vez;
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
  let latestSpecularRatio: number | undefined;
  let latestSpecularStability: number | undefined;
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
  /** Já avisamos sobre features vazias nesta sessão? Sem o latch o
   *  console recebe 30 linhas por segundo e a mensagem some no ruído. */
  let avisouFeaturesVazias = false;
  /**
   * Inferências do L2CS efetivamente CONCLUÍDAS. Distinto de
   * `l2csFramesValid`, que conta leituras do cache no rAF (~30/s) enquanto o
   * worker produz ~10/s. Detectado pela mudança do timestamp de captura.
   */
  let l2csInferencias = 0;
  let ultimoL2csTimestamp = -1;
  let diagL2csInferencias = 0;
  /** Cronômetro PRÓPRIO do log de FPS — dividir `lastStatMs` com o log de
   *  estatísticas fazia um sobrescrever o outro. */
  let lastFpsLogMs = 0;
  let diagFpsLogFrames = 0;

  // Instrumentação de latência por estágio. Janela de 120 amostras (~4 s a
  // 30 fps). O reset acontece no `resetSessionState()`.
  const stageTimer = new StageTimer({ windowSize: 120 });

  /**
   * Token de geração do ciclo de vida.
   *
   * `start()` é async e passa segundos em `await initMediaPipe()`. Um `stop()`
   * durante a espera não pode deixar o await resolver e arrancar o rAF sobre
   * um `<video>` já removido — o loop zumbi seguiria alimentando os
   * singletons de `calibration`, `accuracy` e `recorder`. Cada `start()`
   * incrementa o token e, depois de cada `await`, compara.
   */
  let startGeneration = 0;

  /** `dispose()` já rodou. Impede que uma inicialização em voo publique um
   *  `FaceLandmarker` num engine que o consumidor já descartou. */
  let disposed = false;

  /**
   * Zera todo o estado que pertence a UMA sessão. Sem isto a segunda sessão
   * da mesma página começa contaminada: entra em `degraded` sem a janela de
   * 500 ms e herda o limiar adaptativo de piscada de outro rosto.
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
    oneEuro.reset();
    cadeia?.reset();
    ultimoFiltroSec = null;
    // Encerra qualquer episódio de hold em curso. O `predict` nunca é chamado
    // no ramo `piscando: false`, então o stub abaixo só existe para satisfazer
    // a assinatura sem forçar a cadeia a existir durante um reset.
    blinkHold.update(false, performance.now(), {
      predict: () => ({ x: 0, y: 0 }),
      ready: false,
    });
    brightnessHistory.length = 0;
    brightnessHistoryTs.length = 0;
    latestFeatureDims = 0;
    latestHasFace = false;
    latestIod = 0;
    latestIodPx = 0;
    // Contraluz é do POSTO de uso: um `stop()`/`start()` pode ser o cuidador
    // levando o computador para outro cômodo.
    latestContraluz = undefined;
    medidorDeContraluz.reiniciar();
    latestFaceCenter = { x: 0.5, y: 0.5 };
    latestSpecularRatio = undefined;
    latestSpecularStability = undefined;
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
    // Detector de piscada é singleton de módulo: sem este reset o limiar
    // adaptativo herda o EAR de repouso do rosto da sessão anterior.
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
   * Promessa compartilhada da inicialização do MediaPipe. Sem ela, dois
   * `start()` concorrentes (StrictMode) criavam duas instâncias do
   * `FaceLandmarker`, e a que perdia vazava com seu heap WASM e contexto GPU.
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

  // Inicialização fire-and-forget do L2CS. Nunca bloqueia engine.start()
  // porque o loop rAF precisa começar já para o cursor não ficar parado.
  // Se init falhar, marca status='error' — a UI deve consultar via
  // getL2CSStatus() e mostrar erro/impedir calibração.
  function initL2CSAsync(): void {
    if (l2csClient) return;
    if (EXPERIMENT.l2cs === 'off') {
      // Sem o bloco angular, o modelo usa só as 4 features de íris.
      setL2CSStatus('disabled');
      console.log('[L2CS] desligado por configuração (l2cs=off) — modelo só com features de íris.');
      return;
    }
    // O canvas nasce do tamanho configurado e é a fonte única do lado do crop:
    // `cropFaceToTensor` lê o canvas, e o worker deduz o lado do tensor.
    cropCtx = createCropContext(EXPERIMENT.l2csInputSize);
    l2csClient = createL2CSClient();
    l2csClient.start().then(
      () => { setL2CSStatus('ready'); console.log('[L2CS] worker ready'); },
      (err) => {
        setL2CSStatus('error');
        console.error('[L2CS] worker init FAILED — o bloco angular fica zerado. Motivo:', err);
      },
    );
  }

  // O corpo real é `loopBody()`; o reagendamento vive no `finally` de
  // `runLoopBody`, então nenhuma exceção de etapa mata o rastreamento em silêncio.
  function loop(): void {
    if (!running || !videoEl || !faceLandmarker) return;
    const r = runLoopBody(loopBody, () => { rafHandle = requestAnimationFrame(loop); });
    if (r.fatal) void recoverFromFatalLoopErrors();
  }

  /**
   * Reação a uma sequência de exceções no loop. A causa dominante é perda do
   * contexto WebGL (troca de GPU, sleep/wake), que faz `detectForVideo` lançar
   * indefinidamente; recriar o `FaceLandmarker` é o único caminho de volta.
   *
   * O estado vai para `'error'` antes da tentativa, para o cuidador ver que
   * algo está errado em vez de um cursor parado.
   */
  async function recoverFromFatalLoopErrors(): Promise<void> {
    setState('error');
    console.warn('[IrisFlow] tentando reinicializar o FaceLandmarker após falha persistente do loop.');
    const geracao = startGeneration;
    try {
      if (rafHandle) cancelAnimationFrame(rafHandle);
      rafHandle = 0;
      if (faceLandmarker) {
        try { faceLandmarker.close(); } catch { /* contexto já perdido */ }
        faceLandmarker = null;
      }
      await initMediaPipe();
      // Outro `start()`/`stop()` aconteceu durante o await: não pisar no ciclo
      // de vida novo.
      if (geracao !== startGeneration || !running) return;
      // `initMediaPipe()` pode RESOLVER sem publicar o detector (o ramo
      // `disposed`, ou uma promessa compartilhada de um `start()` que abortou).
      // Sem esta checagem o código seguia para `setState('tracking')` e
      // `requestAnimationFrame(loop)` — e `loop()` sai pela guarda
      // `!faceLandmarker` SEM se reagendar. Resultado: estado 'tracking',
      // cursor congelado e nenhuma mensagem, que é exatamente o modo de falha
      // que o loopGuard existe para tornar impossível.
      if (!faceLandmarker) {
        throw new Error('initMediaPipe() resolveu sem publicar o FaceLandmarker.');
      }
      resetLoopErrorState();
      setState('tracking');
      // Enquanto `faceLandmarker` era null o `loop()` saiu sem se reagendar,
      // então o rAF precisa ser rearmado aqui.
      rafHandle = requestAnimationFrame(loop);
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
        latestHasFace = false;
        latestIod = 0;
        latestFaceCenter = { x: 0.5, y: 0.5 };
        latestSpecularRatio = undefined;
        latestSpecularStability = undefined;
        latestIodPx = 0;
        // Face perdida zera o timer de degradação; sem rosto o problema
        // é 'no_face', não 'degraded'. Quando o rosto voltar, começa uma nova
        // janela de 500 ms antes de considerar degradado novamente.
        mapGazeNullSinceMs = null;
        if (state === 'tracking' || state === 'degraded') setState('no_face');
        // Emite a CADA frame sem rosto, não uma vez por episódio: o dispatcher
        // de dwell decide entre pausar e zerar pela idade da perda, e sem os
        // frames seguintes ficaria em pausa indefinida.
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
        const cantoEsq = landmarks[OLHO_ESQUERDO.externo];
        const cantoDir = landmarks[OLHO_DIREITO.externo];
        const rawIod = Math.sqrt(
          (cantoEsq.x - cantoDir.x) ** 2 +
          (cantoEsq.y - cantoDir.y) ** 2,
        );
        latestHasFace = true;
        latestIod = rawIod;
        // Versão em px de vídeo. `rawIod` acima mistura escalas (x
        // normalizado por largura, y por altura); aqui desfazemos isso antes
        // de medir, senão a distância muda com a inclinação da cabeça.
        latestIodPx = Math.hypot(
          (cantoEsq.x - cantoDir.x) * (videoEl?.videoWidth ?? 0),
          (cantoEsq.y - cantoDir.y) * (videoEl?.videoHeight ?? 0),
        );
        latestFaceCenter = { x: landmarks[NARIZ_PONTA].x, y: landmarks[NARIZ_PONTA].y };
        // Alimenta a compensação de distância (`mapGaze` converte para cm
        // usando o campo de visão calibrado) e a de translação lateral.
        calibration.setCurrentFrameGeometry(
          latestIodPx, videoEl?.videoWidth ?? 0, videoEl?.videoHeight ?? 0, latestFaceCenter,
        );

        // ── Contraluz ────────────────────────────────────────────────────
        //
        // Mede aqui, e não junto do `qualityAnalyzer`, por dois motivos.
        //
        // O primeiro: lá o bloco está atrás de `!blinkDetected &&
        // featuresLeft.length > 0`, e contraluz forte é EXATAMENTE o que
        // derrete a borda da íris e faz a extração falhar. A medição ficaria
        // presa em "não medido" justamente nos postos que ela existe para
        // denunciar. Ela lê o quadro inteiro num canvas 64×36 e não depende de
        // feature nenhuma.
        //
        // O segundo: o retângulo do rosto tem de ser calculado em PIXELS. A
        // primeira versão usava `latestIod` (normalizado, e anisotrópico —
        // veja o comentário logo acima) como meio-lado nos dois eixos, o que
        // num vídeo 16:9 produzia uma caixa achatada que engolia fundo dos
        // lados e cortava testa e queixo. Com a janela ao fundo, esse fundo
        // entrava na média do "rosto", a razão caía pela metade e o contraluz
        // era aprovado.
        if (videoEl && videoEl.videoWidth > 0 && videoEl.videoHeight > 0) {
          const vw = videoEl.videoWidth;
          const vh = videoEl.videoHeight;
          // Rosto ≈ 2,2× a distância entre os cantos externos dos olhos na
          // largura, e mais alto que largo. Números grosseiros de propósito: a
          // razão de luminância não é sensível a alguns por cento de caixa, e
          // segmentar o rosto com precisão custaria mais do que a medida vale.
          const larguraPx = Math.min(vw, Math.max(60, latestIodPx * 2.2));
          const alturaPx = Math.min(vh, larguraPx * 1.35);
          const medida = medidorDeContraluz.medir(
            videoEl,
            {
              x: latestFaceCenter.x - larguraPx / 2 / vw,
              y: latestFaceCenter.y - alturaPx / 2 / vh,
              largura: larguraPx / vw,
              altura: alturaPx / vh,
            },
            performance.now(),
          );
          // `null` LIMPA. O medidor devolve `null` só quando a leitura falhou
          // de verdade (canvas contaminado, quadro ausente) — dentro do
          // intervalo de throttle ele devolve a última medida boa. Manter o
          // valor velho aqui transformaria "não medido" em código morto.
          latestContraluz = medida ?? undefined;
        }

        const rawMatrix = results.facialTransformationMatrixes?.[0]?.data;
        const faceMatrix = rawMatrix ? new Float32Array(rawMatrix) : undefined;

        // L2CS: submete tensor throttled e lê o último gaze válido do cache.
        // O loop rAF nunca aguarda; se stale ou worker off, o extractor recebe
        // {valid: false} e anexa 7 zeros.
        let l2csGaze: L2CSGazeInput | null = null;
        if (l2csClient && cropCtx && videoEl) {
          // O crop só é construído quando o worker aceitaria a submissão, para
          // não gastar ~5 ms de getImageData à toa.
          if (l2csClient.canSubmit(startTimeMs)) {
            try {
              stageTimer.begin(STAGE.l2csCrop);
              const tensor = cropFaceToTensor(videoEl, {
                landmarks,
                isMirrored: IS_VIDEO_MIRRORED,
                context: cropCtx,
                expandFactor: EXPERIMENT.expandFactor,
              });
              stageTimer.end(STAGE.l2csCrop);
              if (l2csClient.submitTensor(tensor)) l2csFramesSubmitted++;
            } catch (e) {
              // Ex.: getImageData tainted, vídeo ainda sem quadro. O extractor
              // recebe o gaze inválido e o bloco angular fica zerado neste quadro.
              stageTimer.end(STAGE.l2csCrop);
              console.warn('[L2CS] crop failed:', e);
            }
          }
          stageTimer.begin(STAGE.l2csRead);
          const g = l2csClient.getLatestGaze(startTimeMs);
          stageTimer.end(STAGE.l2csRead);
          l2csGaze = { yaw: g.yaw, pitch: g.pitch, valid: g.valid, confidence: g.confidence };

          if (g.valid) l2csFramesValid++; else l2csFramesStale++;
          // Conta inferências, não leituras: o timestamp é a hora da captura e
          // só muda quando chega resultado novo.
          if (g.valid && g.timestamp !== ultimoL2csTimestamp) {
            ultimoL2csTimestamp = g.timestamp;
            l2csInferencias++;
          }
          // Saída idêntica por segundos é pipeline quebrado (crop preto ou
          // congelado), não fisiologia.
          if (l2csHealth.observe(g.yaw, g.valid, startTimeMs)) {
            setL2CSStatus('error');
            console.error(
              `[L2CS] SAÍDA TRAVADA — yaw constante em ${g.yaw.toFixed(4)} rad ` +
              `(${((g.yaw * 180) / Math.PI).toFixed(1)}°) por mais de 6 s. ` +
              `O modelo está inferindo sobre imagem inútil (crop preto ou congelado).`,
            );
          } else if (l2csHealth.recuperou) {
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
        // Entrada do filtro, gravada para reproduzir outras cadeias offline
        // sobre exatamente a mesma sessão.
        let recordedPreFilter: { x: number; y: number } | undefined;
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
          // `undefined` é propagado, nunca convertido em zero: o analisador não
          // fabrica medição quando não consegue medir, e a UI mostra "não medido".
          latestSpecularRatio = cropQuality.specularRatio;
          latestSpecularStability = cropQuality.specularStability;
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
          // A pose viaja no `quality` para a calibração registrar a postura
          // mediana de cada alvo. Ela não rejeita amostra nenhuma: a deriva é
          // medida ao fim da coleta e vira aviso, e a compensação geométrica
          // corrige o que sobra.
          const face = extractorResult.advancedFeatures?.face;
          const quality = {
            ...(extractorResult.advancedFeatures?.quality ?? {}),
            ...cropQuality,
            yaw:   face?.yaw,
            pitch: face?.pitch,
            roll:  face?.roll,
            // Proxy de distância, centro facial e escala viajam junto do
            // `quality` para entrar em `profile[].quality`, de onde a
            // referência de calibração é calculada.
            faceCenterX: latestFaceCenter.x,
            faceCenterY: latestFaceCenter.y,
            iodPx: latestIodPx,
          };

          if (face) {
            diagPose = { yaw: face.yaw, pitch: face.pitch, roll: face.roll };
          }
          // Pose do quadro para a compensação geométrica em `mapGaze`. Enviada
          // sempre, inclusive `null`: uma pose velha de um quadro sem rosto
          // compensaria pelo lugar errado.
          calibration.setCurrentFramePose(
            face ? { yaw: face.yaw, pitch: face.pitch, roll: face.roll } : null,
          );

          calibration.feedRawData(featuresLeft, featuresRight, quality);
          latestFeatureDims = featuresLeft.length;

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

          stageTimer.begin(STAGE.predict);
          const calibrated = calibration.mapGaze(featuresLeft, featuresRight, perEyeWeight);
          stageTimer.end(STAGE.predict);
          if (calibrated) {
            targetX = calibrated.x;
            targetY = calibrated.y;
          } else {
            const vw = document.documentElement.clientWidth;
            const vh = document.documentElement.clientHeight;
            targetX = (1.0 - landmarks[NARIZ_PONTA].x) * vw;
            targetY = landmarks[NARIZ_PONTA].y * vh;
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

          const now = performance.now() / 1000.0;
          // Com filterInNormalizedSpace, filtra em [0,1] antes de converter
          // para pixel — o termo `beta·|ẋ|` fica independente da resolução.
          let smoothed: { x: number; y: number };
          // Capturado ANTES do `stageTimer.begin`: é a entrada do filtro, e
          // gravá-lo depois arriscaria pegar um `targetX` já mexido por
          // qualquer coisa que se acrescente entre os dois pontos.
          recordedPreFilter = { x: targetX, y: targetY };
          // Encerra o episódio de hold: este quadro TEM medição.
          if (cadeia?.kalmanInterno) {
            blinkHold.update(false, performance.now(), cadeia.kalmanInterno);
          }
          stageTimer.begin(STAGE.filter);
          if (cadeia) {
            // Cadeia Kalman: trabalha em PIXELS. O `filterInNormalizedSpace`
            // dos presets v2 é uma propriedade do One Euro (mincutoff
            // independente de resolução) e não tem análogo aqui — o Kalman já
            // é independente de resolução porque modela velocidade em px/s com
            // dt explícito.
            const dtSec = ultimoFiltroSec === null
              ? undefined
              : Math.max(1e-3, now - ultimoFiltroSec);
            ultimoFiltroSec = now;
            const r = cadeia.filter(targetX, targetY, now, now * 1000, dtSec);
            smoothed = { x: r.x, y: r.y };
          } else if (activeConfig.filterInNormalizedSpace) {
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
          feedAccuracyFiltered(smoothed.x, smoothed.y);

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
          // Piscada EMITE, na última posição conhecida e com `eyeState:'closed'`:
          // sem amostra, o dispatcher mediria o dwell por relógio de parede e
          // fechar os olhos 2 s sobre um botão clicaria ao reabrir. A posição
          // NÃO é atualizada (olho fechado não informa direção); só o estado
          // muda, para o dispatcher pausar em vez de contar.
          const semCalibracaoBlink = !calibration.isCalibrated();
          // Usa o MESMO critério de degradação do resto do pipeline (com o
          // limiar de 500 ms), sem avançar o timer — a piscada não é falha de
          // predição. Marcar degradado por UM frame nulo antes da piscada
          // zerava dois segundos de dwell.
          const degradadoNaPiscada = updateDegradedTimer({
            mapGazeReturnedNull: mapGazeNullSinceMs !== null,
            isCalibrated: calibration.isCalibrated(),
            isCalibrating: calibration.isCalibrating,
            currentNullSinceMs: mapGazeNullSinceMs,
            now: performance.now(),
          }).isDegraded;
          // Com Kalman ativo, projeta em vez de congelar: congelar assume
          // velocidade zero e o cursor "salta" ao reabrir. `predict` CONSULTA
          // o filtro sem avançá-lo.
          const kalmanDaCadeia = cadeia?.kalmanInterno ?? null;
          const hold = kalmanDaCadeia
            ? blinkHold.update(true, performance.now(), kalmanDaCadeia)
            : null;

          // A projeção NÃO pode virar "última posição conhecida": `emit` grava
          // `lastEmittedX/Y` sempre que `hasFace` é true, e a piscada emite com
          // `hasFace: true`. Sem a restauração abaixo, passados os 2 s de teto
          // o fallback congelaria num ponto extrapolado, não medido.
          const ancoraX = lastEmittedX;
          const ancoraY = lastEmittedY;
          emit({
            // Sem Kalman, ou depois do teto de 2 s, cai na posição congelada de
            // sempre — que é o comportamento default e o que sobra quando não
            // há projeção defensável.
            x: hold?.posicao?.x ?? lastEmittedX,
            y: hold?.posicao?.y ?? lastEmittedY,
            timestamp: performance.now(),
            hasFace: true,
            degraded: !semCalibracaoBlink && degradadoNaPiscada,
            uncalibrated: semCalibracaoBlink,
            eyeState: 'closed',
          });
          if (hold?.posicao) {
            lastEmittedX = ancoraX;
            lastEmittedY = ancoraY;
          }
        } else {
          // Features VAZIAS sem piscada (landmarks parciais, modelo sem
          // refinamento de íris). Sem este ramo o frame não emitia nada, nunca
          // degradava e o cursor ficava parado em `'tracking'` sem aviso.
          // Emite amostra inválida e força a degradação.
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
            preFilter: recordedPreFilter,
            target: getRecorderTarget(),
            sampleDecision: calibration.consumeLastSampleDecision() ?? undefined,
          });
        }
      }

      // `loop.total` fecha dentro do ramo de quadro novo: iterações do rAF sem
      // quadro não fazem trabalho e entrariam como amostras de ~0 ms,
      // deixando o total menor que as próprias partes.
      stageTimer.end(STAGE.loopTotal);
    }

    // Fora do ramo de quadro novo: se a câmera congelar, o fps tem que cair
    // para zero em vez de ficar preso no último valor.
    atualizarDiagnosticos();
  }

  /** Atualiza os contadores do HUD a cada 250 ms. A taxa do L2CS conta
   *  inferências concluídas, não leituras do cache. */
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

      // Token desta tentativa de start. Qualquer `stop()` ou `start()`
      // concorrente invalida o token e faz esta chamada abortar após o await
      // em vez de agendar um rAF órfão.
      const myGen = ++startGeneration;

      videoEl = video;
      setState('loading');

      if (!faceLandmarker) {
        await initMediaPipe();
      }

      // Entre o `await` acima e esta linha podem ter passado segundos, e o
      // consumidor pode ter desmontado.
      if (myGen !== startGeneration) {
        console.log('[IrisFlow] start() abortado: stop() ou novo start() durante a inicialização.');
        return;
      }

      calibration.init();
      initL2CSAsync();
      resetSessionState();
      running = true;
      sessionStartMs = performance.now();
      setState('tracking');
      rafHandle = requestAnimationFrame(loop);
    },

    stop(): void {
      // Invalida qualquer `start()` em voo — ver `startGeneration`.
      startGeneration++;
      running = false;
      if (rafHandle) cancelAnimationFrame(rafHandle);
      rafHandle = 0;
      resetSessionState();
      // Preserva `l2csClient` e `cropCtx` entre start/stop de propósito:
      // recarregar o ONNX de 91 MB a cada troca de rota seria pior que o
      // custo de mantê-los. Quem libera de fato é `dispose()`.
      setState('idle');
    },

    /**
     * Libera os recursos pesados: `FaceLandmarker` (heap WASM + contexto GPU),
     * worker L2CS (~91 MB de sessão ONNX) e os canvases. Separado de `stop()`:
     * `stop()` é "pare de rastrear, posso recomeçar já"; `dispose()` é "este
     * engine não será mais usado". Idempotente.
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
      medidorDeContraluz.dispose();
      calibration.dispose();
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

    setScreenGeometry(screenDiagonalIn: number, viewingDistanceCm: number): void {
      aplicarGeometria(screenDiagonalIn, viewingDistanceCm);
    },

    setFilterPreset(preset: FilterPreset | FilterPresetV2): void {
      if (cadeia) {
        // Os presets são parâmetros do One Euro. Não existe tradução deles
        // para o Kalman, e aceitar a chamada em silêncio faria a UI mostrar um
        // preset ativo que não governa nada.
        console.warn(
          `[engine] setFilterPreset('${preset}') ignorado: filterMode é ` +
          `'${EXPERIMENT.filterMode}', e os presets só parametrizam o One Euro.`,
        );
        return;
      }
      // Atribuído DEPOIS da guarda: antes, uma troca recusada já tinha gravado
      // `activePreset` e voltava sem tocar em `activeConfig` — os dois ficavam
      // permanentemente dessincronizados, e a UI passava a exibir um preset
      // que não correspondia aos parâmetros em uso.
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
      console.log(`[IrisFlow] filtro → ${preset} (mincutoff=${activeConfig.mincutoff}, beta=${activeConfig.beta}, normalized=${activeConfig.filterInNormalizedSpace})`);
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
          executionProvider: l2csClient?.getExecutionProvider() ?? null,
          fallback: l2csClient?.houveFallback() ?? false,
          staleMs: l2csClient?.getStaleMs() ?? 0,
        },
        gaze: {
          yaw: diagL2csYaw,
          pitch: diagL2csPitch,
        },
        // `efetivo` pode diferir de `pedido`: `kalmanEma` sem geometria de tela
        // degrada para Kalman puro, e o relatório precisa saber.
        filtro: {
          pedido: EXPERIMENT.filterMode,
          efetivo: cadeia ? cadeia.modoEfetivo : 'oneEuro',
          degradado: cadeia?.degradado ?? false,
          geometriaConhecida: geometriaDeTela !== null,
          preset: cadeia ? null : activePreset,
        },
        pose: { ...diagPose },
        features: {
          dims: latestFeatureDims * 2,
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
        },
        framing: {
          hasFace: latestHasFace,
          iod: latestIod,
          faceCenter: latestFaceCenter,
          specularRatio: latestSpecularRatio,
          specularStability: latestSpecularStability,
          iodPx: latestIodPx,
          contraluz: latestContraluz,
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
        const g = opts?.geometry;
        if (g?.screenDiagonalIn && g?.viewingDistanceCm) {
          aplicarGeometria(g.screenDiagonalIn, g.viewingDistanceCm);
        }
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
      getCalibrationFitDiagnostics() {
        return calibration.getCalibrationFitDiagnostics();
      },
      getTargetsSkipped() {
        return calibration.getTargetsSkipped();
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
      setEyeDominance(dominance: 'left' | 'right' | 'both'): void {
        calibration.setEyeDominance(dominance);
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
