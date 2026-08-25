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
import { trainRidgeModel, predictRidge } from './ridge';
import {
  applyDistanceCorrectionToFeatures,
  computeDistanceCorrectionRatio,
} from './distanceCorrection';
import { EXPERIMENT } from './config/experiment';
import type { RecordedSampleDecision } from './telemetry/types';
import { resetEarHistory } from './extractor';
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

// ── Ponderação binocular ────────────────────────────────────────────────────
// Antes: `mapGaze` fazia média simples (0.5 · L + 0.5 · R). Com um dos olhos
// parcialmente fechado (piscadinha curta que não dispara o BlinkDetector,
// ptose unilateral, franja, reflexo em uma das lentes), a média puxa a
// predição para longe do alvo real. Agora o engine passa um peso por olho
// derivado do EAR de cada olho — e o `mapGaze` mistura na razão desses pesos.
// A dominância ocular do usuário (SettingsContext.eyeDominance) entra como
// um multiplicador extra.
export type EyeDominance = 'left' | 'right' | 'both';
let eyeDominance: EyeDominance = 'both';
// Ganho aplicado ao olho dominante. 1.5× é conservador — dá vantagem clara
// mas não elimina o não-dominante em condições normais.
const DOMINANCE_GAIN = 1.5;

export function setEyeDominance(d: EyeDominance): void {
  eyeDominance = d;
}
export function getEyeDominance(): EyeDominance {
  return eyeDominance;
}

// Correção de bias em sessão (drift compensation).
// A cada dwell click bem-sucedido registramos um resíduo (alvo − predição)
// e mantemos um EMA. O offset resultante é somado à predição do frame.
// Diferente do RLS (feedOnlineSample), isto só corrige o VIÉS global (2 dofs),
// nunca mexe nos coeficientes do Ridge.
//
// Default DESLIGADO. `feedOnlineSample` é disparado em todo dwell click da UI
// (ver GazeContext.tsx:255), não só em contextos onde faz sentido "aprender"
// deriva. Cada dwell num botão arbitrário injeta um resíduo no EMA — em teste
// controlado (2 rodadas de accuracy sem recalibrar, 2026-08-22) o bias saturou
// no clamp e degradou o meanError de 184 px para 521 px. Feature fica pronta,
// mas exige opt-in explícito via setSessionBiasEnabled(true).
const SESSION_BIAS_ALPHA = 0.35;      // agressividade do EMA (0..1)
const SESSION_BIAS_MAX_NORM = 0.08;   // clamp em 8% da tela (evita drift patológico)
let biasX = 0;                        // em coord normalizada [0..1]
let biasY = 0;
let biasSamples = 0;
let sessionBiasEnabled = false;

export function setSessionBiasEnabled(enabled: boolean): void {
  sessionBiasEnabled = enabled;
  if (!enabled) resetSessionBias();
}
export function resetSessionBias(): void {
  biasX = 0; biasY = 0; biasSamples = 0;
}
export function getSessionBias(): { x: number; y: number; samples: number } {
  return { x: biasX, y: biasY, samples: biasSamples };
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

// D5.2 — `cameraDistanceEstimate` médio durante a calibração. Serve de
// distância de REFERÊNCIA para a correção geométrica em mapGaze. Null
// enquanto não houver calibração treinada, e null se nenhum `quality`
// dos pontos carregou o valor (compat com callers antigos). O que
// mapGaze faz com null: sem correção (comportamento pré-D5.2).
let calibrationRefDistance: number | null = null;

export function getCalibrationRefDistance(): number | null {
  return calibrationRefDistance;
}

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
  resetSessionBias();
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

// A2-7 — persistência de perfis de calibração.
//
// Por que localStorage e não IndexedDB: os perfis são pequenos (~30-50 KB
// de modelos Ridge + scalers + metadados) e o acesso síncrono do localStorage
// simplifica a integração com `init()` que precisa restaurar antes do primeiro
// frame. IndexedDB seria melhor para múltiplos perfis grandes; se isso virar
// problema, migramos o storage sem mudar a API.
//
// Invalidação:
//   - `featureDim` diferente → pipeline mudou (nova versão ou A2-5 ligado)
//   - `screenW`/`screenH` diferente → Ridge mapeia para pixel; tela diferente
//     desloca sistematicamente todas as predições
//   - `videoW`/`videoH` diferente → aspecto do crop mudou
//   - `experimentId` diferente → flags de A2 mudaram (isotropicLandmarks etc.)
//   - `createdAt` > 24 h → oferece revalidação, não bloqueia

const PROFILES_STORAGE_KEY = 'irisflow.calib.profiles';
const PROFILES_MAX_AGE_MS = 24 * 60 * 60 * 1000;

function buildContextKey(): string {
  // Identificador compacto do contexto em que o perfil foi criado.
  // Usado para detectar incompatibilidade (tela diferente, pipeline diferente).
  const sw = typeof window !== 'undefined' ? window.screen.width : 0;
  const sh = typeof window !== 'undefined' ? window.screen.height : 0;
  // Inclui as flags de A2 que mudam o vetor
  const expKey = [
    EXPERIMENT.isotropicLandmarks ? 'iso' : '',
    EXPERIMENT.applyGazeCorrection ? 'rbf' : '',
  ].filter(Boolean).join(',') || 'default';
  return `${sw}x${sh}_${expKey}`;
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
  // A2-7 — tenta restaurar o perfil mais recente válido do localStorage.
  regressorLeft = null;
  regressorRight = null;

  const profiles = tryParseStoredProfiles();
  if (profiles.length === 0) return false;

  const contextKey = buildContextKey();
  const nowMs = Date.now();

  // Filtra e ordena por data (mais recente primeiro)
  const valid = profiles
    .filter(p => {
      // Validação de contexto: tela ou pipeline diferente → incompatível
      if ((p as unknown as Record<string, unknown>)._contextKey !== contextKey) {
        console.warn(`[calib] perfil ${p.meta.id} incompatível (contexto diferente) — ignorado`);
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
    console.log(`[calib] perfil restaurado: ${best.meta.label} (${best.meta.opticalCondition}), ${age > PROFILES_MAX_AGE_MS ? '⚠️ >24h' : 'válido'}`);
    return true;
  } catch (e) {
    console.warn('[calib] falha ao restaurar perfil:', e);
    regressorLeft = null;
    regressorRight = null;
    return false;
  }
}

function saveProfile() {
  // A2-7 — persiste todos os perfis do registry no localStorage.
  // Chamado após `persistActiveProfileToRegistry` em `completeCalibration`.
  if (typeof localStorage === 'undefined') return;
  try {
    const all = profileRegistry.list();
    const profiles = all.map(entry => {
      const stored = profileRegistry.get(entry.meta.id)!;
      // Anota o contexto no perfil para invalidação futura
      return { ...stored, _contextKey: buildContextKey() };
    });
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

export function setGazeCorrections(corrections: GazeCorrection[]): void {
  _gazeCorrections = corrections;
  console.log(`[calib] mapa de correção: ${corrections.length} pontos de referência aplicados`);
}

function applyGazeCorrection(x: number, y: number): { x: number; y: number } {
  if (!EXPERIMENT.applyGazeCorrection) return { x, y };
  if (_gazeCorrections.length < 3) return { x, y };

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  let sumW = 0, cx = 0, cy = 0;
  for (const c of _gazeCorrections) {
    // BUG-6: antes as distâncias estavam em pixels (dx ~ centenas), então
    // o +1.0 era irrisório (w = 1/(dist²+1) ≈ 1/10000 para 100px).
    // Na prática só o ponto mais próximo influenciava. Normalizar por vw/vh
    // garante que dx ∈ [0..1] e o kernel RBF opera em escala correta.
    const dx = (x - c.refX) / vw;
    const dy = (y - c.refY) / vh;
    const w = 1.0 / (dx * dx + dy * dy + 1e-4);
    cx += c.offsetX * w;
    cy += c.offsetY * w;
    sumW += w;
  }
  cx /= sumW;
  cy /= sumW;

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

// D6.1 (ROADMAP §5) — coordenadas dos alvos de calibração, exportadas para
// a UI consumir a MESMA lista canônica. Cada entrada é fração da tela
// [0..1]. Grade 3×3 nas margens de 10/50/90% é a mesma histórica (ver
// `CalibrationCheck.tsx:CALIBRATION_POINTS`). O modo rápido usa APENAS os 4
// cantos: coerente com o achado Frontiers 2024 citado no §3 do ROADMAP (4
// pontos → ~3,2–3,3° em outro sistema webcam). Centro é omitido de propósito
// — os 4 cantos dão exatamente 4 restrições independentes na média binocular,
// que é o mínimo pra estimar bias + escala em x e y sem singularidade.
export const CALIBRATION_TARGETS_FULL: readonly { x: number; y: number }[] = [
  { x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.9, y: 0.1 },
  { x: 0.1, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 },
  { x: 0.1, y: 0.9 }, { x: 0.5, y: 0.9 }, { x: 0.9, y: 0.9 },
];
export const CALIBRATION_TARGETS_QUICK: readonly { x: number; y: number }[] = [
  { x: 0.1, y: 0.1 }, { x: 0.9, y: 0.1 },
  { x: 0.1, y: 0.9 }, { x: 0.9, y: 0.9 },
];

// D6.1 — modo em execução. `null` quando não está calibrando.
let currentCalibrationMode: 'full' | 'quick' | null = null;

export function getCalibrationMode(): 'full' | 'quick' | null {
  return currentCalibrationMode;
}

/** Alvos ativos para a sessão de calibração em curso. Se nenhuma calibração
 *  está ativa, retorna a lista FULL (default histórico) — útil para a UI
 *  renderizar a grade antes de decidir o modo. */
export function getCalibrationTargets(): readonly { x: number; y: number }[] {
  return currentCalibrationMode === 'quick'
    ? CALIBRATION_TARGETS_QUICK
    : CALIBRATION_TARGETS_FULL;
}

export function startCalibrationMode(
  opts?: { opticalCondition?: OpticalCondition; label?: string; quick?: boolean },
) {
  // BUG-1: reset earHistory para que o threshold adaptativo de piscada
  // não venha enviesado de sessões anteriores.
  resetEarHistory();

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
  resetSessionBias();

  // D6.1 — modo ativo. Consulta pública via getCalibrationTargets() para a UI
  // renderizar 4 cantos (quick) ou grade 3×3 (full). Comportamento default
  // permanece 'full' quando `quick` não é passado — perfis pré-D6 seguem iguais.
  currentCalibrationMode = opts?.quick ? 'quick' : 'full';
  if (currentCalibrationMode === 'quick') {
    // ⚠️ RISCO RECONHECIDO (ROADMAP §5 D6, "Riscos"): 4 alvos × ~44 dims/olho
    // é razão amostra:dim de ~0.09 no vetor bruto. Cada alvo contribui ~50-65
    // amostras aceitas → ~200-260 amostras totais, o que TÓRICAMENTE fecha o
    // sistema, mas os termos quadráticos de pose (extractor [31..36]) ficam
    // pouco restringidos. Contramedida: o CV de λ em ridge.ts já escolhe
    // regularização mais forte se detectar overfit; e detectOutlierPoints
    // (D4.2) só emite `insufficient_targets` para < 3 alvos — o que N=4
    // não dispara. Se a decisão pós-medição mostrar que a precisão do modo
    // rápido é sistematicamente pior, a solução mais defensável não é reduzir
    // o vetor (isso força invalidar todos os perfis salvos), é considerar
    // uma variante do modo rápido com 5 pontos (4 cantos + centro). Preserva
    // essa opção como backlog explícito neste comentário.
    console.log('[calib] Modo RÁPIDO (D6.1) — 4 cantos, sem termos quadráticos garantidos.');
  }

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

  // D5.2 — média de `cameraDistanceEstimate` durante a calibração. Fica
  // como a distância de REFERÊNCIA para a correção geométrica opcional
  // em mapGaze. Se nenhum ponto carregou o campo (caller antigo), fica
  // null e mapGaze pula a correção — comportamento pré-D5.2 preservado.
  const camDists = trainingProfile
    .map((p) => (p.quality as { cameraDistanceEstimate?: number } | null | undefined)?.cameraDistanceEstimate)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0);
  calibrationRefDistance = camDists.length > 0
    ? camDists.reduce((a, b) => a + b, 0) / camDists.length
    : null;
  if (calibrationRefDistance !== null) {
    console.log(`[calib] distância câmera-rosto de referência (D5.2): ${calibrationRefDistance.toFixed(4)} (N=${camDists.length} amostras com quality preenchida)`);
  }

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

// D4.1 (ROADMAP §5) — detecção de ponto outlier na calibração.
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
//     1. Treina scaler + Ridge sobre TODOS os pontos EXCETO k (LOO por alvo).
//     2. Prediz cada amostra de k, mede erro (px normalizado) da média.
//     3. Registra o resíduo médio r_k daquele alvo.
//   Calcula MAD = mediana(|r_k - mediana(r)|).
//   Marca k como candidato a outlier se |r_k - mediana(r)| > 3 × MAD × 1.4826.
//   (O 1.4826 é o fator que faz MAD ~ σ para distribuição normal.)
//
// SAÍDA — só sinaliza (regra 4). O caller decide se avisa o cuidador ou não.
// Não bloqueia, não retreina automaticamente sem o ponto.
//
// ⚠️ N pequeno (~9 alvos): o próprio ROADMAP §5 (D4, "Riscos") pede que este
// sinal seja tratado como INDICATIVO, não conclusivo. O log/UI que consumir
// este resultado deve incluir essa ressalva — não criar falsa confiança num
// número pequeno de amostras.
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
// λ (que é caro e não muda a *dominância* do resíduo). Usa λ=1 fixo — o alvo
// não é achar o modelo ótimo, é comparar RESÍDUOS entre alvos deixados de fora
// com o mesmo λ, isolando o efeito do alvo.
const OUTLIER_LOO_LAMBDA = 1.0;
const OUTLIER_MAD_SCALE = 1.4826;      // MAD → σ para distribuição normal
const OUTLIER_ZSCORE_THRESHOLD = 3.0;  // ~conservador; ver ROADMAP D4 riscos
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

    const trainFL = trainIdx.map((i) => points[i].featuresLeft);
    const trainFR = trainIdx.map((i) => points[i].featuresRight);
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
        const pL = predictRidge(modelL, scL.transformSingle(p.featuresLeft));
        const pR = predictRidge(modelR, scR.transformSingle(p.featuresRight));
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

// A1-1 — outcome tipado. O chamador agora sabe se a UI deve mostrar
// "Calibração Concluída" (só se ok=true) ou uma tela de falha com a razão
// específica. Regra 3 do plano: o que a tela afirma tem que ser verdade.
export type CalibrationOutcome =
  | { ok: true }
  | {
      ok: false;
      reason:
        | 'singular_matrix'          // solveLinear lançou mesmo após escalonamento λ (A1-3)
        | 'insufficient_samples'     // profile vazio ou < 2 targets únicos
        | 'degenerate_features'      // preflight de A1-2 (>30% features mortas)
        | 'unknown';
      detail: string;
    };

// A1-1 — classificação de exceções do treino em um CalibrationOutcome.
// Prioriza mensagens específicas do próprio código (degenerate_features,
// singular_matrix) para dar orientação acionável ao cuidador.
function classifyTrainingError(e: unknown, sampleCount: number): CalibrationOutcome {
  const detail = e instanceof Error ? e.message : String(e);
  if (sampleCount === 0) {
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
    const summary = trainScalersAndRegressors(profile);
    saveProfile();
    // A1-6 — snapshot no registry por condição óptica. Se o pendingMeta não
    // foi setado (chamador antigo não passou meta), salva como 'desconhecido'.
    persistActiveProfileToRegistry(summary);
    outcome = { ok: true };
  } catch (e) {
    const failure = classifyTrainingError(e, profile.length);
    outcome = failure;
    // A1-6 — não persistir perfil quando o treino falhou.
    // A1-1 — garantir que isCalibrated() diga a verdade após falha.
    // Zeramos os regressors mesmo se algum tiver sobrevivido parcialmente.
    regressorLeft = null;
    regressorRight = null;
    pendingProfileMeta = null;
    if (!failure.ok) {
      console.error(`[calib] ✗ Calibração falhou (${failure.reason}): ${failure.detail}`);
    }
  } finally {
    isCalibrating = false;
    // D6.1 — libera o modo. `getCalibrationTargets()` volta ao default 'full'.
    currentCalibrationMode = null;
    if (onComplete) onComplete(outcome!);
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

  // D4.2 — corre o detector de outlier ANTES de salvar o perfil, para o campo
  // quality.outlierTargets nascer preenchido. É diagnóstico puro (não muda o
  // treino). Se algo dá errado, log claro mas segue salvando — regra 1 do
  // projeto (falhar alto, não silenciar) sem deixar o perfil sem quality.
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
      // Log honesto e indicativo — ver riscos do D4 no ROADMAP: MAD com N~9
      // é frágil, então nunca chamamos disso "conclusivo".
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
      outlierTargets: outlierSummary,
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
    // D4.2 (ROADMAP §5) — hook para o cuidador/dev ver, no console, quais
    // alvos da última calibração passaram do corte MAD. Roda sob demanda:
    // `__irisflowDebug.outlierTargets()`. Recomputa em cima do `profile`
    // atual (a mesma coisa que persistActiveProfileToRegistry usou), então
    // reflete o estado real do modelo em memória. Retorna null se ainda não
    // há amostras suficientes.
    outlierTargets: () => {
      if (profile.length === 0) return null;
      return detectOutlierPoints(profile);
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
  // Dois caminhos, independentes:
  //   1. Correção de bias em sessão (sempre ativa quando calibrado) — 2 dofs,
  //      EMA sobre resíduo (alvo − predição base). Barato, sem risco de
  //      degradar o modelo.
  //   2. RLS binocular (feature completa, atrás da flag USE_ONLINE_CALIBRATION).
  //      Atualiza os coeficientes β dos dois regressors incrementalmente.
  // Ambos aplicam a mesma rejeição de outlier via predição base.
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

  let absorbed = false;

  // (1) Bias EMA — leve, sempre ativo. `residuo = alvo − predição base` é
  //     a correção que precisamos APLICAR à predição para acertar o alvo,
  //     não subtrair.
  if (sessionBiasEnabled) {
    const rx = targetX - basePredX;
    const ry = targetY - basePredY;
    biasX = (1 - SESSION_BIAS_ALPHA) * biasX + SESSION_BIAS_ALPHA * rx;
    biasY = (1 - SESSION_BIAS_ALPHA) * biasY + SESSION_BIAS_ALPHA * ry;
    // Clamp defensivo — bias grande demais é sinal de calibração ruim, não
    // deriva. Não corrigimos mais que 8% da tela via bias.
    biasX = Math.max(-SESSION_BIAS_MAX_NORM, Math.min(SESSION_BIAS_MAX_NORM, biasX));
    biasY = Math.max(-SESSION_BIAS_MAX_NORM, Math.min(SESSION_BIAS_MAX_NORM, biasY));
    biasSamples++;
    absorbed = true;
  }

  // (2) RLS, opt-in via flag.
  if (USE_ONLINE_CALIBRATION && onlineLeft && onlineRight) {
    onlineLeft.update(scaledLeft, targetX, targetY);
    onlineRight.update(scaledRight, targetX, targetY);
    absorbed = true;
  }

  return absorbed;
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

// A1-1 — antes: `_dimErrorLogged` era one-shot para toda a sessão. Frame 1
// lançava, logava uma vez, e todos os N frames seguintes falhavam em silêncio.
// Combinado com o fallback do nariz no engine, o cursor "funcionava" enquanto
// mapGaze quebrava a 30 Hz sem nenhum sinal.
// Agora: rate-limit por tempo (1×/segundo) + contador de erros consecutivos
// exposto via getMapGazeErrorCount(). Recupera silêncio no caminho feliz
// mas dá visibilidade quando há problema persistente. O estado degradado do
// engine (A1-4) também vai capturar isso — as duas defesas se reforçam.
let _mapGazeConsecutiveErrors = 0;
let _mapGazeLastLoggedMs = 0;
const MAP_GAZE_LOG_INTERVAL_MS = 1000;

export function getMapGazeErrorCount(): number {
  return _mapGazeConsecutiveErrors;
}

// Peso por olho (0..1) derivado do EAR relativo. Fica em escopo de módulo
// para o `mapGaze` de assinatura simples continuar funcionando quando o
// caller antigo (testes de regressão, replay) não passa `perEyeWeight`.
const MIN_EYE_WEIGHT = 0.05;   // nunca zera um olho: mantém alguma contribuição

export function mapGaze(
  featuresLeft: number[],
  featuresRight: number[],
  perEyeWeight?: { left: number; right: number },
  currentCameraDistance?: number | null,
): { x: number; y: number } | null {
  if (!regressorLeft || !regressorRight) return null;

  // D5.2 — correção geométrica de distância câmera-rosto. NO-OP quando:
  //   - flag EXPERIMENT.applyDistanceCorrection = false (default);
  //   - caller não passou currentCameraDistance;
  //   - calibrationRefDistance ainda não foi capturada (perfis pré-D5.2);
  //   - ratio computado sai fora de [1/3, 3] (rejeitado pelo helper).
  // Em qualquer um desses casos, a função pura devolve o vetor idêntico.
  let correctedLeft = featuresLeft;
  let correctedRight = featuresRight;
  if (EXPERIMENT.applyDistanceCorrection) {
    const ratio = computeDistanceCorrectionRatio(currentCameraDistance, calibrationRefDistance);
    if (ratio !== 1) {
      correctedLeft = applyDistanceCorrectionToFeatures(featuresLeft, ratio);
      correctedRight = applyDistanceCorrectionToFeatures(featuresRight, ratio);
    }
  }

  const scaledLeft  = featureScalerLeft.transformSingle(correctedLeft);
  const scaledRight = featureScalerRight.transformSingle(correctedRight);

  let predLeft: { x: number; y: number };
  let predRight: { x: number; y: number };
  try {
    predLeft = regressorLeft.predict(scaledLeft);
    predRight = regressorRight.predict(scaledRight);
    _mapGazeConsecutiveErrors = 0; // caminho feliz: zera contador
  } catch (e) {
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

  // Fusão binocular ponderada. Sem `perEyeWeight` cai no caminho antigo
  // (média simples), preservando os testes existentes. Com pesos, aplica
  // também o multiplicador da dominância ocular do usuário.
  let wL = perEyeWeight ? Math.max(MIN_EYE_WEIGHT, perEyeWeight.left) : 1;
  let wR = perEyeWeight ? Math.max(MIN_EYE_WEIGHT, perEyeWeight.right) : 1;
  if (eyeDominance === 'left')  wL *= DOMINANCE_GAIN;
  if (eyeDominance === 'right') wR *= DOMINANCE_GAIN;
  const wSum = wL + wR;
  let baseX = (predLeft.x * wL + predRight.x * wR) / wSum;
  let baseY = (predLeft.y * wL + predRight.y * wR) / wSum;

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

  // Correção de bias em sessão. Rampa linear em [0..1] evita salto ao juntar
  // primeiras evidências (peso zero na 1ª amostra, cheio a partir de 5).
  if (sessionBiasEnabled && biasSamples > 0) {
    const rampW = Math.min(1, biasSamples / 5);
    baseX += rampW * biasX;
    baseY += rampW * biasY;
  }

  // BUG-4: Soft clamp nas bordas. O clamp abrupto anterior (Math.min/max) fazia
  // o cursor "travar" na borda quando o Ridge extrapolava além dos pontos de
  // calibração (ex.: x=1.15 → x=1.0 instantaneamente). Para o usuário ELA,
  // elementos nas extremas bordas da tela pareciam inacessíveis.
  //
  // Solução: soft clamp — dentro de SOFT_MARGIN (5%) da borda, o movimento é
  // amortecido progressivamente por uma curva sigmoide em vez de cortado abruptamente.
  // Isso preserva a capacidade de alcançar a borda enquanto evita que o cursor
  // "bounce" violentamente fora dos limites da tela.
  //
  // softClamp(v, margin):
  //   - Para v em [margin, 1-margin]: identidade (sem alteração)
  //   - Para v < margin ou v > 1-margin: amortecimento suave até 0 ou 1
  const SOFT_MARGIN = 0.05;
  function softClamp(v: number): number {
    if (v <= 0) return 0;
    if (v >= 1) return 1;
    if (v < SOFT_MARGIN) {
      // Borda esquerda/topo: amortece de 0 até MARGIN
      return SOFT_MARGIN * (1 - Math.cos((v / SOFT_MARGIN) * Math.PI / 2));
    }
    if (v > 1 - SOFT_MARGIN) {
      // Borda direita/baixo: amortece de (1-MARGIN) até 1
      const t = (v - (1 - SOFT_MARGIN)) / SOFT_MARGIN;
      return (1 - SOFT_MARGIN) + SOFT_MARGIN * Math.sin(t * Math.PI / 2);
    }
    return v;
  }
  const avgNormX = softClamp(baseX);
  const avgNormY = softClamp(baseY);

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
