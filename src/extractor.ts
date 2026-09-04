import { buildL2CSBlock } from './l2cs/block';
import { EXPERIMENT } from './config/experiment';
// P5.1 — topologia do Face Mesh com nome, e a guarda de contagem.
import {
  OLHO_ESQUERDO, OLHO_DIREITO, IRIS_ESQUERDA, IRIS_DIREITA,
  TESTA_TOPO, assertFaceMeshCompleto, meshAusenteOuParcial,
} from './faceLandmarks';

export type Point3D = { x: number; y: number; z: number; visibility?: number };

export interface GeometryFeatures {
  pupilCenterLeft: Point3D;
  pupilCenterRight: Point3D;
  irisRadiusLeft: number;
  irisRadiusRight: number;
  pupilEllipseLeft: { width: number; height: number };
  pupilEllipseRight: { width: number; height: number };
  interEyeDistance: number;
  eyeWidthLeft: number;
  eyeHeightLeft: number;
  eyeWidthRight: number;
  eyeHeightRight: number;
}

export interface FaceFeatures {
  pitch: number;
  yaw: number;
  roll: number;
  position3D: Point3D;
  scale: number;
  cameraDistanceEstimate: number;
}

/**
 * Campos OPCIONAIS de propósito: ausente significa "não medido".
 *
 * Antes eram obrigatórios, e o extractor os preenchia com constantes
 * (`detectorConfidence: 1.0`, `brightnessEstimate: 0.5`, `contrastEstimate:
 * 0.5`, `blurEstimate: 0.0`) que o `EyeQualityAnalyzer` deveria sobrescrever
 * com medida real. Quando o analisador FALHA — canvas sem contexto 2d, crop
 * degenerado — as constantes sobreviviam ao spread em `engine.ts` e chegavam ao
 * gate de calibração parecendo medição. E não são valores neutros: passam em
 * todos os seis critérios do gate, `detectorConfidence: 1.0` inclusive, que
 * afirma confiança máxima justamente quando nada foi medido.
 *
 * `undefined` força o consumidor a decidir o que fazer com a ausência, em vez
 * de decidir por ele com um número plausível.
 */
export interface QualityFeatures {
  detectorConfidence?: number;
  brightnessEstimate?: number;
  contrastEstimate?: number;
  blurEstimate?: number;
  occlusionEstimate?: number;
  /** Medido de verdade, a partir do EAR — `ear / 0.25` satura em 1,0 porque
   *  o EAR chega anisotrópico (mediana 0,551 onde a escala isotrópica daria
   *  0,314). */
  irisVisibilityPercentage?: number;
  // Fração de pixels do crop ocular com luminância > SPECULAR_LUMINANCE
  // (default 0.95). Pele e esclera raramente saturam sob exposição correta;
  // lente refletindo a tela, sim. Opcional para compat com testes/perfis
  // antigos serializados.
  specularRatio?: number;
}

export interface AdvancedFrameFeatures {
  geometry: GeometryFeatures;
  face: FaceFeatures;
  quality: QualityFeatures;
}

export interface ExtractorResult {
  featuresLeft: number[];
  featuresRight: number[];
  blinkDetected: boolean;
  advancedFeatures?: AdvancedFrameFeatures;
  // EAR (Eye Aspect Ratio) por olho. Preenchidos por extractEyeFeatures.
  // Usados pelo engine para ponderar a fusão binocular quando um olho está
  // parcialmente fechado (piscadinha curta que passa pelo BlinkDetector,
  // ptose unilateral, obstrução por franja, etc). Opcionais para compat
  // com callers que não participam do pipeline live.
  leftEAR?: number;
  rightEAR?: number;
}

// EyeTrax Indices
const LEFT_EYE_INDICES = [
  107,  66, 105,  63,  70,  55,  65,  52,  53,  46, 468, 469, 470, 471, 472,
  133,  33, 173, 157, 158, 159, 160, 161, 246, 155, 154, 153, 145, 144, 163,   7,
  243, 190,  56,  28,  27,  29,  30, 247, 130,  25, 110,  24,  23,  22,  26, 112,
  244, 189, 221, 222, 223, 224, 225, 113, 226,  31, 228, 229, 230, 231, 232, 233,
  193, 245, 128, 121, 120, 119, 118, 117, 111,  35, 124, 143, 156
];

const RIGHT_EYE_INDICES = [
  336, 296, 334, 293, 300, 285, 295, 282, 283, 276, 473, 476, 475, 474, 477,
  362, 263, 398, 384, 385, 386, 387, 388, 466, 382, 381, 380, 374, 373, 390, 249,
  463, 414, 286, 258, 257, 259, 260, 467, 359, 255, 339, 254, 253, 252, 256, 341,
  464, 413, 441, 442, 443, 444, 445, 342, 446, 261, 448, 449, 450, 451, 452, 453,
  417, 465, 357, 350, 349, 348, 347, 346, 340, 265, 353, 372, 383
];

const MUTUAL_INDICES = [
  4, 10, 151, 9, 152, 234, 454, 58, 288
];

// Vector Math Helpers
function sub(v1: Point3D, v2: Point3D): Point3D { return { x: v1.x - v2.x, y: v1.y - v2.y, z: v1.z - v2.z }; }
function add(v1: Point3D, v2: Point3D): Point3D { return { x: v1.x + v2.x, y: v1.y + v2.y, z: v1.z + v2.z }; }
function scale(v: Point3D, s: number): Point3D { return { x: v.x * s, y: v.y * s, z: v.z * s }; }
function norm(v: Point3D): number { return Math.sqrt(v.x*v.x + v.y*v.y + v.z*v.z); }
function normalize(v: Point3D): Point3D { 
  const n = norm(v) + 1e-9;
  return scale(v, 1/n);
}
function dot(v1: Point3D, v2: Point3D): number { return v1.x*v2.x + v1.y*v2.y + v1.z*v2.z; }
function cross(v1: Point3D, v2: Point3D): Point3D {
  return {
    x: v1.y * v2.z - v1.z * v2.y,
    y: v1.z * v2.x - v1.x * v2.z,
    z: v1.x * v2.y - v1.y * v2.x
  };
}
// BUG-3: dist2D foi substituída por dist3D no cálculo de EAR.
function dist3D(p1: Point3D, p2: Point3D): number {
  return Math.sqrt((p1.x - p2.x) ** 2 + (p1.y - p2.y) ** 2 + (p1.z - p2.z) ** 2);
}

/** As dimensões do vídeo permitem calcular o fator de anisotropia? (B2.6) */
function aspectoValido(w?: number, h?: number): boolean {
  return (
    typeof w === 'number' && typeof h === 'number' &&
    Number.isFinite(w) && Number.isFinite(h) &&
    w > 0 && h > 0
  );
}

// R^T * v = [dot(x_axis, v), dot(y_axis, v), dot(z_axis, v)]
function mulRT(xAxis: Point3D, yAxis: Point3D, zAxis: Point3D, v: Point3D): Point3D {
  return {
    x: dot(xAxis, v),
    y: dot(yAxis, v),
    z: dot(zAxis, v)
  };
}

// Detector de piscada encapsulado em classe com reset() explícito.
// O design anterior usava um array `earHistory` de escopo de módulo que:
//   1. Nunca era resetado entre sessões.
//   2. Incluia frames de piscada no cálculo do threshold adaptativo —
//      criando realimentação: quanto mais piscadas → média EAR menor → threshold
//      menor → menos piscadas detectadas → frames de olho semifechado entram
//      no regressor como fixação válida. Em usuário com ELA (fadiga progressiva)
//      isso causa deriva de precisão ao longo da sessão.
//   3. Não tinha clamping — o threshold podia cair abaixo de 0.10 (nunca
//      detecta piscada) ou subir acima de 0.22 (detecta olho semi-fechado
//      como piscada em usuários com ptose).
//
// BlinkDetector corrige tudo isso. Sem flag — o comportamento anterior era
// indefensável.

/**
 * Piso do limiar adaptativo de piscada, na escala ISOTRÓPICA do EAR (B2.6).
 *
 * Abaixo disto o olho está fisicamente fechado em qualquer pessoa; usar um
 * piso evita que uma sequência de frames ruins arraste o limiar para zero e
 * desligue a detecção.
 */
export const EAR_THR_MIN = 0.12;

/**
 * Teto do limiar adaptativo, na escala ISOTRÓPICA do EAR (B2.6).
 *
 * Precisa ficar ACIMA de `repouso_típico × blinkRatio` para a adaptação de
 * fato acontecer: com repouso isotrópico ~0,31 e ratio 0,8, o alvo é 0,248.
 * O valor antigo (0,22) foi calibrado para a escala isotrópica mas aplicado
 * sobre um EAR inflado 1,78×, o que travava o limiar no clamp em 100% dos
 * frames.
 *
 * Também serve de proteção contra confundir olho semi-fechado (ptose) com
 * piscada — daí não ser simplesmente `Infinity`. O público-alvo tem ELA, e
 * ptose é comum: um teto alto demais transformaria a condição basal do
 * paciente em piscada permanente.
 */
export const EAR_THR_MAX = 0.28;

/**
 * Limiar ABSOLUTO de olho fechado, na escala isotrópica (P5.4 / conflito C7).
 *
 * ── É o 0,18 que a especificação pede, e ele só faz sentido depois de B2.6 ──
 *
 * Num EAR anisotrópico (mediana 0,551) o valor 0,18 nunca dispararia. Com a
 * escala corrigida, repouso mediano 0,314, ele fica a ~57% do repouso: um olho
 * abaixo disso está fechado em praticamente qualquer anatomia.
 *
 * ── Por que ele NÃO é o limiar principal ───────────────────────────────────
 *
 * Um corte fixo seria perigoso justamente para o público-alvo. Ptose é comum em
 * ELA, e alguém com repouso em 0,20 teria margem de apenas 0,02 até o corte —
 * tremor de landmark viraria piscada. Quem decide no regime normal continua
 * sendo o limiar ADAPTATIVO, que aprende o repouso da pessoa.
 *
 * O 0,18 vale onde ele de fato significa "fechado independente de quem": no
 * BOOTSTRAP, antes de existir histórico para adaptar.
 */
export const EAR_CLOSED_ABSOLUTE = 0.18;

/**
 * Quantos quadros o bootstrap tolera sem acumular NENHUM histórico antes de
 * concluir que a premissa do limiar absoluto não vale para esta pessoa.
 *
 * 60 quadros ≈ 2 s a 30 fps. Ninguém fica 2 s com os olhos fechados na frente
 * da tela de calibração sem que isso seja o estado normal daquele rosto.
 */
const BOOTSTRAP_MAX_FRAMES = 60;

export class BlinkDetector {
  private nonBlinkHistory: number[] = [];
  private readonly histLen: number;
  private readonly minHistory: number;
  private readonly blinkRatio: number;
  private readonly thrMin: number;
  private readonly thrMax: number;

  // Timestamps do INÍCIO de cada piscada (edge-detection: transição de
  // "não piscando" para "piscando"). Sem edge-detection, uma piscada de
  // 400ms a 30fps contaria como 12 piscadas — inflação inútil.
  //
  // Usado por getBlinkRatePerMinute() para a UI de conforto visual
  // detectar fadiga (>20 piscadas/min é sinal de brilho excessivo ou
  // olho seco; normal em repouso são ~17/min).
  private blinkStartTimestamps: number[] = [];
  private wasBlinking = false;
  /** Quadros consecutivos abaixo do limiar absoluto SEM nenhum histórico
   *  acumulado. Alimenta a guarda anti-deadlock do bootstrap (P5.4). */
  private quadrosSemHistorico = 0;
  /** Latch do aviso de bootstrap — uma vez por sessão, não por quadro. */
  private avisouBootstrap = false;
  private static readonly TIMESTAMP_RETENTION_MS = 5 * 60 * 1000;   // 5 min basta pra sliding windows

  // thrMin/thrMax na escala ISOTRÓPICA do EAR (B2.6).
  //
  // Os valores antigos (0,10 e 0,22) foram escolhidos para um EAR isotrópico,
  // mas o EAR que chegava estava inflado por W/H = 1,78×. Com repouso medido
  // em 0,551, `mean × 0,8 = 0,44` ficava SEMPRE cortado pelo teto de 0,22 — o
  // limiar adaptativo nunca adaptava e o `blinkRatio` não tinha efeito nenhum.
  //
  // Corrigida a escala do EAR, o repouso passa a ~0,31 e o limiar desejado a
  // 0,80 × 0,31 = 0,248. Manter o teto em 0,22 continuaria cortando: reescalar
  // os limiares é parte indissociável da correção, não um ajuste separado.
  constructor({
    histLen = 50,
    minHistory = 15,
    blinkRatio = 0.8,
    thrMin = EAR_THR_MIN,
    thrMax = EAR_THR_MAX,
  }: {
    histLen?: number;
    minHistory?: number;
    blinkRatio?: number;
    thrMin?: number;
    thrMax?: number;
  } = {}) {
    this.histLen = histLen;
    this.minHistory = minHistory;
    this.blinkRatio = blinkRatio;
    this.thrMin = thrMin;
    this.thrMax = thrMax;
  }

  // Retorna true se o frame é piscada. Atualiza o histórico só com
  // frames de NÃO piscada (quebra a realimentação).
  //
  // `nowMs` opcional — quando ausente usa Date.now(). Injetável para
  // testes determinísticos e para o caller cotar seu próprio relógio
  // monótono (performance.now() no engine).
  update(ear: number, nowMs: number = Date.now()): boolean {
    // ── Limiar do quadro ─────────────────────────────────────────────────────
    //
    // P5.4 — o bootstrap usa `EAR_CLOSED_ABSOLUTE` (0,18), não `thrMax`.
    //
    // O código anterior era `let thr = this.thrMax;` com o comentário "default
    // conservador: só olho bem fechado conta". O comentário dizia o oposto do
    // que o código fazia: 0,28 é o valor MAIS EAGER da faixa, e como o
    // histórico só acumula em quadros SEM piscada, qualquer pessoa com repouso
    // abaixo de 0,28 entrava em deadlock — todo quadro virava piscada, o
    // histórico nunca enchia, e o limiar ficava travado em 0,28 para sempre.
    //
    // Medido: repouso 0,25 dava 200 piscadas em 200 quadros, com `restingEar`
    // preso em `null`. Na prática, o app liga, roda e nunca rastreia para essa
    // pessoa. E repouso baixo (ptose) é comum em ELA — o público-alvo.
    let thr = EAR_CLOSED_ABSOLUTE;
    if (this.nonBlinkHistory.length >= this.minHistory) {
      const mean = this.nonBlinkHistory.reduce((a, b) => a + b, 0) / this.nonBlinkHistory.length;
      thr = Math.max(this.thrMin, Math.min(this.thrMax, mean * this.blinkRatio));
    }
    let blink = ear < thr;

    // Segunda guarda: ptose severa, com o olho ABERTO abaixo de 0,18.
    //
    // Aí o bootstrap por limiar absoluto repetiria o deadlock. A conclusão
    // certa não é "esta pessoa está piscando há dois segundos" — é que a
    // premissa "0,18 = fechado" não vale para ela. Adotamos o observado como
    // repouso e deixamos o limiar adaptativo assumir a partir daí.
    // A condição é `< minHistory`, não `=== 0`: liberar um único quadro não
    // resolve nada, porque o limiar adaptativo só entra quando o histórico
    // ATINGE `minHistory`. Com a guarda presa em "histórico vazio", o detector
    // acumulava exatamente 1 quadro e voltava a travar.
    if (blink && this.nonBlinkHistory.length < this.minHistory) {
      this.quadrosSemHistorico++;
      if (this.quadrosSemHistorico >= BOOTSTRAP_MAX_FRAMES) {
        blink = false;
        if (!this.avisouBootstrap) {
          this.avisouBootstrap = true;
          console.warn(
            `[blink] nenhum quadro acima de ${EAR_CLOSED_ABSOLUTE} em ` +
            `${this.quadrosSemHistorico} quadros (EAR atual ${ear.toFixed(3)}). ` +
            'Adotando o valor observado como repouso — provável ptose ou anatomia ' +
            'de abertura reduzida. O limiar adaptativo assume a partir daqui.',
          );
        }
      }
    } else if (!blink) {
      this.quadrosSemHistorico = 0;
    }

    // Edge de "abriu → fechou": conta uma piscada nova.
    if (blink && !this.wasBlinking) {
      this.blinkStartTimestamps.push(nowMs);
      // Poda entradas antigas — evita crescer indefinidamente numa
      // sessão longa. Só mantém últimos 5 min (janela máxima suportada).
      const cutoff = nowMs - BlinkDetector.TIMESTAMP_RETENTION_MS;
      while (this.blinkStartTimestamps.length > 0 && this.blinkStartTimestamps[0] < cutoff) {
        this.blinkStartTimestamps.shift();
      }
    }
    this.wasBlinking = blink;

    // Só adiciona ao histórico quando não é piscada — garante que a média
    // representa o EAR de repouso, não a mistura com olho fechado.
    if (!blink) {
      this.nonBlinkHistory.push(ear);
      if (this.nonBlinkHistory.length > this.histLen) {
        this.nonBlinkHistory.shift();
      }
    }
    return blink;
  }

  reset(): void {
    this.nonBlinkHistory.length = 0;
    this.blinkStartTimestamps.length = 0;
    this.wasBlinking = false;
    this.quadrosSemHistorico = 0;
    this.avisouBootstrap = false;
  }

  /**
   * Piscadas por minuto na janela recente (padrão: últimos 60s).
   * Ambulatorial de referência: 15-20/min em repouso; >25/min sustentado
   * é indicativo de fadiga, brilho excessivo ou olho seco.
   */
  getBlinkRatePerMinute(windowMs: number = 60000, nowMs: number = Date.now()): number {
    const cutoff = nowMs - windowMs;
    let count = 0;
    for (let i = this.blinkStartTimestamps.length - 1; i >= 0; i--) {
      if (this.blinkStartTimestamps[i] >= cutoff) count++;
      else break;                                     // array é ordenado — para no primeiro anterior à janela
    }
    return count * (60000 / windowMs);
  }

  /** Para testes: quantos frames de não-piscada estão no histórico. */
  get nonBlinkCount(): number {
    return this.nonBlinkHistory.length;
  }

  /**
   * EAR de repouso DESTA PESSOA: média dos quadros sem piscada (B3.31).
   *
   * `null` enquanto não houver `minHistory` quadros — a mesma guarda que o
   * limiar adaptativo usa. Sem base observada não há razão a calcular, e
   * inventar uma é justamente o defeito que `B3.31` corrige.
   *
   * A estatística já existia para adaptar o limiar de piscada; expô-la é o que
   * permite `irisVisibilityPercentage` deixar de ser comparado contra uma
   * constante universal que não existe.
   */
  get restingEar(): number | null {
    if (this.nonBlinkHistory.length < this.minHistory) return null;
    return this.nonBlinkHistory.reduce((a, b) => a + b, 0) / this.nonBlinkHistory.length;
  }
}

/**
 * Fração da abertura ocular de repouso visível neste quadro (B3.31).
 *
 * ── O que estava errado ─────────────────────────────────────────────────────
 *
 * A expressão era `Math.min(1.0, ear / 0.25)` — um divisor FIXO contra o EAR de
 * um rosto qualquer. Mas o EAR de repouso não é universal: depende da anatomia
 * da pálpebra, da distância à câmera e da pose. Com as medianas registradas
 * neste repositório a conta saturava nos dois regimes:
 *
 *     antes de B2.6 (EAR anisotrópico):  0,551 / 0,25 = 2,20  → min → 1,0
 *     depois de B2.6 (EAR isotrópico):   0,314 / 0,25 = 1,26  → min → 1,0
 *
 * Nem a correção de anisotropia resolveu, porque o divisor continuava abaixo do
 * repouso típico. O campo publicava 1,0 em praticamente todo quadro — inclusive
 * com o olho parcialmente fechado, que é exatamente o caso que o gate de
 * qualidade da calibração tenta barrar com `irisVisibilityPercentage < 0.3`.
 * Um critério que nunca dispara é pior que critério nenhum: ele dá a impressão
 * de que o quadro foi verificado.
 *
 * ── A correção ──────────────────────────────────────────────────────────────
 *
 * Medir contra o repouso da própria pessoa, que o `BlinkDetector` já acumula.
 * O resultado passa a ser uma fração real de abertura, comparável entre
 * anatomias e entre sessões.
 *
 * `undefined` enquanto a base não existe: devolver 0 afirmaria "íris oculta" e
 * reprovaria o quadro; devolver 1 afirmaria "perfeitamente visível" e aprovaria
 * qualquer coisa. As duas são medições que ninguém fez — a política de `B3.3`.
 */
export function irisVisibilityFromEar(ear: number, earDeRepouso: number | null): number | undefined {
  if (earDeRepouso === null || !Number.isFinite(earDeRepouso) || earDeRepouso <= 0) return undefined;
  if (!Number.isFinite(ear)) return undefined;
  return Math.min(1, Math.max(0, ear / earDeRepouso));
}

// EAR Blink Detection — instância do módulo (compat com resetEarHistory)
const _blinkDetector = new BlinkDetector();

// BUG-1: earHistory era estado mutável de módulo nunca resetado entre sessões.
// Agora delega para BlinkDetector.reset().
export function resetEarHistory(): void {
  _blinkDetector.reset();
}

/**
 * Piscadas por minuto na janela recente. Delegado para o singleton do
 * módulo. Usado pela UI de conforto visual (Camada 3) — brilho excessivo
 * ou fadiga aumentam a taxa muito acima do repouso (~17/min).
 */
export function getRecentBlinkRatePerMinute(windowMs: number = 60000): number {
  return _blinkDetector.getBlinkRatePerMinute(windowMs);
}

/**
 * Versão da SEMÂNTICA do vetor de features.
 *
 * Renomeada de `RECORDING_FORMAT_VERSION` — havia outra constante com esse nome
 * exato em `telemetry/types.ts`, versionando o JSONL de gravação. Esta aqui
 * nunca chegou a ser importada por ninguém; só era citada em comentários,
 * enquanto perfis de calibração continuavam a ser carregados sem nenhuma
 * verificação de compatibilidade de pipeline.
 *
 * Complementa `FEATURE_VECTOR_ID`, não substitui: o id captura QUAIS dimensões
 * saem (conjunto e contagem), esta versão captura o que elas SIGNIFICAM. Mudar
 * a matemática do extractor mantendo 12 dims invalida perfis salvos sem alterar
 * o id — incrementar aqui é o que sinaliza isso.
 *
 * Incrementar quando a interpretação de qualquer dimensão mudar.
 */
export const FEATURE_FORMAT_VERSION = 2;

// ─── Conjunto de features ativo ─────────────────────────────────────────────
//
// LAYOUT do vetor produzido por `extractCompactFeatures` (por olho):
//
//   [0]      offsetX      deslocamento horizontal da íris vs. centro do olho
//   [1]      offsetY      idem vertical
//   [2]      relX         offsetX normalizado pela largura do olho
//   [3]      relY         offsetY normalizado pela altura do olho
//   [4..11]  contorno da íris — 4 pontos × (x,y) no frame da cabeça
//   [12..19] cantos do olho — interno, externo, topo, base × (x,y)
//   [20]     ear (altura/largura do olho)
//   [21]     irisRadius
//   [22..24] yaw, pitch, roll da cabeça
//   [25..36] interações pose × offset (12 termos)
//   [37..43] bloco L2CS (7 termos) — só quando o engine passa gaze
//   [44..49] bloco `spec11` (P6.5) — só quando o engine passa gaze:
//              [44] distância da câmera        [45] EAR esquerdo
//              [46] EAR direito                [47] gazeYaw × gazePitch
//              [48] gazeYaw²                   [49] gazePitch²
//            Existe porque o conjunto de 11 da especificação (conflito C6) pede
//            seis termos que o vetor não tinha: a distância nunca entrou, o
//            vetor é POR OLHO e carregava um `ear` só, e as interações
//            [25..36] são pose × offset — não gaze × gaze.
//
// POR QUE REDUZIR — medido em duas gravações reais, treinando na janela de
// calibração e medindo na janela do teste de precisão:
//
//   posições de calibração    4     6     8    10    12    14
//   erro com 44 dims        422   302   249   234   200   165   px
//   erro com 12 dims        320   194   165   152   140   117   px
//
// 12 dims venceu em TODOS os k, nas DUAS gravações. A razão é de
// condicionamento, não de informação: 9 alvos distintos não determinam 45
// parâmetros por olho, e as 32 dimensões extras dão ao Ridge liberdade para
// separar os 9 aglomerados usando ruído intra-fixação. O sintoma medido é
// inequívoco — segurar amostras aleatórias dá 22 px de erro, segurar um alvo
// INTEIRO dá 140 px: o modelo memoriza aglomerados em vez de aprender um mapa.
//
// O que sai e por quê:
//   cantos [12..19]  → geometria da órbita, não do olhar; move com a pose.
//   ear, irisRadius  → abertura da pálpebra e distância; sem sinal de direção.
//   pose  [22..24]   → o Ridge pode usá-la como atalho para adivinhar o alvo,
//                      porque pose está correlacionada com a ordem de
//                      apresentação. A alternativa é a compensação geométrica
//                      no output (ver poseCompensation.ts).
//   interações [25..36] → 12 dims quadráticas sobre 9 restrições.
//   L2CS [37..43]    → ver `sourceDimensions` em l2cs/crop.ts.
export type FeatureSet =
  | 'irisCore'
  | 'irisCore+pose'
  | 'irisCore+posecross'
  | 'irisCore+l2cs'
  | 'irisCore+l2cs+pose'
  | 'iris12'
  | 'iris12+pose'
  | 'iris12+posecross'
  | 'iris12+l2cs'
  | 'iris12+l2cs+pose'
  /** Conjunto de 11 da especificação (P6.5 / conflito C6). Alternativa a
   *  MEDIR: o repositório tem evidência contra ampliar o vetor (322 px contra
   *  140 px). A decisão sai do `F8.4`. */
  | 'spec11'
  | 'compact';

/** Dimensões do conjunto `spec11`. */
export const SPEC11_DIMS = 11;

/** Índices mantidos por `iris12`: offset, rel e contorno da íris. */
export const IRIS12_DIMS = 12;

/**
 * Índices do vetor completo que cada conjunto seleciona.
 *
 * Índices literais e não fatias porque os blocos não são contíguos: pose é
 * [22..24] e as interações de 1ª ordem são [25..30], com cantos/ear/irisRadius
 * ([12..21]) descartados no meio.
 *
 * Conjuntos destilados (irisCore): eliminam os 8 termos redundantes de contorno
 * de íris (que possuem correlação > 0.99 com offsetX/offsetY), reduzindo o
 * número de condição da matriz de 350.000 para < 100.
 */
const FEATURE_SET_INDICES: Record<Exclude<FeatureSet, 'compact'>, readonly number[]> = {
  'irisCore': [0, 1, 2, 3],
  'irisCore+pose': [0, 1, 2, 3, 22, 23, 24],
  'irisCore+posecross': [0, 1, 2, 3, 22, 23, 24, 25, 26],
  'irisCore+l2cs': [0, 1, 2, 3, 37, 38],
  'irisCore+l2cs+pose': [0, 1, 2, 3, 22, 23, 24, 25, 26, 37, 38],
  'iris12': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
  'iris12+pose': [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 22, 23, 24],
  'iris12+posecross': [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    22, 23, 24,
    25, 26, 27, 28, 29, 30,
  ],
  'iris12+l2cs': [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    37, 38, 39, 40, 41, 42, 43,
  ],
  'iris12+l2cs+pose': [
    0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    22, 23, 24,
    37, 38, 39, 40, 41, 42, 43,
  ],
  // P6.5 — na ORDEM da especificação: pitch, yaw, head_pitch, head_yaw,
  // head_roll, distância, EAR_left, EAR_right, pitch×yaw, pitch², yaw².
  'spec11': [37, 38, 22, 23, 24, 44, 45, 46, 47, 48, 49],
};

/** Maior índice que cada conjunto exige do vetor completo. Um vetor mais curto
 *  que isso não pode ser projetado — ver `projectFeatureSet`. */
const FEATURE_SET_MIN_LENGTH: Record<Exclude<FeatureSet, 'compact'>, number> = {
  'irisCore': 4,
  'irisCore+pose': 25,
  'irisCore+posecross': 27,
  'irisCore+l2cs': 39,
  'irisCore+l2cs+pose': 39,
  'iris12': 12,
  'iris12+pose': 25,
  'iris12+posecross': 31,
  'iris12+l2cs': 44,
  'iris12+l2cs+pose': 44,
  'spec11': 50,
};

/** Índices do bloco L2CS no vetor COMPLETO (ver o mapa em [37..43]). */
const L2CS_FULL_INDICES: readonly number[] = [37, 38, 39, 40, 41, 42, 43];

/**
 * Posições do bloco L2CS DENTRO do vetor já projetado no conjunto — vazio
 * quando o conjunto não carrega bloco angular nenhum.
 *
 * Existe porque o diagnóstico `l2csValidFraction` perguntava "as últimas
 * L2CS_BLOCK_DIM dimensões são todas zero?", e essa pergunta erra de dois
 * jeitos: com `irisCore` (4 dims) o vetor é mais curto que o bloco e a
 * contagem simplesmente não acontece — o relatório publicava 0%, que se lê
 * como "o L2CS falhou em 100% das amostras" quando a verdade é que ele não
 * está no vetor; e com `irisCore+l2cs`, que leva só 2 das 7 dims, "as últimas
 * 7" invadiria as features de íris.
 *
 * `compact` devolve o vetor inteiro, então as posições são os próprios índices.
 */
export function l2csSlotsInSet(set: FeatureSet = ACTIVE_FEATURE_SET): number[] {
  if (set === 'compact') return [...L2CS_FULL_INDICES];
  const indices = FEATURE_SET_INDICES[set];
  const slots: number[] = [];
  for (let pos = 0; pos < indices.length; pos++) {
    if (L2CS_FULL_INDICES.includes(indices[pos])) slots.push(pos);
  }
  return slots;
}

/** Conjunto ativo: as 4 dimensões destiladas do `irisCore` + as 2 dimensões
 *  angulares de 1ª ordem do L2CS (`tan(yaw)`, `tan(pitch)`), totalizando 6.
 *
 *  Vem em par com `EXPERIMENT.enableL2CS = true` — ligar um sem o outro é
 *  degenerado: o worker roda sem alimentar o modelo, ou o modelo recebe zeros
 *  no lugar do bloco angular. As outras 5 dimensões do bloco completo (produtos
 *  com distância, quadrados, cruzado) ficam fora deste conjunto porque `iris12`
 *  + interações já cobrem parte do sinal de 2ª ordem, e o Ridge precisa de mais
 *  alvos que dims para não memorizar aglomerados.
 */
/**
 * Conjunto ativo, vindo da flag `featureSet` (`P6.5`).
 *
 * Era uma constante literal aqui. O problema: `spec11` existia como tipo e
 * como projeção, mas NENHUM caminho podia selecioná-lo — e o `F8.4` precisa
 * exatamente disso para medir o conflito C6. Uma alternativa que não se
 * consegue ligar não é alternativa.
 *
 * Continua sendo resolvido UMA vez, no boot: mudar o conjunto no meio da
 * sessão trocaria o vetor sob um modelo já treinado.
 */
export const ACTIVE_FEATURE_SET: FeatureSet = EXPERIMENT.featureSet;

/** Número de dimensões por olho que o conjunto ativo entrega ao modelo.
 *  `compact` é variável (37 sem bloco L2CS, 44 com), então o identificador
 *  usa `var` — quem grava com `compact` não pode confiar em comparação por
 *  dimensão e precisa recomputar. */
export function activeFeatureDims(set: FeatureSet = ACTIVE_FEATURE_SET): number | 'var' {
  return set === 'compact' ? 'var' : FEATURE_SET_INDICES[set].length;
}

/**
 * Identificador do vetor de features que ESTE build produz.
 *
 * Grava-se no cabeçalho de gravações para detectar divergência entre a
 * semântica atual e a que produziu os dados salvos — impede ler features
 * antigas como se descrevessem o pipeline em vigor.
 */
export const FEATURE_VECTOR_ID = `${ACTIVE_FEATURE_SET}:${activeFeatureDims()}`;

/**
 * Identidade de um conjunto QUALQUER, não só do ativo (P6.5).
 *
 * Existe porque a contagem de dimensões sozinha NÃO identifica: `spec11` e
 * `irisCore+l2cs+pose` têm 11 dims cada e significam coisas completamente
 * diferentes. Um perfil trocado entre eles produziria predições plausíveis e
 * erradas — o modo de falha que este repositório combate.
 */
export function featureVectorId(set: FeatureSet = ACTIVE_FEATURE_SET): string {
  return `${set}:${activeFeatureDims(set)}`;
}

/**
 * A expansão polinomial deve rodar sobre este conjunto? (P6.5)
 *
 * `false` para `spec11`: ele JÁ traz `pitch×yaw`, `pitch²` e `yaw²`
 * explicitamente. Expandir por cima duplicaria exatamente esses termos, e
 * duplicata em regressão linear não é inofensiva — é colinearidade perfeita,
 * que é o que o Ridge regulariza contra. Gastaríamos λ desfazendo o que nós
 * mesmos criamos.
 *
 * E o custo cresce: 11 dims expandidas viram 77, sobre 9 alvos de calibração.
 * O cabeçalho deste módulo já registra o que acontece quando o vetor cresce
 * sem restrições correspondentes — 322 px contra 140 px.
 */
export function expandirPolinomioNoConjunto(set: FeatureSet = ACTIVE_FEATURE_SET): boolean {
  return set !== 'spec11';
}

/**
 * Projeta o vetor completo do extractor no conjunto ativo.
 *
 * Com `compact` devolve a entrada intacta; com os demais conjuntos seleciona os
 * índices declarados em `FEATURE_SET_INDICES`.
 *
 * ## Contrato de comprimento (B1.1)
 *
 * - **Vetor vazio** → devolve `[]`. É o frame sem rosto, e quem trata é o
 *   caller (o engine tem ramo próprio para `featuresLeft.length === 0`).
 * - **Vetor curto demais** → **lança `RangeError`**.
 * - Caso contrário → projeta.
 *
 * Por que lançar em vez de devolver intacto (o comportamento até B1.1): o
 * fallback silencioso deixava `ACTIVE_FEATURE_SET = 'irisCore+l2cs'` (6 dims,
 * exige 39) receber um vetor de 37 dims — o que acontece sempre que
 * `EXPERIMENT.enableL2CS` está desligado, porque aí o bloco angular [37..43]
 * nunca é anexado. O Ridge então treinava com 37 dims, incluindo a pose
 * [22..24] e as 12 interações [25..36] que a análise em `extractCompactFeatures`
 * exclui DE PROPÓSITO por memorização (322 px medidos contra 140 px). Pior:
 * `FEATURE_VECTOR_ID` continuava gravando `"irisCore+l2cs:6"`, então
 * `buildContextKey()` produzia a mesma chave dos perfis legítimos de 6 dims —
 * um perfil de 37 dims era aceito por uma sessão de 6, `predictRidge` lançava
 * `RangeError` no primeiro frame, `mapGaze` chamava `clearCalibration()` e o
 * paciente perdia a calibração no meio da sessão.
 *
 * Falhar aqui, alto e cedo, troca uma corrupção silenciosa por um erro
 * diagnosticável no primeiro frame.
 */
export function projectFeatureSet(
  full: number[],
  set: FeatureSet = ACTIVE_FEATURE_SET,
): number[] {
  if (set === 'compact') return full;
  // Frame sem rosto: o extractor devolve vazio e o caller já tem ramo para
  // isso. Única exceção legítima ao contrato de comprimento.
  if (full.length === 0) return [];
  const min = FEATURE_SET_MIN_LENGTH[set];
  if (full.length < min) {
    throw new RangeError(
      `[extractor] projectFeatureSet: conjunto '${set}' exige comprimento >= ${min}, ` +
      `recebeu ${full.length}. Causa provável: o bloco angular L2CS (índices 37..43) ` +
      `não foi anexado porque o engine passou l2csGaze=null — o que acontece quando ` +
      `EXPERIMENT.enableL2CS está desligado, ou quando o worker L2CS nunca saiu de ` +
      `'loading'. Verifique __irisflowExp.dump() e o estado de getL2CSStatus(). ` +
      `Projetar assim mesmo produziria um vetor com pose e interações que o modelo ` +
      `ativo exclui de propósito, gravado sob um FEATURE_VECTOR_ID que mente.`
    );
  }
  const idx = FEATURE_SET_INDICES[set];
  const out = new Array<number>(idx.length);
  for (let i = 0; i < idx.length; i++) out[i] = full[idx[i]];
  return out;
}

export function extractEyeFeatures(
  landmarks: Point3D[],
  faceMatrix?: Float32Array,
  videoWidth?: number,
  videoHeight?: number,
  /** Ver `blinkDetector` em `extractCompactFeatures`. */
  blinkDetector?: BlinkDetector,
): ExtractorResult {
  // P5.1 — falha VISÍVEL, não vetor vazio.
  //
  // O código anterior devolvia `featuresLeft: []` aqui. O engine tem ramo para
  // features vazias, então um modelo de 468 pontos produzia um app que liga,
  // roda e nunca rastreia — sem uma linha no console dizendo por quê.
  //
  // Lançar coloca o problema no `loopGuard`, que conta erros consecutivos e os
  // expõe em `EngineDiagnostics.loop` (B2.4): condição permanente vira erro
  // permanente. Em produção nunca dispara — o `FaceLandmarker` é criado com
  // refinamento de íris e sempre devolve 478.
  assertFaceMeshCompleto(landmarks);
  // Ausente ou parcial (quadro sem rosto, detecção truncada): contrato de
  // `B1.1` — vetor vazio, sem lançar. É transitório e normal.
  if (meshAusenteOuParcial(landmarks)) {
    return { featuresLeft: [], featuresRight: [], blinkDetected: false };
  }

  // 1. Head Pose Normalization (EyeTrax Logic)
  //
  // Correção de anisotropia de aspect ratio (atrás de flag).
  // O MediaPipe normaliza x por videoWidth e y por videoHeight. Em 1920×1080
  // a escala de x é 1.78× maior que a de y. Distâncias euclidianas que misturam
  // as duas ficam distorcidas: o vetor interocular muda de comprimento quando
  // a cabeça inclina, mesmo com distância física constante. Isso faz a escala
  // de normalização (`interEyeDistRaw`) oscilar com o roll da cabeça.
  //
  // Correção: multiplicar x (e z) por (W/H) para equalizar as escalas antes
  // de qualquer cálculo de distância. Só ativado quando
  // EXPERIMENT.isotropicLandmarks === true (default false).
  //
  // ⚠️ Atenção: quando ligado, perfis calibrados anteriormente são
  // incompatíveis — o vetor de features muda. RECORDING_FORMAT_VERSION
  // foi incrementado para forçar invalidação de perfis salvos.
  let workingLandmarks = landmarks;
  if (EXPERIMENT.isotropicLandmarks && videoWidth && videoHeight && videoHeight > 0) {
    const aspectRatio = videoWidth / videoHeight;
    workingLandmarks = landmarks.map(p => ({
      ...p,
      x: p.x * aspectRatio,
      z: p.z * aspectRatio,
    }));
  }

  const leftCorner = workingLandmarks[33];
  const rightCorner = workingLandmarks[263];
  const topOfHead = workingLandmarks[10];

  const eyeCenter = scale(add(leftCorner, rightCorner), 0.5);
  
  let xAxis = sub(rightCorner, leftCorner);
  xAxis = normalize(xAxis);
  
  let yApprox = sub(topOfHead, eyeCenter);
  yApprox = normalize(yApprox);
  
  let yAxis = sub(yApprox, scale(xAxis, dot(yApprox, xAxis)));
  yAxis = normalize(yAxis);
  
  let zAxis = cross(xAxis, yAxis);
  zAxis = normalize(zAxis);

  // Rotate points using R^T
  const rotatedPoints: Point3D[] = [];
  for (let i = 0; i < workingLandmarks.length; i++) {
    const shifted = sub(workingLandmarks[i], eyeCenter);
    const rot = mulRT(xAxis, yAxis, zAxis, shifted);
    rotatedPoints.push(rot);
  }

  const leftCornerRot = mulRT(xAxis, yAxis, zAxis, sub(leftCorner, eyeCenter));
  const rightCornerRot = mulRT(xAxis, yAxis, zAxis, sub(rightCorner, eyeCenter));
  const interEyeDistRaw = norm(sub(rightCornerRot, leftCornerRot));

  if (interEyeDistRaw > 1e-7) {
    for (let i = 0; i < rotatedPoints.length; i++) {
      rotatedPoints[i] = scale(rotatedPoints[i], 1 / interEyeDistRaw);
    }
  }

  // Flatten subset features Binocularly
  const featuresLeft: number[] = [];
  const featuresRight: number[] = [];
  
  for (const idx of LEFT_EYE_INDICES) {
    const p = rotatedPoints[idx];
    featuresLeft.push(p.x, p.y, p.z);
  }
  for (const idx of RIGHT_EYE_INDICES) {
    const p = rotatedPoints[idx];
    featuresRight.push(p.x, p.y, p.z);
  }

  for (const idx of MUTUAL_INDICES) {
    const p = rotatedPoints[idx];
    featuresLeft.push(p.x, p.y, p.z);
    featuresRight.push(p.x, p.y, p.z);
  }

  // 2.3 — ângulos de Euler a partir dos landmarks, quando não há matriz facial.
  //
  // A versão anterior era:
  //     yaw   = atan2(xAxis.y, xAxis.x)                    ← isto é ROLL
  //     pitch = atan2(-xAxis.z, hypot(yAxis.z, zAxis.z))   ← isto é YAW
  //     roll  = atan2(yAxis.z, zAxis.z)                    ← isto é PITCH
  //
  // Permutação cíclica. `xAxis` é a linha entre os cantos externos dos olhos: o
  // ângulo dela NO PLANO DA IMAGEM é a inclinação da cabeça (roll), e o
  // componente z dela cresce quando a cabeça VIRA (yaw). Quem mede pitch é o
  // eixo vertical inclinando para perto ou longe da câmera.
  //
  // A causa é uma troca de FRAME. Os landmarks vêm em coordenadas de imagem
  // (x direita, y para BAIXO, z negativo em direção à câmera), enquanto a
  // matriz facial do MediaPipe vem em coordenadas métricas (y para CIMA, z na
  // direção do observador). Passar de um para o outro é uma rotação de 180°
  // em torno de X:
  //
  //     F = diag(1, −1, −1)      R_métrico = F · R_imagem
  //
  // Com `R_imagem = [xAxis | yAxis | zAxis]`, aplicar F é negar as linhas y e z,
  // e daí valem as MESMAS fórmulas do caminho da matriz logo abaixo
  // (pitch = asin(−R12), yaw = atan2(R02, R22), roll = atan2(R10, R11)):
  //
  //     R12 = −zAxis.y   R02 = zAxis.x   R22 = −zAxis.z
  //     R10 = −xAxis.y   R11 = −yAxis.y
  //
  // Os dois caminhos passam a concordar, o que o teste em extractor.euler.test.ts
  // exige em quatro rotações conhecidas.
  //
  // ⚠️ ALCANCE REAL: este fallback não roda no app. `outputFacialTransformationMatrixes`
  // está ligado e a gravação de referência tem matriz válida em 100% dos 3147
  // quadros. É bug latente — só apareceria se o MediaPipe deixasse de entregar
  // a matriz, e aí em silêncio, com a pose girada de eixo.
  let pitch = Math.asin(Math.max(-1, Math.min(1, zAxis.y)));
  let yaw = Math.atan2(zAxis.x, -zAxis.z);
  let roll = Math.atan2(-xAxis.y, -yAxis.y);

  let pos3D = eyeCenter;
  let scale3D = interEyeDistRaw;
  
  if (faceMatrix && faceMatrix.length === 16) {
    const r02 = faceMatrix[8];
    const r10 = faceMatrix[1], r11 = faceMatrix[5], r12 = faceMatrix[9];
    const r22 = faceMatrix[10];

    // Clamp para [-1,1] antes do asin — erros de ponto flutuante na matriz do
    // MediaPipe podem produzir |r12| ligeiramente > 1, fazendo Math.asin retornar NaN.
    // NaN corromperia o StandardScaler (mean/std=NaN) e degeneraria o regressor para
    // prever ~centro constante, causando cursor estático após calibração.
    pitch = Math.asin(Math.max(-1, Math.min(1, -r12)));
    yaw = Math.atan2(r02, r22);
    roll = Math.atan2(r10, r11);

    pos3D = { x: faceMatrix[12], y: faceMatrix[13], z: faceMatrix[14] };
  }

  featuresLeft.push(yaw, pitch, roll);
  featuresRight.push(yaw, pitch, roll);

  // ── Offset explícito da íris (feature de alta sinalização) ──────────────
  // O regressor linear precisa desta feature explícita porque o mapeamento
  // iris_coord_raw → gaze é mais linear quando expresso como deslocamento
  // relativo ao centro do olho (canto nasal + temporal) do que em coordenadas
  // brutas que incluem variação de pose da cabeça.

  const midXL = (rotatedPoints[33].x + rotatedPoints[133].x) * 0.5;
  const midYL = (rotatedPoints[33].y + rotatedPoints[133].y) * 0.5;
  const irisL = rotatedPoints[468];
  featuresLeft.push(
    irisL.x - midXL,  // offset horizontal da íris em relação ao centro do olho
    irisL.y - midYL,  // offset vertical
  );

  const midXR = (rotatedPoints[263].x + rotatedPoints[362].x) * 0.5;
  const midYR = (rotatedPoints[263].y + rotatedPoints[362].y) * 0.5;
  const irisR = rotatedPoints[473];
  featuresRight.push(
    irisR.x - midXR,
    irisR.y - midYR,
  );

  // 2. Blink Detection & Dimensions
  // P5.1 — índices por nome. `landmarks[374]` não é revisável: ninguém sabe,
  // lendo, se é a pálpebra inferior direita. Um índice trocado produz um EAR
  // plausível e errado, que é o modo de falha mais caro deste projeto.
  const lInner = landmarks[OLHO_ESQUERDO.interno], lOuter = landmarks[OLHO_ESQUERDO.externo];
  const lTop = landmarks[OLHO_ESQUERDO.superior], lBottom = landmarks[OLHO_ESQUERDO.inferior];
  const rInner = landmarks[OLHO_DIREITO.interno], rOuter = landmarks[OLHO_DIREITO.externo];
  const rTop = landmarks[OLHO_DIREITO.superior], rBottom = landmarks[OLHO_DIREITO.inferior];

  // BUG-3: dist2D perdia a componente Z dos landmarks 3D do MediaPipe.
  // Para cabeça inclinada (pitch > 0), a altura do olho em 2D parece menor
  // que a real → EAR artificialmente baixo → falsa piscada → frame rejeitado
  // na calibração. dist3D corrige isso sem custo adicional (já definida).
  const lWidth = dist3D(lOuter, lInner);
  const lHeight = dist3D(lTop, lBottom);

  const rWidth = dist3D(rOuter, rInner);
  const rHeight = dist3D(rTop, rBottom);

  // B2.6 — correção de anisotropia do EAR.
  //
  // O MediaPipe normaliza x pela LARGURA e y pela ALTURA do vídeo. Uma
  // distância física de `d` px vira `d/W` no eixo x e `d/H` no eixo y. Como
  // W > H, o mesmo comprimento físico aparece MAIOR na vertical:
  //
  //   EAR_bruto = (dy/H)/(dx/W) = (dy/dx)·(W/H) = EAR_isotrópico · 1,78
  //
  // Em 1920×1080 o EAR saía inflado por 1,78×. O cabeçalho deste módulo
  // registra a medição: mediana 0,551 onde a escala isotrópica daria 0,314 —
  // e 0,314 × 1,78 = 0,559.
  //
  // O efeito prático era desligar o limiar adaptativo: `mean*0.8 = 0,44`
  // ficava sempre cortado pelo teto de 0,22, então o detector exigia que o
  // olho fechasse até 40% da abertura de repouso em vez dos 80% pretendidos.
  // Piscadas parciais, ptose e as fases de abertura/fechamento passavam como
  // fixação válida e entravam na calibração.
  //
  // A correção mora AQUI, e não numa transformação global dos landmarks, de
  // propósito: `EXPERIMENT.isotropicLandmarks` conserta o EAR por acidente mas
  // muda o vetor de features junto, e o plano exige que os dois efeitos sejam
  // separáveis para o benchmark do Dia 7 poder atribuí-los.
  //
  // Sem `videoWidth`/`videoHeight` não há como saber o fator: devolvemos o
  // valor bruto em vez de chutar 16:9. Fabricar a correção seria o mesmo
  // padrão de defeito que o projeto combate.
  const earAspecto = aspectoValido(videoWidth, videoHeight)
    ? (videoHeight as number) / (videoWidth as number)
    : 1;

  const leftEAR = (lHeight / (lWidth + 1e-9)) * earAspecto;
  const rightEAR = (rHeight / (rWidth + 1e-9)) * earAspecto;

  const ear = (leftEAR + rightEAR) / 2;
  
  // O detector injetado tem precedência sobre o singleton do módulo.
  //
  // O limiar de piscada é ADAPTATIVO: aprende o EAR de repouso dos quadros
  // anteriores. Injetar o detector torna `extractFeatures` pura — o mesmo
  // quadro produz sempre o mesmo `blinkDetected`, independente do que rodou
  // antes no processo.
  const detector = blinkDetector ?? _blinkDetector;
  const blinkDetected = detector.update(ear);
  // B3.31 — lido DEPOIS do `update`, de propósito: com o olho aberto o quadro
  // atual entra na média e a razão dá 1,0, que é a leitura certa; numa piscada
  // o quadro NÃO entra, então a base continua sendo a de olho aberto e a razão
  // despenca — que também é a leitura certa. Ler antes deixaria o primeiro
  // quadro após o histórico encher sem base.
  const earDeRepouso = detector.restingEar;

  // 3. Geometry Extractions
  const irisCenterL = landmarks[IRIS_ESQUERDA.centro];
  const irisCenterR = landmarks[IRIS_DIREITA.centro];

  // Raio = média das distâncias aos dois pontos HORIZONTAIS do anel. O eixo
  // horizontal é o menos afetado por pálpebra: a vertical some numa piscada
  // parcial e o raio encolheria sem a íris ter mudado de tamanho.
  const irisRadiusL = (dist3D(irisCenterL, landmarks[IRIS_ESQUERDA.direita])
                     + dist3D(irisCenterL, landmarks[IRIS_ESQUERDA.esquerda])) / 2;
  const irisRadiusR = (dist3D(irisCenterR, landmarks[IRIS_DIREITA.direita])
                     + dist3D(irisCenterR, landmarks[IRIS_DIREITA.esquerda])) / 2;

  const pEllL = {
    width: dist3D(landmarks[IRIS_ESQUERDA.direita], landmarks[IRIS_ESQUERDA.esquerda]),
    height: dist3D(landmarks[IRIS_ESQUERDA.superior], landmarks[IRIS_ESQUERDA.inferior]),
  };
  const pEllR = {
    width: dist3D(landmarks[IRIS_DIREITA.direita], landmarks[IRIS_DIREITA.esquerda]),
    height: dist3D(landmarks[IRIS_DIREITA.superior], landmarks[IRIS_DIREITA.inferior]),
  };

  const geometry: GeometryFeatures = {
    pupilCenterLeft: irisCenterL,
    pupilCenterRight: irisCenterR,
    irisRadiusLeft: irisRadiusL,
    irisRadiusRight: irisRadiusR,
    pupilEllipseLeft: pEllL,
    pupilEllipseRight: pEllR,
    interEyeDistance: interEyeDistRaw,
    eyeWidthLeft: lWidth,
    eyeHeightLeft: lHeight,
    eyeWidthRight: rWidth,
    eyeHeightRight: rHeight
  };

  const face: FaceFeatures = {
    pitch,
    yaw,
    roll,
    position3D: pos3D,
    scale: scale3D,
    cameraDistanceEstimate: 1.0 / (scale3D + 1e-9)
  };

  // 2.4 — só o que este módulo realmente sabe.
  //
  // `irisVisibilityPercentage` sai do EAR, que é calculado aqui. Os demais
  // dependem dos PIXELS do crop ocular, que o extractor não vê — quem mede é
  // o `EyeQualityAnalyzer`. Preencher com constantes era fabricar medição.
  //
  // B3.31 — e este campo ERA uma dessas constantes, disfarçada. Ver
  // `irisVisibilityFromEar`: o divisor fixo de 0,25 ficava abaixo do EAR de
  // repouso típico, então o `min` grampeava em 1,0 quase sempre. Agora a
  // referência é o repouso da própria pessoa, e `undefined` significa
  // "ainda não há base observada" em vez de um número inventado.
  const quality: QualityFeatures = {
    irisVisibilityPercentage: irisVisibilityFromEar(ear, earDeRepouso),
    specularRatio: 0, // sobrescrito por qualityAnalyzer quando disponível
  };

  const advancedFeatures: AdvancedFrameFeatures = {
    geometry,
    face,
    quality
  };

  return { featuresLeft, featuresRight, blinkDetected, advancedFeatures, leftEAR, rightEAR };
}

// L2CS gaze data (E5/E6 do L2CS-NET.md). Interface local para evitar
// dependência do módulo l2cs — o extractor permanece agnóstico. Quem passar
// o objeto (engine.ts) sabe quando o gaze é válido e quando não é (cache
// stale, worker não pronto, etc). `confidence` (opcional, 0..1) é a entropia
// normalizada da softmax agregada por min(yaw, pitch); passada adiante para
// telemetria/diagnostics.
export interface L2CSGazeInput {
  yaw: number;    // rad
  pitch: number;  // rad
  valid: boolean; // false → bloco de 7 zeros
  confidence?: number;
}

export function extractCompactFeatures(
  landmarks: Point3D[],
  faceMatrix?: Float32Array,
  l2csGaze?: L2CSGazeInput | null,
  /** Detector de piscada a usar. Sem ele vale o singleton do módulo. */
  blinkDetector?: BlinkDetector,
  /** Dimensões do vídeo, para a correção de anisotropia do EAR (B2.6).
   *  Ausentes → o EAR volta cru (anisotrópico) em vez de ser corrigido com um
   *  aspecto chutado. */
  videoWidth?: number,
  videoHeight?: number,
): ExtractorResult {
  const baseResult = extractEyeFeatures(landmarks, faceMatrix, videoWidth, videoHeight, blinkDetector);
  if (baseResult.featuresLeft.length === 0) return baseResult;

  const leftCorner = landmarks[OLHO_ESQUERDO.externo];
  const rightCorner = landmarks[OLHO_DIREITO.externo];
  const topOfHead = landmarks[TESTA_TOPO];

  const eyeCenter = scale(add(leftCorner, rightCorner), 0.5);
  let xAxis = normalize(sub(rightCorner, leftCorner));
  let yApprox = normalize(sub(topOfHead, eyeCenter));
  let yAxis = normalize(sub(yApprox, scale(xAxis, dot(yApprox, xAxis))));
  let zAxis = normalize(cross(xAxis, yAxis));

  const rot = (p: Point3D) => mulRT(xAxis, yAxis, zAxis, sub(p, eyeCenter));
  const interEyeDistRaw = norm(sub(rot(rightCorner), rot(leftCorner))) || 1;

  const rotS = (idx: number) => {
    const p = rot(landmarks[idx]);
    return { x: p.x / interEyeDistRaw, y: p.y / interEyeDistRaw };
  };

  const getEyeCompact = (
    irisCenter: number, irisP: number[],
    cInner: number, cOuter: number, cTop: number, cBot: number,
    pose: { yaw: number; pitch: number; roll: number; scale: number }
  ) => {
    const cI = rotS(cInner), cO = rotS(cOuter), cT = rotS(cTop), cB = rotS(cBot);
    const iC = rotS(irisCenter);

    const midX = (cI.x + cO.x) * 0.5;
    const midY = (cI.y + cO.y) * 0.5;
    const offsetX = iC.x - midX;
    const offsetY = iC.y - midY;

    const width = Math.sqrt((cO.x - cI.x)**2 + (cO.y - cI.y)**2) || 1e-9;
    const height = Math.sqrt((cT.x - cB.x)**2 + (cT.y - cB.y)**2) || 1e-9;
    const relX = offsetX / width;
    const relY = offsetY / height;

    const irisContour = irisP.flatMap(idx => {
      const p = rotS(idx);
      return [p.x, p.y];
    });

    const corners = [cI.x, cI.y, cO.x, cO.y, cT.x, cT.y, cB.x, cB.y];
    
    const ear = height / width;
    const irisRadius = Math.sqrt((rotS(irisP[0]).x - rotS(irisP[2]).x)**2 + (rotS(irisP[0]).y - rotS(irisP[2]).y)**2) / 2;

    // 6 termos originais (1ª ordem) + 6 termos de 2ª ordem.
    // Compensação de pose linear vs quadrática dentro de um modelo Ridge:
    // como todas as variáveis já estão calculadas, o custo é zero e o λ
    // por CV cuida do overfitting. Vetor por olho: ~31 → ~37 dims.
    const interactions = [
      offsetX * pose.yaw,
      offsetY * pose.pitch,
      offsetX * pose.scale,
      offsetY * pose.scale,
      offsetX * pose.roll,
      offsetY * pose.roll,
      offsetX * pose.yaw * pose.yaw,
      offsetY * pose.pitch * pose.pitch,
      offsetX * pose.yaw * pose.scale,
      offsetY * pose.pitch * pose.scale,
      pose.yaw * pose.scale,
      pose.pitch * pose.scale,
    ];

    return [
      offsetX, offsetY,
      relX, relY,
      ...irisContour,
      ...corners,
      ear, irisRadius,
      pose.yaw, pose.pitch, pose.roll,
      ...interactions
    ];
  };

  const face = baseResult.advancedFeatures!.face;
  const pose = { yaw: face.yaw, pitch: face.pitch, roll: face.roll, scale: face.scale };

  const compLeft = getEyeCompact(468, [469, 470, 471, 472], 133, 33, 159, 145, pose);
  const compRight = getEyeCompact(473, [474, 475, 476, 477], 362, 263, 386, 374, pose);

  // E5/E6 do L2CS-NET.md — quando o engine passa gaze, ambos olhos ganham o
  // mesmo bloco de 7 dims (angulares são face-level, não per-eye). Se `null`
  // ou undefined, nada é anexado — mantém backward-compat com callers que não
  // participam do pipeline L2CS (parity test, calibrações antigas, etc).
  if (l2csGaze != null) {
    const block = buildL2CSBlock(
      l2csGaze.yaw,
      l2csGaze.pitch,
      l2csGaze.valid,
      face.cameraDistanceEstimate,
      // B3.1 — a confiança da softmax passa a ser CONSUMIDA. Era calculada em
      // todo frame e descartada; é o único sinal que distingue "o modelo diz
      // centro" de "o modelo não faz ideia" quando o crop está degenerado.
      l2csGaze.confidence,
    );
    for (let i = 0; i < block.length; i++) {
      compLeft.push(block[i]);
      compRight.push(block[i]);
    }

    // ── Bloco `spec11` [44..49] — P6.5 ────────────────────────────────────
    //
    // Anexado junto do bloco L2CS porque depende dele: três dos seis termos
    // são funções do gaze. Anexar sempre deixaria [44..49] presentes com
    // gaze zerado, e o conjunto `spec11` treinaria sobre constantes.
    //
    // Os seis são idênticos nos dois olhos, como já acontece com a pose e com
    // o bloco angular: distância, EAR do par e termos de gaze são grandezas de
    // ROSTO, não de olho.
    //
    // ⚠️ Os quadráticos usam as MESMAS grandezas das features lineares —
    // `tan(yaw)` e `tan(pitch)`, que são `block[0]` e `block[1]`.
    //
    // A primeira versão usava o gaze CRU aqui, e isso quebrava a única
    // propriedade que dá sentido ao conjunto: os termos de grau 2 têm que ser a
    // expansão polinomial dos de grau 1. Com `[0] = tan(yaw)` e
    // `[9] = yaw_cru²`, os dois descrevem coisas diferentes, e desligar a
    // expansão polinomial (`expandirPolinomioNoConjunto`) deixaria de ser
    // justificável — não haveria duplicata a evitar, haveria termo faltando.
    //
    // O polo da tangente não é problema: `buildL2CSBlock` clampa em ±π/4 antes
    // de aplicá-la, então `tan` fica em [−1, 1] e o quadrado em [0, 1].
    const gy = block[0];
    const gp = block[1];
    const spec11Block = [
      face.cameraDistanceEstimate,
      baseResult.leftEAR ?? 0,
      baseResult.rightEAR ?? 0,
      gy * gp,
      gy * gy,
      gp * gp,
    ];
    for (let i = 0; i < spec11Block.length; i++) {
      compLeft.push(spec11Block[i]);
      compRight.push(spec11Block[i]);
    }
  }

  return {
    featuresLeft: compLeft,
    featuresRight: compRight,
    blinkDetected: baseResult.blinkDetected,
    advancedFeatures: baseResult.advancedFeatures,
    leftEAR: baseResult.leftEAR,
    rightEAR: baseResult.rightEAR,
  };
}
