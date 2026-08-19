import type { GazeRegressor } from './gazeRegressor';
import {
  createRegressor,
  ridgeModelFromRegressor,
  ridgeRegressorFromModel,
  REGRESSOR_MODE
} from './gazeRegressor';
import { StandardScaler } from './scaler';
import { isAccuracyTesting } from './accuracy';
import { RecursiveRidgeRegressor } from './recursiveRidge';
import type { RidgeModel } from './ridge';
import { EXPERIMENT } from './config/experiment';
import type { RecordedSampleDecision } from './telemetry/types';
import {
  profileRegistry,
  shouldWarnPrecisionForCondition,
  type CalibrationProfileMeta,
  type OpticalCondition,
  type StoredCalibrationProfile,
  type ProfileListEntry,
} from './calibrationProfiles';

// Sprint 4 — recalibração implícita. `false` = comportamento antigo (só modelo
// offline). Ligar via `setOnlineCalibrationEnabled(true)` a partir da UI/settings.
export let USE_ONLINE_CALIBRATION = false;

export function setOnlineCalibrationEnabled(enabled: boolean): void {
  USE_ONLINE_CALIBRATION = enabled;
}

// Rampa de mistura base ↔ online. Peso online sobe linearmente até 1.0 após
// ~50 amostras confirmadas — evita que um dwell acidental degrade o modelo
// antes de acumular evidência suficiente.
const ONLINE_RAMP_SAMPLES = 50;

// Rejeição de outlier: se a predição base estiver a mais de N unidades
// normalizadas do alvo do dwell, provavelmente o usuário não estava olhando
// para o botão que disparou. Threshold em fração da tela (0.15 = 15%).
const ONLINE_OUTLIER_THRESHOLD = 0.15;

export interface CalibrationPoint {
  screenX: number;
  screenY: number;
  featuresLeft: number[];
  featuresRight: number[];
  quality?: any | null;
}

export interface GazeCorrection {
  refX: number;
  refY: number;
  offsetX: number;
  offsetY: number;
}

export interface GazeDistanceLogEntry {
  timestamp: number;
  phase: string;
  screenX: number;
  screenY: number;
  nearestDistLeft: number;
  nearestDistRight: number;
  nearestDistAvg: number;
}

// Sprint 2 — amostragem ponderada na periferia. `COLLECTION_MS_BASE` é a
// duração para o ponto central; pontos de canto coletam `+ COLLECTION_MS_RANGE`
// ms adicionais. A justificativa vem de literatura + prática: usuários fixam
// pior nas bordas, e o Ridge extrapola pior perto do limite do fecho convexo.
// Mais amostras nesses pontos reduz variância do fit local.
//
// Valores escalados ×1.402 (12/2026) ao migrar de 13 → 9 pontos (grade 3×3
// 10/50/90). A soma total de tempo de coleta é preservada (~21.2s),
// garantindo o mesmo número de amostras alimentando o Ridge com menos
// fadiga do usuário.
//
// CUIDADO: se o total ultrapassar ~40s (9 pontos × ~2.6s + acomodação), a fadiga
// do usuário-alvo (ELA) piora as fixações finais e anula o ganho. Este budget
// atual: 9 pontos ~ 1680..2800ms + 400ms acomodação = 18.7..28.8s. Ok.
const COLLECTION_MS_BASE = 1680;
const COLLECTION_MS_RANGE = 1120;
const COLLECTION_MS_FALLBACK = COLLECTION_MS_BASE + COLLECTION_MS_RANGE;

export function getCollectionMsForPoint(x: number, y: number): number {
  // Distância euclidiana normalizada do centro (0..1). Centro = 0, cantos = 1.
  const d = Math.hypot(x - 0.5, y - 0.5) / Math.hypot(0.5, 0.5);
  return Math.round(COLLECTION_MS_BASE + d * COLLECTION_MS_RANGE);
}

// A1-2 — portão de variância. O antigo `VARIANCE_THRESHOLD = 0.02` era
// ordem de grandeza irrisória: em A0-5 medimos variâncias entre 0.98 e 1.32
// (sem óculos ~1.02, com óculos ~1.30), então o teto de 0.02 nunca rejeitava
// nada. Mantido como referência histórica para reconhecer casos vindos de
// perfis antigos serializados. **Não usar em código novo.**
const VARIANCE_THRESHOLD_LEGACY_UNUSED = 0.02;
void VARIANCE_THRESHOLD_LEGACY_UNUSED;

// Piso e teto derivados de A0-5 (Rodada A sem óculos: 0.98–1.05; Rodada B
// com óculos: 1.27–1.32). Piso uma ordem de grandeza abaixo do mínimo
// observado — defesa contra features congeladas em outros hardwares, nunca
// acionado no hw testado. Teto entre os dois mundos, para rejeitar reflexo
// de óculos e aceitar sessão limpa com folga. Estes números vão ser afinados
// à medida que mais sessões forem capturadas — sinalizam, não bloqueiam.
const INTRA_POINT_VARIANCE_FLOOR = 0.10;
const INTRA_POINT_VARIANCE_CEIL = 1.15;

// A1-2 — feature "morta" = dimensão cuja variância ENTRE as médias dos 9
// alvos é próxima de zero. Uma feature que não muda entre alvos diferentes
// não carrega informação de olhar. Se mais de DEAD_FEATURE_RATIO do vetor
// estiver morto, o modelo linear não tem sinal para aprender e vai devolver
// o viés (ponto fixo perto do centro dos alvos). É o cenário que a hipótese
// original do plano descrevia para o bug dos óculos; A0-5 mostrou que **não
// é o modo dominante neste hardware**, mas a defesa continua fazendo sentido.
const DEAD_FEATURE_VARIANCE_EPS = 1e-6;
const DEAD_FEATURE_MAX_RATIO = 0.30;

// A1-2 — contadores de breach expostos via __irisflowDebug. Reset em
// startCalibrationMode e clearCalibration.
let varianceFloorBreaches = 0;
let varianceCeilBreaches = 0;

// A1-5 — detecção de reflexo especular por frame. Um único frame com specular
// alto é ruído (piscada de luz, cursor branco cruzando o crop); avisar só
// quando persistente durante um ponto (>SPECULAR_PERSISTENCE dos frames).
// Não rejeita o frame — sinaliza para o cuidador que a lente pode estar
// refletindo. Sinal barato: qualityAnalyzer já calcula.
const SPECULAR_FRAME_THRESHOLD = 0.02;      // 2% do crop saturado = "há reflexo"
const SPECULAR_PERSISTENCE     = 0.30;      // >30% dos frames do ponto → warn
let currentPointSpecularHits   = 0;         // frames deste ponto com specular alto
let currentPointFramesAccepted = 0;         // frames deste ponto que passaram os gates
let specularWarningsIssued     = 0;         // pontos que dispararam o warn

const DIST_LOG_CAPACITY = 500;
const distanceLog: GazeDistanceLogEntry[] = [];

// Hotfix — rejeição por deriva de pose dentro do ponto de calibração.
// Motivação: no primeiro teste real, a coluna X esquerda colapsou para o
// centro. Assinatura clássica de colinearidade yaw↔offsetX na calibração:
// o usuário move a cabeça sem perceber ao virar o olhar, e o Ridge não
// consegue separar as duas contribuições. Filtramos aqui para forçar que
// as amostras de cada ponto tenham pose homogênea.
//
// Threshold em radianos. 0.087 rad ≈ 5°. Baseline é a pose observada no
// primeiro frame ACEITO do ponto (já pós-acomodação).
const POSE_DRIFT_YAW_MAX   = 0.087;
const POSE_DRIFT_PITCH_MAX = 0.087;
const POSE_DRIFT_ROLL_MAX  = 0.087;

let currentPointBaselinePose: { yaw: number; pitch: number; roll: number } | null = null;
let poseDriftRejects = 0;

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

export function consumeLastSampleDecision(): RecordedSampleDecision | null {
  const d = lastDecision;
  lastDecision = null;
  return d;
}

let regressorLeft: GazeRegressor | null = null;
let regressorRight: GazeRegressor | null = null;
export const featureScalerLeft = new StandardScaler();
export const featureScalerRight = new StandardScaler();

// A1-6 — meta da sessão de calibração em curso. Setada por startCalibrationMode
// (default: `desconhecido`), consumida por completeCalibration para salvar o
// perfil resultante no registry por condição óptica.
let pendingProfileMeta: CalibrationProfileMeta | null = null;

let scaledProfileLeft: number[][] = [];
let scaledProfileRight: number[][] = [];
let _gazeCorrections: GazeCorrection[] = [];

let onlineLeft: RecursiveRidgeRegressor | null = null;
let onlineRight: RecursiveRidgeRegressor | null = null;

export function isCalibrated(): boolean {
  return regressorLeft !== null && regressorRight !== null;
}

export function clearCalibration() {
  profile = [];
  regressorLeft = null;
  regressorRight = null;
  _gazeCorrections = [];
  onlineLeft = null;
  onlineRight = null;
  varianceFloorBreaches = 0;
  varianceCeilBreaches = 0;
  currentPointSpecularHits = 0;
  currentPointFramesAccepted = 0;
  specularWarningsIssued = 0;
  pendingProfileMeta = null;
}

export function getSampleCount(): number {
  return profile.length;
}

export function getCurrentLambda(): number {
  // Compat: devolve o λ do olho esquerdo. Consumidores novos devem preferir
  // getLambdaDiagnostics() para pegar os dois olhos + razão de disparidade.
  const diag = getLambdaDiagnostics();
  return diag?.left ?? 0;
}

// A1-3 — diagnóstico de regularização. Uma razão λ_max/λ_min > 10 entre os
// dois olhos indica que o CV está detectando dado ruim em pelo menos um dos
// lados (A0-5 observou λ=1 num olho e λ=0.01 no outro com óculos, ratio 100).
// nearSingular* revela colunas do vetor de features que degeneram no treino.
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

export function loadProfile(): boolean {
  regressorLeft = null;
  regressorRight = null;
  return false;
}

function saveProfile() {
  // Saved profiles disabled
}

export function setGazeCorrections(corrections: GazeCorrection[]): void {
  _gazeCorrections = corrections;
  console.log(`[calib] mapa de correção: ${corrections.length} pontos de referência aplicados`);
}

function applyGazeCorrection(x: number, y: number): { x: number; y: number } {
  if (!EXPERIMENT.applyGazeCorrection) return { x, y };
  if (_gazeCorrections.length < 3) return { x, y };

  let sumW = 0, cx = 0, cy = 0;
  for (const c of _gazeCorrections) {
    const dx = x - c.refX;
    const dy = y - c.refY;
    const w = 1.0 / (dx * dx + dy * dy + 1.0);
    cx += c.offsetX * w;
    cy += c.offsetY * w;
    sumW += w;
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

function currentGazePhase(): string {
  if (isCalibrating) return 'calibration';
  if (isAccuracyTesting) return 'accuracy_test';
  return 'live';
}

function logGazeDistance(entry: GazeDistanceLogEntry): void {
  distanceLog.push(entry);
  if (distanceLog.length > DIST_LOG_CAPACITY) distanceLog.shift();
}

export function getGazeDistanceLog(): GazeDistanceLogEntry[] {
  return distanceLog.slice();
}

export function exportGazeDistanceLog(): void {
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

// ── Headless Calibration API ──────────────────────────────────────────────────

export function startCalibrationMode(
  opts?: { opticalCondition?: OpticalCondition; label?: string },
) {
  isCalibrating = true;
  profile = [];
  regressorLeft = null;
  regressorRight = null;
  _gazeCorrections = [];
  scaledProfileLeft = [];
  scaledProfileRight = [];
  onlineLeft = null;
  onlineRight = null;
  varianceFloorBreaches = 0;
  varianceCeilBreaches = 0;
  currentPointSpecularHits = 0;
  currentPointFramesAccepted = 0;
  specularWarningsIssued = 0;

  // A1-6 — meta para o perfil que resultar desta calibração. Default
  // `desconhecido` porque a UI que pergunta a condição óptica (B1-6/B2-1)
  // ainda não existe; quando existir, o React passa a condição explícita.
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

  currentTargetX = x;
  currentTargetY = y;
  currentCollectionMs = getCollectionMsForPoint(x, y);
  isCollecting = true;
  collectionStartTime = performance.now();
  collectedFeaturesLeft = [];
  collectedFeaturesRight = [];
  collectedQualities = [];
  pointCompleteCallback = onDone;
  currentPointBaselinePose = null;
  poseDriftRejects = 0;
  currentPointSpecularHits = 0;
  currentPointFramesAccepted = 0;

  console.log(`[calib] ▶ Coletando ponto (${(x*100).toFixed(0)}%, ${(y*100).toFixed(0)}%) — aguardando ${currentCollectionMs}ms + 400ms acomodação`);

  // Hard timeout: if feedRawData never fires the callback (e.g. all frames
  // discarded by quality filters, or face not detected during the window),
  // force processStaticPoint after currentCollectionMs + 800ms grace period.
  collectionTimeoutHandle = setTimeout(() => {
    collectionTimeoutHandle = null;
    if (isCollecting) {
      console.warn(`[calib] ⏱ Timeout! isCollecting ainda true após ${currentCollectionMs + 800}ms. Amostras coletadas: ${collectedFeaturesLeft.length}`);
      isCollecting = false;
      processStaticPoint();
    }
  }, currentCollectionMs + 800);
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

// A1-2 — variância ENTRE alvos (não dentro do alvo). Para cada dimensão de
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
    lastDecision = { accepted: false, elapsedMs: 0, reason: 'not_collecting' };
    return;
  }

  const elapsed = performance.now() - collectionStartTime;

  // Descartar os primeiros 400ms (fase de sacada / acomodação)
  if (elapsed < 400) {
    lastDecision = { accepted: false, elapsedMs: elapsed, reason: 'acclimation' };
    return;
  }

  // Sprint 1.1 — filtros de qualidade agora usam valores reais medidos no
  // crop dos olhos por `EyeQualityAnalyzer` (não mais constantes hardcoded).
  //
  // Thresholds iniciais, conservadores. Precisam ser refinados com base nos
  // valores observados durante a coleta de baseline:
  //   - detectorConfidence < 0.4 → landmarks muito instáveis (movimento brusco)
  //   - brightness  < 0.08       → região do olho quase preta (câmera obstruída
  //                                ou usuário no escuro total)
  //   - brightness  > 0.92       → over-exposto (contraluz forte)
  //   - contrast    < 0.02       → imagem sem estrutura (borrão total)
  //   - blur        > 0.85       → foco perdido / rosto muito distante
  //   - irisVisibilityPercentage < 0.3 → pálpebra semi-fechada / piscada
  if (quality) {
    if (
      quality.irisVisibilityPercentage < 0.3 ||
      quality.detectorConfidence < 0.4 ||
      (typeof quality.brightnessEstimate === 'number' && (quality.brightnessEstimate < 0.08 || quality.brightnessEstimate > 0.92)) ||
      (typeof quality.contrastEstimate === 'number' && quality.contrastEstimate < 0.02) ||
      (typeof quality.blurEstimate === 'number' && quality.blurEstimate > 0.85)
    ) {
      lastDecision = { accepted: false, elapsedMs: elapsed, reason: 'quality' };
      return; // Ignora frame ruim
    }

    // Hotfix — deriva de pose dentro do ponto. `currentPointBaselinePose` é
    // fixado no primeiro frame que sobrevive aos filtros de qualidade.
    // Se a cabeça se afastar dessa referência dentro da janela, o ponto
    // encerra virando amostras com pose inconsistente — Ridge não separa
    // yaw da cabeça de yaw do olhar.
    if (
      typeof quality.yaw === 'number' &&
      typeof quality.pitch === 'number' &&
      typeof quality.roll === 'number'
    ) {
      if (!currentPointBaselinePose) {
        currentPointBaselinePose = {
          yaw: quality.yaw,
          pitch: quality.pitch,
          roll: quality.roll,
        };
      } else {
        if (
          Math.abs(quality.yaw   - currentPointBaselinePose.yaw)   > POSE_DRIFT_YAW_MAX ||
          Math.abs(quality.pitch - currentPointBaselinePose.pitch) > POSE_DRIFT_PITCH_MAX ||
          Math.abs(quality.roll  - currentPointBaselinePose.roll)  > POSE_DRIFT_ROLL_MAX
        ) {
          poseDriftRejects++;
          lastDecision = { accepted: false, elapsedMs: elapsed, reason: 'pose_drift' };
          return;
        }
      }
    }
  }

  collectedFeaturesLeft.push(featuresLeft);
  collectedFeaturesRight.push(featuresRight);
  collectedQualities.push(quality ?? null);

  // A1-5 — contagem de frames com reflexo especular alto. Não rejeita nada
  // (regra do plano: prevenir vale mais que rejeitar); só acumula para o
  // sumário do ponto avisar.
  currentPointFramesAccepted++;
  if (quality && typeof quality.specularRatio === 'number' && quality.specularRatio > SPECULAR_FRAME_THRESHOLD) {
    currentPointSpecularHits++;
  }

  lastDecision = { accepted: true, elapsedMs: elapsed };

  if (elapsed >= currentCollectionMs) {
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
    `[calib] processStaticPoint — amostras: ${collectedFeaturesLeft.length} | poseDriftRejects=${poseDriftRejects}`,
  );

  // If no samples were collected at all (face not visible, all frames discarded
  // by quality filter), report failure so the UI can retry this point.
  if (collectedFeaturesLeft.length === 0) {
    console.warn('[calib] ✗ Nenhuma amostra coletada — rosto ausente ou qualidade insuficiente.');
    const cb = pointCompleteCallback;
    pointCompleteCallback = null;
    if (cb) cb(false);
    return;
  }

  const avgVarLeft = calculateFeatureVariance(collectedFeaturesLeft);
  const avgVarRight = calculateFeatureVariance(collectedFeaturesRight);
  // Nota A0-5: como ~80% das dimensões do vetor de features vêm de landmarks
  // e ângulos compartilhados entre os dois olhos (MUTUAL_INDICES, pose de
  // cabeça), avgVarLeft ≈ avgVarRight até a 6ª casa decimal. NÃO é bug — é
  // decorrência do design do extractor. Usamos a média das duas para o gate,
  // e logamos as duas separadamente só para o developer confirmar o padrão.
  const avgVar = (avgVarLeft + avgVarRight) / 2;

  console.log(
    `[calib] Variância intra-ponto: L=${avgVarLeft.toFixed(6)} R=${avgVarRight.toFixed(6)} avg=${avgVar.toFixed(6)} ` +
    `(faixa [${INTRA_POINT_VARIANCE_FLOOR}, ${INTRA_POINT_VARIANCE_CEIL}])`,
  );

  // A1-5 — reflexo especular persistente no ponto. Só avisa (não bloqueia).
  // Diagnóstico direto para o cuidador ver antes de rodar todos os 9 pontos:
  // se o primeiro já dispara, mudar posição da tela vale mais que continuar.
  if (currentPointFramesAccepted > 0) {
    const specularPct = currentPointSpecularHits / currentPointFramesAccepted;
    if (specularPct > SPECULAR_PERSISTENCE) {
      specularWarningsIssued++;
      console.warn(
        `[calib] ⚠ Reflexo especular persistente no crop ocular: ` +
        `${currentPointSpecularHits}/${currentPointFramesAccepted} frames ` +
        `(${(specularPct * 100).toFixed(0)}% > ${(SPECULAR_PERSISTENCE * 100).toFixed(0)}%). ` +
        `Provável reflexo em óculos ou tela muito próxima. Incline a tela para baixo ou ` +
        `reduza luzes atrás de você.`,
      );
    }
  }

  // A1-2 — portão bidirecional. Continuamos aceitando pontos fora da faixa
  // (comportamento antigo, para não gerar infinite retry loop em usuários
  // inquietos), mas o log agora distingue piso vs. teto e contabiliza breaches
  // para o preflight do treino decidir se aborta.
  if (avgVar < INTRA_POINT_VARIANCE_FLOOR) {
    varianceFloorBreaches++;
    console.warn(
      `[calib] ⚠ Ponto com variância BAIXA (${avgVar.toFixed(6)} < ${INTRA_POINT_VARIANCE_FLOOR}) — ` +
      `features possivelmente congeladas (reflexo, foco perdido). Aceitando com ${collectedFeaturesLeft.length} amostras.`,
    );
  } else if (avgVar > INTRA_POINT_VARIANCE_CEIL) {
    varianceCeilBreaches++;
    console.warn(
      `[calib] ⚠ Ponto com variância ALTA (${avgVar.toFixed(6)} > ${INTRA_POINT_VARIANCE_CEIL}) — ` +
      `usuário instável ou landmarks ruidosos (reflexo em óculos é o padrão A0-5). ` +
      `Aceitando com ${collectedFeaturesLeft.length} amostras.`,
    );
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

function trainScalersAndRegressors(trainingProfile: CalibrationPoint[]): TrainingSummary {
  const trainFeaturesLeft  = trainingProfile.map(p => p.featuresLeft);
  const trainFeaturesRight = trainingProfile.map(p => p.featuresRight);
  const trainTargets = trainingProfile.map(p => ({ screenX: p.screenX, screenY: p.screenY }));

  // A1-2 — preflight: aborta antes do solveLinear se mais de 30% das dims
  // não variam entre alvos diferentes. Falha barata com diagnóstico claro,
  // vs. falhar caro dentro do CV lambda com "Matriz singular na coluna N".
  // A1-1 (pendente) vai propagar essa exceção para a UI; hoje o catch de
  // completeCalibration engole, mas o warn abaixo dá diagnóstico ao dev.
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

  featureScalerLeft.fit(trainFeaturesLeft);
  featureScalerRight.fit(trainFeaturesRight);

  const scaledFeaturesLeft  = featureScalerLeft.transform(trainFeaturesLeft);
  const scaledFeaturesRight = featureScalerRight.transform(trainFeaturesRight);

  const targetsX = trainTargets.map(t => t.screenX);
  const targetsY = trainTargets.map(t => t.screenY);

  regressorLeft = createRegressor(REGRESSOR_MODE);
  regressorLeft.train(scaledFeaturesLeft, targetsX, targetsY);
  regressorRight = createRegressor(REGRESSOR_MODE);
  regressorRight.train(scaledFeaturesRight, targetsX, targetsY);

  scaledProfileLeft  = scaledFeaturesLeft;
  scaledProfileRight = scaledFeaturesRight;

  // A1-3 — sinal de dado ruim que o CV já detecta mas não era propagado.
  // A0-5 observou λ=1 num olho e λ=0.01 no outro com óculos (ratio 100).
  // Um ratio > 10 significa que os dois olhos discordam violentamente sobre
  // quanto regularizar, sinal de que pelo menos um dos lados está com
  // features degeneradas ou ruído desproporcional.
  const diag = getLambdaDiagnostics();
  if (diag && diag.ratio > 10) {
    console.warn(
      `[calib] ⚠ λ discrepante entre olhos: L=${diag.left} R=${diag.right} (ratio=${diag.ratio.toFixed(1)}). ` +
      `Dado provavelmente ruim (reflexo em óculos, iluminação assimétrica). ` +
      `Ver A0-5 no plano.`,
    );
  }

  // Sprint 4 — inicializa os regressores online a partir do modelo Ridge
  // recém-treinado. Só suportado quando o modo ativo é 'ridge' — outros
  // regressores (kernel) não expõem β_x/β_y diretamente.
  onlineLeft = null;
  onlineRight = null;
  if (REGRESSOR_MODE === 'ridge') {
    const modelL = ridgeModelFromRegressor(regressorLeft) as RidgeModel | null;
    const modelR = ridgeModelFromRegressor(regressorRight) as RidgeModel | null;
    if (modelL && modelR) {
      onlineLeft = new RecursiveRidgeRegressor(modelL.betaX, modelL.betaY);
      onlineRight = new RecursiveRidgeRegressor(modelR.betaX, modelR.betaY);
      console.log('[calib] Regressor online (RLS) inicializado a partir do Ridge offline.');
    }
  }

  return { deadFeaturesLeftPct: ratioL, deadFeaturesRightPct: ratioR };
}

export function completeCalibration(onComplete?: () => void) {
  // Cancel any pending collection timeout before finalising
  if (collectionTimeoutHandle !== null) {
    clearTimeout(collectionTimeoutHandle);
    collectionTimeoutHandle = null;
  }
  isCollecting = false;
  pointCompleteCallback = null;

  try {
    const summary = trainScalersAndRegressors(profile);
    saveProfile();
    // A1-6 — snapshot no registry por condição óptica. Se o pendingMeta não
    // foi setado (chamador antigo não passou meta), salva como 'desconhecido'.
    persistActiveProfileToRegistry(summary);
  } catch (e) {
    console.error('[calib] Erro fatal no treinamento:', e);
    // A1-6 — não persistir perfil quando o treino falhou. isCalibrated()
    // continua false por conta dos regressors serem zerados em startCalibrationMode.
  } finally {
    isCalibrating = false;
    if (onComplete) onComplete();
  }
}

// A1-6 — extrai um snapshot serializável do estado atual e enfileira no
// registry sob a meta pendente. Chamador (completeCalibration) só invoca
// quando o treino terminou sem exceção.
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
  const stored: StoredCalibrationProfile = {
    meta,
    modelLeft: modelL,
    modelRight: modelR,
    scalerParamsLeft:  featureScalerLeft.getParams(),
    scalerParamsRight: featureScalerRight.getParams(),
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
    },
  };
  profileRegistry.save(stored);
  console.log(
    `[calib] Perfil salvo no registry: id=${meta.id} condição=${meta.opticalCondition} ` +
    `label='${meta.label}' amostras=${profile.length}`,
  );
}

// A1-6 — troca o perfil ativo (recarrega regressors e scalers a partir do
// snapshot serializado). Devolve o meta do perfil ativado ou null se o id
// não existe. NÃO chama startCalibrationMode — o perfil está pronto, é só
// restaurar o estado.
export function switchActiveProfile(id: string): CalibrationProfileMeta | null {
  const stored = profileRegistry.switchTo(id);
  if (!stored) {
    console.warn(`[calib] switchActiveProfile: id '${id}' não encontrado.`);
    return null;
  }
  regressorLeft = ridgeRegressorFromModel(stored.modelLeft);
  regressorRight = ridgeRegressorFromModel(stored.modelRight);
  featureScalerLeft.setParams(stored.scalerParamsLeft.means, stored.scalerParamsLeft.stds);
  featureScalerRight.setParams(stored.scalerParamsRight.means, stored.scalerParamsRight.stds);
  // Reset dos regressors online — eles são derivados do offline e precisam
  // ser reinicializados a partir dos novos betas.
  onlineLeft = null;
  onlineRight = null;
  if (REGRESSOR_MODE === 'ridge') {
    onlineLeft = new RecursiveRidgeRegressor(stored.modelLeft.betaX, stored.modelLeft.betaY);
    onlineRight = new RecursiveRidgeRegressor(stored.modelRight.betaX, stored.modelRight.betaY);
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
    // O perfil ativo foi apagado — zerar regressors para isCalibrated() dizer a verdade.
    regressorLeft = null;
    regressorRight = null;
    onlineLeft = null;
    onlineRight = null;
  }
  return ok;
}

export function init() {
  loadProfile();
  try {
    const saved = localStorage.getItem("accuracyResult");
    if (saved && isCalibrated()) {
      // O React consumirá isso futuramente
    }
  } catch (_) {}

  (window as unknown as Record<string, unknown>).__exportGazeDistanceLog = exportGazeDistanceLog;

  // A0-5 + A1-3 + A1-2: expõe hooks de diagnóstico do bug dos óculos no console.
  // Uso: __irisflowDebug.isCalibrated(), __irisflowDebug.lambdaDiag(),
  //      __irisflowDebug.varianceBreaches(), __irisflowDebug.deadFeatures().
  // Remover quando A1 estiver estável.
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
  };
}

export function feedFaceMetrics(_detected: boolean, _iod: number): void {
  // O React agora consome isso diretamente via engine e Context
}

// Sprint 4 — hook de recalibração implícita. Chamado quando um dwell click é
// confirmado sobre um botão da UI; alvo em pixels de tela (o centro do botão).
//
// Rejeita a amostra se:
//   - Flag `USE_ONLINE_CALIBRATION` está desligada
//   - Modelo offline não treinado
//   - Predição atual está a mais de ONLINE_OUTLIER_THRESHOLD (em unidades
//     normalizadas de tela) do alvo — provável falso positivo (o usuário
//     estava olhando para outro elemento quando o dwell disparou).
//
// Retorna `true` se a amostra foi aceita e usada.
export function feedOnlineSample(
  featuresLeft: number[],
  featuresRight: number[],
  targetXpx: number,
  targetYpx: number,
): boolean {
  if (!USE_ONLINE_CALIBRATION) return false;
  if (!onlineLeft || !onlineRight) return false;
  if (!regressorLeft || !regressorRight) return false;

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const targetX = targetXpx / vw;
  const targetY = targetYpx / vh;

  const scaledLeft  = featureScalerLeft.transformSingle(featuresLeft);
  const scaledRight = featureScalerRight.transformSingle(featuresRight);

  // Rejeição de outlier via predição do modelo BASE — o online ainda está
  // aprendendo e não deve ser usado para julgar seus próprios inputs.
  const baseLeft  = regressorLeft.predict(scaledLeft);
  const baseRight = regressorRight.predict(scaledRight);
  const basePredX = (baseLeft.x + baseRight.x) / 2;
  const basePredY = (baseLeft.y + baseRight.y) / 2;
  const distToTarget = Math.hypot(basePredX - targetX, basePredY - targetY);
  if (distToTarget > ONLINE_OUTLIER_THRESHOLD) {
    console.log(
      `[calib] Online sample rejeitada — pred=(${basePredX.toFixed(3)},${basePredY.toFixed(3)}) alvo=(${targetX.toFixed(3)},${targetY.toFixed(3)}) dist=${distToTarget.toFixed(3)} > ${ONLINE_OUTLIER_THRESHOLD}`,
    );
    return false;
  }

  onlineLeft.update(scaledLeft, targetX, targetY);
  onlineRight.update(scaledRight, targetX, targetY);
  return true;
}

export function onlineSampleCount(): number {
  if (!onlineLeft || !onlineRight) return 0;
  return Math.min(onlineLeft.n, onlineRight.n);
}

// Fase 0.1 — expõe o alvo atual da coleta em px de viewport, para o gravador
// de sessão anexar como ground-truth no frame. Retorna null quando não há
// ponto sendo coletado (fora da calibração, ou entre pontos). Devolve o
// centro do dot mesmo durante os 400 ms de acomodação — o dot está visível
// ali, o replay precisa saber disso.
export function getCurrentTargetPx(): { xPx: number; yPx: number } | null {
  if (!isCalibrating || !isCollecting) return null;
  if (typeof document === 'undefined') return null;
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  return { xPx: currentTargetX * vw, yPx: currentTargetY * vh };
}

let _dimErrorLogged = false;

export function mapGaze(
  featuresLeft: number[],
  featuresRight: number[],
): { x: number; y: number } | null {
  if (!regressorLeft || !regressorRight) return null;

  const scaledLeft  = featureScalerLeft.transformSingle(featuresLeft);
  const scaledRight = featureScalerRight.transformSingle(featuresRight);

  let predLeft: { x: number; y: number };
  let predRight: { x: number; y: number };
  try {
    predLeft = regressorLeft.predict(scaledLeft);
    predRight = regressorRight.predict(scaledRight);
    _dimErrorLogged = false; // reseta a flag num frame feliz
  } catch (e) {
    if (!_dimErrorLogged) {
      console.error(e);
      _dimErrorLogged = true;
    }
    return null;
  }

  let baseX = (predLeft.x + predRight.x) / 2;
  let baseY = (predLeft.y + predRight.y) / 2;

  // Sprint 4 — mistura com o modelo online (RLS) quando habilitado e após
  // acumular amostras suficientes. Rampa linear em [0,1] evita degradar o
  // baseline antes de acumular evidência.
  if (USE_ONLINE_CALIBRATION && onlineLeft && onlineRight) {
    const nOnline = Math.min(onlineLeft.n, onlineRight.n);
    if (nOnline > 0) {
      const onlinePredLeft = onlineLeft.predict(scaledLeft);
      const onlinePredRight = onlineRight.predict(scaledRight);
      const onlineX = (onlinePredLeft.x + onlinePredRight.x) / 2;
      const onlineY = (onlinePredLeft.y + onlinePredRight.y) / 2;
      const w = Math.min(1, nOnline / ONLINE_RAMP_SAMPLES);
      baseX = (1 - w) * baseX + w * onlineX;
      baseY = (1 - w) * baseY + w * onlineY;
    }
  }

  // Clamp em unidades normalizadas [0,1] APÓS a média binocular (Sprint 1.2).
  // Fazer o clamp aqui, e não em `predictRidge`, evita o viés de borda descrito
  // no comentário de ridge.ts.
  const avgNormX = Math.min(1, Math.max(0, baseX));
  const avgNormY = Math.min(1, Math.max(0, baseY));

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;
  const result = {
    x: avgNormX * vw,
    y: avgNormY * vh,
  };

  if (EXPERIMENT.enableDistanceLog) {
    const nearestDistLeft  = nearestDistance(scaledLeft, scaledProfileLeft);
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
  }

  return applyGazeCorrection(result.x, result.y);
}
