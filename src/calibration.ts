import type { GazeRegressor } from './gazeRegressor';
import {
  createRegressor,
  ridgeModelFromRegressor,
  ridgeRegressorFromModel,
} from './gazeRegressor';
import { StandardScaler } from './scaler';
import type { RidgeModel } from './ridge';
import { trainRidgeModel, predictRidge, targetGroupKey, RidgeRegressor } from './ridge';
import { l2csSlotsInSet } from './extractor';

/** Posições do bloco angular dentro do vetor projetado (vazio sem L2CS). */
const L2CS_SLOTS: readonly number[] = l2csSlotsInSet();
import { EXPERIMENT } from './config/experiment';
import { compensarPredicao, deslocamentoPorPose, poseDeReferencia } from './poseCompensation';
import type { Pose } from './poseCompensation';
import { compensarTranslacao, centroDeReferencia } from './translationCompensation';
import { diagnosticarGrade } from './calibrationGridDiagnosis';
import type { DiagnosticoGrade } from './calibrationGridDiagnosis';
import type { CentroFacial, EscalaFacial } from './translationCompensation';
import { estimateDistanceCm } from './setupReadiness';
import {
  evaluateDistanceRange,
  applyDistanceRatioToPrediction,
  type DistanceRange,
} from './distanceCompensation';
import type { RecordedSampleDecision } from './telemetry/types';
import { resetEarHistory, FEATURE_VECTOR_ID, FEATURE_FORMAT_VERSION } from './extractor';
import {
  profileRegistry,
  shouldWarnPrecisionForCondition,
  type CalibrationProfileMeta,
  type OpticalCondition,
  type StoredCalibrationProfile,
  type ProfileListEntry,
  type CalibrationReferenceState,
  PROFILE_SCHEMA_VERSION,
} from './calibrationProfiles';
import { expandPolynomialFeatures } from './calibration/polynomial';
import { ACCLIMATION_MS } from './accuracyProtocol';

// A expansão polinomial acontece uma única vez, no ponto em que as features
// cruas entram no StandardScaler/Ridge.
function expansaoAtiva(): boolean {
  return EXPERIMENT.polynomialFeatures;
}

function maybeExpand(features: number[][]): number[][] {
  if (!expansaoAtiva()) return features;
  return features.map((f) => expandPolynomialFeatures(f));
}

function maybeExpandSingle(features: number[]): number[] {
  if (!expansaoAtiva()) return features;
  return expandPolynomialFeatures(features);
}

// ── Ponderação binocular ────────────────────────────────────────────────────
// Uma média simples dos dois olhos puxa a predição para longe do alvo quando
// um deles está parcialmente fechado (ptose unilateral, franja, reflexo numa
// lente). O engine passa um peso por olho derivado do EAR, e o `mapGaze`
// mistura na razão desses pesos. A dominância ocular do usuário entra como
// multiplicador extra.
export type EyeDominance = 'left' | 'right' | 'both';
let eyeDominance: EyeDominance = 'both';
// Ganho aplicado ao olho dominante. 1.5× é conservador — dá vantagem clara
// mas não elimina o não-dominante em condições normais.
const DOMINANCE_GAIN = 1.5;

export function setEyeDominance(d: EyeDominance): void {
  eyeDominance = d;
}

export interface CalibrationPoint {
  screenX: number;
  screenY: number;
  featuresLeft: number[];
  featuresRight: number[];
  quality?: any | null;
}

// Amostragem ponderada na periferia. `COLLECTION_MS_BASE` é a duração para o
// ponto central; pontos de canto coletam `+ COLLECTION_MS_RANGE` ms adicionais:
// usuários fixam pior nas bordas, e o Ridge extrapola pior perto do limite do
// fecho convexo.
//
// CUIDADO: se o total ultrapassar ~40 s (9 pontos × ~2,6 s + acomodação), a
// fadiga do usuário-alvo (ELA) piora as fixações finais e anula o ganho.
const COLLECTION_MS_BASE = 1680;
const COLLECTION_MS_RANGE = 1120;
const COLLECTION_MS_FALLBACK = COLLECTION_MS_BASE + COLLECTION_MS_RANGE;

/**
 * Janela descartada no início de cada ponto: sacada + acomodação, em ms.
 * O mesmo número do teste de precisão — o joelho medido da curva de erro fica
 * em ~585 ms, e aos 400 ms o erro ainda vale o dobro do regime estacionário.
 */
export const CALIBRATION_ACCLIMATION_MS = ACCLIMATION_MS;

/**
 * Janela ÚTIL de coleta de um ponto, em ms. É exatamente `collectionMs` — a
 * acomodação NÃO está incluída nela (ver `duracaoTotalDoPonto`).
 */
export function janelaUtilDoPonto(collectionMs: number): number {
  return collectionMs;
}

/** Duração TOTAL de um ponto: acomodação + janela útil. */
export function duracaoTotalDoPonto(collectionMs: number): number {
  return CALIBRATION_ACCLIMATION_MS + janelaUtilDoPonto(collectionMs);
}

/**
 * Mediana de uma série de distâncias, descartando valores não-finitos.
 * `null` quando não sobra nenhum valor — fabricar um número aqui contaminaria
 * `calibrationRefDistance`, que governa a compensação de distância.
 */
export function medianaDeDistancias(valores: readonly number[]): number | null {
  const v = valores.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (v.length === 0) return null;
  const meio = v.length >> 1;
  return v.length % 2 ? v[meio] : (v[meio - 1] + v[meio]) / 2;
}

export function getCollectionMsForPoint(x: number, y: number): number {
  // Distância euclidiana normalizada do centro (0..1). Centro = 0, cantos = 1.
  const d = Math.hypot(x - 0.5, y - 0.5) / Math.hypot(0.5, 0.5);
  return Math.round(COLLECTION_MS_BASE + d * COLLECTION_MS_RANGE);
}

// Piso e teto de variância intra-ponto. Piso uma ordem de grandeza abaixo do
// mínimo observado — defesa contra features congeladas em outros hardwares,
// nunca acionado no hw testado. Teto entre os dois mundos, para rejeitar
// reflexo de óculos e aceitar sessão limpa com folga. Estes números vão ser
// afinados à medida que mais sessões forem capturadas — sinalizam, não bloqueiam.
const INTRA_POINT_VARIANCE_FLOOR = 0.10;
const INTRA_POINT_VARIANCE_CEIL = 1.15;

// Feature "morta" = dimensão cuja variância ENTRE as médias dos 9
// alvos é próxima de zero. Uma feature que não muda entre alvos diferentes
// não carrega informação de olhar. Se mais de DEAD_FEATURE_RATIO do vetor
// estiver morto, o modelo linear não tem sinal para aprender e vai devolver
// o viés (ponto fixo perto do centro dos alvos).
const DEAD_FEATURE_VARIANCE_EPS = 1e-6;
const DEAD_FEATURE_MAX_RATIO = 0.30;

// Contadores de breach expostos via __irisflowDebug. Reset em
// startCalibrationMode e clearCalibration.
let varianceFloorBreaches = 0;
let varianceCeilBreaches = 0;

// Detecção de reflexo especular por frame. Um único frame com specular
// alto é ruído (piscada de luz, cursor branco cruzando o crop); avisar só
// quando persistente durante um ponto (>SPECULAR_PERSISTENCE dos frames).
// Não rejeita o frame — sinaliza para o cuidador que a lente pode estar
// refletindo. Sinal barato: qualityAnalyzer já calcula.
const SPECULAR_FRAME_THRESHOLD = 0.02;      // 2% do crop saturado = "há reflexo"
const SPECULAR_PERSISTENCE     = 0.30;      // >30% dos frames do ponto → warn
let currentPointSpecularHits   = 0;         // frames deste ponto com specular alto
let currentPointFramesAccepted = 0;         // frames deste ponto que passaram os gates
let specularWarningsIssued     = 0;         // pontos que dispararam o warn


/**
 * Mínimo de amostras aceitas para um ponto entrar no treino. Um ponto com 3
 * amostras ao lado de outros com ~60 entra com 1/20 do peso — presente o
 * bastante para deslocar o ajuste, ausente o bastante para não restringi-lo.
 * 15 é ~1/4 de um ponto saudável; abaixo disso o ponto é REFEITO.
 */
export const MIN_ACCEPTED_SAMPLES = 15;

/**
 * Frames de pose necessários para o baseline de sessão ser reportável.
 *
 * ~1 s a 30 fps. O baseline NÃO gateia nada (ver `POSE_DRIFT_YAW_MAX`); serve
 * de referência para medir a deriva da sessão e mostrá-la ao operador.
 */
export const SESSION_POSE_BASELINE_MIN_SAMPLES = 20;

/**
 * Acima de quantos pixels-equivalentes de deriva entre alvos o operador
 * é avisado.
 *
 * 60 px é ~1,5° na tela de referência. Não bloqueia a calibração: a deriva é
 * modelável e bloquear custaria uma sessão inteira a um usuário com ELA. Só
 * informa, e diz o que fazer a respeito.
 */
export const POSE_DRIFT_WARN_PX = 60;


/**
 * Pose de referência da SESSÃO de calibração.
 *
 * Fixada uma vez, antes do primeiro alvo, com a mediana de ~1 s de frames.
 * Todos os pontos são julgados contra ela — é o que impede que dois alvos
 * sejam coletados em posturas diferentes e o Ridge tente explicar a diferença
 * como se fosse olhar.
 */
let sessionBaselinePose: { yaw: number; pitch: number; roll: number } | null = null;
/** Buffer de poses acumulado antes do primeiro alvo. */
let sessionPoseSamples: { yaw: number; pitch: number; roll: number }[] = [];
/** Pose mediana de cada alvo concluído, na ordem de coleta. */
let sessionPoseByTarget: { yaw: number; pitch: number; roll: number }[] = [];

/**
 * Quanto a postura migrou ao longo da calibração, em graus e em pixels.
 *
 * A conversão para pixels usa o mesmo ganho geométrico do resto do módulo
 * (`d · tan(Δ)` na distância de calibração), porque grau não diz nada ao
 * operador e 150 px diz tudo.
 *
 * `trendR` é a correlação da pose com a ORDEM de coleta. Perto de ±1 significa
 * deriva postural lenta e monótona — o usuário escorregando na cadeira ao longo
 * da sessão. Perto de 0 significa movimento errático.
 */
export interface SessionPoseDrift {
  targets: number;
  yawDeg: number; pitchDeg: number; rollDeg: number;
  yawPx: number; pitchPx: number;
  trendRYaw: number; trendRPitch: number;
}

/**
 * Veredito legível sobre a deriva de pose — a forma como a UI e o log falam
 * dela. `null` quer dizer "nada a relatar", nunca "não medi".
 */
export interface VeredictoDeriva {
  /** Deriva do eixo que mais doeu, em pixels-equivalentes na tela. */
  piorEixoPx: number;
  eixo: 'yaw' | 'pitch';
  /** |r| > 0,8 contra a ordem de coleta: deriva lenta e progressiva. */
  monotona: boolean;
  /** Monótona = postura escorregando; errática = movimento. Pedem coisas
   *  diferentes do usuário, e mandar refazer uma deriva monótona só produz
   *  uma segunda calibração igualmente contaminada. */
  acao: 'apoiar-a-nuca' | 'refazer';
  mensagem: string;
}

/**
 * Traduz a deriva medida em algo que se mostra para uma pessoa. Função pura
 * porque tem DOIS consumidores que precisam concordar: o log de calibração e
 * a tela de calibração.
 */
export function avaliarDerivaDePose(
  drift: SessionPoseDrift | null,
  limiarPx: number = POSE_DRIFT_WARN_PX,
): VeredictoDeriva | null {
  if (!drift) return null;
  const eixo: 'yaw' | 'pitch' = drift.pitchPx >= drift.yawPx ? 'pitch' : 'yaw';
  const piorEixoPx = Math.max(drift.yawPx, drift.pitchPx);
  if (!(piorEixoPx > limiarPx)) return null;

  const monotona = Math.abs(drift.trendRYaw) > 0.8 || Math.abs(drift.trendRPitch) > 0.8;
  const r = eixo === 'pitch' ? drift.trendRPitch : drift.trendRYaw;
  return {
    piorEixoPx,
    eixo,
    monotona,
    acao: monotona ? 'apoiar-a-nuca' : 'refazer',
    mensagem:
      `A cabeça migrou ${piorEixoPx.toFixed(0)}px-equivalentes entre o primeiro e o último alvo. ` +
      (monotona
        ? `A deriva é monótona (r≈${r.toFixed(2)}), típica de escorregar na cadeira ao longo da ` +
          `sessão — apoiar a nuca reduz mais que refazer a calibração.`
        : `A deriva é errática — vale refazer a calibração com a cabeça apoiada.`),
  };
}

export function getSessionPoseDrift(): SessionPoseDrift | null {
  const n = sessionPoseByTarget.length;
  if (n < 2) return null;
  const amp = (pick: (p: { yaw: number; pitch: number; roll: number }) => number) => {
    const v = sessionPoseByTarget.map(pick);
    return Math.max(...v) - Math.min(...v);
  };
  // Correlação de Pearson contra o índice de coleta.
  const corr = (pick: (p: { yaw: number; pitch: number; roll: number }) => number) => {
    const y = sessionPoseByTarget.map(pick);
    const x = y.map((_, i) => i);
    const mx = x.reduce((a, b) => a + b, 0) / n;
    const my = y.reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i = 0; i < n; i++) {
      num += (x[i] - mx) * (y[i] - my); dx += (x[i] - mx) ** 2; dy += (y[i] - my) ** 2;
    }
    const den = Math.sqrt(dx * dy);
    return den > 0 ? num / den : 0;
  };
  const toDeg = (r: number) => (r * 180) / Math.PI;
  // px por radiano na distância de visão: d · tan(Δ) ≈ d · Δ para Δ pequeno.
  // A distância de calibração medida tem precedência; sem ela vale a configurada.
  const g = currentCalibrationGeometry();
  const diagPx = Math.hypot(g.screenWidthPx, g.screenHeightPx);
  const pxPerCm = g.screenDiagonalIn > 0 ? diagPx / (g.screenDiagonalIn * 2.54) : 0;
  const distCm = calibrationScreenDistanceCm ?? g.viewingDistanceCm;
  const pxPorRad = distCm * pxPerCm;
  return {
    targets: n,
    yawDeg: toDeg(amp((p) => p.yaw)),
    pitchDeg: toDeg(amp((p) => p.pitch)),
    rollDeg: toDeg(amp((p) => p.roll)),
    yawPx: amp((p) => p.yaw) * pxPorRad,
    pitchPx: amp((p) => p.pitch) * pxPorRad,
    trendRYaw: corr((p) => p.yaw),
    trendRPitch: corr((p) => p.pitch),
  };
}

/** Fixa o baseline a partir do buffer. Mediana por eixo — robusta a um frame
 *  espúrio, que a média não seria. Devolve false se não houve amostras
 *  suficientes; nesse caso o caller mantém o comportamento antigo. */
function finalizeSessionPoseBaseline(): boolean {
  if (sessionBaselinePose) return true;
  if (sessionPoseSamples.length < SESSION_POSE_BASELINE_MIN_SAMPLES) return false;
  const med = (pick: (p: { yaw: number; pitch: number; roll: number }) => number) => {
    const v = sessionPoseSamples.map(pick).sort((a, b) => a - b);
    const m = v.length >> 1;
    return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
  };
  sessionBaselinePose = { yaw: med((p) => p.yaw), pitch: med((p) => p.pitch), roll: med((p) => p.roll) };
  const deg = (r: number) => ((r * 180) / Math.PI).toFixed(1);
  console.log(
    `[calib] baseline de pose da sessão fixado com ${sessionPoseSamples.length} frames: ` +
    `yaw=${deg(sessionBaselinePose.yaw)}° pitch=${deg(sessionBaselinePose.pitch)}° roll=${deg(sessionBaselinePose.roll)}°`,
  );
  return true;
}
/** Rejeitados no ponto corrente por bloco angular do L2CS inválido (stale ou
 *  implausível). Um zero no lugar do ângulo entraria no treino como valor real. */
let l2csRejects = 0;
/** Rejeitados pelo gate de QUALIDADE de imagem no ponto corrente. Separado do
 *  contador de pose para a UI não culpar o movimento quando o problema é luz. */
let qualityRejects = 0;

/** Peso relativo de cada olho, do resíduo de treino. `null` antes de
 *  qualquer calibração, e nesse caso a fusão volta a ser média simples. */
let eyeReliability: { left: number; right: number } | null = null;

/** Campos de qualidade que o gate consulta. Lista explícita para o aviso
 *  de ausência poder nomear o que faltou. */
const QUALITY_FIELDS = [
  'irisVisibilityPercentage', 'detectorConfidence',
  'brightnessEstimate', 'contrastEstimate', 'blurEstimate',
] as const;
/** Avisa uma vez por sessão, não a 30 Hz. */
let qualityGapWarned = false;

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

export interface ResumoDoPonto {
  aceitos: number;
  porQualidade: number;
  porL2cs: number;
  necessario: number;
}

/**
 * Por que o último ponto terminou como terminou. Permite à UI distinguir pose,
 * qualidade de imagem e poucas amostras em vez de dizer "não se mova" para
 * tudo — a um paciente com ELA, quando o problema é a lâmpada.
 */
export function getResumoDoPonto(): ResumoDoPonto {
  return {
    aceitos: currentPointFramesAccepted,
    porQualidade: qualityRejects,
    porL2cs: l2csRejects,
    necessario: MIN_ACCEPTED_SAMPLES,
  };
}

export function consumeLastSampleDecision(): RecordedSampleDecision | null {
  const d = lastDecision;
  lastDecision = null;
  return d;
}

let regressorLeft: GazeRegressor | null = null;
let regressorRight: GazeRegressor | null = null;
export const featureScalerLeft = new StandardScaler();
export const featureScalerRight = new StandardScaler();

// `cameraDistanceEstimate` médio durante a calibração. Serve de
// distância de REFERÊNCIA para a correção geométrica em mapGaze. Null
// enquanto não houver calibração treinada, e null se nenhum `quality`
// dos pontos carregou o valor (compat com callers antigos).
let calibrationRefDistance: number | null = null;

// Distâncias da calibração em CENTÍMETROS, para a compensação de saída.
//
// `calibrationRefDistance` acima é o proxy `1/scale3D`, adimensional: serve
// para razões, não para a aritmética aditiva que a compensação exige (ver o
// cabeçalho de `distanceCompensation.ts` sobre por que é aditiva).
let calibrationCameraDistanceCm: number | null = null;
let calibrationScreenDistanceCm: number | null = null;

/** Registra as distâncias desta calibração, em cm. Chamado pela UI, que
 *  é quem conhece a distância medida da câmera e a configurada até a tela. */
export function setCalibrationDistancesCm(
  cameraCm: number | null,
  screenCm: number | null,
): void {
  calibrationCameraDistanceCm = cameraCm;
  calibrationScreenDistanceCm = screenCm;
}

// ── distância de calibração medida sobre os quadros ACEITOS ──────────
//
// A mediana sobre os quadros aceitos descreve o que o modelo de fato viu —
// não a postura de quem acabou de clicar "começar". Mediana e não média para
// resistir a um quadro com o rosto parcialmente ocluído, que joga o IOD para
// baixo e a distância para cima.

/** Distâncias câmera→rosto dos quadros aceitos, em cm. Uma por amostra. */
let acceptedDistancesCm: number[] = [];

/** Mediana das distâncias aceitas, ou `null` se nenhuma foi medida. */
export function measuredCalibrationDistanceCm(): number | null {
  if (acceptedDistancesCm.length === 0) return null;
  const v = [...acceptedDistancesCm].sort((a, b) => a - b);
  const m = v.length >> 1;
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/** Quantos quadros aceitos entraram na mediana. Exposto porque uma mediana de
 *  3 quadros e uma de 500 merecem confiança diferente. */
export function measuredCalibrationDistanceSamples(): number {
  return acceptedDistancesCm.length;
}

export function getCalibrationDistancesCm(): { cameraCm: number | null; screenCm: number | null } {
  return { cameraCm: calibrationCameraDistanceCm, screenCm: calibrationScreenDistanceCm };
}

// Geometria do quadro corrente e campo de visão da câmera. Estado de módulo,
// e não parâmetros de `mapGaze`: assim o teste de precisão herda a mesma
// compensação que o cursor usa.
let currentIodPx = 0;
let currentVideoWidth = 0;
let cameraFovDeg: number | null = null;

/** Campo de visão horizontal da câmera, calibrado uma vez pelo cuidador. Sem
 *  ele não há como converter tamanho de rosto em centímetros, e a compensação
 *  de distância fica inativa. */
export function setCameraFovDeg(fov: number | null): void {
  cameraFovDeg = fov;
}

/** Chamado a cada quadro pelo engine. Barato: dois números. */
export function setCurrentFrameGeometry(
  iodPx: number,
  videoWidth: number,
  // Altura e ponta do nariz. Opcionais: a estimativa de distância não
  // precisa delas.
  videoHeight?: number,
  centro?: CentroFacial | null,
): void {
  currentIodPx = iodPx;
  currentVideoWidth = videoWidth;
  latestFaceScale = iodPx > 0 && videoWidth > 0 && (videoHeight ?? 0) > 0
    ? { iodPx, videoWidth, videoHeight: videoHeight as number }
    : null;
  latestFaceCenter = centro ?? null;
}

/** Ponta do nariz e escala facial do quadro corrente. */
let latestFaceCenter: CentroFacial | null = null;
let latestFaceScale: EscalaFacial | null = null;
/** Centro facial médio das amostras que treinaram o modelo. */
let calibrationReferenceCenter: CentroFacial | null = null;

/** Densidade da tela configurada, em px por cm. A translação é 1:1 em
 *  centímetros, então é isto — e não a distância — que a converte para pixels. */
function screenPxPerCm(): number {
  const g = currentCalibrationGeometry();
  const diagPx = Math.hypot(g.screenWidthPx, g.screenHeightPx);
  return g.screenDiagonalIn > 0 ? diagPx / (g.screenDiagonalIn * 2.54) : 0;
}

// ── estado da compensação geométrica de pose ─────────────────────────

/** Pose do quadro corrente. Alimentada por `setCurrentFramePose`; `null` até o
 *  primeiro quadro com matriz facial válida. */
let latestPose: Pose | null = null;
/** Pose média das amostras que treinaram o modelo. É a referência contra a
 *  qual o desvio é medido — o mapeamento íris→tela só vale nela. */
let calibrationReferencePose: Pose | null = null;

export function setCurrentFramePose(pose: Pose | null): void {
  latestPose = pose;
}

/**
 * Distância olho→tela em PIXELS, que é a unidade em que `d · tan(Δ)` sai em px.
 *
 * Converte a distância em cm pela densidade da tela configurada. Usa a
 * distância medida na calibração quando existe, e a configurada quando não —
 * a compensação é relativa à pose de calibração, então a geometria daquele
 * momento é a coerente.
 */
function screenDistancePx(): number {
  const g = currentCalibrationGeometry();
  const diagPx = Math.hypot(g.screenWidthPx, g.screenHeightPx);
  const pxPerCm = g.screenDiagonalIn > 0 ? diagPx / (g.screenDiagonalIn * 2.54) : 0;
  const distCm = calibrationScreenDistanceCm ?? g.viewingDistanceCm;
  return distCm > 0 && pxPerCm > 0 ? distCm * pxPerCm : 0;
}

/** Distância câmera→rosto do quadro corrente, em cm. `null` sem FOV calibrado. */
export function getCurrentCameraDistanceCm(): number | null {
  return estimateDistanceCm(currentIodPx, currentVideoWidth, cameraFovDeg);
}

/**
 * Motivo pelo qual a calibração foi descartada em tempo de execução. Quando
 * preenchido, a UI deve pedir recalibração: nenhum frame futuro corrige
 * dimensão incompatível ou viewport diferente.
 */
export interface CalibrationInvalidated {
  /** `feature_dim_mismatch`: um perfil salvo sobreviveu a uma mudança de
   *  pipeline e `predictRidge` lançaria a 30 Hz para sempre.
   *  `viewport_changed`: o modelo foi treinado em pixels do viewport antigo e
   *  as predições caem deslocadas — sem virar `degraded`, porque `mapGaze`
   *  continua devolvendo valores válidos. */
  reason: 'feature_dim_mismatch' | 'viewport_changed';
  detail: string;
  at: number;
}

const invalidationListeners = new Set<(e: CalibrationInvalidated) => void>();

/** Assina o evento. Devolve a função de cancelamento. */
export function onCalibrationInvalidated(cb: (e: CalibrationInvalidated) => void): () => void {
  invalidationListeners.add(cb);
  return () => invalidationListeners.delete(cb);
}

function emitirInvalidacao(e: CalibrationInvalidated): void {
  for (const cb of invalidationListeners) {
    try {
      cb(e);
    } catch (err) {
      // Um listener que lança não pode impedir os outros de saber que a
      // calibração morreu.
      console.error('[calib] listener de invalidação lançou:', err);
    }
  }
}

/**
 * Viewport em que a calibração ativa foi treinada. `null` sem calibração.
 * Serve para detectar redimensionamento — o modelo mapeia para pixels do
 * viewport, então mudá-lo invalida a escala e o offset aprendidos.
 */
let viewportDaCalibracao: { w: number; h: number } | null = null;

/**
 * Fração de mudança do viewport tolerada antes de invalidar.
 *
 * Não é zero de propósito: barras de rolagem aparecendo/sumindo, o teclado
 * virtual do SO, e o arredondamento de `clientWidth` sob zoom fracionário
 * produzem variações de poucos pixels que não justificam descartar uma
 * calibração de 1–2 min. 2% de 1280 px são ~26 px — bem acima desse ruído e
 * bem abaixo de qualquer redimensionamento intencional.
 */
const VIEWPORT_TOLERANCIA = 0.02;

/**
 * Verifica se o viewport mudou desde a calibração e invalida se mudou.
 * Chamada pelo listener de `resize` instalado em `init()`.
 */
export function checarMudancaDeViewport(w: number, h: number): boolean {
  if (!viewportDaCalibracao) return false;
  if (!isCalibrated()) return false;
  const { w: w0, h: h0 } = viewportDaCalibracao;
  if (w0 <= 0 || h0 <= 0) return false;

  const dW = Math.abs(w - w0) / w0;
  const dH = Math.abs(h - h0) / h0;
  if (dW <= VIEWPORT_TOLERANCIA && dH <= VIEWPORT_TOLERANCIA) return false;

  const detalhe =
    `O tamanho da janela mudou de ${w0}×${h0} para ${w}×${h} depois da calibração. ` +
    `O modelo foi treinado em pixels desse viewport, então as predições ficariam ` +
    `deslocadas sem nenhum aviso visível. Recalibre.`;
  console.warn(`[calib] calibração invalidada — ${detalhe}`);
  clearCalibration();
  emitirInvalidacao({ reason: 'viewport_changed', detail: detalhe, at: Date.now() });
  return true;
}

/** Última avaliação de faixa de distância. Diagnóstico para a UI e o relatório. */
let lastDistanceRange: DistanceRange | null = null;

export function getDistanceRange(): DistanceRange | null {
  return lastDistanceRange;
}

// ---------------------------------------------------------------------------
// Estado de referência da calibração como parte do PERFIL.
//
// Pose, centro, distâncias e `eyeReliability` de referência precisam viajar
// com o modelo: só em memória, um F5 os zerava e uma troca de perfil deixava
// os do perfil anterior — a compensação de pose virava no-op e a fusão
// binocular ficava enviesada, sem aviso. Captura e restauração ficam nestas
// duas funções para que um campo novo seja mudança em UM lugar.
// ---------------------------------------------------------------------------

export type { CalibrationReferenceState };

/** Fotografa o estado de referência atual para gravar no perfil. */
export function captureReferenceStateForProfile(): CalibrationReferenceState {
  return {
    pose: calibrationReferencePose,
    center: calibrationReferenceCenter,
    cameraDistanceCm: calibrationCameraDistanceCm,
    screenDistanceCm: calibrationScreenDistanceCm,
    refDistance: calibrationRefDistance,
    eyeReliability,
    viewport: viewportDaCalibracao,
  };
}

/**
 * Reinstala o estado de referência vindo de um perfil. `null` zera tudo.
 * Estado parcial NÃO é suportado de propósito: herdar metade do perfil
 * anterior é exatamente o modo de falha a evitar.
 */
export function restoreReferenceStateFromProfile(
  ref: CalibrationReferenceState | null,
): void {
  // O viewport é o do TREINO, gravado no perfil; o listener de `resize`
  // compara contra ele. Perfis antigos sem o campo usam o atual (a chave de
  // contexto já garantiu que a resolução bate).
  viewportDaCalibracao = ref
    ? ref.viewport ?? (typeof document !== 'undefined'
        ? { w: document.documentElement.clientWidth, h: document.documentElement.clientHeight }
        : null)
    : null;
  calibrationReferencePose     = ref?.pose ?? null;
  calibrationReferenceCenter   = ref?.center ?? null;
  calibrationCameraDistanceCm  = ref?.cameraDistanceCm ?? null;
  calibrationScreenDistanceCm  = ref?.screenDistanceCm ?? null;
  calibrationRefDistance       = ref?.refDistance ?? null;
  // A confiabilidade por olho é substituída, nunca herdada: média simples é
  // neutra, peso herdado é errado E invisível.
  eyeReliability               = ref?.eyeReliability ?? null;
}

/**
 * Um perfil só é carregável se traz o estado de referência (schema v2+).
 * Perfis v1 não são migráveis — o estado de referência não é derivável dos
 * betas nem dos scalers — e carregá-los com `reference: null` deixaria a
 * compensação desligada em silêncio.
 */
export function profileTemReferencia(p: StoredCalibrationProfile): boolean {
  const r = p.reference;
  if (!r) return false;
  // Presença do objeto não basta: um `reference: {}` gravado por engano
  // passaria e reintroduziria o bug. Exigimos que as chaves existam (os
  // valores PODEM ser null — nem toda sessão mede distância, por exemplo).
  return (
    'pose' in r &&
    'center' in r &&
    'cameraDistanceCm' in r &&
    'screenDistanceCm' in r &&
    'refDistance' in r &&
    'eyeReliability' in r
  );
}

// Meta da sessão de calibração em curso. Setada por startCalibrationMode
// (default: `desconhecido`), consumida por completeCalibration para salvar o
// perfil resultante no registry por condição óptica.
let pendingProfileMeta: CalibrationProfileMeta | null = null;

/**
 * Distâncias câmera→rosto dos frames ACEITOS do ponto corrente. Zerada no
 * início de cada ponto e consumida por `processStaticPoint` para gravar a
 * mediana real do ponto.
 */
const currentPointCameraDistances: number[] = [];

/** Mediana de distância de cada ponto ACEITO da calibração. */
const acceptedPointDistances: number[] = [];

export function isCalibrated(): boolean {
  return regressorLeft !== null && regressorRight !== null;
}

/**
 * Encerra uma sessão de calibração em curso SEM treinar (sair da tela no meio
 * da coleta não pode prender o app em `calibrating`).
 *
 * Derruba TODO o estado de coleta, inclusive o timeout duro do ponto corrente
 * — que, se sobrevivesse, chamaria o callback de um componente desmontado.
 * Não toca no modelo treinado: quem quer descartá-lo chama `clearCalibration()`.
 */
export function abortCalibration(): void {
  if (collectionTimeoutHandle !== null) {
    clearTimeout(collectionTimeoutHandle);
    collectionTimeoutHandle = null;
  }
  const estavaAtiva = isCalibrating || isCollecting;

  isCalibrating = false;
  isCollecting = false;
  pointCompleteCallback = null;
  currentCalibrationMode = null;
  currentCalibrationTargets = null;

  // Buffers do ponto em curso.
  collectedFeaturesLeft = [];
  collectedFeaturesRight = [];
  collectedQualities = [];
  collectionStartTime = 0;
  lastDecision = null;

  // Contadores e baselines por ponto/sessão: sem isto, a próxima calibração
  // herdaria o baseline de pose e os contadores de gate da sessão abortada.
  currentPointSpecularHits = 0;
  currentPointFramesAccepted = 0;
  l2csRejects = 0;
  qualityRejects = 0;
  sessionBaselinePose = null;
  sessionPoseSamples = [];
  sessionPoseByTarget = [];

  if (estavaAtiva) {
    console.log('[calib] calibração abortada — estado de coleta limpo');
  }
}

export function clearCalibration() {
  abortCalibration();
  profile = [];
  regressorLeft = null;
  regressorRight = null;
  varianceFloorBreaches = 0;
  varianceCeilBreaches = 0;
  currentPointSpecularHits = 0;
  currentPointFramesAccepted = 0;
  specularWarningsIssued = 0;
  pendingProfileMeta = null;
  currentCalibrationTargets = null;
  // A referência do modelo descartado não pode sobreviver a ele.
  restoreReferenceStateFromProfile(null);
}

export function getSampleCount(): number {
  return profile.length;
}

export function getCurrentLambda(): number {
  // λ do olho esquerdo; `getLambdaDiagnostics()` dá os dois e a disparidade.
  const diag = getLambdaDiagnostics();
  return diag?.left ?? 0;
}

// Diagnóstico de regularização. Uma razão λ_max/λ_min > 10 entre os
// dois olhos indica que o CV está detectando dado ruim em pelo menos um dos
// lados. nearSingular* revela colunas do vetor de features que degeneram no
// treino.
export interface LambdaDiagnostics {
  left: number;
  right: number;
  ratio: number;                  // max(l,r) / max(min(l,r), 1e-12)
  nearSingularLeft: number[];
  nearSingularRight: number[];
}

export function getLambdaDiagnostics(): LambdaDiagnostics | null {
  const modelL = regressorLeft ? ridgeModelFromRegressor(regressorLeft) : null;
  const modelR = regressorRight ? ridgeModelFromRegressor(regressorRight) : null;
  if (!modelL || !modelR) return null;
  const left = modelL.lambda ?? 0;
  const right = modelR.lambda ?? 0;
  const lo = Math.max(Math.min(left, right), 1e-12);
  const ratio = Math.max(left, right) / lo;
  return {
    left,
    right,
    ratio,
    nearSingularLeft: modelL.nearSingularCols ?? [],
    nearSingularRight: modelR.nearSingularCols ?? [],
  };
}

// Persistência de perfis de calibração.
//
// Por que localStorage e não IndexedDB: os perfis são pequenos (~30-50 KB
// de modelos Ridge + scalers + metadados) e o acesso síncrono do localStorage
// simplifica a integração com `init()` que precisa restaurar antes do primeiro
// frame. IndexedDB seria melhor para múltiplos perfis grandes; se isso virar
// problema, migramos o storage sem mudar a API.
//
// Invalidação:
//   - `featureDim` diferente → pipeline mudou (nova versão)
//   - `screenW`/`screenH` diferente → Ridge mapeia para pixel; tela diferente
//     desloca sistematicamente todas as predições
//   - `videoW`/`videoH` diferente → aspecto do crop mudou
//   - `experimentId` diferente → flags mudaram (isotropicLandmarks etc.)
//   - `createdAt` > 24 h → oferece revalidação, não bloqueia

// Chave versionada. A redução do vetor de 44 para 12 dims (ver
// `ACTIVE_FEATURE_SET` em extractor.ts) torna todo perfil anterior
// incompatível: `predictRidge` lançaria por dimensão divergente e o
// `mapGaze` cairia em null a 30 Hz. Trocar a chave descarta os antigos de
// forma limpa, em vez de depender do erro em tempo de inferência.
const PROFILES_STORAGE_KEY = 'irisflow.calib.profiles.v2';
const PROFILES_MAX_AGE_MS = 24 * 60 * 60 * 1000;

/**
 * Tudo que precisa bater para um perfil salvo poder ser reaproveitado.
 * O viewport entra porque a geometria de treino é medida nele; as flags
 * entram porque mudam a dimensão ou o significado das
 * features (`expandFactor` muda os valores de tan yaw/pitch sem mudar a
 * dimensão — o perfil carregaria e prediria errado sem nenhum erro).
 */
export interface CalibrationContext {
  viewportW: number;
  viewportH: number;
  featureVectorId: string;
  formatVersion: number;
  polynomialFeatures: boolean;
  geometricPoseCompensation: boolean;
  expandFactor: number;
}

export function buildContextKeyFrom(ctx: CalibrationContext): string {
  const expKey = [
    ctx.polynomialFeatures ? 'poly' : '',
    ctx.geometricPoseCompensation ? 'posecomp' : '',
    `xf${ctx.expandFactor}`,
  ].filter(Boolean).join(',');
  return `${ctx.viewportW}x${ctx.viewportH}_${ctx.featureVectorId}_v${ctx.formatVersion}_${expKey}`;
}

function buildContextKey(): string {
  const doc = typeof document !== 'undefined' ? document.documentElement : null;
  return buildContextKeyFrom({
    viewportW: doc?.clientWidth ?? 0,
    viewportH: doc?.clientHeight ?? 0,
    featureVectorId: FEATURE_VECTOR_ID,
    formatVersion: FEATURE_FORMAT_VERSION,
    polynomialFeatures: EXPERIMENT.polynomialFeatures,
    geometricPoseCompensation: EXPERIMENT.geometricPoseCompensation,
    expandFactor: EXPERIMENT.expandFactor,
  });
}

function tryParseStoredProfiles(): StoredCalibrationProfile[] {
  if (typeof localStorage === 'undefined') return [];
  try {
    const raw = localStorage.getItem(PROFILES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed as StoredCalibrationProfile[];
  } catch {
    return [];
  }
}

export function loadProfile(): boolean {
  // Tenta restaurar o perfil mais recente válido do localStorage.
  regressorLeft = null;
  regressorRight = null;

  const profiles = tryParseStoredProfiles();
  if (profiles.length === 0) return false;

  const contextKey = buildContextKey();
  const nowMs = Date.now();

  // Filtra e ordena por data (mais recente primeiro)
  const valid = profiles
    .filter(p => {
      // Entrada malformada (sem `meta`, sem modelos): um perfil antigo ou um
      // JSON editado à mão não pode derrubar o `init()` do engine.
      if (!p || typeof p !== 'object' || !p.meta || typeof p.meta.id !== 'string'
        || !p.modelLeft || !p.modelRight || !p.scalerParamsLeft || !p.scalerParamsRight) {
        console.warn('[calib] perfil salvo malformado — ignorado');
        return false;
      }
      // Validação de contexto: tela ou pipeline diferente → incompatível
      const chave = p.contextKey ?? (p as unknown as Record<string, unknown>)._contextKey;
      if (chave !== contextKey) {
        console.warn(`[calib] perfil ${p.meta.id} incompatível (contexto diferente) — ignorado`);
        return false;
      }
      // Perfil de schema antigo (sem estado de referência) é INVALIDADO, não
      // carregado com null — ver `profileTemReferencia`.
      if (!profileTemReferencia(p)) {
        console.warn(
          `[calib] perfil ${p.meta.id} é de schema anterior a v${PROFILE_SCHEMA_VERSION} ` +
          `(sem estado de referência de calibração) — descartado. ` +
          `Recalibre: sem a pose/centro/distância de referência a compensação ` +
          `geométrica não teria contra o que comparar e ficaria inativa sem aviso.`
        );
        return false;
      }
      return true;
    })
    .sort((a, b) => new Date(b.meta.createdAt).getTime() - new Date(a.meta.createdAt).getTime());

  if (valid.length === 0) return false;

  const best = valid[0];
  const age = nowMs - new Date(best.meta.createdAt).getTime();
  if (age > PROFILES_MAX_AGE_MS) {
    console.warn(`[calib] perfil ${best.meta.id} tem ${Math.round(age / 3600000)} h — mais antigo que 24 h. Recomendado recalibrar.`);
    // Não bloqueia: oferecer revalidação, não bloqueio.
  }

  try {
    // Restaura o perfil no registry e os regressors em memória
    profileRegistry.save(best);
    const reloadedLeft = ridgeRegressorFromModel(best.modelLeft);
    const reloadedRight = ridgeRegressorFromModel(best.modelRight);
    if (!reloadedLeft || !reloadedRight) return false;
    regressorLeft = reloadedLeft;
    regressorRight = reloadedRight;
    featureScalerLeft.setParams(best.scalerParamsLeft.means, best.scalerParamsLeft.stds);
    featureScalerRight.setParams(best.scalerParamsRight.means, best.scalerParamsRight.stds);
    // O filtro acima garante que `best.reference` existe.
    restoreReferenceStateFromProfile(best.reference ?? null);
    console.log(
      `[calib] perfil restaurado: ${best.meta.label} (${best.meta.opticalCondition}), ` +
      `${age > PROFILES_MAX_AGE_MS ? '>24h' : 'válido'} — ` +
      `pose ref ${best.reference?.pose ? 'presente' : 'ausente'}, ` +
      `confiabilidade ${best.reference?.eyeReliability ? 'presente' : 'ausente'}`
    );
    return true;
  } catch (e) {
    console.warn('[calib] falha ao restaurar perfil:', e);
    regressorLeft = null;
    regressorRight = null;
    // Estado parcial é pior que nenhum: um modelo que falhou ao carregar não
    // pode deixar a referência do perfil anterior em pé.
    restoreReferenceStateFromProfile(null);
    return false;
  }
}

function saveProfile() {
  // Persiste todos os perfis do registry no localStorage.
  // Chamado após `persistActiveProfileToRegistry` em `completeCalibration`.
  if (typeof localStorage === 'undefined') return;
  try {
    const all = profileRegistry.list();
    // Cada perfil guarda a chave do contexto em que FOI treinado; recarimbar
    // com a chave atual faria um perfil de outro viewport renascer compatível.
    const profiles = all.map(entry => profileRegistry.get(entry.meta.id)!);
    // Mantém no máximo 5 perfis para não estourar o localStorage
    const latest = profiles
      .sort((a, b) => new Date(b.meta.createdAt).getTime() - new Date(a.meta.createdAt).getTime())
      .slice(0, 5);
    localStorage.setItem(PROFILES_STORAGE_KEY, JSON.stringify(latest));
    console.log(`[calib] ${latest.length} perfil(s) salvo(s) no localStorage`);
  } catch (e) {
    console.warn('[calib] falha ao salvar perfis:', e);
  }
}

// ── Headless Calibration API ──────────────────────────────────────────────────

// Coordenadas dos alvos de calibração, exportadas para a UI consumir a MESMA
// lista canônica. Cada entrada é fração da tela [0..1]. O modo rápido usa
// APENAS os 4 cantos: dão exatamente 4 restrições independentes na média
// binocular, o mínimo para estimar bias + escala em x e y sem singularidade.
//
// ── Orçamento de excentricidade angular dos alvos ──────────────────────────
//
// Medido numa sessão de referência (1920×1080, 23,6", 60 cm): decompondo os
// pares ground-truth → predito num mapa afim, 79% do erro era ganho coerente,
// com ganho X = 1,294 e ganho Y = 0,930. Um modelo LINEAR só aprende ganho
// > 1 se o olhar registrado nos alvos percorreu menos que a distância
// nominal: é hipometria com a cabeça parada. Traduzindo para ângulo, até
// ~12,4° o olho entrega o que se pede; a 21,4° (os alvos horizontais em
// 5%/95%) entrega 77%. Como o modelo é global, o erro contamina a tela
// inteira.
//
// A correção é derivar a posição dos alvos de um orçamento de excentricidade
// em vez de uma fração fixa da tela: troca-se ~14% de extrapolação nas bordas
// (barata — o mapeamento é quase linear) por 22% de erro de ganho em TODA a
// tela. Na tela de referência, 16° põe os alvos horizontais em ~17%/83% e
// mantém os verticais em 5%/95%. Numa 15,6", onde 5%/95% já exige só 14,5°,
// o orçamento não morde.
//
// 16° foi escolhido por varredura no simulador de regiões
// (`calibration.regions.test.ts`): minimiza o erro nas regiões que o app de
// fato usa (`GazeGrid` nunca põe alvo a menos de ~17% da borda). 12°–14° dão
// erro menor na grade do teste de precisão, mas otimizar para a métrica
// exibida em vez do uso real deixaria o número bonito e o app pior. Abaixo de
// ~16° a amplitude do sinal de olhar encolhe e o ruído passa a custar mais
// que a hipometria economizada.
//
// LIMITE: a curva de hipometria foi ajustada com DOIS pontos de UMA sessão.
// A direção é sustentada pela física e pela assimetria X/Y medida, mas o
// ótimo exato precisa de re-medição — usuários com ELA/oftalmoparesia podem
// precisar de menos. Por isso é constante nomeada e `geometry.maxEccentricityDeg`.
export const MAX_ECCENTRICITY_DEG = 16;

/** Geometria física necessária para converter graus em fração de tela. */
export interface CalibrationGeometry {
  screenWidthPx: number;
  screenHeightPx: number;
  /** Diagonal física do monitor em polegadas. */
  screenDiagonalIn: number;
  /** Distância olho→tela em cm. */
  viewingDistanceCm: number;
  /** Excentricidade máxima admitida, em graus. */
  maxEccentricityDeg?: number;
}

// Fallback quando o caller não passa geometria. Em produção quem manda é
// `settings.screenDiagonalIn` / `settings.viewingDistanceCm` (persistidas em
// SettingsContext, editáveis em Configurações → Teste de precisão), que também
// alimentam o `RunMeta` do relatório — uma fonte só para o erro angular e para
// a posição dos alvos.
//
// Estes defaults descrevem o posto de uso de referência (23,6" a 60 cm), não
// uma tela genérica. Errar a diagonal não é cosmético: com 15,6" configurado
// numa tela de 23,6", `meanErrorDeg` sai 34% MENOR que o real.
export const DEFAULT_SCREEN_DIAGONAL_IN = 23.6;
export const DEFAULT_VIEWING_DISTANCE_CM = 60;

// Fração da tela medida a partir do centro. O teto 0,45 reproduz os alvos em
// 5%/95% quando a tela inteira já cabe no orçamento angular; o piso 0,22 evita
// que uma geometria absurda (tela gigante, distância mal digitada) colapse os
// alvos em cima do centro e destrua o condicionamento do Ridge.
const MIN_EXTENT_FRACTION = 0.22;
const MAX_EXTENT_FRACTION = 0.45;

/**
 * Fração da tela (a partir do centro) em que o alvo deve ficar para que a
 * excentricidade angular exigida do olho não passe de `maxDeg`.
 * Função pura — `sizePx`/`pxPerCm` descrevem o eixo sendo calculado.
 */
export function eccentricityExtentFraction(
  sizePx: number,
  pxPerCm: number,
  viewingDistanceCm: number,
  maxDeg: number,
): number {
  if (!(sizePx > 0) || !(pxPerCm > 0) || !(viewingDistanceCm > 0) || !(maxDeg > 0)) {
    return MAX_EXTENT_FRACTION;
  }
  const halfSizeCm = sizePx / pxPerCm / 2;
  if (!(halfSizeCm > 0)) return MAX_EXTENT_FRACTION;
  const budgetCm = viewingDistanceCm * Math.tan((maxDeg * Math.PI) / 180);
  // Fração da SEMI-tela que o orçamento cobre → fração da tela inteira.
  const fraction = (budgetCm / halfSizeCm) * 0.5;
  if (!Number.isFinite(fraction)) return MAX_EXTENT_FRACTION;
  return Math.min(MAX_EXTENT_FRACTION, Math.max(MIN_EXTENT_FRACTION, fraction));
}

/**
 * Grade 3×3 (full) ou 4 cantos (quick) posicionada dentro do orçamento de
 * excentricidade. Pura e determinística — é o que o teste de regiões usa.
 */
export function computeCalibrationTargets(
  geometry: CalibrationGeometry,
  quick = false,
): { x: number; y: number }[] {
  const { screenWidthPx, screenHeightPx, screenDiagonalIn, viewingDistanceCm } = geometry;
  const maxDeg = geometry.maxEccentricityDeg ?? MAX_ECCENTRICITY_DEG;
  const diagPx = Math.hypot(screenWidthPx, screenHeightPx);
  const pxPerCm = screenDiagonalIn > 0 ? diagPx / (screenDiagonalIn * 2.54) : 0;

  const ex = eccentricityExtentFraction(screenWidthPx, pxPerCm, viewingDistanceCm, maxDeg);
  const ey = eccentricityExtentFraction(screenHeightPx, pxPerCm, viewingDistanceCm, maxDeg);

  const xs = [0.5 - ex, 0.5, 0.5 + ex];
  const ys = [0.5 - ey, 0.5, 0.5 + ey];

  if (quick) {
    return [
      { x: xs[0], y: ys[0] }, { x: xs[2], y: ys[0] },
      { x: xs[0], y: ys[2] }, { x: xs[2], y: ys[2] },
    ];
  }
  const out: { x: number; y: number }[] = [];
  for (const y of ys) for (const x of xs) out.push({ x, y });
  return out;
}

/**
 * Geometria física da sessão em curso. `null` até alguém informá-la.
 *
 * Precisa ser estado de módulo, e não local de `startCalibrationMode`:
 * `screenDistancePx()` e `screenPxPerCm()` estão no caminho quente de TODO
 * `mapGaze` (compensação de pose), e com os defaults de 23,6"/60 cm numa
 * tela de 27" o deslocamento `d·tan(Δ)` era super-aplicado em ~14%. Deriva
 * de pose é a maior fonte de erro do pipeline (em ELA a fraqueza cervical
 * torna a deriva MAIS provável), então a densidade de tela errada aqui custa
 * caro.
 */
let sessionGeometry: Partial<CalibrationGeometry> | null = null;

/**
 * Informa a geometria física da sessão.
 *
 * Chamada por `startCalibrationMode`, e exposta para que a UI possa atualizá-la
 * quando o cuidador corrigir a diagonal sem recalibrar.
 *
 * `null` limpa e volta aos defaults — usado pelos testes para isolamento.
 */
export function setSessionGeometry(g: Partial<CalibrationGeometry> | null): void {
  sessionGeometry = g;
}

export function currentCalibrationGeometry(
  overrides?: Partial<CalibrationGeometry>,
): CalibrationGeometry {
  const hasDom = typeof document !== 'undefined' && !!document.documentElement;
  return {
    screenWidthPx: hasDom ? document.documentElement.clientWidth || 1920 : 1920,
    screenHeightPx: hasDom ? document.documentElement.clientHeight || 1080 : 1080,
    screenDiagonalIn: DEFAULT_SCREEN_DIAGONAL_IN,
    viewingDistanceCm: DEFAULT_VIEWING_DISTANCE_CM,
    maxEccentricityDeg: MAX_ECCENTRICITY_DEG,
    // A da sessão vence os defaults; um `overrides` explícito vence tudo.
    ...(sessionGeometry ?? {}),
    ...overrides,
  };
}

// Listas nominais (geometria default) — exportadas porque a UI e os testes as
// consomem para desenhar/afirmar a grade antes de qualquer sessão começar.
// Durante uma calibração real vale `getCalibrationTargets()`, que devolve a
// grade calculada para a tela em uso.
export const CALIBRATION_TARGETS_FULL: readonly { x: number; y: number }[] =
  computeCalibrationTargets(currentCalibrationGeometry(), false);
export const CALIBRATION_TARGETS_QUICK: readonly { x: number; y: number }[] =
  computeCalibrationTargets(currentCalibrationGeometry(), true);

// Modo em execução. `null` quando não está calibrando.
let currentCalibrationMode: 'full' | 'quick' | null = null;
// Grade calculada para a tela/geometria da sessão em curso. `null` fora
// de uma calibração; nesse caso `getCalibrationTargets` devolve a lista
// nominal, que é o que a UI precisa para desenhar o tutorial.
let currentCalibrationTargets: readonly { x: number; y: number }[] | null = null;

export function getCalibrationMode(): 'full' | 'quick' | null {
  return currentCalibrationMode;
}

/** Alvos ativos para a sessão de calibração em curso. Se nenhuma calibração
 *  está ativa, retorna a lista nominal (default histórico) — útil para a UI
 *  renderizar a grade antes de decidir o modo. */
export function getCalibrationTargets(): readonly { x: number; y: number }[] {
  if (currentCalibrationTargets) return currentCalibrationTargets;
  return currentCalibrationMode === 'quick'
    ? CALIBRATION_TARGETS_QUICK
    : CALIBRATION_TARGETS_FULL;
}

export function startCalibrationMode(
  opts?: {
    opticalCondition?: OpticalCondition;
    label?: string;
    quick?: boolean;
    /** Geometria física da tela/usuário. Quando o cuidador tiver
     *  configurado diagonal e distância reais, a UI passa aqui e a grade se
     *  ajusta; sem isso, valem os defaults. */
    geometry?: Partial<CalibrationGeometry>;
  },
) {
  // O limiar adaptativo de piscada não pode vir enviesado de sessões anteriores.
  resetEarHistory();

  isCalibrating = true;

  // Zera a coleta de uma calibração abandonada: com `isCollecting` ligado,
  // `feedRawData` acumularia amostras contra o alvo ANTIGO e o timeout
  // pendente chamaria o callback de uma sessão que já não existe.
  isCollecting = false;
  if (collectionTimeoutHandle !== null) {
    clearTimeout(collectionTimeoutHandle);
    collectionTimeoutHandle = null;
  }

  // O baseline pertence à SESSÃO; recomeçar a calibração recomeça ele.
  sessionBaselinePose = null;
  sessionPoseSamples = [];
  sessionPoseByTarget = [];
  calibrationReferencePose = null;
  calibrationReferenceCenter = null;
  acceptedDistancesCm = [];
  eyeReliability = null;
  qualityGapWarned = false;
  profile = [];
  regressorLeft = null;
  regressorRight = null;
  varianceFloorBreaches = 0;
  varianceCeilBreaches = 0;
  currentPointSpecularHits = 0;
  currentPointFramesAccepted = 0;
  specularWarningsIssued = 0;

  // Modo ativo. Consulta pública via getCalibrationTargets() para a UI
  // renderizar 4 cantos (quick) ou grade 3×3 (full). Comportamento default
  // permanece 'full' quando `quick` não é passado.
  currentCalibrationMode = opts?.quick ? 'quick' : 'full';
  if (currentCalibrationMode === 'quick') {
    // 4 alvos restringem pouco os termos de ordem alta; o CV de λ compensa
    // com regularização mais forte se detectar overfit.
    console.log('[calib] Modo RÁPIDO — 4 cantos, sem termos quadráticos garantidos.');
  }

  // Grade posicionada pelo orçamento de excentricidade da tela em uso, e
  // registrada na sessão para a compensação de pose usar a mesma geometria.
  if (opts?.geometry) setSessionGeometry(opts.geometry);
  const geometry = currentCalibrationGeometry(opts?.geometry);
  currentCalibrationTargets = computeCalibrationTargets(
    geometry,
    currentCalibrationMode === 'quick',
  );
  const exPct = ((0.5 - currentCalibrationTargets[0].x) * 100).toFixed(1);
  const eyPct = ((0.5 - currentCalibrationTargets[0].y) * 100).toFixed(1);
  console.log(
    `[calib] Alvos — orçamento ${geometry.maxEccentricityDeg}° em ` +
    `${geometry.screenDiagonalIn}" a ${geometry.viewingDistanceCm} cm → ` +
    `±${exPct}% em X, ±${eyPct}% em Y (a partir do centro).`,
  );

  // Meta para o perfil que resultar desta calibração.
  const cond: OpticalCondition = opts?.opticalCondition ?? 'desconhecido';
  pendingProfileMeta = profileRegistry.createMeta({
    opticalCondition: cond,
    label: opts?.label,
  });
  if (shouldWarnPrecisionForCondition(cond)) {
    console.warn(
      `[calib] Condição óptica '${cond}' registrada. Progressivas refratam de forma ` +
      `dependente da região da lente pela qual o usuário olha — nenhum modelo linear ` +
      `global compensa. Não prometer a mesma precisão de outras condições.`,
    );
  }
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

  // Fixa o baseline de pose da sessão no primeiro alvo, a partir dos
  // frames acumulados durante a janela de preparo da UI. Se não houver frames
  // suficientes, segue sem ele e o gate cai no comportamento por ponto.
  if (!sessionBaselinePose && !finalizeSessionPoseBaseline()) {
    console.warn(
      `[calib] baseline de pose da sessão não fixado ` +
      `(${sessionPoseSamples.length}/${SESSION_POSE_BASELINE_MIN_SAMPLES} frames). ` +
      `Deriva entre alvos volta a ser invisível nesta calibração.`,
    );
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
  l2csRejects = 0;
  qualityRejects = 0;
  currentPointSpecularHits = 0;
  currentPointFramesAccepted = 0;
  currentPointCameraDistances.length = 0;

  const totalMs = duracaoTotalDoPonto(currentCollectionMs);
  console.log(
    `[calib] ▶ Coletando ponto (${(x * 100).toFixed(0)}%, ${(y * 100).toFixed(0)}%) — ` +
    `${CALIBRATION_ACCLIMATION_MS}ms de acomodação + ${currentCollectionMs}ms de coleta útil ` +
    `(${totalMs}ms no total)`,
  );

  // Timeout duro: se `feedRawData` nunca fechar o ponto (todos os frames
  // rejeitados, rosto ausente), força `processStaticPoint` após a duração
  // TOTAL (acomodação + coleta) mais 800 ms de folga.
  collectionTimeoutHandle = setTimeout(() => {
    collectionTimeoutHandle = null;
    if (isCollecting) {
      console.warn(`[calib] ⏱ Timeout! isCollecting ainda true após ${totalMs + 800}ms. Amostras coletadas: ${collectedFeaturesLeft.length}`);
      isCollecting = false;
      processStaticPoint();
    }
  }, totalMs + 800);
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

// Variância ENTRE alvos (não dentro do alvo). Para cada dimensão de
// feature, tira a média por alvo (agrupando amostras do mesmo screenX/screenY)
// e mede quanto essa média varia entre os alvos. Dimensões com variância
// entre-alvos ~ 0 não carregam informação de olhar — o modelo linear não
// consegue diferenciar "olhar aqui" de "olhar ali" olhando pra elas.
//
// Retorna { deadCount, totalDims, deadIndices }. Chamador decide o corte
// (DEAD_FEATURE_MAX_RATIO). Mede sobre um único array de features/targets;
// para binocular, chame duas vezes (L e R).
export function countDeadFeatures(
  features: number[][],
  targets: { screenX: number; screenY: number }[],
  eps = DEAD_FEATURE_VARIANCE_EPS,
): { deadCount: number; totalDims: number; deadIndices: number[] } {
  if (features.length === 0 || targets.length !== features.length) {
    return { deadCount: 0, totalDims: 0, deadIndices: [] };
  }
  const numDims = features[0].length;

  // Agrupa índices por (screenX, screenY) arredondado — mesmo scheme do CV
  // em ridge.ts (evita agrupamentos incorretos por drift de ponto flutuante).
  const groups = new Map<string, number[]>();
  for (let i = 0; i < targets.length; i++) {
    const key = `${targets[i].screenX.toFixed(4)},${targets[i].screenY.toFixed(4)}`;
    let g = groups.get(key);
    if (!g) { g = []; groups.set(key, g); }
    g.push(i);
  }
  const uniqueTargets = groups.size;
  if (uniqueTargets < 2) {
    // Precisa de pelo menos 2 alvos distintos para haver "variância entre alvos".
    return { deadCount: 0, totalDims: numDims, deadIndices: [] };
  }

  // Média por alvo, dimensão a dimensão
  const perTargetMeans: number[][] = [];
  for (const idxs of groups.values()) {
    const mean = new Array<number>(numDims).fill(0);
    for (const i of idxs) {
      const f = features[i];
      for (let d = 0; d < numDims; d++) mean[d] += f[d];
    }
    for (let d = 0; d < numDims; d++) mean[d] /= idxs.length;
    perTargetMeans.push(mean);
  }

  // Variância das médias por alvo, por dimensão
  const deadIndices: number[] = [];
  for (let d = 0; d < numDims; d++) {
    let sum = 0;
    for (const m of perTargetMeans) sum += m[d];
    const grandMean = sum / perTargetMeans.length;
    let sumSq = 0;
    for (const m of perTargetMeans) {
      const diff = m[d] - grandMean;
      sumSq += diff * diff;
    }
    const varBetween = sumSq / (perTargetMeans.length - 1);
    if (varBetween < eps) deadIndices.push(d);
  }

  return { deadCount: deadIndices.length, totalDims: numDims, deadIndices };
}

export function feedRawData(featuresLeft: number[], featuresRight: number[], quality?: any | null) {
  if (!isCalibrating || !isCollecting) {
    // A janela entre `startCalibrationMode` e o primeiro alvo (a UI espera
    // PREPARE_MS ali) é onde o baseline de pose da sessão é montado. Sem isto o
    // baseline só poderia sair do primeiro frame do primeiro ponto, que é
    // exatamente o que se quer evitar: um único frame como referência.
    if (isCalibrating && !sessionBaselinePose && quality
      && typeof quality.yaw === 'number' && typeof quality.pitch === 'number' && typeof quality.roll === 'number') {
      sessionPoseSamples.push({ yaw: quality.yaw, pitch: quality.pitch, roll: quality.roll });
      if (sessionPoseSamples.length > 120) sessionPoseSamples.shift();
    }
    lastDecision = { accepted: false, elapsedMs: 0, reason: 'not_collecting' };
    return;
  }

  const elapsed = performance.now() - collectionStartTime;

  // Descarta a fase de sacada / acomodação.
  if (elapsed < CALIBRATION_ACCLIMATION_MS) {
    lastDecision = { accepted: false, elapsedMs: elapsed, reason: 'acclimation' };
    return;
  }

  // Filtros de qualidade sobre valores medidos no crop dos olhos por
  // `EyeQualityAnalyzer`. Medido: nenhum destes critérios dispara em uso
  // normal — o gate só pega falha catastrófica (câmera tapada, escuro total).
  //
  // Limiares e a intenção de cada um:
  //   - detectorConfidence < 0.4 → landmarks muito instáveis (movimento brusco)
  //   - brightness  < 0.08       → região do olho quase preta (câmera obstruída
  //                                ou usuário no escuro total)
  //   - brightness  > 0.92       → over-exposto (contraluz forte)
  //   - contrast    < 0.02       → imagem sem estrutura (borrão total)
  //   - blur        > 0.85       → foco perdido / rosto muito distante
  //   - irisVisibilityPercentage < 0.3 → pálpebra semi-fechada / piscada
  if (quality) {
    // Cada critério só vale se o valor foi MEDIDO (`undefined < 0.3` é false
    // e passaria em silêncio). Quando a medida falta o quadro é ACEITO e o
    // console avisa uma vez: rejeitar tudo deixaria o app inutilizável num
    // browser com canvas tainted, e o público-alvo não tem como contornar.
    const medido = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
    const ausentes = QUALITY_FIELDS.filter((k) => !medido(quality[k]));
    if (ausentes.length > 0 && !qualityGapWarned) {
      qualityGapWarned = true;
      console.warn(
        `[calib] qualidade não medida: ${ausentes.join(', ')}. ` +
        `Estes critérios do gate ficam INATIVOS nesta sessão; os quadros são aceitos ` +
        `sem eles. Causa provável: canvas sem contexto 2d ou crop ocular degenerado.`,
      );
    }
    if (
      (medido(quality.irisVisibilityPercentage) && quality.irisVisibilityPercentage < 0.3) ||
      (medido(quality.detectorConfidence) && quality.detectorConfidence < 0.4) ||
      (medido(quality.brightnessEstimate) && (quality.brightnessEstimate < 0.08 || quality.brightnessEstimate > 0.92)) ||
      (medido(quality.contrastEstimate) && quality.contrastEstimate < 0.02) ||
      (medido(quality.blurEstimate) && quality.blurEstimate > 0.85)
    ) {
      qualityRejects++;
      lastDecision = { accepted: false, elapsedMs: elapsed, reason: 'quality' };
      return;
    }
  }

  // Bloco angular inválido (L2CS stale ou implausível) chega como zeros. Um
  // zero não é "sem informação" depois do StandardScaler: vira um z-score
  // grande que diz "olhar para o centro" num alvo periférico. Quando o
  // conjunto ativo carrega o bloco, a amostra é rejeitada.
  if (L2CS_SLOTS.length > 0 && L2CS_SLOTS.every((i) => featuresLeft[i] === 0 && featuresRight[i] === 0)) {
    l2csRejects++;
    lastDecision = { accepted: false, elapsedMs: elapsed, reason: 'l2cs_invalid' };
    return;
  }

  collectedFeaturesLeft.push(featuresLeft);
  collectedFeaturesRight.push(featuresRight);
  collectedQualities.push(quality ?? null);

  // Contagem de frames com reflexo especular alto. Não rejeita nada;
  // só acumula para o sumário do ponto avisar.
  currentPointFramesAccepted++;
  if (quality && typeof quality.specularRatio === 'number' && quality.specularRatio > SPECULAR_FRAME_THRESHOLD) {
    currentPointSpecularHits++;
  }

  lastDecision = { accepted: true, elapsedMs: elapsed };

  // Acumula a distância dos frames EFETIVAMENTE ACEITOS — não do último frame
  // visto no fim do ponto, que pode ser um rejeitado.
  {
    const d = getCurrentCameraDistanceCm();
    if (d !== null && Number.isFinite(d)) currentPointCameraDistances.push(d);
  }

  // A coleta para depois da acomodação MAIS a janela útil, para o tempo de
  // coleta prometido ser o tempo de coleta entregue.
  if (elapsed >= duracaoTotalDoPonto(currentCollectionMs)) {
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
    `[calib] processStaticPoint — amostras: ${collectedFeaturesLeft.length} | rejeitados: qualidade=${qualityRejects} l2cs=${l2csRejects}`,
  );

  // Sem nenhuma amostra (rosto ausente, tudo rejeitado pelo gate): falha para
  // a UI repetir o ponto.
  if (collectedFeaturesLeft.length === 0) {
    console.warn('[calib] ✗ Nenhuma amostra coletada — rosto ausente ou qualidade insuficiente.');
    const cb = pointCompleteCallback;
    pointCompleteCallback = null;
    if (cb) cb(false);
    return;
  }

  const avgVarLeft = calculateFeatureVariance(collectedFeaturesLeft);
  const avgVarRight = calculateFeatureVariance(collectedFeaturesRight);
  // Boa parte das dimensões é compartilhada entre os dois olhos (pose de
  // cabeça), então avgVarLeft ≈ avgVarRight. Não é bug; o gate usa a média.
  const avgVar = (avgVarLeft + avgVarRight) / 2;

  console.log(
    `[calib] Variância intra-ponto: L=${avgVarLeft.toFixed(6)} R=${avgVarRight.toFixed(6)} avg=${avgVar.toFixed(6)} ` +
    `(faixa [${INTRA_POINT_VARIANCE_FLOOR}, ${INTRA_POINT_VARIANCE_CEIL}])`,
  );

  // Reflexo especular persistente no ponto. Só avisa (não bloqueia): se o
  // primeiro ponto já dispara, mudar a posição da tela vale mais que
  // continuar. Os contadores de diagnóstico só são incrementados quando o
  // ponto é ACEITO (ver após o gate de `MIN_ACCEPTED_SAMPLES`); aqui apenas
  // registramos o veredito desta tentativa.
  let esteAttemptTeveSpecular = false;
  let esteAttemptTeveVarianciaBaixa = false;
  let esteAttemptTeveVarianciaAlta = false;

  if (currentPointFramesAccepted > 0) {
    const specularPct = currentPointSpecularHits / currentPointFramesAccepted;
    if (specularPct > SPECULAR_PERSISTENCE) {
      esteAttemptTeveSpecular = true;
      console.warn(
        `[calib] ⚠ Reflexo especular persistente no crop ocular: ` +
        `${currentPointSpecularHits}/${currentPointFramesAccepted} frames ` +
        `(${(specularPct * 100).toFixed(0)}% > ${(SPECULAR_PERSISTENCE * 100).toFixed(0)}%). ` +
        `Provável reflexo em óculos ou tela muito próxima. Incline a tela para baixo ou ` +
        `reduza luzes atrás de você.`,
      );
    }
  }

  // Portão bidirecional. Continuamos aceitando pontos fora da faixa
  // (para não gerar infinite retry loop em usuários inquietos), mas o log
  // agora distingue piso vs. teto e contabiliza breaches para o preflight
  // do treino decidir se aborta.
  if (avgVar < INTRA_POINT_VARIANCE_FLOOR) {
    esteAttemptTeveVarianciaBaixa = true;
    console.warn(
      `[calib] ⚠ Ponto com variância BAIXA (${avgVar.toFixed(6)} < ${INTRA_POINT_VARIANCE_FLOOR}) — ` +
      `features possivelmente congeladas (reflexo, foco perdido). Aceitando com ${collectedFeaturesLeft.length} amostras.`,
    );
  } else if (avgVar > INTRA_POINT_VARIANCE_CEIL) {
    esteAttemptTeveVarianciaAlta = true;
    console.warn(
      `[calib] ⚠ Ponto com variância ALTA (${avgVar.toFixed(6)} > ${INTRA_POINT_VARIANCE_CEIL}) — ` +
      `usuário instável ou landmarks ruidosos (reflexo em óculos é o padrão). ` +
      `Aceitando com ${collectedFeaturesLeft.length} amostras.`,
    );
  }

  // Ponto com poucas amostras é REFEITO, não aceito de qualquer jeito (ver
  // `MIN_ACCEPTED_SAMPLES`). A UI trata `success: false` com retry.
  if (collectedFeaturesLeft.length < MIN_ACCEPTED_SAMPLES) {
    console.warn(
      `[calib] ✗ Ponto com ${collectedFeaturesLeft.length} amostras ` +
      `(mínimo ${MIN_ACCEPTED_SAMPLES}) — refazendo. ` +
      `Rejeitados por qualidade: ${qualityRejects}, por L2CS inválido: ${l2csRejects}.`,
    );
    const cbFew = pointCompleteCallback;
    pointCompleteCallback = null;
    if (cbFew) cbFew(false);
    return;
  }

  // A contabilização acontece AQUI, depois do gate de amostras mínimas, para
  // um alvo refeito 3× não contar 3× nas métricas que comparam perfis.
  if (esteAttemptTeveSpecular) specularWarningsIssued++;
  if (esteAttemptTeveVarianciaBaixa) varianceFloorBreaches++;
  if (esteAttemptTeveVarianciaAlta) varianceCeilBreaches++;

  // Mediana das distâncias dos frames que este ponto de fato aceitou.
  {
    const mediana = medianaDeDistancias(currentPointCameraDistances);
    if (mediana !== null) acceptedPointDistances.push(mediana);
  }

  // Pose mediana DESTE alvo, para medir a deriva da sessão.
  //
  // Não gateia nada. É o registro que permite ao operador (e ao relatório) ver
  // que a cabeça migrou entre o primeiro e o último alvo, que é a deriva que o
  // gate por ponto estruturalmente não vê.
  {
    const poses = collectedQualities.filter(
      (q): q is { yaw: number; pitch: number; roll: number } =>
        !!q && typeof q.yaw === 'number' && typeof q.pitch === 'number' && typeof q.roll === 'number',
    );
    if (poses.length > 0) {
      const med = (pick: (p: { yaw: number; pitch: number; roll: number }) => number) => {
        const v = poses.map(pick).sort((a, b) => a - b);
        const m = v.length >> 1;
        return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
      };
      sessionPoseByTarget.push({
        yaw: med((q) => q.yaw), pitch: med((q) => q.pitch), roll: med((q) => q.roll),
      });
    }
  }

  // Série real de distâncias, acumulada frame a frame em `feedRawData` junto
  // com a decisão de aceitar.
  for (const d of currentPointCameraDistances) {
    if (d > 0) acceptedDistancesCm.push(d);
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

interface TrainingSummary {
  deadFeaturesLeftPct: number;
  deadFeaturesRightPct: number;
}

// Diagnóstico de AJUSTE da calibração. O accuracy test roda DEPOIS e mistura
// três coisas num número só; estas métricas as separam:
//
//   trainErrorPx — erro nas PRÓPRIAS amostras de treino. Alto ⇒ os dados de
//                  calibração são internamente inconsistentes (o usuário não
//                  fixou os alvos, ou a pose derivou entre pontos).
//   looErrorPx   — erro leave-one-target-out: estimativa honesta de
//                  generalização só com dados de calibração.
//
//   loo ≈ teste  ⇒ o limite é o modelo/os dados.
//   loo << teste ⇒ mudou algo entre calibrar e testar (pose, L2CS, luz).
//
// Puramente diagnóstico: não altera o modelo nem bloqueia.
export interface CalibrationFitDiagnostics {
  /** Erro médio do modelo nas próprias amostras de treino, em PIXELS. Em px
   *  e não em fração de tela: x é fração da largura e y da altura, e cada
   *  eixo precisa ser convertido pela sua própria dimensão antes de compor. */
  trainErrorPx: number;
  /** Erro leave-one-target-out médio, em pixels. Mesma convenção. */
  looErrorPx: number;
  /** Erro LOO por alvo, na ordem dos alvos únicos. */
  looByTarget: { x: number; y: number; errorPx: number; samples: number }[];
  /** Média e desvio da pose durante TODA a calibração (rad). O desvio é o
   *  número interessante: pose que varia muito entre alvos vira variável
   *  confundida com o olhar. */
  poseMean: { yaw: number; pitch: number; roll: number } | null;
  poseStd: { yaw: number; pitch: number; roll: number } | null;
  /** Deriva postural ENTRE alvos, em graus e em pixels de tela.
   *
   *  `poseStd` acima mistura o ruído dentro de cada ponto com a migração entre
   *  pontos; o primeiro é ~0,3° e o segundo ~3,9°, e só o segundo importa. Este
   *  campo separa os dois. */
  poseDrift: SessionPoseDrift | null;
  /** Diagnóstico da GRADE a partir do LOO por alvo: distingue "a periferia saiu
   *  do alcance" de "a sessão inteira está ruim". Ver `calibrationGridDiagnosis.ts`. */
  gridDiagnosis: DiagnosticoGrade;
  /**
   * Fração das amostras de treino em que o bloco L2CS estava válido (≠ 0).
   * Se for < 1, parte do treino viu zeros onde a inferência vai ver valores
   * reais (ou vice-versa) — vazamento direto para o erro.
   *
   * `null` = o conjunto de features ativo NÃO carrega bloco angular, então não
   * há o que validar. Antes este campo era `number` e devolvia 0 nesse caso,
   * que se lê como "o L2CS falhou em 100% das amostras" — alarme falso que
   * apareceu como `l2csValidFraction: 0` no relatório
   * `accuracy-report-1788225161304`, com o conjunto ativo em `irisCore`.
   */
  l2csValidFraction: number | null;
  /** Amostras aceitas por alvo. Desequilíbrio grande enviesa o ajuste. */
  samplesPerTarget: number[];
  /** Alvos planejados pela grade, alvos que de fato treinaram e os que ficaram
   *  de fora (pulados pela UI após tentativas). Um modelo treinado sem a linha
   *  de baixo prediz a linha de baixo por extrapolação, e o relatório precisa dizer. */
  targetsPlanned: number;
  targetsTrained: number;
  targetsSkipped: { x: number; y: number }[];
  /** λ escolhido pela validação cruzada, por olho. */
  lambda: { left: number; right: number } | null;
  /** Dimensões por olho que entraram no Ridge (depois da expansão polinomial). */
  dimsPerEye: number;
  polynomialFeatures: boolean;
  /** Se os alvos de treino foram compensados pela pose de cada amostra. */
  poseCompensatedTargets: boolean;
}

let lastFitDiagnostics: CalibrationFitDiagnostics | null = null;

export function getCalibrationFitDiagnostics(): CalibrationFitDiagnostics | null {
  return lastFitDiagnostics;
}

/**
 * Alvos de treino compensados pela pose de cada amostra.
 *
 * A compensação geométrica desloca a predição por `d·tan(Δ)` em relação à
 * pose de referência. Para o treino ser coerente com isso, cada amostra
 * coletada sob pose `p` precisa aprender o alvo "como se a cabeça estivesse na
 * referência": alvo − d·tan(p − ref). Sem isto a deriva de pose entre alvos
 * (2° de yaw ≈ 80 px) entra no Ridge como se fosse olhar, e a compensação na
 * inferência corrige duas vezes.
 */
function alvosCompensadosPorPose(
  profile: readonly CalibrationPoint[],
  referencia: Pose | null,
  vw: number,
  vh: number,
): { screenX: number; screenY: number }[] {
  const distPx = screenDistancePx();
  return profile.map((p) => {
    const q = p.quality;
    const pose = q && typeof q.yaw === 'number' && typeof q.pitch === 'number' && typeof q.roll === 'number'
      ? { yaw: q.yaw, pitch: q.pitch, roll: q.roll }
      : null;
    if (!EXPERIMENT.geometricPoseCompensation || !pose || !referencia || !(vw > 0) || !(vh > 0)) {
      return { screenX: p.screenX, screenY: p.screenY };
    }
    const { dx, dy } = deslocamentoPorPose(pose, referencia, distPx);
    return { screenX: p.screenX - dx / vw, screenY: p.screenY - dy / vh };
  });
}

function poseDaAmostra(p: CalibrationPoint): Pose | null {
  const q = p.quality;
  return q && typeof q.yaw === 'number' && typeof q.pitch === 'number' && typeof q.roll === 'number'
    ? { yaw: q.yaw, pitch: q.pitch, roll: q.roll }
    : null;
}

function trainScalersAndRegressors(trainingProfile: CalibrationPoint[]): TrainingSummary {
  const trainFeaturesLeft  = trainingProfile.map(p => p.featuresLeft);
  const trainFeaturesRight = trainingProfile.map(p => p.featuresRight);

  const g = currentCalibrationGeometry();
  const vw = g.screenWidthPx;
  const vh = g.screenHeightPx;
  // O modelo mapeia para este viewport; o detector de resize compara contra ele.
  viewportDaCalibracao = { w: vw, h: vh };

  // Referência de pose = média das amostras que treinam. É contra ela que a
  // compensação mede o desvio, no treino e na inferência.
  calibrationReferencePose = poseDeReferencia(trainingProfile.map(poseDaAmostra));
  const trainTargets = alvosCompensadosPorPose(trainingProfile, calibrationReferencePose, vw, vh);

  const camDists = trainingProfile
    .map((p) => (p.quality as { cameraDistanceEstimate?: number } | null | undefined)?.cameraDistanceEstimate)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  calibrationRefDistance = camDists.length > 0
    ? camDists.reduce((a, b) => a + b, 0) / camDists.length
    : null;

  // Falha cedo se mais de 30% das dimensões não variam entre alvos: o modelo
  // linear não teria sinal e devolveria o viés.
  const deadL = countDeadFeatures(trainFeaturesLeft, trainTargets);
  const deadR = countDeadFeatures(trainFeaturesRight, trainTargets);
  const ratioL = deadL.totalDims > 0 ? deadL.deadCount / deadL.totalDims : 0;
  const ratioR = deadR.totalDims > 0 ? deadR.deadCount / deadR.totalDims : 0;
  console.log(
    `[calib] Features mortas (variância entre alvos < ${DEAD_FEATURE_VARIANCE_EPS}): ` +
    `L=${deadL.deadCount}/${deadL.totalDims} (${(ratioL * 100).toFixed(0)}%) ` +
    `R=${deadR.deadCount}/${deadR.totalDims} (${(ratioR * 100).toFixed(0)}%)`,
  );
  if (ratioL > DEAD_FEATURE_MAX_RATIO || ratioR > DEAD_FEATURE_MAX_RATIO) {
    throw new Error(
      `[calib] degenerate_features: mais de ${(DEAD_FEATURE_MAX_RATIO * 100).toFixed(0)}% das dimensões ` +
      `não variam entre alvos (L=${(ratioL * 100).toFixed(0)}% R=${(ratioR * 100).toFixed(0)}%). ` +
      `Causa provável: reflexo travando landmarks de íris, ou face fixa fora do alvo. ` +
      `Recalibre com atenção especial ao enquadramento e à luz.`,
    );
  }

  const expandedFeaturesLeft  = maybeExpand(trainFeaturesLeft);
  const expandedFeaturesRight = maybeExpand(trainFeaturesRight);

  featureScalerLeft.fit(expandedFeaturesLeft);
  featureScalerRight.fit(expandedFeaturesRight);

  const scaledFeaturesLeft  = featureScalerLeft.transform(expandedFeaturesLeft);
  const scaledFeaturesRight = featureScalerRight.transform(expandedFeaturesRight);

  const targetsX = trainTargets.map(t => t.screenX);
  const targetsY = trainTargets.map(t => t.screenY);

  regressorLeft = createRegressor();
  regressorLeft.train(scaledFeaturesLeft, targetsX, targetsY);
  regressorRight = createRegressor();
  regressorRight.train(scaledFeaturesRight, targetsX, targetsY);

  // Peso por olho pelo inverso da variância do resíduo de treino. Com olhos
  // igualmente bons dá ~0,5/0,5; um olho ruim deixa de arrastar a média.
  {
    const residuo = (r: typeof regressorLeft, z: number[][]) => {
      if (!r) return 1;
      let soma = 0;
      for (let i = 0; i < z.length; i++) {
        const p = r.predict(z[i]);
        soma += (p.x - targetsX[i]) ** 2 + (p.y - targetsY[i]) ** 2;
      }
      return soma / Math.max(1, z.length);
    };
    const vL = residuo(regressorLeft, scaledFeaturesLeft) || 1e-12;
    const vR = residuo(regressorRight, scaledFeaturesRight) || 1e-12;
    const iL = 1 / vL, iR = 1 / vR;
    if (Number.isFinite(iL) && Number.isFinite(iR) && iL + iR > 0) {
      eyeReliability = { left: iL / (iL + iR), right: iR / (iL + iR) };
      console.log(
        `[calib] confiabilidade por olho — esquerdo ${(eyeReliability.left * 100).toFixed(0)}% ` +
        `direito ${(eyeReliability.right * 100).toFixed(0)}%`,
      );
    }
  }

  const diag = getLambdaDiagnostics();
  if (diag && diag.ratio > 10) {
    console.warn(
      `[calib] ⚠ λ discrepante entre olhos: L=${diag.left} R=${diag.right} (ratio=${diag.ratio.toFixed(1)}). ` +
      `Dado provavelmente ruim (reflexo em óculos, iluminação assimétrica).`,
    );
  }

  // Mediana das distâncias dos quadros aceitos, quando há FOV calibrado.
  {
    const medida = measuredCalibrationDistanceCm();
    if (medida !== null) {
      calibrationCameraDistanceCm = medida;
      console.log(`[calib] distância de calibração: ${medida.toFixed(1)} cm (mediana de ${measuredCalibrationDistanceSamples()} quadros aceitos)`);
    }
  }

  calibrationReferenceCenter = centroDeReferencia(
    trainingProfile.map((a) => {
      const q = a.quality;
      return q && typeof q.faceCenterX === 'number' && typeof q.faceCenterY === 'number'
        ? { x: q.faceCenterX, y: q.faceCenterY }
        : null;
    }),
  );

  lastFitDiagnostics = computeFitDiagnostics(
    trainFeaturesLeft, trainFeaturesRight, trainTargets, trainingProfile,
    { w: vw, h: vh },
  );
  const d = lastFitDiagnostics;
  console.log(
    `[calib] ajuste — treino=${d.trainErrorPx.toFixed(0)}px | LOO=${d.looErrorPx.toFixed(0)}px | ` +
    `λ=${d.lambda ? `${d.lambda.left}/${d.lambda.right}` : '?'} | dims=${d.dimsPerEye} | ` +
    `L2CS ${d.l2csValidFraction === null ? 'fora do conjunto' : `válido=${(d.l2csValidFraction * 100).toFixed(0)}%`} | ` +
    `amostras/alvo=[${d.samplesPerTarget.join(',')}]` +
    (d.targetsSkipped.length > 0 ? ` | ALVOS PULADOS: ${d.targetsSkipped.length}` : ''),
  );
  {
    const gd = d.gridDiagnosis;
    console.log(
      `[calib] grade — LOO centro ${gd.centroPx.toFixed(0)}px | periferia ${gd.periferiaPx.toFixed(0)}px | ` +
      `razão ${gd.razao.toFixed(1)}× | veredito: ${gd.veredicto}`,
    );
    if (gd.mensagem) console.warn(`[calib] ⚠️ ${gd.mensagem}`);
  }
  if (d.poseDrift) {
    const pd = d.poseDrift;
    console.log(
      `[calib] deriva de pose entre os ${pd.targets} alvos — ` +
      `yaw ${pd.yawDeg.toFixed(2)}° (${pd.yawPx.toFixed(0)}px em X) | ` +
      `pitch ${pd.pitchDeg.toFixed(2)}° (${pd.pitchPx.toFixed(0)}px em Y)`,
    );
    const veredito = avaliarDerivaDePose(pd);
    if (veredito) console.warn(`[calib] ⚠️ ${veredito.mensagem}`);
  }

  return { deadFeaturesLeftPct: ratioL, deadFeaturesRightPct: ratioR };
}

/**
 * Diagnóstico do ajuste: erro de treino, leave-one-target-out por alvo, pose,
 * validade do L2CS e a contagem de alvos. Pura em relação ao DOM (recebe o
 * viewport) para poder ser testada sem `completeCalibration`.
 *
 * A predição usa a mesma fusão binocular de `mapGaze` (pesos de confiabilidade
 * por olho) e os alvos já compensados por pose, para os números serem
 * comparáveis com o teste de precisão.
 */
export function computeFitDiagnostics(
  featuresLeft: number[][],
  featuresRight: number[][],
  targets: { screenX: number; screenY: number }[],
  profile?: readonly CalibrationPoint[],
  viewport?: { w: number; h: number },
): CalibrationFitDiagnostics {
  const n = featuresLeft.length;
  const vw = viewport?.w ?? (typeof document !== 'undefined' ? document.documentElement.clientWidth : 1920);
  const vh = viewport?.h ?? (typeof document !== 'undefined' ? document.documentElement.clientHeight : 1080);
  const errPx = (dx: number, dy: number) => Math.hypot(dx * vw, dy * vh);
  const wL = eyeReliability ? Math.max(MIN_EYE_WEIGHT, eyeReliability.left) : 1;
  const wR = eyeReliability ? Math.max(MIN_EYE_WEIGHT, eyeReliability.right) : 1;
  const fundir = (a: { x: number; y: number }, b: { x: number; y: number }) => ({
    x: (a.x * wL + b.x * wR) / (wL + wR),
    y: (a.y * wL + b.y * wR) / (wL + wR),
  });

  const binocular = (
    sl: StandardScaler, sr: StandardScaler,
    ml: RidgeModel, mr: RidgeModel,
    fl: number[], fr: number[],
  ) => fundir(
    predictRidge(ml, sl.transformSingle(maybeExpandSingle(fl))),
    predictRidge(mr, sr.transformSingle(maybeExpandSingle(fr))),
  );

  const fitPair = (idx: number[]) => {
    const fl = maybeExpand(idx.map((i) => featuresLeft[i]));
    const fr = maybeExpand(idx.map((i) => featuresRight[i]));
    const tg = idx.map((i) => targets[i]);
    const sl = new StandardScaler(); sl.fit(fl);
    const sr = new StandardScaler(); sr.fit(fr);
    const rl = new RidgeRegressor(); rl.train(sl.transform(fl), tg.map(t => t.screenX), tg.map(t => t.screenY));
    const rr = new RidgeRegressor(); rr.train(sr.transform(fr), tg.map(t => t.screenX), tg.map(t => t.screenY));
    return { sl, sr, ml: rl.getModel() as RidgeModel, mr: rr.getModel() as RidgeModel };
  };

  let trainErrorPx = 0;
  if (n > 0 && regressorLeft && regressorRight) {
    let sum = 0;
    for (let i = 0; i < n; i++) {
      const p = fundir(
        regressorLeft.predict(featureScalerLeft.transformSingle(maybeExpandSingle(featuresLeft[i]))),
        regressorRight.predict(featureScalerRight.transformSingle(maybeExpandSingle(featuresRight[i]))),
      );
      sum += errPx(p.x - targets[i].screenX, p.y - targets[i].screenY);
    }
    trainErrorPx = sum / n;
  }

  const byTarget = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const k = targetGroupKey(targets[i]);
    const arr = byTarget.get(k);
    if (arr) arr.push(i); else byTarget.set(k, [i]);
  }
  const keys = [...byTarget.keys()];
  const samplesPerTarget = keys.map((k) => byTarget.get(k)!.length);

  const looByTarget: CalibrationFitDiagnostics['looByTarget'] = [];
  let looSum = 0, looCount = 0;
  if (keys.length >= 3) {
    for (const k of keys) {
      const test = byTarget.get(k)!;
      const train: number[] = [];
      for (let i = 0; i < n; i++) if (targetGroupKey(targets[i]) !== k) train.push(i);
      try {
        const f = fitPair(train);
        let s = 0;
        for (const i of test) {
          const p = binocular(f.sl, f.sr, f.ml, f.mr, featuresLeft[i], featuresRight[i]);
          s += errPx(p.x - targets[i].screenX, p.y - targets[i].screenY);
        }
        const e = s / test.length;
        looByTarget.push({ x: targets[test[0]].screenX, y: targets[test[0]].screenY, errorPx: e, samples: test.length });
        looSum += e; looCount++;
      } catch {
        looByTarget.push({ x: targets[test[0]].screenX, y: targets[test[0]].screenY, errorPx: NaN, samples: test.length });
      }
    }
  }
  const looErrorPx = looCount > 0 ? looSum / looCount : NaN;

  let poseMean: CalibrationFitDiagnostics['poseMean'] = null;
  let poseStd: CalibrationFitDiagnostics['poseStd'] = null;
  if (profile && profile.length > 0) {
    const ys: number[] = [], ps: number[] = [], rs: number[] = [];
    for (const p of profile) {
      const q = poseDaAmostra(p);
      if (q) { ys.push(q.yaw); ps.push(q.pitch); rs.push(q.roll); }
    }
    if (ys.length > 1) {
      const m = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
      const sd = (v: number[], mu: number) => Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / (v.length - 1));
      const my = m(ys), mp = m(ps), mr2 = m(rs);
      poseMean = { yaw: my, pitch: mp, roll: mr2 };
      poseStd = { yaw: sd(ys, my), pitch: sd(ps, mp), roll: sd(rs, mr2) };
    }
  }

  // Inválido é representado por zeros exatos no bloco angular. `null` quando o
  // conjunto ativo não carrega o bloco — zero aqui significaria "o L2CS falhou
  // em todas as amostras", que é outra conclusão.
  const l2csSlots = l2csSlotsInSet();
  let l2csValidFraction: number | null = null;
  if (l2csSlots.length > 0 && n > 0) {
    let l2csValid = 0;
    for (let i = 0; i < n; i++) {
      const f = featuresLeft[i];
      if (l2csSlots.some((s) => s < f.length && f[s] !== 0)) l2csValid++;
    }
    l2csValidFraction = l2csValid / n;
  }

  // Alvos da grade que não treinaram. Comparação pela chave ORIGINAL do alvo
  // (o `profile` guarda o alvo nominal; `targets` pode estar compensado).
  const planejados = currentCalibrationTargets ?? [];
  const treinados = new Set((profile ?? []).map((p) => targetGroupKey({ screenX: p.screenX, screenY: p.screenY })));
  const targetsSkipped = planejados
    .filter((t) => !treinados.has(targetGroupKey({ screenX: t.x, screenY: t.y })))
    .map((t) => ({ x: t.x, y: t.y }));

  const lam = getLambdaDiagnostics();

  return {
    trainErrorPx,
    looErrorPx,
    looByTarget,
    poseMean,
    poseStd,
    poseDrift: getSessionPoseDrift(),
    gridDiagnosis: diagnosticarGrade(looByTarget),
    l2csValidFraction,
    samplesPerTarget,
    targetsPlanned: planejados.length,
    targetsTrained: keys.length,
    targetsSkipped,
    lambda: lam ? { left: lam.left, right: lam.right } : null,
    dimsPerEye: n > 0 ? maybeExpandSingle(featuresLeft[0]).length : 0,
    polynomialFeatures: expansaoAtiva(),
    poseCompensatedTargets: EXPERIMENT.geometricPoseCompensation,
  };
}

// Detecção de ponto outlier na calibração.
//
// Motivação: hoje só existe rejeição de outlier DENTRO de um ponto (variância
// intra-ponto → warn; deriva de pose → rejeita frame). Um ponto INTEIRO mal
// coletado (usuário olhou pro lado durante os 3 s de coleta) entra no treino
// sem sinalização, empurra o Ridge por muitos px, e o único aviso é o erro
// grande depois do accuracy test — tarde demais.
//
// Algoritmo — variante robusta baseada em MAD (median absolute deviation),
// adequada a N pequeno (~9) onde RANSAC clássico não é estatisticamente
// estável. Mesmo agrupamento por `(screenX,screenY)` que `selectLambdaCV`
// já usa em `ridge.ts` (leave-one-target-out).
//
//   Para cada alvo único k:
//     1. Treina scaler + Ridge sobre os pontos exceto k (LOO por alvo).
//     2. Prediz cada amostra de k, mede erro (px normalizado) da média.
//     3. Registra o resíduo médio r_k daquele alvo.
//   Calcula MAD = mediana(|r_k - mediana(r)|).
//   Marca k como candidato a outlier se |r_k - mediana(r)| > 3 × MAD × 1.4826.
//   (O 1.4826 é o fator que faz MAD ~ σ para distribuição normal.)
//
// SAÍDA — só sinaliza. O caller decide se avisa o cuidador ou não.
// Não bloqueia, não retreina automaticamente sem o ponto.
//
// ⚠️ N pequeno (~9 alvos): este sinal deve ser tratado como INDICATIVO, não
// conclusivo. O log/UI que consumir este resultado deve incluir essa ressalva
// — não criar falsa confiança num número pequeno de amostras.
export interface OutlierPointsReport {
  /** Índices em `points` (não em `targets únicos`) — pode conter várias
   *  amostras do mesmo alvo se ele foi marcado como outlier. */
  outlierIndices: number[];
  /** Um item por alvo único, ordenado pela ordem de aparição em `points`. */
  perTarget: {
    screenX: number;
    screenY: number;
    sampleCount: number;
    residualNorm: number;   // erro médio normalizado da predição LOO neste alvo
    zScore: number;         // (residualNorm - mediana) / (MAD × 1.4826)
    isOutlier: boolean;
  }[];
  medianResidual: number;
  mad: number;               // median absolute deviation (bruto, sem escalar)
  madThreshold: number;      // 3 × MAD × 1.4826 — o corte usado
  targetCount: number;
  reason?: 'insufficient_targets' | 'training_failed';
}

// Ridge mínimo local para o LOO — reutiliza `trainRidgeModel` e `predictRidge`
// do módulo `ridge` (mesma fórmula do CV de λ ali dentro), mas evita o CV de
// λ (que é caro e não muda a *dominância* do resíduo). Usa λ fixo — o alvo
// não é achar o modelo ótimo, é comparar RESÍDUOS entre alvos deixados de fora
// com o mesmo λ, isolando o efeito do alvo.
//
// λ é adimensional em `trainRidgeModel` (a penalidade é `λ·m·P`, não mais
// `λ·I` absoluto). `2e-3` mantém a ordem de grandeza efetiva do detector para
// os tamanhos de coleta reais, sem depender de m. A penalidade continua
// isotrópica aqui de propósito: o LOO precisa comparar alvos com o MESMO viés,
// e a matriz Σ_W mudaria entre folds.
const OUTLIER_LOO_LAMBDA = 2e-3;
const OUTLIER_MAD_SCALE = 1.4826;      // MAD → σ para distribuição normal
const OUTLIER_ZSCORE_THRESHOLD = 3.0;  // ~conservador
// Piso absoluto do threshold em unidades normalizadas de tela (15% da tela).
// Duas razões pra este piso ser alto:
//   1. Quando o modelo é bom e os resíduos LOO são todos pequenos e parecidos,
//      o MAD encolhe até quase zero e o critério 3×MAD marca variação de
//      ruído normal como outlier — false positives que confundem o cuidador.
//   2. Ridge regularizado extrapola pior nos CANTOS da grade que no centro,
//      mesmo sem ruído. Sem este piso, os 4 alvos de canto viravam outlier
//      falsos sistematicamente com N=9 (efeito 3×3). Um alvo só é outlier
//      se seu resíduo é 3×MAD ACIMA da mediana **e** passa deste piso
//      absoluto. Um resíduo >15% da tela é claramente "algo deu errado".
//   Comparação: baseline atual é ~5% da tela (57 px em 1080 = 5.3%). 15%
//   é 3× o baseline — margem confortável pra não gerar falso alerta.
const OUTLIER_ABS_FLOOR = 0.15;

export function detectOutlierPoints(
  points: readonly CalibrationPoint[],
): OutlierPointsReport {
  const empty: OutlierPointsReport = {
    outlierIndices: [],
    perTarget: [],
    medianResidual: 0,
    mad: 0,
    madThreshold: 0,
    targetCount: 0,
  };

  // Agrupamento por (screenX, screenY) com a MESMA chave (4 casas decimais)
  // que ridge.ts usa em selectLambdaCV. Mesma chave = mesma comparabilidade.
  const groups = new Map<string, number[]>(); // key → índices em `points`
  const orderedKeys: string[] = [];
  const keyCoords = new Map<string, { x: number; y: number }>();
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    const key = `${p.screenX.toFixed(4)},${p.screenY.toFixed(4)}`;
    if (!groups.has(key)) {
      groups.set(key, []);
      orderedKeys.push(key);
      keyCoords.set(key, { x: p.screenX, y: p.screenY });
    }
    groups.get(key)!.push(i);
  }

  if (orderedKeys.length < 3) {
    // < 3 alvos: MAD degenera (mediana de 1 ou 2 valores é o próprio dado).
    return { ...empty, targetCount: orderedKeys.length, reason: 'insufficient_targets' };
  }

  // Verifica dims consistentes (o treino real já valida, mas queremos falhar
  // limpo aqui em vez de propagar exceção).
  const dimL = points[0].featuresLeft.length;
  const dimR = points[0].featuresRight.length;
  if (dimL === 0 || dimR === 0) {
    return { ...empty, targetCount: orderedKeys.length, reason: 'training_failed' };
  }

  // Para cada alvo k, treina em ALL - k e mede resíduo médio nos frames de k.
  const residualsByKey = new Map<string, number>();
  for (const heldOutKey of orderedKeys) {
    const trainIdx: number[] = [];
    for (const [k, idxs] of groups) {
      if (k === heldOutKey) continue;
      trainIdx.push(...idxs);
    }
    const testIdx = groups.get(heldOutKey)!;

    const trainFL = maybeExpand(trainIdx.map((i) => points[i].featuresLeft));
    const trainFR = maybeExpand(trainIdx.map((i) => points[i].featuresRight));
    const trainTgt = trainIdx.map((i) => ({
      screenX: points[i].screenX,
      screenY: points[i].screenY,
    }));

    let residualSum = 0;
    let residualCount = 0;
    try {
      const scL = new StandardScaler(); scL.fit(trainFL);
      const scR = new StandardScaler(); scR.fit(trainFR);
      const modelL = trainRidgeModel(scL.transform(trainFL), trainTgt, OUTLIER_LOO_LAMBDA);
      const modelR = trainRidgeModel(scR.transform(trainFR), trainTgt, OUTLIER_LOO_LAMBDA);
      for (const ti of testIdx) {
        const p = points[ti];
        const pL = predictRidge(modelL, scL.transformSingle(maybeExpandSingle(p.featuresLeft)));
        const pR = predictRidge(modelR, scR.transformSingle(maybeExpandSingle(p.featuresRight)));
        const px = (pL.x + pR.x) / 2;
        const py = (pL.y + pR.y) / 2;
        const dx = px - p.screenX;
        const dy = py - p.screenY;
        residualSum += Math.hypot(dx, dy);
        residualCount += 1;
      }
    } catch {
      // Se o LOO falhar num alvo específico (matriz singular sem esse ponto),
      // marcamos com residual = +Infinity para o alvo entrar como candidato
      // óbvio a outlier — remover o ponto degenera o problema.
      residualSum = Infinity;
      residualCount = 1;
    }

    residualsByKey.set(heldOutKey, residualCount > 0 ? residualSum / residualCount : 0);
  }

  // MAD sobre os resíduos por alvo.
  const residualsArr = orderedKeys
    .map((k) => residualsByKey.get(k) ?? 0)
    .filter((v) => Number.isFinite(v));
  const finiteMedian = residualsArr.length > 0 ? medianOf(residualsArr) : 0;
  const absDeviations = residualsArr.map((r) => Math.abs(r - finiteMedian));
  const madBase = absDeviations.length > 0 ? medianOf(absDeviations) : 0;

  // Fallback quando todos os resíduos são iguais (MAD = 0): usa desvio médio
  // simples em vez de zero, senão o threshold vira 0 e tudo vira outlier.
  const madEffective = madBase > 0
    ? madBase
    : absDeviations.reduce((a, b) => a + b, 0) / Math.max(absDeviations.length, 1);
  // Threshold combina MAD (relativo) com o piso ABSOLUTO — o maior dos dois é
  // o corte real. Em N=9 alvos, MAD pode ser enganosamente pequeno; o piso é
  // o "isso não é grande o suficiente pra chamar de outlier de qualquer jeito".
  const madThreshold = OUTLIER_ZSCORE_THRESHOLD * madEffective * OUTLIER_MAD_SCALE;
  const threshold = Math.max(madThreshold, OUTLIER_ABS_FLOOR);

  const perTarget: OutlierPointsReport['perTarget'] = [];
  const outlierIndices: number[] = [];
  for (const key of orderedKeys) {
    const residual = residualsByKey.get(key) ?? 0;
    const coords = keyCoords.get(key)!;
    const sampleCount = groups.get(key)!.length;
    const zScore = madEffective > 0
      ? (residual - finiteMedian) / (madEffective * OUTLIER_MAD_SCALE)
      : 0;
    // Resíduos infinitos (treino falhou sem esse alvo) sempre viram outlier.
    const isOutlier = !Number.isFinite(residual)
      || (threshold > 0 && Math.abs(residual - finiteMedian) > threshold);
    perTarget.push({
      screenX: coords.x,
      screenY: coords.y,
      sampleCount,
      residualNorm: Number.isFinite(residual) ? residual : Number.MAX_SAFE_INTEGER,
      zScore: Number.isFinite(zScore) ? zScore : Number.MAX_SAFE_INTEGER,
      isOutlier,
    });
    if (isOutlier) outlierIndices.push(...groups.get(key)!);
  }

  return {
    outlierIndices,
    perTarget,
    medianResidual: finiteMedian,
    mad: madBase,
    madThreshold: threshold,
    targetCount: orderedKeys.length,
  };
}

function medianOf(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

// Outcome tipado. O chamador sabe se a UI deve mostrar "Calibração Concluída"
// (só se ok=true) ou uma tela de falha com a razão específica.
export type CalibrationOutcome =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'singular_matrix'          // solveLinear lançou mesmo após escalonamento λ
        | 'insufficient_samples'     // profile vazio ou < 3 alvos únicos
        | 'degenerate_features'      // preflight (>30% features mortas)
        | 'unknown';
      detail: string;
    };

// Classificação de exceções do treino em um CalibrationOutcome.
// Prioriza mensagens específicas do próprio código (degenerate_features,
// singular_matrix) para dar orientação acionável ao cuidador.
function classifyTrainingError(e: unknown, sampleCount: number): CalibrationOutcome {
  const detail = e instanceof Error ? e.message : String(e);
  if (sampleCount === 0) {
    return { ok: false, reason: 'insufficient_samples', detail };
  }
  // O preflight de `completeCalibration` também dispara com amostras > 0
  // mas alvos únicos < 3. Sem este ramo, esse caso cairia em `unknown` e a UI
  // mostraria "erro desconhecido" para uma condição que sabemos nomear.
  if (/insufficient_samples/i.test(detail)) {
    return { ok: false, reason: 'insufficient_samples', detail };
  }
  if (/degenerate_features/i.test(detail)) {
    return { ok: false, reason: 'degenerate_features', detail };
  }
  if (/matriz singular/i.test(detail)) {
    return { ok: false, reason: 'singular_matrix', detail };
  }
  return { ok: false, reason: 'unknown', detail };
}

export function completeCalibration(
  onComplete?: (outcome: CalibrationOutcome) => void,
) {
  // Cancel any pending collection timeout before finalising
  if (collectionTimeoutHandle !== null) {
    clearTimeout(collectionTimeoutHandle);
    collectionTimeoutHandle = null;
  }
  isCollecting = false;
  pointCompleteCallback = null;

  let outcome: CalibrationOutcome;
  try {
    // Preflight de amostras: `trainRidgeModel` NÃO lança com perfil vazio
    // (devolve um modelo com 0 features), e a UI mostraria "Calibração
    // Concluída". Três alvos únicos é o mínimo: dois determinam ganho e
    // offset por eixo sem folga nenhuma.
    const alvosUnicos = new Set(profile.map((pt) => targetGroupKey({ screenX: pt.screenX, screenY: pt.screenY }))).size;
    if (profile.length === 0 || alvosUnicos < 3) {
      throw new Error(
        `[calib] insufficient_samples: ${profile.length} amostra(s) em ${alvosUnicos} alvo(s) único(s). ` +
        `Mínimo: 3 alvos. Causa provável: todos os frames rejeitados pelos filtros de ` +
        `qualidade ou rosto ausente durante a coleta.`,
      );
    }

    const summary = trainScalersAndRegressors(profile);
    // Primeiro o registry recebe o perfil novo, depois o localStorage é
    // gravado — na ordem inversa o perfil recém-treinado só chegaria ao disco
    // na calibração seguinte.
    persistActiveProfileToRegistry(summary);
    saveProfile();
    outcome = { ok: true };
  } catch (e) {
    const failure = classifyTrainingError(e, profile.length);
    outcome = failure;
    // Não persistir perfil quando o treino falhou. Garantir que isCalibrated()
    // diga a verdade após falha: zeramos os regressors mesmo se algum tiver
    // sobrevivido parcialmente.
    regressorLeft = null;
    regressorRight = null;
    pendingProfileMeta = null;
    if (!failure.ok) {
      console.error(`[calib] ✗ Calibração falhou (${failure.reason}): ${failure.detail}`);
    }
  } finally {
    isCalibrating = false;
    // Libera o modo. `getCalibrationTargets()` volta ao default 'full'.
    currentCalibrationMode = null;
    if (onComplete) onComplete(outcome!);
  }
}

// Extrai um snapshot serializável do estado atual e enfileira no registry sob
// a meta pendente. Chamador (completeCalibration) só invoca quando o treino
// terminou sem exceção.
function persistActiveProfileToRegistry(summary: TrainingSummary): void {
  const modelL = regressorLeft ? ridgeModelFromRegressor(regressorLeft) : null;
  const modelR = regressorRight ? ridgeModelFromRegressor(regressorRight) : null;
  if (!modelL || !modelR) {
    console.warn('[calib] persistActiveProfileToRegistry: regressors ausentes; nada a salvar.');
    return;
  }
  const meta = pendingProfileMeta ?? profileRegistry.createMeta({ opticalCondition: 'desconhecido' });
  pendingProfileMeta = null;

  const diag = getLambdaDiagnostics();

  // Corre o detector de outlier ANTES de salvar o perfil, para o campo
  // quality.outlierTargets nascer preenchido. É diagnóstico puro (não muda o
  // treino). Se algo dá errado, log claro mas segue salvando — falhar alto,
  // não silenciar, sem deixar o perfil sem quality.
  let outlierSummary: NonNullable<StoredCalibrationProfile['quality']>['outlierTargets'] | undefined;
  try {
    const rep = detectOutlierPoints(profile);
    if (rep.reason) {
      console.log(`[calib] outlier detection SKIPPED (${rep.reason}, N=${rep.targetCount} alvos)`);
    } else {
      const outlierIndicesInPerTarget: number[] = [];
      for (let i = 0; i < rep.perTarget.length; i++) if (rep.perTarget[i].isOutlier) outlierIndicesInPerTarget.push(i);
      outlierSummary = {
        count: outlierIndicesInPerTarget.length,
        indices: outlierIndicesInPerTarget,
        medianResidual: rep.medianResidual,
        madThreshold: rep.madThreshold,
        perTarget: rep.perTarget.map((t) => ({
          screenX: t.screenX,
          screenY: t.screenY,
          residualNorm: t.residualNorm,
          zScore: t.zScore,
          isOutlier: t.isOutlier,
        })),
      };
      // Log honesto e indicativo — MAD com N~9 é frágil, então nunca
      // chamamos disso "conclusivo".
      if (outlierIndicesInPerTarget.length > 0) {
        const worst = rep.perTarget
          .filter((t) => t.isOutlier)
          .map((t) => `(${t.screenX.toFixed(2)},${t.screenY.toFixed(2)}) z=${t.zScore.toFixed(1)}`)
          .join('; ');
        console.warn(
          `[calib] ⚠ outlier indicativo em ${outlierIndicesInPerTarget.length}/${rep.perTarget.length} alvo(s): ` +
          `${worst}. MAD com N=${rep.targetCount} é frágil — sinal indicativo, não conclusivo.`,
        );
      } else {
        console.log(`[calib] outlier detection: 0/${rep.perTarget.length} alvos acima do corte (mediana=${rep.medianResidual.toFixed(4)}).`);
      }
    }
  } catch (e) {
    console.warn('[calib] detectOutlierPoints falhou (não afeta salvar perfil):', e);
  }

  const stored: StoredCalibrationProfile = {
    meta,
    contextKey: buildContextKey(),
    schemaVersion: PROFILE_SCHEMA_VERSION,
    modelLeft: modelL,
    modelRight: modelR,
    scalerParamsLeft:  featureScalerLeft.getParams(),
    scalerParamsRight: featureScalerRight.getParams(),
    // O estado de referência viaja COM o modelo (ver
    // `captureReferenceStateForProfile`).
    reference: captureReferenceStateForProfile(),
    quality: {
      sampleCount: profile.length,
      varianceFloorBreaches,
      varianceCeilBreaches,
      specularWarnings: specularWarningsIssued,
      lambdaLeft:  diag?.left  ?? 0,
      lambdaRight: diag?.right ?? 0,
      lambdaRatio: diag?.ratio ?? 1,
      deadFeaturesLeftPct:  summary.deadFeaturesLeftPct,
      deadFeaturesRightPct: summary.deadFeaturesRightPct,
      outlierTargets: outlierSummary,
    },
  };
  profileRegistry.save(stored);
  console.log(
    `[calib] Perfil salvo no registry: id=${meta.id} condição=${meta.opticalCondition} ` +
    `label='${meta.label}' amostras=${profile.length}`,
  );
}

// Troca o perfil ativo (recarrega regressors e scalers a partir do
// snapshot serializado). Devolve o meta do perfil ativado ou null se o id
// não existe. NÃO chama startCalibrationMode — o perfil está pronto, é só
// restaurar o estado.
export function switchActiveProfile(id: string): CalibrationProfileMeta | null {
  const candidato = profileRegistry.get(id);
  if (!candidato) {
    console.warn(`[calib] switchActiveProfile: id '${id}' não encontrado.`);
    return null;
  }
  if (candidato.contextKey && candidato.contextKey !== buildContextKey()) {
    console.warn(
      `[calib] switchActiveProfile: perfil '${id}' foi treinado noutro viewport/pipeline ` +
      `(${candidato.contextKey}) — recalibre em vez de ativá-lo.`,
    );
    return null;
  }
  const stored = profileRegistry.switchTo(id);
  if (!stored) return null;
  regressorLeft = ridgeRegressorFromModel(stored.modelLeft);
  regressorRight = ridgeRegressorFromModel(stored.modelRight);
  featureScalerLeft.setParams(stored.scalerParamsLeft.means, stored.scalerParamsLeft.stds);
  featureScalerRight.setParams(stored.scalerParamsRight.means, stored.scalerParamsRight.stds);
  // A referência acompanha a troca de perfil: manter a `eyeReliability` do
  // perfil anterior enviesaria a fusão binocular num modelo que nunca a
  // produziu. Um perfil sem `reference` zera tudo.
  restoreReferenceStateFromProfile(stored.reference ?? null);
  if (!stored.reference) {
    console.warn(
      `[calib] perfil '${stored.meta.id}' não traz estado de referência ` +
      `(schema anterior a v${PROFILE_SCHEMA_VERSION}). Compensação geométrica e ` +
      `fusão ponderada por olho ficam INATIVAS para este perfil — recalibre.`
    );
  }
  if (shouldWarnPrecisionForCondition(stored.meta.opticalCondition)) {
    console.warn(
      `[calib] Perfil ativado com condição '${stored.meta.opticalCondition}'. ` +
      `Não prometer a mesma precisão de outras condições — refração progressiva ` +
      `é limite físico, não bug.`,
    );
  }
  console.log(`[calib] Perfil ativo: ${stored.meta.label} (${stored.meta.id})`);
  return stored.meta;
}

export function listCalibrationProfiles(): ProfileListEntry[] {
  return profileRegistry.list();
}

export function getActiveProfileMeta(): CalibrationProfileMeta | null {
  return profileRegistry.getActive()?.meta ?? null;
}

export function deleteCalibrationProfile(id: string): boolean {
  const active = profileRegistry.getActiveId() === id;
  const ok = profileRegistry.delete(id);
  if (ok && active) {
    regressorLeft = null;
    regressorRight = null;
    restoreReferenceStateFromProfile(null);
  }
  if (ok) saveProfile();
  return ok;
}

/** Cancela o listener de resize instalado por `init()`. */
let removerListenerResize: (() => void) | null = null;

export function init() {
  loadProfile();

  // O modelo mapeia para pixels do VIEWPORT: maximizar a janela (ou Ctrl+`+`)
  // deixaria o perfil ativo com escala e offset errados sem virar `degraded`.
  // `resize` dispara muitas vezes durante o arrasto; o debounce só avalia
  // quando o usuário para.
  if (typeof window !== 'undefined' && !removerListenerResize) {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const aoRedimensionar = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => {
        const doc = document.documentElement;
        checarMudancaDeViewport(doc.clientWidth, doc.clientHeight);
      }, 300);
    };
    window.addEventListener('resize', aoRedimensionar);
    removerListenerResize = () => {
      if (timer) clearTimeout(timer);
      window.removeEventListener('resize', aoRedimensionar);
      removerListenerResize = null;
    };
  }

  // Expõe hooks de diagnóstico no console.
  // Uso: __irisflowDebug.isCalibrated(), __irisflowDebug.lambdaDiag(),
  //      __irisflowDebug.varianceBreaches(), __irisflowDebug.deadFeatures().
  (window as unknown as Record<string, unknown>).__irisflowDebug = {
    isCalibrated,
    sampleCount: getSampleCount,
    currentLambda: getCurrentLambda,
    lambdaDiag: getLambdaDiagnostics,
    hasRegressors: () => ({ left: regressorLeft !== null, right: regressorRight !== null }),
    isCalibrating: () => isCalibrating,
    varianceBreaches: () => ({
      floor: varianceFloorBreaches,
      ceil: varianceCeilBreaches,
      floorThreshold: INTRA_POINT_VARIANCE_FLOOR,
      ceilThreshold: INTRA_POINT_VARIANCE_CEIL,
    }),
    specularStats: () => ({
      pointsWithReflectionWarning: specularWarningsIssued,
      currentPointHits: currentPointSpecularHits,
      currentPointFrames: currentPointFramesAccepted,
      frameThreshold: SPECULAR_FRAME_THRESHOLD,
      persistenceThreshold: SPECULAR_PERSISTENCE,
    }),
    mapGazeErrors: () => _mapGazeConsecutiveErrors,
    profiles: {
      list: listCalibrationProfiles,
      active: getActiveProfileMeta,
      switchTo: switchActiveProfile,
      remove: deleteCalibrationProfile,
    },
    deadFeatures: () => {
      if (profile.length === 0) return null;
      const targets = profile.map(p => ({ screenX: p.screenX, screenY: p.screenY }));
      const left = countDeadFeatures(profile.map(p => p.featuresLeft), targets);
      const right = countDeadFeatures(profile.map(p => p.featuresRight), targets);
      return {
        left: { count: left.deadCount, total: left.totalDims, pct: left.totalDims ? left.deadCount / left.totalDims : 0 },
        right: { count: right.deadCount, total: right.totalDims, pct: right.totalDims ? right.deadCount / right.totalDims : 0 },
        maxAllowed: DEAD_FEATURE_MAX_RATIO,
      };
    },
    // Quais alvos da última calibração passaram do corte MAD. Recomputa em
    // cima do `profile` atual.
    outlierTargets: () => {
      if (profile.length === 0) return null;
      return detectOutlierPoints(profile);
    },
  };
}

/** Remove o listener de resize instalado por `init()`. Chamado no `dispose()` do engine. */
export function dispose(): void {
  removerListenerResize?.();
}

export function getCurrentTargetPx(): { xPx: number; yPx: number } | null {
  if (!isCalibrating || !isCollecting) return null;
  if (typeof document === 'undefined') return null;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  return { xPx: currentTargetX * vw, yPx: currentTargetY * vh };
}

// Erros de `mapGaze` são logados com rate-limit (1×/s) e contados em
// sequência: um log one-shot esconderia uma falha persistente a 30 Hz, e o
// estado degradado do engine é a segunda defesa.
let _mapGazeConsecutiveErrors = 0;
let _mapGazeLastLoggedMs = 0;
const MAP_GAZE_LOG_INTERVAL_MS = 1000;

/** Nunca zera um olho: mantém alguma contribuição. */
const MIN_EYE_WEIGHT = 0.05;

export function mapGaze(
  featuresLeft: number[],
  featuresRight: number[],
  perEyeWeight?: { left: number; right: number },
): { x: number; y: number } | null {
  if (!regressorLeft || !regressorRight) return null;

  // A compensação de distância corrige a SAÍDA, não as features (ver o bloco
  // no fim desta função e o cabeçalho de `distanceCompensation.ts`).
  const scaledLeft  = featureScalerLeft.transformSingle(maybeExpandSingle(featuresLeft));
  const scaledRight = featureScalerRight.transformSingle(maybeExpandSingle(featuresRight));

  let predLeft: { x: number; y: number };
  let predRight: { x: number; y: number };
  try {
    predLeft = regressorLeft.predict(scaledLeft);
    predRight = regressorRight.predict(scaledRight);
    _mapGazeConsecutiveErrors = 0; // caminho feliz: zera contador
  } catch (e) {
    // Dimensão incompatível é DEFINITIVA, não transitória: nenhum frame futuro
    // conserta um modelo treinado com outro número de features.
    if (e instanceof RangeError) {
      const detail = e.message;
      console.error(`[calib] calibração invalidada — ${detail}`);
      clearCalibration();
      emitirInvalidacao({ reason: 'feature_dim_mismatch', detail, at: Date.now() });
      return null;
    }

    _mapGazeConsecutiveErrors++;
    const now = performance.now();
    if (now - _mapGazeLastLoggedMs > MAP_GAZE_LOG_INTERVAL_MS) {
      _mapGazeLastLoggedMs = now;
      console.error(
        `[calib] mapGaze exception (${_mapGazeConsecutiveErrors} consecutivo(s)):`, e,
      );
    }
    return null;
  }

  // Fusão binocular ponderada. Sem `perEyeWeight` é média simples. A
  // confiabilidade medida na calibração compõe com o peso instantâneo: são
  // coisas diferentes (`perEyeWeight` = o olho está aberto agora?;
  // `eyeReliability` = quão bem o modelo daquele olho mapeia íris → tela).
  let wL = perEyeWeight ? Math.max(MIN_EYE_WEIGHT, perEyeWeight.left) : 1;
  let wR = perEyeWeight ? Math.max(MIN_EYE_WEIGHT, perEyeWeight.right) : 1;
  if (eyeReliability) {
    wL *= Math.max(MIN_EYE_WEIGHT, eyeReliability.left);
    wR *= Math.max(MIN_EYE_WEIGHT, eyeReliability.right);
  }
  if (eyeDominance === 'left')  wL *= DOMINANCE_GAIN;
  if (eyeDominance === 'right') wR *= DOMINANCE_GAIN;
  const wSum = wL + wR;
  let baseX = (predLeft.x * wL + predRight.x * wR) / wSum;
  let baseY = (predLeft.y * wL + predRight.y * wR) / wSum;

  // softClamp: Hermite cúbico com derivada contínua nas duas junções (C¹) —
  // f(0)=0, f(m)=m, f'(m)=1 e o espelho no outro lado. Dentro de [m, 1-m] é
  // identidade; nas bordas o slope vai de 0 a 1 sem salto de velocidade. Uma
  // margem de 2% afeta só ~38 px de cada lado em 1920 px.
  const SOFT_MARGIN = 0.02;
  function softClamp(v: number): number {
    if (v <= 0) return 0;
    if (v >= 1) return 1;
    if (v < SOFT_MARGIN) {
      // Hermite cúbico: t = v/m ∈ [0,1], f(v) = m · t²(2-t).
      // Verificação: f(0)=0 ✓, f(m)=m·1·1=m ✓, f'(0)=0 ✓,
      // f'(v) = (1/m)·m·(4t-3t²) = t(4-3t), f'(m) = 1·(4-3)=1 ✓
      const t = v / SOFT_MARGIN;
      return SOFT_MARGIN * t * t * (2 - t);
    }
    if (v > 1 - SOFT_MARGIN) {
      // Espelha: t = (1-v)/m ∈ [0,1], f = 1 - m · t²(2-t)
      const t = (1 - v) / SOFT_MARGIN;
      return 1 - SOFT_MARGIN * t * t * (2 - t);
    }
    return v;
  }
  // Compensação de distância, aplicada em espaço NORMALIZADO e ANTES do
  // softClamp.
  //
  // Antes do clamp porque o clamp é quem garante que o resultado fique dentro
  // da tela; compensar depois poderia empurrar o valor para fora de novo.
  // Em espaço normalizado o centro é 0,5 — e o centro é o ponto fixo correto,
  // porque olhar para o centro corresponde a ângulo zero, que não depende de
  // distância nenhuma.
  const range = evaluateDistanceRange(
    getCurrentCameraDistanceCm(),
    calibrationCameraDistanceCm,
    calibrationScreenDistanceCm,
  );
  lastDistanceRange = range;
  const compensado = applyDistanceRatioToPrediction(baseX, baseY, 1, 1, range.ratio);

  // Compensação geométrica de pose, também antes do softClamp e pelo mesmo
  // motivo. A translação lateral vem depois da rotação: são efeitos
  // independentes que se somam no mesmo ponto predito.
  const comPose0 = EXPERIMENT.geometricPoseCompensation
    ? compensarPredicao(
        compensado.x, compensado.y,
        latestPose, calibrationReferencePose,
        screenDistancePx(),
        document.documentElement.clientWidth,
        document.documentElement.clientHeight,
      )
    : compensado;

  const comPose = EXPERIMENT.lateralTranslationCompensation
    ? compensarTranslacao(
        comPose0.x, comPose0.y,
        latestFaceCenter, calibrationReferenceCenter, latestFaceScale,
        screenPxPerCm(),
        document.documentElement.clientWidth,
        document.documentElement.clientHeight,
      )
    : comPose0;

  const avgNormX = softClamp(comPose.x);
  const avgNormY = softClamp(comPose.y);

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const result = {
    x: avgNormX * vw,
    y: avgNormY * vh,
  };

  return result;
}
