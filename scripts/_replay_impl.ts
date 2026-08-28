// Replay determinístico offline (Fase 0.2 do SPRINTSELA.MD) — implementação.
//
// Este arquivo é bundled+executado por scripts/replay.mjs. Ele não é rodado
// diretamente porque os módulos de src/ usam imports sem extensão (ex:
// `from './types'`), o que Node ESM nativo não resolve mas esbuild sim.
//
// O que faz:
//   1. Lê um .jsonl produzido pelo gravador da Fase 0.1.
//   2. Reagrupa frames por fase (calibração, precisão, uso livre).
//   3. Re-treina scalers + regressor Ridge do zero com os frames de
//      calibração (mesma matemática do calibration.ts, sem depender do
//      document/window).
//   4. Aplica predict + OneEuroFilter aos frames de precisão.
//   5. Calcula métricas equivalentes ao accuracy.ts.
//
// LIMITAÇÕES ASSUMIDAS (documentadas para não haver falha silenciosa):
//   - Não replica applyGazeCorrection (RBF) — o gravador não persiste o
//     mapa de correção; o replay é o baseline sem correção.
//   - Não replica USE_ONLINE_CALIBRATION (RLS) — flag off por default.
//   - Assume USE_COMPACT_FEATURES=true. Se o gravador foi feito com
//     features full, replay aborta com mensagem clara (dims incompatíveis).

import { readFile, writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { RidgeRegressor, withinTargetPenalty } from '../src/ridge';
import { StandardScaler } from '../src/scaler';
import { OneEuroFilter2D, FILTER_PRESETS, FILTER_PRESETS_V2, type FilterPreset, type FilterPresetV2 } from '../src/oneEuroFilter';
import { extractFeatures } from '../src/featurePipeline';
import type { Point3D, L2CSGazeInput } from '../src/extractor';
import { FEATURE_VECTOR_ID, activeFeatureDims, BlinkDetector } from '../src/extractor';
import type { FeatureSet } from '../src/extractor';

/** 1.2 — conjuntos que o harness aceita medir. `compact` fica de fora de
 *  propósito: seu tamanho varia com a presença do bloco L2CS, então uma tabela
 *  comparativa com ele dentro compararia vetores de larguras diferentes. */
const FEATURE_SETS = ['iris12', 'iris12+pose', 'iris12+posecross'] as const;
function isFeatureSet(v: string | undefined): v is FeatureSet {
  return !!v && (FEATURE_SETS as readonly string[]).includes(v);
}
// 1.1 — os limiares do gate vêm do módulo, não de cópias no harness: um
// harness com o número duplicado mede o pipeline de ontem em silêncio.
import {
  POSE_DRIFT_YAW_MAX, POSE_DRIFT_PITCH_MAX, POSE_DRIFT_ROLL_MAX, MIN_ACCEPTED_SAMPLES,
} from '../src/calibration';
import { compensarPredicao, poseDeReferencia } from '../src/poseCompensation';
import { compensarTranslacao, centroDeReferencia } from '../src/translationCompensation';
import { parseJSONL } from '../src/telemetry/recorder';
import type { RecordedFrame, Recording, RecordedTarget } from '../src/telemetry/types';

// Constante espelhada de accuracy.ts (não exportada de lá; se mudar, atualizar
// aqui também — replay tem que usar EXATAMENTE o mesmo valor para os graus
// baterem com os do teste online).
const ASSUMED_DIST_PX = 2268;

/**
 * 1.3 — ganho geométrico da pose, em px de tela por grau de rotação da cabeça.
 *
 * Com o olho parado na órbita e a cabeça girando Δ, o ponto olhado se desloca
 * `d · tan(Δ)`. Em pixels a distância já é `ASSUMED_DIST_PX`, então o ganho é
 * `ASSUMED_DIST_PX · tan(1°)` — e como os pixels são quadrados, é o MESMO nos
 * dois eixos. Essa igualdade entre eixos é o que tornou conclusiva a medição de
 * 1.2: o coeficiente ajustado diferia entre eixos por 7×.
 */
const GANHO_GEOMETRICO_PX_POR_GRAU = ASSUMED_DIST_PX * Math.tan(Math.PI / 180);

// D3.2 (ROADMAP §5) — o replay aceita presets v1 (pixel space) e v2
// (normalized space). Presets v2 são o default do engine desde D1-1, e sem
// suportá-los aqui o baseline offline não bate 1:1 com o accuracy test ao
// vivo — limitação documentada em `frontend/scripts/measure_baseline.mjs`
// como "escopo do D3", que este bloco resolve.
type AnyFilterPreset = FilterPreset | FilterPresetV2;

function isV2Preset(name: string): name is FilterPresetV2 {
  return name.endsWith('-v2') && name in FILTER_PRESETS_V2;
}

function isV1Preset(name: string): name is FilterPreset {
  return name in FILTER_PRESETS;
}

// D4.3 (ROADMAP §5) — ablação de features via replay.
//
// Layout FIXO do vetor de features por olho produzido por
// `extractCompactFeatures` (src/extractor.ts:486). Se a ordem lá mudar, este
// mapa mente silenciosamente — mantê-los em sincronia é responsabilidade de
// quem editar o extractor. Testes de ablação abaixo cobrem o caso "vetor sem
// L2CS = 37 dims", ancorando o limite entre base+pose e L2CS.
//
//   [0..3]    offsetX, offsetY, relX, relY           (4 dims — geometria de íris)
//   [4..11]   irisContour x/y × 4 pontos              (8 dims)
//   [12..19]  eyelid corners x/y × 4                  (8 dims)
//   [20..21]  ear, irisRadius                         (2 dims)
//   [22..24]  pose.yaw, pose.pitch, pose.roll         (3 dims — POSE LINEAR ISOLADA)
//   [25..30]  offset×pose 1ª ordem (6 termos)         (6 dims — INTERAÇÕES LINEARES pose×offset)
//   [31..36]  interações quadráticas/×scale           (6 dims — POSE×POSE / pose×scale)
//   [37..43]  bloco L2CS (7 dims) — só se presente
export type FeatureGroup = 'pose-linear' | 'pose-cross' | 'pose-quadratic' | 'l2cs';
const FEATURE_LAYOUT: Record<FeatureGroup, [number, number]> = {
  'pose-linear':    [22, 25],   // 3 dims — yaw/pitch/roll isolados
  'pose-cross':     [25, 31],   // 6 dims — offset×pose 1ª ordem
  'pose-quadratic': [31, 37],   // 6 dims — pose×pose e pose×scale
  'l2cs':           [37, 44],   // 7 dims — bloco L2CS (buildL2CSBlock)
};

function isFeatureGroup(s: string): s is FeatureGroup {
  return s === 'pose-linear' || s === 'pose-cross' || s === 'pose-quadratic' || s === 'l2cs';
}

/** Zera dimensões dos grupos pedidos IN-PLACE numa cópia — o Ridge treinado
 *  com essas dims == 0 não pode aprender β != 0 nelas, o que é equivalente
 *  a "remover a feature" para o treino (só que sem mudar `numFeatures`, o
 *  que evita mexer no shape do modelo). */
function applyDropGroups(vec: number[], drops: readonly FeatureGroup[]): number[] {
  if (drops.length === 0) return vec;
  const out = vec.slice();
  for (const g of drops) {
    const [start, end] = FEATURE_LAYOUT[g];
    for (let i = start; i < end && i < out.length; i++) out[i] = 0;
  }
  return out;
}

interface CliArgs {
  jsonl: string;
  report?: string;
  filter: AnyFilterPreset;
  verbose: boolean;
  recomputeFeatures: boolean;
  dropFeatures: FeatureGroup[];
  // D7.3 — janela temporal aplicada APENAS aos frames de accuracy (calibração
  // sempre é preservada integralmente, ela é pré-requisito do modelo). Formato
  // do CLI: `--time-window <startSec>,<endSec>`, offsets desde o primeiro
  // captureTs do JSONL. Undefined = sem filtro (comportamento anterior).
  timeWindow?: { startSec: number; endSec: number };
  /**
   * 1.1 — reaplica o gate de pose offline, em vez de honrar a decisão gravada.
   *
   * O replay normalmente reproduz `sampleDecision.accepted` do JSONL. Isso é
   * correto para comparar variantes de FEATURES ou de MODELO, mas torna o
   * harness cego a qualquer mudança no gate de aceitação: mexer na tolerância
   * de pose não muda um único frame do conjunto de treino, e o replay reporta
   * "sem diferença" quando na verdade não mediu nada.
   *
   * Com esta flag o gate de pose é reconstruído a partir da pose gravada por
   * frame. As demais razões de rejeição (`acclimation`, `quality`) continuam
   * vindo da gravação — não mudaram e reexecutá-las só somaria ruído.
   */
  regatePose?: { yawMax: number; pitchMax: number; rollMax: number; minSamples: number };
  /**
   * 1.2 — conjunto de features a medir, sobrepondo `ACTIVE_FEATURE_SET`.
   *
   * Só tem efeito com features RECOMPUTADAS: as gravadas no JSONL já vêm
   * projetadas pelo build que gravou, e reprojetá-las seria fatiar um vetor
   * que já perdeu as dimensões pedidas. `--use-recorded-features` junto com
   * `--feature-set` é rejeitado na entrada por isso.
   */
  featureSet?: FeatureSet;
  /** 1.3 — liga a compensação geométrica de pose na saída. */
  poseCompensation: boolean;
  /**
   * 1.3 — escala aplicada à distância geométrica, para MEDIR o quanto a
   * geometria pura superestima. 1,0 é a geometria sem ajuste e é o único valor
   * que pode ser enviado ao produto; qualquer outro é diagnóstico, porque
   * escolher esse número pela medição é ajustar um parâmetro livre — o mesmo
   * erro que 1.2 documentou.
   */
  poseCompensationGain: number;
  /** 1.3 — ablação por eixo. Não é parâmetro ajustável do produto: serve para
   *  separar qual eixo carrega o viés, já que a análise de resíduo indicou que
   *  quase todo ele está em Y. */
  poseCompensationAxes: 'x' | 'y' | 'xy';
  /**
   * 1.3 — CONTROLE. Desloca a predição por um vetor fixo em px, sem olhar a
   * pose.
   *
   * Existe para responder uma pergunta que a compensação sozinha não responde:
   * se a pose é praticamente constante durante o teste, `d · tan(Δ)` degenera
   * num deslocamento fixo, e qualquer ganho medido seria remoção de viés
   * disfarçada de geometria. Se este controle igualar a compensação, a pose não
   * contribuiu com nada.
   */
  constantShiftPx?: { x: number; y: number };
  /** 1.4 — liga a compensação de translação lateral. */
  translationCompensation: boolean;
  /** 3.1 — projeta as features nas k primeiras componentes principais, para
   *  medir se a redundância do vetor custa. 0 = desligado. */
  pca: number;
  /**
   * 3.1 - mantem apenas estes indices do vetor projetado.
   *
   * Diferente de --pca: aqui as dimensoes sao escolhidas por ANALISE (quais sao
   * redundantes por construcao), nao ordenadas por variancia. A distincao
   * importa porque a PCA truncada piorou em todo k justamente por descartar
   * direcoes de baixa variancia, que e onde o sinal de olhar mora.
   */
  keepDims?: number[];
  /** 3.2 — modo de fusao binocular. Ver `ModoFusao`. */
  fusao: ModoFusao;
  /**
   * 3.1 — pesa os eixos pelas dimensões reais na escolha de λ.
   *
   * Nasce TRUE, porque é o que o app faz. O harness que descreve outro
   * pipeline que não o do build é como `ci-baseline-a2` mediu 44 dims horas
   * depois do commit que reduziu para 12 — ver `FEATURE_VECTOR_ID`.
   * `--normalized-cv` reproduz o comportamento antigo, para comparação.
   */
  axisWeightedCv: boolean;
  /** 3.1 — força um λ, em vez de deixar o CV escolher. */
  lambda?: number;
}

function parseArgs(argv: string[]): CliArgs {
  // 0.1 — `recomputeFeatures` nasce TRUE.
  //
  // O default antigo (usar as features gravadas) é o que permitiu que
  // `ci-baseline-a2.report.json` e `ci-baseline-ablation.report.json` medissem
  // o vetor de 44 dims horas antes do commit que o reduziu para 12, sem que
  // nada acusasse. Recomputar a partir dos landmarks é o único modo de o
  // relatório descrever o pipeline que está no build.
  const args: Partial<CliArgs> = { filter: 'balanceado', verbose: false, recomputeFeatures: true, dropFeatures: [], poseCompensation: false, poseCompensationGain: 1, poseCompensationAxes: 'xy', translationCompensation: false, pca: 0, axisWeightedCv: true, fusao: 'confianca' };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--jsonl') args.jsonl = argv[++i];
    else if (a === '--report') args.report = argv[++i];
    else if (a === '--filter') args.filter = argv[++i] as AnyFilterPreset;
    else if (a === '--verbose' || a === '-v') args.verbose = true;
    else if (a === '--recompute-features') args.recomputeFeatures = true;
    // Opt-in explícito para o comportamento antigo. Útil para reproduzir um
    // relatório histórico bit a bit; nunca para medir o pipeline atual.
    else if (a === '--use-recorded-features') args.recomputeFeatures = false;
    else if (a === '--pose-compensation') args.poseCompensation = true;
    else if (a === '--translation-compensation') args.translationCompensation = true;
    else if (a === '--axis-weighted-cv') args.axisWeightedCv = true;
    else if (a === '--normalized-cv') args.axisWeightedCv = false;
    else if (a === '--lambda') {
      const v = Number(argv[++i]);
      if (!Number.isFinite(v) || v <= 0) throw new Error(`--lambda espera um número > 0; recebi '${argv[i]}'`);
      args.lambda = v;
    }
    else if (a === '--fusion') {
      const m = argv[++i];
      const validos: ModoFusao[] = ['media', 'esquerdo', 'direito', 'confianca', 'concatenado'];
      if (!validos.includes(m as ModoFusao)) {
        throw new Error(`--fusion desconhecido: '${m}'. Validos: ${validos.join(', ')}`);
      }
      args.fusao = m as ModoFusao;
    }
    else if (a === '--keep-dims') {
      const raw = argv[++i];
      const idx = (raw ?? '').split(',').map((x) => Number(x.trim()));
      if (idx.length === 0 || idx.some((x) => !Number.isInteger(x) || x < 0)) {
        throw new Error(`--keep-dims espera indices inteiros separados por virgula; recebi '${raw}'`);
      }
      args.keepDims = idx;
    }
    else if (a === '--pca') {
      const k = Number(argv[++i]);
      if (!Number.isInteger(k) || k < 1) throw new Error(`--pca espera um inteiro >= 1; recebi '${argv[i]}'`);
      args.pca = k;
    }
    else if (a === '--pose-compensation-gain') {
      const g = Number(argv[++i]);
      if (!Number.isFinite(g)) throw new Error(`--pose-compensation-gain espera um número; recebi '${argv[i]}'`);
      args.poseCompensation = true;
      args.poseCompensationGain = g;
    }
    else if (a === '--pose-compensation-axes') {
      const eixos = argv[++i];
      if (eixos !== 'x' && eixos !== 'y' && eixos !== 'xy') {
        throw new Error(`--pose-compensation-axes espera x, y ou xy; recebi '${eixos}'`);
      }
      args.poseCompensation = true;
      args.poseCompensationAxes = eixos;
    }
    else if (a === '--constant-shift') {
      const raw = argv[++i];
      const n = (raw ?? '').split(',').map((x) => Number(x.trim()));
      if (n.length !== 2 || n.some((x) => !Number.isFinite(x))) {
        throw new Error(`--constant-shift espera <dxPx>,<dyPx>; recebi '${raw}'`);
      }
      args.constantShiftPx = { x: n[0], y: n[1] };
    }
    else if (a === '--feature-set') {
      const raw = argv[++i];
      if (!isFeatureSet(raw)) {
        throw new Error(
          `--feature-set desconhecido: '${raw}'. Válidos: ${FEATURE_SETS.join(', ')}`,
        );
      }
      args.featureSet = raw;
    }
    // 1.1 — `--regate-pose <yawMax>,<pitchMax>,<rollMax>,<minSamples>` em rad.
    // Sem argumento, usa os valores em vigor no código.
    else if (a === '--regate-pose') {
      const raw = argv[i + 1];
      if (raw && !raw.startsWith('--')) {
        i++;
        const n = raw.split(',').map((x) => Number(x.trim()));
        if (n.length !== 4 || n.some((x) => !Number.isFinite(x))) {
          throw new Error(`--regate-pose espera <yawMax>,<pitchMax>,<rollMax>,<minSamples>; recebi '${raw}'`);
        }
        args.regatePose = { yawMax: n[0], pitchMax: n[1], rollMax: n[2], minSamples: n[3] };
      } else {
        args.regatePose = {
          yawMax: POSE_DRIFT_YAW_MAX, pitchMax: POSE_DRIFT_PITCH_MAX,
          rollMax: POSE_DRIFT_ROLL_MAX, minSamples: MIN_ACCEPTED_SAMPLES,
        };
      }
    }
    else if (a === '--drop-features') {
      const raw = argv[++i];
      const parts = raw.split(',').map((s) => s.trim()).filter(Boolean);
      const groups: FeatureGroup[] = [];
      for (const p of parts) {
        if (!isFeatureGroup(p)) throw new Error(`--drop-features grupo desconhecido: '${p}'. Válidos: pose-linear, pose-cross, pose-quadratic, l2cs`);
        groups.push(p);
      }
      args.dropFeatures = groups;
    }
    else if (a === '--time-window') {
      const raw = argv[++i];
      const parts = raw.split(',').map((s) => Number(s.trim()));
      if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n)) || parts[0] < 0 || parts[1] <= parts[0]) {
        throw new Error(`--time-window espera formato "startSec,endSec" com 0 <= start < end. Recebi "${raw}"`);
      }
      args.timeWindow = { startSec: parts[0], endSec: parts[1] };
    }
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Argumento desconhecido: ${a}`);
    }
  }
  if (!args.jsonl) {
    printHelp();
    throw new Error('Falta --jsonl <path>');
  }
  const filterName = args.filter as string;
  if (!isV1Preset(filterName) && !isV2Preset(filterName)) {
    const allPresets = [...Object.keys(FILTER_PRESETS), ...Object.keys(FILTER_PRESETS_V2)];
    throw new Error(`--filter deve ser um de: ${allPresets.join(', ')}`);
  }
  return args as CliArgs;
}

function printHelp(): void {
  process.stdout.write(`
Uso:
  npm run replay -- --jsonl <path> [--report <path>] [--filter <preset>] [-v] [--use-recorded-features] [--drop-features <grupos>]

Argumentos:
  --jsonl <path>    Arquivo .jsonl produzido pelo gravador (Fase 0.1). Obrigatorio.
  --report <path>   Escreve o relatorio em JSON no caminho dado. Sem esse flag,
                    imprime na stdout.
  --filter <preset> Preset do OneEuroFilter. Padrao: balanceado.
                    v1 (espaço pixel):        estavel | balanceado | responsivo
                    v2 (espaço normalizado):  estavel-v2 | balanceado-v2 | responsivo-v2
                    Default do engine desde D1-1 é balanceado-v2 — use v2 para
                    baseline comparável com o accuracy test ao vivo.
  --recompute-features Recomputa features a partir dos landmarks. JA E O PADRAO
                    desde 0.1 — a flag continua aceita por compatibilidade.
  --use-recorded-features
                    Usa as features gravadas no JSONL em vez de recomputar.
                    So para reproduzir um relatorio historico: as features
                    gravadas descrevem o pipeline da epoca da gravacao, nao o
                    do build atual. Exige que o featureVectorId bata, ou o
                    replay aborta.
  --drop-features <grupos>
                    Ablação (D4.3): zera dimensões dos grupos indicados no
                    vetor de features ANTES do treino/predição. Lista separada
                    por vírgula. Grupos:
                      pose-linear     — yaw/pitch/roll isolados (3 dims/olho)
                      pose-cross      — offset×pose 1ª ordem (6 dims/olho)
                      pose-quadratic  — pose²/pose×scale (6 dims/olho)
                      l2cs            — bloco L2CS inteiro (7 dims/olho)
                    Ex.: --drop-features pose-quadratic,l2cs
  --time-window <startSec,endSec>
                    D7.3 — janela temporal aplicada APENAS aos frames de
                    accuracy (calibração é preservada integralmente pois é
                    pré-requisito do modelo). Offsets em segundos desde o
                    primeiro captureTs. Ex.: --time-window 1200,1500 mede
                    erro no intervalo 20-25min da sessão.
  -v, --verbose     Loga cada frame de precisao com erro por frame.
  -h, --help        Mostra esta ajuda.
`);
}

// Reconstroi landmarks Point3D[] a partir do buffer achatado do JSONL
// ([x0,y0,z0, x1,y1,z1, ...]). Retorna null se comprimento nao e multiplo de 3
// ou zero — o replay marca o frame como sem-face nesse caso, sem cair no chao.
function unflattenLandmarks(flat: number[] | undefined): Point3D[] | null {
  if (!flat || flat.length === 0 || flat.length % 3 !== 0) return null;
  const out: Point3D[] = new Array(flat.length / 3);
  for (let i = 0, j = 0; i < flat.length; i += 3, j++) {
    out[j] = { x: flat[i], y: flat[i + 1], z: flat[i + 2] };
  }
  return out;
}

function toFloat32(arr: number[] | undefined): Float32Array | undefined {
  if (!arr || arr.length === 0) return undefined;
  return Float32Array.from(arr);
}

function toL2CSInput(l2cs: RecordedFrame['l2cs']): L2CSGazeInput | null {
  if (!l2cs) return null;
  // §8.1 fix (D7.1, 2026-08-26) — PRESERVA `valid=false` em vez de retornar
  // null. Motivo: o vetor de features precisa ter shape ESTÁVEL entre frames
  // pra alimentar StandardScaler + Ridge. No pipeline LIVE, `extractFeatures`
  // recebe `l2csGaze` mesmo com valid=false, e `buildL2CSBlock` zera as 7
  // dims — shape sempre 44. Filtrar aqui produzia 37 dims quando l2cs.valid
  // era false e 44 quando true, gerando mismatch entre calibração e
  // inferência dentro do mesmo replay (ci-baseline.jsonl tem ~50/50 de
  // valid=true vs false, mistura garantida). Isso bloqueava D7.1 e qualquer
  // outra variante `--recompute-features` em fixtures gravadas com L2CS
  // ativo — que é a operação real do projeto.
  // D3.3 — preserva `confidence` se a gravação for pós-D3.3; ausente em
  // gravações antigas (o campo é opcional em RecordedL2CS por retrocompat).
  return { yaw: l2cs.yaw, pitch: l2cs.pitch, valid: l2cs.valid, confidence: l2cs.confidence };
}

interface CalibrationSample {
  featuresLeft: number[];
  featuresRight: number[];
  targetXNorm: number;
  targetYNorm: number;
  targetXPx: number;
  targetYPx: number;
  /** 1.3 — pose da cabeça no frame, quando gravada. A compensação geométrica
   *  precisa dela nos DOIS lados: para fixar a referência da calibração e para
   *  medir o desvio no frame que está sendo predito. */
  pose?: Pose;
  /** 1.4 — ponta do nariz normalizada e escala facial do quadro. */
  centro?: { x: number; y: number };
  escala?: { iodPx: number; videoWidth: number; videoHeight: number };
}

interface Pose { yaw: number; pitch: number; roll: number }

/**
 * 1.4 — ponta do nariz (landmark 1) e distância interocular em px de vídeo
 * (cantos externos 33 e 263), recomputadas dos landmarks gravados.
 *
 * Não vêm prontas do JSONL: `faceCenter` nunca foi um campo de telemetria. Os
 * landmarks estão lá, então a medida é reconstruível — e recomputar é o que
 * garante que ela descreva o pipeline de hoje.
 */
function centroEscalaDoFrame(
  f: RecordedFrame, videoWidth: number, videoHeight: number,
): { centro?: { x: number; y: number }; escala?: { iodPx: number; videoWidth: number; videoHeight: number } } {
  const lm = f.landmarks;
  if (!lm || lm.length < 264 * 3) return {};
  const centro = { x: lm[1 * 3], y: lm[1 * 3 + 1] };
  const iodPx = Math.hypot(
    (lm[33 * 3] - lm[263 * 3]) * videoWidth,
    (lm[33 * 3 + 1] - lm[263 * 3 + 1]) * videoHeight,
  );
  if (!(iodPx > 0)) return { centro };
  return { centro, escala: { iodPx, videoWidth, videoHeight } };
}

/** 1.3 — pose gravada no frame, ou null se o gravador não a tinha. */
function poseDoFrame(f: RecordedFrame): Pose | undefined {
  const q = f.quality;
  if (!q || typeof q.yaw !== 'number' || typeof q.pitch !== 'number' || typeof q.roll !== 'number') return undefined;
  return { yaw: q.yaw, pitch: q.pitch, roll: q.roll };
}

/** Média por eixo das poses presentes. É a referência à qual o modelo foi
 *  ajustado: o centróide da distribuição de treino, não um frame escolhido. */
function poseMedia(poses: (Pose | undefined)[]): Pose | null {
  const v = poses.filter((p): p is Pose => !!p);
  if (v.length === 0) return null;
  const m = (pick: (p: Pose) => number) => v.reduce((a, b) => a + pick(b), 0) / v.length;
  return { yaw: m((p) => p.yaw), pitch: m((p) => p.pitch), roll: m((p) => p.roll) };
}

interface AccuracySample {
  featuresLeft: number[];
  featuresRight: number[];
  target: RecordedTarget;
  captureTs: number;
  frameIdx: number;
  pose?: Pose;
  centro?: { x: number; y: number };
  escala?: { iodPx: number; videoWidth: number; videoHeight: number };
}

// Extrai (ou re-extrai) features do frame. Se o JSONL ja tem featuresLeft/Right,
// usa direto — economiza CPU e garante paridade com a gravacao. Se nao tem,
// tenta re-computar a partir de landmarks; se tambem nao tem landmarks, retorna
// null (frame descartado). O replay reporta a contagem de frames descartados.
//
// D4.3 — quando `dropFeatures` é passado, zera as dimensões dos grupos
// indicados no vetor (tanto no path "usar features gravadas" quanto no path
// "recomputar"). Zerar é equivalente a "sem essa feature" para o Ridge:
// StandardScaler.fit vê variância 0 e trata a dim como constante; β acaba
// preso a 0 na inversão. O shape do vetor NÃO muda, então o modelo do
// replay continua comparável frame a frame com a variante completa.
function getFeatures(
  f: RecordedFrame,
  recomputeFeatures: boolean,
  dropFeatures: readonly FeatureGroup[],
  videoWidth?: number,
  videoHeight?: number,
  featureSet?: FeatureSet,
  blinkDetector?: BlinkDetector,
  keepDims?: number[],
): { left: number[]; right: number[] } | null {
  let left: number[];
  let right: number[];
  if (!recomputeFeatures && f.featuresLeft && f.featuresRight
      && f.featuresLeft.length > 0 && f.featuresRight.length > 0
      && f.featuresLeft.length === f.featuresRight.length) {
    left = f.featuresLeft;
    right = f.featuresRight;
  } else {
    const lm = unflattenLandmarks(f.landmarks);
    if (!lm) return null;
    // §8.1 fix (D7.1, 2026-08-26) — propaga videoWidth/videoHeight pra que a
    // flag EXPERIMENT.isotropicLandmarks tenha efeito no path recompute.
    // Antes de hoje, o replay não passava dimensões de vídeo e o branch
    // de `isotropicLandmarks` em featurePipeline.ts era no-op silencioso
    // no replay — sweep A2-5 mostrava OFF=ON idênticos.
    const geo = extractFeatures(
      lm,
      toFloat32(f.faceMatrix),
      toL2CSInput(f.l2cs),
      videoWidth,
      videoHeight,
      featureSet,
      blinkDetector,
    );
    if (geo.blinkDetected) return null;
    left = geo.featuresLeft;
    right = geo.featuresRight;
  }
  if (dropFeatures.length > 0) {
    left = applyDropGroups(left, dropFeatures);
    right = applyDropGroups(right, dropFeatures);
  }
  // 3.1 - corte por indice, DEPOIS da projecao do conjunto. Indice fora do
  // alcance e ignorado em vez de virar undefined: um NaN aqui contaminaria o
  // scaler e degeneraria o regressor em silencio.
  // 3.2 — no modo concatenado os dois "olhos" recebem o MESMO vetor de 24 dims.
  // Assim um unico Ridge ve os dois olhos, e a media na saida vira identidade.
  if (ReplayRegressor.fusao === 'concatenado' && left.length > 0 && right.length > 0) {
    const junto = [...left, ...right];
    left = junto; right = junto;
  }
  if (keepDims && keepDims.length > 0) {
    left = keepDims.filter((i) => i < left.length).map((i) => left[i]);
    right = keepDims.filter((i) => i < right.length).map((i) => right[i]);
  }
  return { left, right };
}

// Split canonico dos frames em calibracao, precisao e uso livre. Descarta
// frames sem face, sem features utilizaveis, ou com blink.
//
// D7.3 — `timeWindow` (se passado) filtra APENAS os frames de `accuracy`,
// deixando calibração intocada. Motivo: calibração é normalmente feita no
// início da sessão (~primeiros minutos); janelas de 20-25min ou 40-45min
// cortariam a calibração inteira e o replay falharia com "faltam amostras".
// A janela é aplicada em segundos-desde-primeiro-captureTs.
/** 1.1 — o que o re-gate offline fez, para o relatório poder ser lido sem
 *  precisar reexecutar nada. */
interface RegateInfo {
  /** Espelha o gate ao vivo: referência é o primeiro frame elegível de CADA ponto. */
  baselineKind: 'per-target';
  thresholds: { yawMax: number; pitchMax: number; rollMax: number; minSamples: number };
  /** Aceitos na gravação que o gate reaplicado rejeita por deriva de pose. */
  rejeitadosPorPose: number;
  /** Alvos descartados inteiros por caírem abaixo de `minSamples`. */
  alvosDescartados: number;
  /** Aceitos por alvo depois do re-gate, na ordem em que aparecem. */
  aceitosPorAlvo: number[];
  /** Deriva ENTRE alvos — não gateada, só medida. Ver `medirDerivaEntreAlvos`. */
  derivaEntreAlvos: ReturnType<typeof medirDerivaEntreAlvos>;
}

/**
 * 1.1 — deriva postural entre alvos, medida na gravação.
 *
 * Não gateia nada — espelha `getSessionPoseDrift` em `src/calibration.ts`. Está
 * aqui porque foi este número que derrubou a hipótese de que apertar o gate
 * melhoraria a calibração: a amplitude entre alvos é uma ordem de grandeza
 * maior que a dispersão dentro deles.
 */
function medirDerivaEntreAlvos(rec: Recording): {
  yawDeg: number; pitchDeg: number; rollDeg: number; trendRYaw: number; trendRPitch: number; alvos: number;
} | null {
  const porAlvo = new Map<string, { yaw: number; pitch: number; roll: number }[]>();
  for (const f of rec.frames) {
    if (f.target?.kind !== 'calibration') continue;
    const q = f.quality;
    if (!q || typeof q.yaw !== 'number' || typeof q.pitch !== 'number' || typeof q.roll !== 'number') continue;
    const k = `${Math.round(f.target.xPx)},${Math.round(f.target.yPx)}`;
    const arr = porAlvo.get(k); if (arr) arr.push({ yaw: q.yaw, pitch: q.pitch, roll: q.roll });
    else porAlvo.set(k, [{ yaw: q.yaw, pitch: q.pitch, roll: q.roll }]);
  }
  if (porAlvo.size < 2) return null;
  const medPorAlvo = [...porAlvo.values()].map((v) => {
    const m = (pick: (p: { yaw: number; pitch: number; roll: number }) => number) => {
      const a = v.map(pick).sort((x, y) => x - y);
      const i2 = a.length >> 1;
      return a.length % 2 ? a[i2] : (a[i2 - 1] + a[i2]) / 2;
    };
    return { yaw: m((p) => p.yaw), pitch: m((p) => p.pitch), roll: m((p) => p.roll) };
  });
  const amp = (pick: (p: { yaw: number; pitch: number; roll: number }) => number) => {
    const v = medPorAlvo.map(pick); return Math.max(...v) - Math.min(...v);
  };
  const corr = (pick: (p: { yaw: number; pitch: number; roll: number }) => number) => {
    const y = medPorAlvo.map(pick); const n = y.length;
    const mx = (n - 1) / 2; const my = y.reduce((a, b) => a + b, 0) / n;
    let num = 0, dx = 0, dy = 0;
    for (let i2 = 0; i2 < n; i2++) { num += (i2 - mx) * (y[i2] - my); dx += (i2 - mx) ** 2; dy += (y[i2] - my) ** 2; }
    const den = Math.sqrt(dx * dy); return den > 0 ? num / den : 0;
  };
  const deg = (r: number) => (r * 180) / Math.PI;
  return {
    yawDeg: deg(amp((p) => p.yaw)), pitchDeg: deg(amp((p) => p.pitch)), rollDeg: deg(amp((p) => p.roll)),
    trendRYaw: corr((p) => p.yaw), trendRPitch: corr((p) => p.pitch), alvos: porAlvo.size,
  };
}

/** 1.1 — mesmo predicado do gate ao vivo, aplicado à pose gravada. Frame sem
 *  pose gravada é REJEITADO: aceitá-lo seria assumir que a cabeça estava parada
 *  justamente onde não há medição. */
function posePassaNoGate(
  f: RecordedFrame,
  ref: { yaw: number; pitch: number; roll: number },
  lim: { yawMax: number; pitchMax: number; rollMax: number },
): boolean {
  const q = f.quality;
  if (!q || typeof q.yaw !== 'number' || typeof q.pitch !== 'number' || typeof q.roll !== 'number') return false;
  return Math.abs(q.yaw - ref.yaw) <= lim.yawMax
    && Math.abs(q.pitch - ref.pitch) <= lim.pitchMax
    && Math.abs(q.roll - ref.roll) <= lim.rollMax;
}

function splitFrames(
  rec: Recording,
  recomputeFeatures: boolean,
  dropFeatures: readonly FeatureGroup[],
  timeWindow?: { startSec: number; endSec: number },
  regatePose?: { yawMax: number; pitchMax: number; rollMax: number; minSamples: number },
  featureSet?: FeatureSet,
  keepDims?: number[],
): {
  calibration: CalibrationSample[];
  accuracy: AccuracySample[];
  live: number; // apenas contagem
  discarded: number;
  rejectedByDecision: number;
  legacyNoDecision: number;
  timeWindow?: { startSec: number; endSec: number; filteredOut: number; firstCaptureTs: number };
  regate?: RegateInfo;
} {
  const vw = rec.header.resolution.w;
  const vh = rec.header.resolution.h;
  const calibration: CalibrationSample[] = [];
  const accuracy: AccuracySample[] = [];
  let live = 0;
  let discarded = 0;
  let rejectedByDecision = 0;
  let legacyNoDecision = 0;
  let accuracyFilteredOutByWindow = 0;

  // 2.2 — detector de piscada PRÓPRIO desta execução.
  //
  // Antes, `extractFeatures` mexia num singleton de módulo. Com um detector por
  // execução, o limiar adaptativo não pode vazar entre variantes nem para o
  // resto do processo, e o replay volta a ser função só do JSONL e das flags.
  const blinkDetector = new BlinkDetector();

  // 1.1 — estado do re-gate offline. Uma referência por alvo, fixada no
  // primeiro frame elegível daquele alvo, exatamente como ao vivo.
  const regate = regatePose;
  const baselinePorAlvo = new Map<string, { yaw: number; pitch: number; roll: number }>();
  let rejeitadosPorPose = 0;
  const chaveAlvo = (t: RecordedTarget) => `${Math.round(t.xPx)},${Math.round(t.yPx)}`;

  // D7.3 — resolvemos o "tempo zero" da gravação lazy: primeiro captureTs de
  // qualquer frame (não só accuracy) — reflete o momento em que o gravador
  // começou, alinhando os offsets absolutos do usuário (`--time-window 0,300`
  // = "primeiros 5 min da sessão inteira", intuitivo) com o timeline gravado.
  let firstCaptureTs: number | null = null;
  if (timeWindow) {
    for (const f of rec.frames) {
      if (Number.isFinite(f.captureTs)) { firstCaptureTs = f.captureTs; break; }
    }
  }

  // §8.1 fix (D7.1, 2026-08-26) — dimensões do vídeo original vêm do header
  // (`videoResolution`, gravado pelo recorder no start). Necessárias pra flag
  // `isotropicLandmarks` funcionar no path recompute. Cai pra `resolution` se
  // o header for antigo/sem `videoResolution`, aí a flag continua no-op nessa
  // gravação — mas não quebra.
  const videoW = rec.header.videoResolution?.w ?? vw;
  const videoH = rec.header.videoResolution?.h ?? vh;

  for (const f of rec.frames) {
    if (!f.hasFace) { discarded++; continue; }
    if (f.blink) { discarded++; continue; }
    const feats = getFeatures(f, recomputeFeatures, dropFeatures, videoW, videoH, featureSet, blinkDetector, keepDims);
    if (!feats) { discarded++; continue; }

    if (f.target?.kind === 'calibration') {
      // v2+: honra a decisão gravada. Sem isto o replay treina em frames de
      // acomodação/baixa qualidade que o pipeline ao vivo descartou — e o
      // baseline offline deixa de ser comparável ao online (achado A3).
      if (rec.header.formatVersion >= 2) {
        if (regate) {
          // 1.1 — só o critério de POSE é reexecutado.
          //
          // `acclimation` e `quality` não mudaram entre as variantes, e
          // reexecutá-los exigiria reproduzir o relógio da sessão. Um frame
          // elegível é o que a gravação aceitou, mais o que ela rejeitou
          // exatamente por pose — este último pode voltar, porque o baseline
          // de sessão não é o mesmo contra o qual ele foi rejeitado.
          const d = f.sampleDecision;
          const elegivel = d?.accepted === true || d?.reason === 'pose_drift';
          if (!elegivel) { rejectedByDecision++; continue; }
          // Referência do ALVO: o primeiro frame elegível dele a chegar aqui.
          const k = chaveAlvo(f.target);
          const ref = baselinePorAlvo.get(k);
          if (!ref) {
            const q = f.quality;
            if (q && typeof q.yaw === 'number' && typeof q.pitch === 'number' && typeof q.roll === 'number') {
              baselinePorAlvo.set(k, { yaw: q.yaw, pitch: q.pitch, roll: q.roll });
            }
          } else if (!posePassaNoGate(f, ref, regate)) {
            rejectedByDecision++;
            if (d?.accepted) rejeitadosPorPose++;
            continue;
          }
        } else if (!f.sampleDecision?.accepted) {
          rejectedByDecision++; continue;
        }
      } else {
        legacyNoDecision++;   // v1: comportamento antigo, mas avisa no relatório
      }
      calibration.push({
        pose: poseDoFrame(f),
        ...centroEscalaDoFrame(f, videoW, videoH),
        featuresLeft: feats.left,
        featuresRight: feats.right,
        targetXNorm: f.target.xPx / vw,
        targetYNorm: f.target.yPx / vh,
        targetXPx: f.target.xPx,
        targetYPx: f.target.yPx,
      });
    } else if (f.target?.kind === 'accuracy') {
      // D7.3 — aplica janela temporal aos frames de accuracy. Frames fora
      // da janela são contados em `accuracyFilteredOutByWindow` para o
      // relatório mostrar honestamente quantos foram descartados por essa
      // razão (separado dos descartes por qualidade).
      if (timeWindow && firstCaptureTs !== null) {
        const offsetSec = (f.captureTs - firstCaptureTs) / 1000;
        if (offsetSec < timeWindow.startSec || offsetSec >= timeWindow.endSec) {
          accuracyFilteredOutByWindow++;
          continue;
        }
      }
      accuracy.push({
        pose: poseDoFrame(f),
        ...centroEscalaDoFrame(f, videoW, videoH),
        featuresLeft: feats.left,
        featuresRight: feats.right,
        target: f.target,
        captureTs: f.captureTs,
        frameIdx: f.frameIdx,
      });
    } else {
      live++;
    }
  }
  let regateInfo: RegateInfo | undefined;
  if (regatePose) {
    // 1.1 — MIN_ACCEPTED_SAMPLES ao vivo faz o ponto ser REFEITO. Offline não há
    // como refazer, então o alvo é descartado — e o número aparece no relatório,
    // porque perder um alvo muda o que o Ridge tem para restringir e ninguém
    // deve descobrir isso comparando médias.
    const porAlvo = new Map<string, CalibrationSample[]>();
    for (const c of calibration) {
      const k = `${Math.round(c.targetXPx)},${Math.round(c.targetYPx)}`;
      const arr = porAlvo.get(k); if (arr) arr.push(c); else porAlvo.set(k, [c]);
    }
    const mantidos: CalibrationSample[] = [];
    let alvosDescartados = 0;
    const aceitosPorAlvo: number[] = [];
    for (const [, arr] of porAlvo) {
      aceitosPorAlvo.push(arr.length);
      if (arr.length < regatePose.minSamples) { alvosDescartados++; continue; }
      mantidos.push(...arr);
    }
    calibration.length = 0;
    calibration.push(...mantidos);
    regateInfo = {
      baselineKind: 'per-target',
      thresholds: regatePose, rejeitadosPorPose, alvosDescartados, aceitosPorAlvo,
      derivaEntreAlvos: medirDerivaEntreAlvos(rec),
    };
  }

  return {
    calibration, accuracy, live, discarded, rejectedByDecision, legacyNoDecision,
    regate: regateInfo,
    timeWindow: timeWindow && firstCaptureTs !== null
      ? { startSec: timeWindow.startSec, endSec: timeWindow.endSec, filteredOut: accuracyFilteredOutByWindow, firstCaptureTs }
      : undefined,
  };
}

// Espelha a matematica de calibration.trainScalersAndRegressors + mapGaze
// (sem RBF, sem RLS, sem document). Uma unica fonte de verdade seria melhor
// — mas calibration.ts esta acoplado ao browser e refatorar por causa do
// replay agora seria risco maior que o beneficio.
/**
 * 1.2 — coeficiente aprendido para as dimensões de pose, em px de tela por grau.
 *
 * É o teste que separa "o modelo aprendeu geometria" de "o modelo decorou".
 * A geometria diz o que esperar: com o olho parado na órbita e a cabeça girando
 * Δ, o ponto olhado se desloca `d · tan(Δ)` — cerca de +38 px/grau em X para
 * yaw e em Y para pitch, com sinal DEFINIDO. Um coeficiente com sinal trocado,
 * ou uma ordem de grandeza fora, não é compensação de pose: é a pose sendo
 * usada como atalho para adivinhar o alvo.
 *
 * A conversão desfaz a padronização: β está em espaço z, então dPred/dx é
 * β/σ em unidades normalizadas de tela; daí × largura (ou altura) para px e
 * × π/180 para "por grau".
 */
function ganhoPose(
  m: ReplayRegressor, bruto: number[][], vw: number, vh: number,
): { yawX: number; pitchY: number } | null {
  const mod = m.ridgeL.getModel?.();
  if (!mod || mod.betaX.length < 16 || bruto.length === 0 || bruto[0].length < 15) return null;
  // σ da dimensão, recalculado aqui porque o scaler não expõe os seus.
  const sigma = (j: number) => {
    const v = bruto.map((r) => r[j]);
    const mu = v.reduce((a, b) => a + b, 0) / v.length;
    return Math.sqrt(v.reduce((a, b) => a + (b - mu) ** 2, 0) / v.length) || 1;
  };
  // ATENÇÃO AO DESLOCAMENTO: `trainRidgeModel` monta `Phi = [1.0, ...f]`, então
  // `beta[0]` é o viés e o coeficiente da feature `j` mora em `beta[j + 1]`.
  const porGrau = (beta: number[], j: number, dim: number) =>
    (beta[j + 1] / sigma(j)) * dim * (Math.PI / 180);
  // Nos conjuntos com pose a feature 12 é yaw e a 13 é pitch (ver
  // FEATURE_SET_INDICES: [0..11] de íris, depois 22,23,24 = yaw,pitch,roll).
  return { yawX: porGrau(mod.betaX, 12, vw), pitchY: porGrau(mod.betaY, 13, vh) };
}

/**
 * 3.1 — autovalores da matriz de correlação das features, por Jacobi.
 *
 * Jacobi cíclico e não SVD porque a matriz é simétrica, pequena (12×12 a 21×21)
 * e o algoritmo cabe em vinte linhas sem dependência — importar uma biblioteca
 * de álgebra linear para isso seria custo maior que o benefício.
 *
 * A entrada é a matriz de CORRELAÇÃO, não a de covariância: as dimensões do
 * `iris12` têm escalas diferentes (offset em unidades de frame, contorno da
 * íris em coordenadas rotacionadas), e a covariância deixaria a maior escala
 * dominar o espectro por um motivo que nada tem a ver com redundância.
 */
function autovaloresPorJacobi(A: number[][], iteracoes = 100): number[] {
  const n = A.length;
  const M = A.map((linha) => [...linha]);
  for (let varredura = 0; varredura < iteracoes; varredura++) {
    let foraDaDiagonal = 0;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) foraDaDiagonal += M[p][q] ** 2;
    if (foraDaDiagonal < 1e-14) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(M[p][q]) < 1e-15) continue;
        const theta = (M[q][q] - M[p][p]) / (2 * M[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const sJ = t * c;
        for (let k = 0; k < n; k++) {
          const mkp = M[k][p], mkq = M[k][q];
          M[k][p] = c * mkp - sJ * mkq;
          M[k][q] = sJ * mkp + c * mkq;
        }
        for (let k = 0; k < n; k++) {
          const mpk = M[p][k], mqk = M[q][k];
          M[p][k] = c * mpk - sJ * mqk;
          M[q][k] = sJ * mpk + c * mqk;
        }
      }
    }
  }
  return M.map((_, i) => M[i][i]).sort((a, b) => b - a);
}

/**
 * 3.1 — quanto do vetor de features é redundante.
 *
 * `participacao` é a razão de participação `(Σλ)² / Σλ²`. Vale d quando todas as
 * direções contribuem igualmente e 1 quando uma só domina — é a leitura mais
 * honesta de "quantas dimensões independentes existem de fato", porque não
 * depende de escolher um limiar arbitrário.
 *
 * `acima1pct` conta autovalores acima de 1% do maior, e serve de segunda
 * opinião: as duas medidas discordando é sinal de espectro com cauda longa.
 *
 * `condicao` é λ_max/λ_min. Acima de ~1e6 a solução do sistema normal perde
 * metade dos dígitos em precisão dupla.
 */
/**
 * 3.1 — autovetores da matriz de correlação, para projetar o vetor.
 *
 * Mesma rotina de Jacobi, mas acumulando a matriz de rotação: as colunas de V
 * são os autovetores, na mesma ordem dos autovalores.
 */
function autoDecomposicao(A: number[][], iteracoes = 100): { lam: number[]; V: number[][] } {
  const n = A.length;
  const M = A.map((l) => [...l]);
  const V: number[][] = Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => (i === j ? 1 : 0)));
  for (let varredura = 0; varredura < iteracoes; varredura++) {
    let fora = 0;
    for (let p = 0; p < n - 1; p++) for (let q = p + 1; q < n; q++) fora += M[p][q] ** 2;
    if (fora < 1e-14) break;
    for (let p = 0; p < n - 1; p++) {
      for (let q = p + 1; q < n; q++) {
        if (Math.abs(M[p][q]) < 1e-15) continue;
        const theta = (M[q][q] - M[p][p]) / (2 * M[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const sj = t * c;
        for (let k = 0; k < n; k++) {
          const a = M[k][p], b = M[k][q];
          M[k][p] = c * a - sj * b; M[k][q] = sj * a + c * b;
        }
        for (let k = 0; k < n; k++) {
          const a = M[p][k], b = M[q][k];
          M[p][k] = c * a - sj * b; M[q][k] = sj * a + c * b;
        }
        for (let k = 0; k < n; k++) {
          const a = V[k][p], b = V[k][q];
          V[k][p] = c * a - sj * b; V[k][q] = sj * a + c * b;
        }
      }
    }
  }
  const ordem = M.map((_, i) => i).sort((a, b) => M[b][b] - M[a][a]);
  return {
    lam: ordem.map((i) => M[i][i]),
    V: V.map((linha) => ordem.map((i) => linha[i])),
  };
}

/**
 * 3.1 — projeção nas k primeiras componentes principais.
 *
 * Ajustada SÓ nas amostras de calibração e aplicada também às de precisão, como
 * qualquer transformação aprendida. É não-supervisionada, então não há
 * vazamento de alvo — o que ela usa é a estrutura de covariância das features,
 * não a resposta.
 */
class ProjecaoPCA {
  private media: number[] = [];
  private desvio: number[] = [];
  private V: number[][] = [];
  private k = 0;

  fit(amostras: number[][], k: number): void {
    const m = amostras.length, d = amostras[0].length;
    this.k = Math.max(1, Math.min(k, d));
    this.media = new Array<number>(d).fill(0);
    for (const a of amostras) for (let j = 0; j < d; j++) this.media[j] += a[j];
    for (let j = 0; j < d; j++) this.media[j] /= m;
    this.desvio = new Array<number>(d).fill(0);
    for (const a of amostras) for (let j = 0; j < d; j++) this.desvio[j] += (a[j] - this.media[j]) ** 2;
    for (let j = 0; j < d; j++) this.desvio[j] = Math.sqrt(this.desvio[j] / m) || 1;

    const R: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
    for (const a of amostras) {
      for (let i = 0; i < d; i++) {
        const zi = (a[i] - this.media[i]) / this.desvio[i];
        for (let j = i; j < d; j++) R[i][j] += zi * ((a[j] - this.media[j]) / this.desvio[j]);
      }
    }
    for (let i = 0; i < d; i++) for (let j = i; j < d; j++) { R[i][j] /= m; R[j][i] = R[i][j]; }
    this.V = autoDecomposicao(R).V;
  }

  transform(v: number[]): number[] {
    const d = this.media.length;
    const z = new Array<number>(d);
    for (let j = 0; j < d; j++) z[j] = (v[j] - this.media[j]) / this.desvio[j];
    const out = new Array<number>(this.k).fill(0);
    for (let c = 0; c < this.k; c++) {
      let acc = 0;
      for (let j = 0; j < d; j++) acc += z[j] * this.V[j][c];
      out[c] = acc;
    }
    return out;
  }
}

/** 3.1 - matriz de correlacao das features, arredondada para leitura. */
function matrizCorrelacao(amostras: number[][]): number[][] | null {
  const m = amostras.length;
  if (m < 2) return null;
  const d = amostras[0].length;
  const media = new Array<number>(d).fill(0);
  for (const a of amostras) for (let j = 0; j < d; j++) media[j] += a[j];
  for (let j = 0; j < d; j++) media[j] /= m;
  const desvio = new Array<number>(d).fill(0);
  for (const a of amostras) for (let j = 0; j < d; j++) desvio[j] += (a[j] - media[j]) ** 2;
  for (let j = 0; j < d; j++) desvio[j] = Math.sqrt(desvio[j] / m) || 1;
  const R: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  for (const a of amostras) {
    for (let i = 0; i < d; i++) {
      const zi = (a[i] - media[i]) / desvio[i];
      for (let j = i; j < d; j++) R[i][j] += zi * ((a[j] - media[j]) / desvio[j]);
    }
  }
  for (let i = 0; i < d; i++) for (let j = i; j < d; j++) {
    R[i][j] = Number((R[i][j] / m).toFixed(4)); R[j][i] = R[i][j];
  }
  return R;
}

function espectroDeFeatures(amostras: number[][]): {
  dims: number; autovalores: number[]; participacao: number; acima1pct: number; condicao: number;
} | null {
  const m = amostras.length;
  if (m < 2) return null;
  const d = amostras[0].length;
  if (d === 0) return null;

  const media = new Array<number>(d).fill(0);
  for (const a of amostras) for (let j = 0; j < d; j++) media[j] += a[j];
  for (let j = 0; j < d; j++) media[j] /= m;
  const desvio = new Array<number>(d).fill(0);
  for (const a of amostras) for (let j = 0; j < d; j++) desvio[j] += (a[j] - media[j]) ** 2;
  for (let j = 0; j < d; j++) desvio[j] = Math.sqrt(desvio[j] / m) || 1;

  const R: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  for (const a of amostras) {
    for (let i = 0; i < d; i++) {
      const zi = (a[i] - media[i]) / desvio[i];
      for (let j = i; j < d; j++) R[i][j] += zi * ((a[j] - media[j]) / desvio[j]);
    }
  }
  for (let i = 0; i < d; i++) for (let j = i; j < d; j++) { R[i][j] /= m; R[j][i] = R[i][j]; }

  const lam = autovaloresPorJacobi(R).map((v) => Math.max(0, v));
  const soma = lam.reduce((a, b) => a + b, 0);
  const somaQuad = lam.reduce((a, b) => a + b * b, 0);
  const maior = lam[0] || 1;
  const menor = lam[lam.length - 1];
  return {
    dims: d,
    autovalores: lam.map((v) => Number(v.toFixed(6))),
    participacao: somaQuad > 0 ? (soma * soma) / somaQuad : 0,
    acima1pct: lam.filter((v) => v > maior * 0.01).length,
    condicao: menor > 1e-12 ? maior / menor : Infinity,
  };
}

/**
 * 3.2 — como as predicoes dos dois olhos viram uma.
 *
 *   'media'        media simples. E o que o replay fazia, e o caso base do app
 *                  quando nao ha `perEyeWeight`.
 *   'esquerdo'     so o olho esquerdo. Diagnostico: diz quanto cada olho vale
 *                  sozinho, e portanto se a fusao esta somando ou diluindo.
 *   'direito'      so o olho direito.
 *   'confianca'    media ponderada pelo inverso da variancia do residuo de cada
 *                  olho, medida NO TREINO. E a ponderacao otima para dois
 *                  estimadores nao-enviesados e independentes; o quanto ela
 *                  ajuda mede o quanto os dois olhos diferem em qualidade.
 *   'concatenado'  UM modelo sobre os 24 dims dos dois olhos juntos, em vez de
 *                  dois modelos de 12 promediados. Nao e a mesma coisa: media
 *                  de dois ajustes independentes ignora a correlacao entre os
 *                  olhos, que um ajuste conjunto pode explorar.
 */
type ModoFusao = 'media' | 'esquerdo' | 'direito' | 'confianca' | 'concatenado';

// O default e 'confianca', porque e o que o app faz desde 3.2. Um harness que
// descreve outro pipeline que nao o do build ja custou caro uma vez -- ver
// FEATURE_VECTOR_ID. `--fusion media` reproduz o comportamento anterior.

class ReplayRegressor {
  /** 3.2 — modo de fusao binocular. Estatico pelo mesmo motivo de `pcaK`. */
  static fusao: ModoFusao = 'media';
  /** Pesos por olho derivados do residuo de treino, no modo 'confianca'. */
  private pesoL = 0.5;
  private pesoR = 0.5;
  /** 3.1 — k componentes principais, ou 0 para usar as features cruas.
   *  Estático porque `diagnose` instancia o regressor internamente e a
   *  variante tem que valer para todas as instâncias da execução. */
  static pcaK = 0;
  private pcaL: ProjecaoPCA | null = null;
  private pcaR: ProjecaoPCA | null = null;
  private scalerL = new StandardScaler();
  private scalerR = new StandardScaler();
  ridgeL = new RidgeRegressor();
  ridgeR = new RidgeRegressor();
  private trained = false;

  train(samples: CalibrationSample[]): void {
    if (samples.length < 2) {
      throw new Error(`Precisa de ao menos 2 amostras de calibracao para treinar (recebi ${samples.length})`);
    }
    let rawL = samples.map((s) => s.featuresLeft);
    let rawR = samples.map((s) => s.featuresRight);
    const tx = samples.map((s) => s.targetXNorm);
    const ty = samples.map((s) => s.targetYNorm);
    // 3.1 — projeção ANTES do scaler. A PCA já padroniza internamente; o
    // StandardScaler seguinte opera sobre as componentes, que é o que o Ridge
    // e a penalidade Σ_W esperam receber.
    if (ReplayRegressor.pcaK > 0 && rawL[0]?.length > 0) {
      this.pcaL = new ProjecaoPCA(); this.pcaL.fit(rawL, ReplayRegressor.pcaK);
      this.pcaR = new ProjecaoPCA(); this.pcaR.fit(rawR, ReplayRegressor.pcaK);
      rawL = rawL.map((v) => this.pcaL!.transform(v));
      rawR = rawR.map((v) => this.pcaR!.transform(v));
    }
    this.scalerL.fit(rawL);
    this.scalerR.fit(rawR);
    const scaledL = this.scalerL.transform(rawL);
    const scaledR = this.scalerR.transform(rawR);
    this.ridgeL.train(scaledL, tx, ty);
    this.ridgeR.train(scaledR, tx, ty);
    this.trained = true;

    // 3.2 — pesos por olho, do residuo de treino de cada um.
    //
    // Para dois estimadores nao-enviesados e independentes, o peso otimo e o
    // inverso da variancia. Independencia aqui e aproximacao grosseira (os dois
    // olhos veem a mesma cabeca e o mesmo ruido de landmark), mas o que se quer
    // medir e se ha diferenca de qualidade entre os olhos que a media simples
    // esteja jogando fora.
    if (ReplayRegressor.fusao === 'confianca') {
      const varDe = (ridge: RidgeRegressor, z: number[][]) => {
        let soma = 0;
        for (let i = 0; i < z.length; i++) {
          const p = ridge.predict(z[i]);
          soma += (p.x - tx[i]) ** 2 + (p.y - ty[i]) ** 2;
        }
        return soma / Math.max(1, z.length);
      };
      const vL = varDe(this.ridgeL, scaledL) || 1e-12;
      const vR = varDe(this.ridgeR, scaledR) || 1e-12;
      const iL = 1 / vL, iR = 1 / vR;
      this.pesoL = iL / (iL + iR);
      this.pesoR = iR / (iL + iR);
    }
  }

  /**
   * 1.2 — erro do modelo nas PRÓPRIAS amostras de treino, e o mesmo erro com
   * um alvo inteiro removido do treino (leave-one-target-out).
   *
   * A diferença entre os dois é o que separa aprendizado de memorização, e é a
   * única forma honesta de julgar features correlacionadas com o alvo. Um split
   * aleatório de amostras não serve: amostras do mesmo alvo são quase idênticas,
   * então segurar algumas delas mede interpolação dentro do aglomerado, não
   * generalização para um alvo novo.
   *
   * Em px por eixo, cada eixo convertido pela sua própria dimensão antes de
   * compor — `hypot` sobre frações de tela infla erro puro de Y numa tela 16:9.
   */
  static diagnose(samples: CalibrationSample[], vw: number, vh: number): {
    trainErrorPx: number; looErrorPx: number; targets: number; lambdaL: number; lambdaR: number; penaltyDiag: number[] | null; poseGainPxPorGrau: { yawX: number; pitchY: number } | null; espectro: ReturnType<typeof espectroDeFeatures>; correlacao: number[][] | null;
  } {
    const erroDe = (treino: CalibrationSample[], teste: CalibrationSample[]): number => {
      const m = new ReplayRegressor();
      m.train(treino);
      let soma = 0;
      for (const t of teste) {
        const p = m.predictPx(t.featuresLeft, t.featuresRight, vw, vh);
        soma += Math.hypot(p.x - t.targetXNorm * vw, p.y - t.targetYNorm * vh);
      }
      return soma / teste.length;
    };

    const chave = (t: CalibrationSample) => `${Math.round(t.targetXPx)},${Math.round(t.targetYPx)}`;
    const alvos = [...new Set(samples.map(chave))];

    let looSoma = 0, looN = 0;
    for (const alvo of alvos) {
      const treino = samples.filter((t) => chave(t) !== alvo);
      const teste = samples.filter((t) => chave(t) === alvo);
      // Menos de 3 alvos no treino não fecha o sistema; pular é mais honesto
      // que reportar um número que veio de um ajuste degenerado.
      if (new Set(treino.map(chave)).size < 3 || teste.length === 0) continue;
      looSoma += erroDe(treino, teste); looN++;
    }

    // λ escolhido pelo CV. Relatado porque λ é compartilhado por TODAS as
    // dimensões do vetor: uma feature nova que ganha muita variância depois da
    // padronização força λ para cima e encolhe também as features úteis. Sem
    // este número, esse efeito é indistinguível de "a feature não informa".
    const cheio = new ReplayRegressor();
    cheio.train(samples);

    // 1.2 — diagonal de Σ_W normalizada, no espaço padronizado.
    //
    // É o peso da penalidade que CADA dimensão recebe. `withinTargetPenalty`
    // divide por trace/d, então o valor 1,0 é a média: bem abaixo de 1 quer
    // dizer "esta dimensão é quase livre, o Ridge pode carregar o coeficiente
    // que quiser nela". Uma feature com variância intra-alvo quase nula — pose
    // numa sessão de cabeça parada — cai exatamente nesse regime, E puxa a
    // média para baixo, endurecendo a penalidade de todas as outras.
    const sc = new StandardScaler();
    const bruto = samples.map((t) => t.featuresLeft);
    sc.fit(bruto);
    const P = withinTargetPenalty(sc.transform(bruto), samples.map(chave));

    return {
      trainErrorPx: erroDe(samples, samples),
      looErrorPx: looN > 0 ? looSoma / looN : NaN,
      targets: alvos.length,
      lambdaL: cheio.ridgeL.getModel?.()?.lambda ?? NaN,
      lambdaR: cheio.ridgeR.getModel?.()?.lambda ?? NaN,
      penaltyDiag: P ? P.map((linha, j) => Number(linha[j].toFixed(4))) : null,
      poseGainPxPorGrau: ganhoPose(cheio, bruto, vw, vh),
      espectro: espectroDeFeatures(bruto),
      // 3.1 — matriz de correlacao inteira, para ver QUAIS pares sao redundantes.
      // O posto efetivo diz quanta redundancia existe; isto diz onde ela mora.
      correlacao: matrizCorrelacao(bruto),
    };
  }

  // Retorna coordenadas em px de tela ja com clamp normalizado, sem filtro
  // temporal (filtro e responsabilidade do caller).
  predictPx(fL: number[], fR: number[], vw: number, vh: number): { x: number; y: number } {
    if (!this.trained) throw new Error('ReplayRegressor.predictPx chamado antes de train');
    const sL = this.scalerL.transformSingle(this.pcaL ? this.pcaL.transform(fL) : fL);
    const sR = this.scalerR.transformSingle(this.pcaR ? this.pcaR.transform(fR) : fR);
    const pL = this.ridgeL.predict(sL);
    const pR = this.ridgeR.predict(sR);
    let baseX: number, baseY: number;
    switch (ReplayRegressor.fusao) {
      case 'esquerdo': baseX = pL.x; baseY = pL.y; break;
      case 'direito':  baseX = pR.x; baseY = pR.y; break;
      case 'confianca':
        baseX = pL.x * this.pesoL + pR.x * this.pesoR;
        baseY = pL.y * this.pesoL + pR.y * this.pesoR;
        break;
      // 'concatenado' junta os vetores ANTES do treino, entao aqui os dois
      // "olhos" ja carregam a mesma predicao conjunta e a media e identidade.
      default: baseX = (pL.x + pR.x) / 2; baseY = (pL.y + pR.y) / 2;
    }
    const normX = Math.min(1, Math.max(0, baseX));
    const normY = Math.min(1, Math.max(0, baseY));
    return { x: normX * vw, y: normY * vh };
  }
}

interface FrameError {
  frameIdx: number;
  targetXPx: number;
  targetYPx: number;
  predictedXPx: number;
  predictedYPx: number;
  errorPx: number;
  errorDeg: number;
}

interface PerPointStat {
  targetXPx: number;
  targetYPx: number;
  label?: string;
  count: number;
  meanErrorPx: number;
  medianErrorPx: number;
  meanErrorDeg: number;
}

interface Report {
  replayVersion: 1;
  generatedAt: string;
  input: { path: string; startedAt: string; formatVersion: number };
  resolution: { w: number; h: number };
  filter: { preset: AnyFilterPreset; mincutoff: number; beta: number; normalizedSpace: boolean };
  frames: {
    totalInJsonl: number;
    droppedInRecording: number;
    calibration: number;
    accuracy: number;
    live: number;
    discarded: number;
    rejectedByDecision: number;
    legacyNoDecision: number;
    regatePose?: RegateInfo;
  };
  calibration: { uniqueTargets: number; trainErrorPx: number; looErrorPx: number; lambdaL: number; lambdaR: number; penaltyDiag: number[] | null; poseGainPxPorGrau: { yawX: number; pitchY: number } | null; espectro: ReturnType<typeof espectroDeFeatures>; correlacao: number[][] | null };
  accuracy: {
    n: number;
    meanErrorPx: number;
    medianErrorPx: number;
    p90ErrorPx: number;
    maxErrorPx: number;
    meanErrorDeg: number;
    medianErrorDeg: number;
    p90ErrorDeg: number;
    perPoint: PerPointStat[];
  } | null;
  /** 1.3 — resposta do resíduo à pose, nos frames do teste de precisão.
   *  `null` quando a gravação não tem pose ou tem poucos frames. */
  residuoVsPose: {
    n: number;
    refPose: Pose;
    yawParaX: { pxPorGrau: number; r: number };
    pitchParaY: { pxPorGrau: number; r: number };
    /** Estimador within-alvo: a média de cada alvo é removida dos dois lados
     *  antes de regredir, isolando a resposta geométrica do erro por alvo. */
    dentroDoAlvo: {
      n: number;
      yawParaX: { pxPorGrau: number; r: number };
      pitchParaY: { pxPorGrau: number; r: number };
      amplitudeYawGraus: number;
      amplitudePitchGraus: number;
    } | null;
    residuoMedioPx: { x: number; y: number };
    desvioPoseMedioGraus: { yaw: number; pitch: number };
    esperadoPxPorGrau: number;
  } | null;
  /** 1.4 — média e amplitude da correção de translação aplicada, em px. */
  correcaoTranslacao: {
    mediaPx: { x: number; y: number };
    amplitudePx: { x: number; y: number };
  } | null;
  config: {
    assumedDistPx: number;
    rbfApplied: false;
    onlineRls: false;
    source: 'src/';
    featuresSource: 'recorded' | 'recomputed';
    // D4.3 — grupos zerados. Vazio = vetor completo.
    droppedFeatureGroups: FeatureGroup[];
    // D7.3 — janela temporal aplicada aos frames de accuracy (undefined = sem filtro).
    timeWindow?: { startSec: number; endSec: number; framesFilteredOut: number };
  };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor(s.length * p));
  return s[idx];
}

function pxToDeg(px: number): number {
  return (Math.atan(px / ASSUMED_DIST_PX) * 180) / Math.PI;
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  // Modulos importados de src/ (ex.: RidgeRegressor.selectLambdaCV) chamam
  // console.log para diagnostico. Sem redirecionar, isso polui o JSON escrito
  // em stdout — o que quebra `npm run replay > report.json` e a Fase 0.4
  // (bench) que vai parsear stdout. Desviamos para stderr sem mexer nos modulos.
  const origLog = console.log;
  console.log = (...a: unknown[]) => console.error(...a);
  try {
    return await runInner(args);
  } finally {
    console.log = origLog;
  }
}

async function runInner(args: CliArgs): Promise<number> {
  const text = await readFile(resolvePath(args.jsonl), 'utf8');
  const rec = parseJSONL(text);
  if (!rec) {
    process.stderr.write(`ERRO: nao foi possivel parsear ${args.jsonl} como JSONL da Fase 0.1.\n`);
    return 2;
  }
  // 0.1 — guarda de compatibilidade do vetor de features.
  //
  // Só morde quando o usuário pediu explicitamente as features GRAVADAS: se
  // vamos recomputar a partir dos landmarks, o vetor da gravação é irrelevante.
  if (args.featureSet && !args.recomputeFeatures) {
    console.error(
      `
ERRO: --feature-set ${args.featureSet} pede features recomputadas.
` +
      `As features gravadas no JSONL já vieram projetadas pelo build que gravou;
` +
      `reprojetá-las fatiaria um vetor que já perdeu as dimensões pedidas, e o
` +
      `número sairia sem que nada acusasse. Remova --use-recorded-features.
`,
    );
    return 2;
  }

  if (!args.recomputeFeatures) {
    const gravado = rec.header.featureVectorId;
    if (gravado !== FEATURE_VECTOR_ID) {
      process.stderr.write(
        `ERRO: incompatibilidade de vetor de features.\n` +
        `  gravacao: ${gravado ?? '(anterior ao campo — vetor desconhecido)'}\n` +
        `  build   : ${FEATURE_VECTOR_ID}\n` +
        `\n` +
        `As features gravadas descrevem um pipeline diferente do que esta no\n` +
        `codigo. Medir assim produz um numero que nao corresponde a nenhuma\n` +
        `configuracao real — foi o que aconteceu com ci-baseline-a2.report.json.\n` +
        `\n` +
        `Rode sem --use-recorded-features para recomputar a partir dos landmarks.\n`,
      );
      return 2;
    }
  }

  const vw = rec.header.resolution.w;
  const vh = rec.header.resolution.h;
  if (!vw || !vh) {
    process.stderr.write(`ERRO: header sem resolution valida (${vw}x${vh}).\n`);
    return 2;
  }

  ReplayRegressor.pcaK = args.pca;
  ReplayRegressor.fusao = args.fusao;
  RidgeRegressor.lambdaOverride = args.lambda ?? null;
  RidgeRegressor.axisScale = args.axisWeightedCv ? { x: vw, y: vh } : { x: 1, y: 1 };
  const split = splitFrames(rec, args.recomputeFeatures, args.dropFeatures, args.timeWindow, args.regatePose, args.featureSet, args.keepDims);
  // D7.3 — log honesto quando o filtro corta frames de accuracy: o número
  // de amostras retido é insumo direto para interpretar a curva de drift.
  if (split.timeWindow) {
    process.stderr.write(
      `[replay] time-window ${split.timeWindow.startSec}s..${split.timeWindow.endSec}s → ` +
      `${split.accuracy.length} frames de accuracy retidos, ${split.timeWindow.filteredOut} filtrados.\n`,
    );
  }
  
  if (split.legacyNoDecision > 0) {
    process.stderr.write(
      `\nAVISO: gravação v1 sem sampleDecision — o modelo do replay inclui frames\n` +
      `que o pipeline ao vivo descartaria. Números NÃO comparáveis com o teste online.\n\n`
    );
  }

  if (split.calibration.length < 2) {
    process.stderr.write(
      `ERRO: nao ha frames de calibracao suficientes no JSONL (${split.calibration.length}). ` +
      `Regravar com calibracao rodando via SettingsScreen > Gravador de sessao.\n`,
    );
    return 3;
  }

  const regr = new ReplayRegressor();
  regr.train(split.calibration);
  const uniqueTargets = new Set(
    split.calibration.map((s) => `${s.targetXNorm.toFixed(4)},${s.targetYNorm.toFixed(4)}`),
  ).size;

  // 1.2 — treino vs leave-one-target-out. A distância entre os dois é a medida
  // de memorização, e é o número que decide se uma feature nova ajuda ou só
  // dá ao Ridge um jeito melhor de decorar os aglomerados.
  const diagCalib = ReplayRegressor.diagnose(split.calibration, vw, vh);

  // D3.2 — resolve config v1 (pixel) ou v2 (normalized). No caminho v2, o
  // filtro opera em [0, 1] antes de converter para pixel — exatamente o que
  // o engine faz desde D1-1.
  const filterName = args.filter as string;
  const fc = isV2Preset(filterName)
    ? FILTER_PRESETS_V2[filterName]
    : FILTER_PRESETS[filterName as FilterPreset];
  const filter = new OneEuroFilter2D(60, fc.mincutoff, fc.beta);
  const filterInNormalizedSpace = fc.filterInNormalizedSpace;

  // 1.3 — pose média das amostras de calibração ACEITAS: o centróide contra o
  // qual o Ridge minimizou o erro, e portanto a única referência coerente.
  const poseRefCalib = poseDeReferencia(split.calibration.map((c) => c.pose));
  // 1.4 — mesma lógica de referência para o centro facial.
  const centroRefCalib = centroDeReferencia(split.calibration.map((c) => c.centro));
  // Densidade da tela alvo. `ASSUMED_DIST_PX` já assume 96 DPI, então usar a
  // mesma convenção aqui mantém o harness internamente coerente.
  const PX_POR_CM = 96 / 2.54;

  const errors: FrameError[] = [];
  for (const s of split.accuracy) {
    const bruto = regr.predictPx(s.featuresLeft, s.featuresRight, vw, vh);
    // Compensação ANTES do filtro temporal: ela corrige o ponto predito, e
    // filtrar depois trata o resultado corrigido como qualquer predição. Na
    // ordem inversa o filtro suavizaria um sinal que ainda vai ser deslocado.
    const raw = args.poseCompensation
      ? (() => {
          const c = compensarPredicao(
            bruto.x / vw, bruto.y / vh, s.pose, poseRefCalib,
            ASSUMED_DIST_PX * args.poseCompensationGain, vw, vh,
          );
          return {
            x: args.poseCompensationAxes === 'y' ? bruto.x : c.x * vw,
            y: args.poseCompensationAxes === 'x' ? bruto.y : c.y * vh,
          };
        })()
      : args.constantShiftPx
        ? { x: bruto.x + args.constantShiftPx.x, y: bruto.y + args.constantShiftPx.y }
        : bruto;

    // 1.4 — translação aplicada depois da rotação e antes do filtro: são
    // efeitos independentes que se somam no mesmo ponto predito.
    const corrigido = args.translationCompensation
      ? (() => {
          const c = compensarTranslacao(
            raw.x / vw, raw.y / vh, s.centro, centroRefCalib, s.escala,
            PX_POR_CM, vw, vh,
          );
          return { x: c.x * vw, y: c.y * vh };
        })()
      : raw;
    // Timestamp em segundos (OneEuro usa segundos). captureTs vem de
    // performance.now() em ms — divide por 1000.
    const smooth = filterInNormalizedSpace
      ? (() => {
          const sm = filter.filter(corrigido.x / vw, corrigido.y / vh, s.captureTs / 1000);
          return { x: sm.x * vw, y: sm.y * vh };
        })()
      : filter.filter(corrigido.x, corrigido.y, s.captureTs / 1000);
    const dx = smooth.x - s.target.xPx;
    const dy = smooth.y - s.target.yPx;
    const errPx = Math.hypot(dx, dy);
    errors.push({
      frameIdx: s.frameIdx,
      targetXPx: s.target.xPx,
      targetYPx: s.target.yPx,
      predictedXPx: smooth.x,
      predictedYPx: smooth.y,
      errorPx: errPx,
      errorDeg: pxToDeg(errPx),
    });
    if (args.verbose) {
      process.stdout.write(
        `frame ${s.frameIdx}: target=(${s.target.xPx.toFixed(0)}, ${s.target.yPx.toFixed(0)}) ` +
        `pred=(${smooth.x.toFixed(0)}, ${smooth.y.toFixed(0)}) ` +
        `err=${errPx.toFixed(1)}px / ${pxToDeg(errPx).toFixed(2)}°\n`,
      );
    }
  }

  // 1.4 — o que a compensação de translação de fato aplicou, em px.
  //
  // Média e amplitude juntas, porque só as duas separam compensação de remoção
  // de viés: se a amplitude for desprezível ao lado da média, a correção é um
  // deslocamento fixo com outro nome, e um `--constant-shift` a reproduz sem
  // usar o rosto para nada.
  const correcaoTranslacao = (() => {
    if (!centroRefCalib) return null;
    const xs: number[] = []; const ys: number[] = [];
    for (const am of split.accuracy) {
      const c = compensarTranslacao(0, 0, am.centro, centroRefCalib, am.escala, PX_POR_CM, vw, vh);
      xs.push(c.x * vw); ys.push(c.y * vh);
    }
    if (xs.length === 0) return null;
    const med = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;
    return {
      mediaPx: { x: med(xs), y: med(ys) },
      amplitudePx: { x: Math.max(...xs) - Math.min(...xs), y: Math.max(...ys) - Math.min(...ys) },
    };
  })();

  // 1.3 — o resíduo do modelo responde à pose?
  //
  // Esta é a pergunta que decide se compensar geometricamente pode funcionar.
  // Se a cabeça gira Δ e o olho fica parado na órbita, o ponto olhado se desloca
  // `d · tan(Δ)`, e o modelo — que só vê a íris no frame da cabeça — não tem como
  // saber. Então o erro DEVE crescer com o desvio de pose, com inclinação igual
  // ao ganho geométrico. Se não crescer, não há o que compensar e a Fase 1.3
  // não tem premissa.
  //
  // Regressão simples do resíduo por eixo contra o desvio de pose, em px/grau,
  // com o r de Pearson junto: inclinação sem correlação é ruído.
  const residuoVsPose = (() => {
    const ref = poseMedia(split.calibration.map((c) => c.pose));
    if (!ref) return null;
    const pares: { dyaw: number; dpitch: number; rx: number; ry: number }[] = [];
    for (let i = 0; i < split.accuracy.length; i++) {
      const p = split.accuracy[i].pose;
      const e = errors[i];
      if (!p || !e) continue;
      pares.push({
        dyaw: p.yaw - ref.yaw, dpitch: p.pitch - ref.pitch,
        rx: e.predictedXPx - e.targetXPx, ry: e.predictedYPx - e.targetYPx,
      });
    }
    if (pares.length < 10) return null;
    const ajuste = (x: number[], y: number[]) => {
      const n = x.length;
      const mx = x.reduce((a, b) => a + b, 0) / n, my = y.reduce((a, b) => a + b, 0) / n;
      let sxy = 0, sxx = 0, syy = 0;
      for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; syy += (y[i] - my) ** 2; }
      if (sxx === 0) return { pxPorGrau: NaN, r: NaN };
      // slope está em px/rad; × π/180 dá px/grau.
      return { pxPorGrau: (sxy / sxx) * (Math.PI / 180), r: syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0 };
    };
    const x = ajuste(pares.map((p) => p.dyaw), pares.map((p) => p.rx));
    const y = ajuste(pares.map((p) => p.dpitch), pares.map((p) => p.ry));

    // A regressão acima é CONTAMINADA e não serve para dimensionar a correção.
    //
    // A pose deriva monotonicamente com o tempo e os alvos do teste também são
    // apresentados em ordem fixa, então "pose" e "qual alvo" andam juntos. A
    // inclinação bruta mistura a resposta geométrica com o erro que o modelo
    // já tem em cada alvo.
    //
    // O estimador WITHIN remove a média de cada alvo dos dois lados antes de
    // regredir. Sobra só a variação de pose DENTRO de um mesmo alvo, que não
    // pode ser explicada por qual alvo é — é a resposta geométrica isolada.
    const porAlvo = new Map<string, typeof pares>();
    for (let i = 0; i < split.accuracy.length; i++) {
      const p = split.accuracy[i].pose; const e = errors[i];
      if (!p || !e) continue;
      const k = `${Math.round(e.targetXPx)},${Math.round(e.targetYPx)}`;
      const arr = porAlvo.get(k);
      const item = { dyaw: p.yaw - ref.yaw, dpitch: p.pitch - ref.pitch,
                     rx: e.predictedXPx - e.targetXPx, ry: e.predictedYPx - e.targetYPx };
      if (arr) arr.push(item); else porAlvo.set(k, [item]);
    }
    const centrado: typeof pares = [];
    for (const grupo of porAlvo.values()) {
      if (grupo.length < 3) continue;
      const m = (pick: (q: typeof grupo[0]) => number) => grupo.reduce((a, b) => a + pick(b), 0) / grupo.length;
      const my = m((q) => q.dyaw), mp = m((q) => q.dpitch), mrx = m((q) => q.rx), mry = m((q) => q.ry);
      for (const q of grupo) {
        centrado.push({ dyaw: q.dyaw - my, dpitch: q.dpitch - mp, rx: q.rx - mrx, ry: q.ry - mry });
      }
    }
    const dentro = centrado.length >= 10 ? {
      n: centrado.length,
      yawParaX: ajuste(centrado.map((p) => p.dyaw), centrado.map((p) => p.rx)),
      pitchParaY: ajuste(centrado.map((p) => p.dpitch), centrado.map((p) => p.ry)),
      /** Amplitude de pose que sobra depois de remover a média do alvo. Se for
       *  ínfima, a inclinação WITHIN é ruído dividido por ruído. */
      amplitudeYawGraus: (Math.max(...centrado.map((p) => p.dyaw)) - Math.min(...centrado.map((p) => p.dyaw))) * 180 / Math.PI,
      amplitudePitchGraus: (Math.max(...centrado.map((p) => p.dpitch)) - Math.min(...centrado.map((p) => p.dpitch))) * 180 / Math.PI,
    } : null;

    return {
      n: pares.length,
      refPose: ref,
      yawParaX: x, pitchParaY: y,
      dentroDoAlvo: dentro,
      // 1.3 — o que a compensação geométrica de fato aplicaria nesta gravação,
      // ao lado do viés que existe para ser corrigido. O desvio de pose durante
      // o teste é quase constante, então `d · tan(Δ)` vira um deslocamento
      // aproximadamente fixo: ele só ajuda se casar com o resíduo médio.
      residuoMedioPx: {
        x: pares.reduce((a, b) => a + b.rx, 0) / pares.length,
        y: pares.reduce((a, b) => a + b.ry, 0) / pares.length,
      },
      desvioPoseMedioGraus: {
        yaw: (pares.reduce((a, b) => a + b.dyaw, 0) / pares.length) * 180 / Math.PI,
        pitch: (pares.reduce((a, b) => a + b.dpitch, 0) / pares.length) * 180 / Math.PI,
      },
      // Ganho geométrico esperado, para comparação direta na mesma unidade.
      esperadoPxPorGrau: GANHO_GEOMETRICO_PX_POR_GRAU,
    };
  })();

  const accSection: Report['accuracy'] = errors.length === 0 ? null : (() => {
    const errPx = errors.map((e) => e.errorPx);
    const errDeg = errors.map((e) => e.errorDeg);
    const byTarget = new Map<string, FrameError[]>();
    for (const e of errors) {
      const key = `${e.targetXPx.toFixed(1)},${e.targetYPx.toFixed(1)}`;
      const arr = byTarget.get(key) ?? [];
      arr.push(e);
      byTarget.set(key, arr);
    }
    const perPoint: PerPointStat[] = [];
    for (const [, arr] of byTarget) {
      const ppErrPx = arr.map((e) => e.errorPx);
      const ppErrDeg = arr.map((e) => e.errorDeg);
      perPoint.push({
        targetXPx: arr[0].targetXPx,
        targetYPx: arr[0].targetYPx,
        count: arr.length,
        meanErrorPx: ppErrPx.reduce((a, b) => a + b, 0) / ppErrPx.length,
        medianErrorPx: median(ppErrPx),
        meanErrorDeg: ppErrDeg.reduce((a, b) => a + b, 0) / ppErrDeg.length,
      });
    }
    return {
      n: errors.length,
      meanErrorPx: errPx.reduce((a, b) => a + b, 0) / errPx.length,
      medianErrorPx: median(errPx),
      p90ErrorPx: percentile(errPx, 0.9),
      maxErrorPx: Math.max(...errPx),
      meanErrorDeg: errDeg.reduce((a, b) => a + b, 0) / errDeg.length,
      medianErrorDeg: median(errDeg),
      p90ErrorDeg: percentile(errDeg, 0.9),
      perPoint,
    };
  })();

  const report: Report = {
    replayVersion: 1,
    generatedAt: new Date().toISOString(),
    input: {
      path: resolvePath(args.jsonl),
      startedAt: rec.header.startedAt,
      formatVersion: rec.header.formatVersion,
    },
    resolution: { w: vw, h: vh },
    filter: { preset: args.filter, mincutoff: fc.mincutoff, beta: fc.beta, normalizedSpace: filterInNormalizedSpace },
    frames: {
      totalInJsonl: rec.frames.length,
      droppedInRecording: rec.droppedFrames,
      calibration: split.calibration.length,
      accuracy: split.accuracy.length,
      live: split.live,
      discarded: split.discarded,
      rejectedByDecision: split.rejectedByDecision,
      legacyNoDecision: split.legacyNoDecision,
      // 1.1 — presente só quando `--regate-pose` foi usado. A ausência do campo
      // é a marca de que o relatório honrou as decisões gravadas.
      regatePose: split.regate,
    },
    calibration: { uniqueTargets, ...diagCalib },
    accuracy: accSection,
    residuoVsPose,
    correcaoTranslacao,
    config: {
      assumedDistPx: ASSUMED_DIST_PX,
      rbfApplied: false,
      onlineRls: false,
      source: 'src/',
      featuresSource: args.recomputeFeatures ? 'recomputed' : 'recorded',
      // 1.2 — qual conjunto ESTE relatório mediu. Sem isto uma tabela de
      // variantes vira um monte de números sem etiqueta.
      featureSet: args.featureSet ?? 'iris12 (ACTIVE_FEATURE_SET)',
      poseCompensation: args.poseCompensation,
      poseCompensationGain: args.poseCompensationGain,
      poseCompensationAxes: args.poseCompensationAxes,
      constantShiftPx: args.constantShiftPx ?? null,
      translationCompensation: args.translationCompensation,
      featureDims: activeFeatureDims(args.featureSet),
      pca: args.pca,
      keepDims: args.keepDims ?? null,
      fusao: args.fusao,
      lambda: args.lambda ?? 'CV',
      axisWeightedCv: args.axisWeightedCv,
      // Sem isto, um relatorio nao diz a que pipeline se refere — e relatorio
      // que nao diz isso vira decisao tomada sobre configuracao errada.
      featureVectorId: FEATURE_VECTOR_ID,
      recordedFeatureVectorId: rec.header.featureVectorId ?? null,
      droppedFeatureGroups: args.dropFeatures,
      timeWindow: split.timeWindow
        ? {
            startSec: split.timeWindow.startSec,
            endSec: split.timeWindow.endSec,
            framesFilteredOut: split.timeWindow.filteredOut,
          }
        : undefined,
    },
  };

  const output = JSON.stringify(report, null, 2);
  if (args.report) {
    await writeFile(resolvePath(args.report), output, 'utf8');
    process.stdout.write(`Relatorio escrito em ${resolvePath(args.report)}\n`);
  } else {
    process.stdout.write(output + '\n');
  }
  return 0;
}

// Bootstrap chama esta funcao; qualquer excecao vira exit != 0.
export async function run(argv: string[]): Promise<number> {
  try {
    return await main(argv);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`ERRO: ${msg}\n`);
    return 1;
  }
}
