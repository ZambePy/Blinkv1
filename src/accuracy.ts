// Teste de precisão pós-calibração.
//
// Mostra 13 alvos (grade 3×3 interior em 25/50/75 + 4 cantos em 5/95),
// coleta a predição crua do modelo em cada um, e produz um relatório com
// acurácia (erro médio, viés por eixo, erro angular), precisão (dispersão
// durante a fixação) e as condições medidas da sessão. No fim exibe um overlay
// com o par alvo→predição de cada ponto.

import {
  mapGaze, getCalibrationTargets,
  getCalibrationFitDiagnostics, getDistanceRange, getCalibrationDistancesCm,
  getCurrentCameraDistanceCm, getCalibrationTimestampMs,
} from './calibration';
import { REGRESSOR_MODE } from './gazeRegressor';
import { experimentSnapshot } from './config/experiment';
import { ACCLIMATION_MS, COLLECTION_MS, MIN_VALID_SAMPLE_RATIO, quadrosEsperados } from './accuracyProtocol';
import { ACTIVE_FEATURE_SET, l2csSlotsInSet } from './extractor';

/** Amostras mínimas para um ponto contar como medido. Abaixo disto a média do
 *  ponto é ruído de um ou dois quadros, não uma fixação. */
export const MIN_SAMPLES_PER_POINT = 8;

export interface AccuracyResult {
  // `null` significa "não há pontos medidos para esta métrica" — nunca NaN,
  // nunca 0 fabricado. Cada métrica declara sua população (`nInterior`/`nEdge`).
  /** Erro médio em px, pontos INTERIORES (a métrica com histórico). */
  meanError: number | null;
  medianError: number | null;
  p90Error: number | null;
  /** |erro| médio por eixo, mesma população de `meanError`. */
  meanErrorX: number | null;
  meanErrorY: number | null;
  /** Viés ASSINADO médio por eixo (predito − alvo), em px. Um viés grande e
   *  uniforme é assinatura de deriva de pose ou de geometria errada. */
  biasX: number | null;
  biasY: number | null;
  /** Pior erro entre todos os pontos medidos. */
  maxError: number | null;
  /** Erro médio como % da diagonal do viewport. */
  errorPct: number | null;
  /** Erro angular médio (graus), calculado ponto a ponto com a excentricidade
   *  real de cada alvo e a distância informada. */
  meanErrorDeg: number | null;
  /** Precisão: dispersão 2D das predições em torno da própria média, por ponto
   *  (RMS), média sobre os pontos medidos. É o tremor que o paciente vê. */
  jitterRMS: number | null;
  /** Precisão por eixo: desvio-padrão médio das predições, em px. */
  precisionSdX: number | null;
  precisionSdY: number | null;
  /** Precisão amostra-a-amostra (RMS-S2S), em px — separa tremor de deriva lenta. */
  precisionS2S: number | null;
  /** Precisão em graus (jitterRMS convertido na distância informada). */
  precisionDeg: number | null;
  /** Dispersão da SAÍDA FILTRADA (o cursor), quando o engine a alimentou. */
  jitterFilteredRMS: number | null;
  meanErrorInner: number | null;
  meanErrorEdge: number | null;
  score: string;
  colorClass: string;
  pointErrors: number[];
  pointJitters: number[];
  pontosMedidos: number;
  pontosNaoMedidos: number;
  nInterior: number;
  nEdge: number;
  /** Erro por AMOSTRA, não por média do ponto. É o que o dwell sente. */
  sampleMeanError: number | null;
  sampleMedianError: number | null;
  sampleP90Error: number | null;
  /** % de amostras dentro de um alvo de raio R centrado no ponto. */
  hitRateByRadius: { radiusPx: number; pct: number | null }[];
  /** Taxa de quadros efetiva durante o teste (amostras por segundo de janela útil). */
  sampleRateHz: number | null;
  /**
   * Decomposição afim do erro sobre os pontos interiores: quanto do erro é um
   * mapa coerente (ganho/offset/cisalhamento) e quanto é ruído incoerente.
   * Só diagnóstico; nenhuma métrica exibida depende dele.
   */
  affine?: {
    gainX: number;
    gainY: number;
    crossXY: number;
    shearYX: number;
    offsetXPx: number;
    offsetYPx: number;
    residualPx: number;
    explainedFraction: number;
  };
  /** Pontos de validação que coincidiram com alvos de calibração. */
  validationOverlap?: { validationPoint: string; calibX: number; calibY: number }[];
  /** Deriva de pose durante o teste, em radianos, relativa ao início do teste. */
  poseDrift?: {
    baseline: { yaw: number; pitch: number; roll: number };
    maxDelta: { yaw: number; pitch: number; roll: number };
    meanDelta: { yaw: number; pitch: number; roll: number };
  };
  /** Diferença entre a pose média da CALIBRAÇÃO e a pose média do TESTE, em
   *  graus. É o número que explica um viés uniforme. */
  poseDeltaCalibToTestDeg?: { yaw: number; pitch: number; roll: number };
  /** BCEA(68%) média dos pontos interiores, em px² e em graus². */
  bceaPx2: number | null;
  bceaDeg2: number | null;
  /** Fração de amostras válidas na janela útil, média dos pontos medidos. */
  fracaoDeAmostrasValidas: number | null;
  /** Pontos cuja fração ficou abaixo do mínimo do protocolo. */
  pontosComPoucaAmostra: string[];
  /**
   * Lado mínimo de um alvo quadrado que acomoda o erro deste usuário,
   * `2 · (offset + 2σ)` (Feit et al., 2017) — a medição virando requisito de
   * interface. Em px e em graus.
   */
  alvoMinimoPx: number | null;
  alvoMinimoDeg: number | null;
  /** Distância olho→CÂMERA medida durante o teste (mediana e faixa), em cm.
   *  Não é a olho→tela de `meta.distanciaCm`, que é digitada. */
  distanciaMedidaCm: { mediana: number; min: number; max: number } | null;
}

/** Condição da sessão, preenchida pela UI e gravada junto do resultado. */
export interface RunMeta {
  data: string;
  iluminacao: 'boa' | 'ruim';
  oculos: boolean;
  movimentoCabeca: 'parada' | 'livre';
  minutosDeSessao: number;
  usuario?: string;
  observacoes?: string;
  /** Distância olho→tela em cm, usada para converter px em graus. */
  distanciaCm: number;
  /**
   * Iluminância do ambiente em lux. **Fora do protocolo desde 2026-09-06.**
   *
   * O campo permanece no schema porque relatórios antigos podem trazê-lo, e
   * porque a limitação que ele documenta continua real: sem lux, uma sessão
   * nossa não é reproduzível por terceiros, e o binário `iluminacao` não
   * cobre a lacuna — ele mede o recorte do olho DEPOIS da exposição
   * automática, então aprova uma sala escura. Ver a seção "Limitações
   * assumidas" do `docs/MEDICOES.md`.
   */
  luxAmbiente?: number | null;
  /**
   * Ordinal da rodada contra a MESMA calibração: 1 = logo após treinar,
   * 2 = repetição ~10 min depois sem recalibrar, 3+ = as seguintes.
   *
   * Derivado do instante do treino (`getCalibrationTimestampMs`), não
   * digitado. Ausente quando não há calibração ativa — um teste sem modelo
   * não pertence a bloco nenhum. O número passou de `1 | 2` para `number`
   * porque uma terceira rodada acontece na prática, e gravá-la como "2"
   * corromperia justamente a comparação que os blocos existem para fazer.
   */
  blocoDeMedicao?: number;
  /** Diagonal física do monitor em polegadas. */
  telaPolegadas: number;
  /** De onde veio `telaPolegadas`: `default` é o hardcode de 23,6″. */
  screenGeometrySource?: ScreenGeometrySource | null;
  screenScaleFactor?: number | null;
}

/** Estado do runtime no momento do teste, informado pela UI a partir dos
 *  diagnósticos do engine. Sem ele o relatório não sabe em que provider o
 *  L2CS rodou nem qual filtro estava governando. */
export interface RuntimeInfo {
  l2csExecutionProvider?: string | null;
  l2csFallback?: boolean;
  l2csLatencyMs?: number;
  l2csStalePct?: number;
  l2csInputSize?: number;
  filterEffective?: string;
  filterPreset?: string | null;
  fpsRender?: number;
  video?: { width: number; height: number };
  appVersion?: string;
}

export type ScreenGeometrySource = 'default' | 'auto' | 'manual';

/** Fonte única para converter fração de tela em px (alvo e ground-truth). */
export function fracaoDaTelaParaPx(fracao: number, larguraPx: number): number {
  return fracao * larguraPx;
}

export interface ErrosAgregados {
  meanErrorInner: number | null;
  meanErrorEdge: number | null;
  meanError: number | null;
  medianError: number | null;
  p90Error: number | null;
  meanErrorX: number | null;
  meanErrorY: number | null;
  biasX: number | null;
  biasY: number | null;
  sampleMeanError: number | null;
  sampleMedianError: number | null;
  sampleP90Error: number | null;
  hitRateByRadius: { radiusPx: number; pct: number | null }[];
  maxError: number | null;
  errorPct: number | null;
  pontosMedidos: number;
  pontosNaoMedidos: number;
  nInterior: number;
  nEdge: number;
}

export interface PontoAgregavel {
  isEdge?: boolean;
  error?: number;
  errorX?: number;
  errorY?: number;
  /** Viés assinado (predito − alvo), em px. */
  biasX?: number;
  biasY?: number;
  samplesError?: number[];
}

const HIT_RADII = [60, 100, 150, 200];

function mostrarPx(v: number | null): string {
  return v === null ? '—' : `${Math.round(v)}px`;
}

const media = (v: number[]): number | null =>
  v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : null;

/** Percentil com interpolação linear (convenção 'linear' do numpy). */
export function percentileLinear(sorted: readonly number[], q: number): number {
  const n = sorted.length;
  if (n === 0) return 0;
  if (n === 1) return sorted[0];
  const pos = (n - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
}

/** Agrega os erros por ponto. Pura e total; toda a política de ausência mora aqui. */
export function agregarErros(
  pontos: readonly PontoAgregavel[],
  vw: number,
  vh: number,
): ErrosAgregados {
  const medido = (p: PontoAgregavel) => typeof p.error === 'number' && Number.isFinite(p.error);
  const medidos = pontos.filter(medido);
  const interiores = medidos.filter((p) => !p.isEdge);
  const bordas = medidos.filter((p) => p.isEdge);

  const errosInterior = interiores.map((p) => p.error as number);
  const errosBorda = bordas.map((p) => p.error as number);
  const errosTodos = medidos.map((p) => p.error as number);
  const ordenadosInterior = [...errosInterior].sort((a, b) => a - b);
  const meanErrorInner = media(errosInterior);

  const finitos = (v: (number | undefined)[]) =>
    v.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  const amostras = medidos.flatMap((p) => p.samplesError ?? []).filter(Number.isFinite);
  const ordenadasAmostras = [...amostras].sort((a, b) => a - b);
  const diagonal = Math.hypot(vw, vh);

  return {
    meanErrorInner,
    meanErrorEdge: media(errosBorda),
    meanError: meanErrorInner,
    medianError: ordenadosInterior.length > 0 ? percentileLinear(ordenadosInterior, 0.5) : null,
    p90Error: ordenadosInterior.length > 0 ? percentileLinear(ordenadosInterior, 0.9) : null,
    meanErrorX: media(finitos(interiores.map((p) => p.errorX))),
    meanErrorY: media(finitos(interiores.map((p) => p.errorY))),
    biasX: media(finitos(interiores.map((p) => p.biasX))),
    biasY: media(finitos(interiores.map((p) => p.biasY))),
    sampleMeanError: media(amostras),
    sampleMedianError: ordenadasAmostras.length > 0 ? percentileLinear(ordenadasAmostras, 0.5) : null,
    sampleP90Error: ordenadasAmostras.length > 0 ? percentileLinear(ordenadasAmostras, 0.9) : null,
    hitRateByRadius: HIT_RADII.map((r) => ({
      radiusPx: r,
      pct: amostras.length > 0 ? (amostras.filter((e) => e <= r).length / amostras.length) * 100 : null,
    })),
    maxError: errosTodos.length > 0 ? Math.max(...errosTodos) : null,
    errorPct: meanErrorInner !== null && diagonal > 0 ? (meanErrorInner / diagonal) * 100 : null,
    pontosMedidos: medidos.length,
    pontosNaoMedidos: pontos.length - medidos.length,
    nInterior: interiores.length,
    nEdge: bordas.length,
  };
}

/** A geometria foi medida (EDID ou fita métrica) ou apenas assumida? */
export function geometriaFoiMedida(source: ScreenGeometrySource | null | undefined): boolean {
  return source === 'auto' || source === 'manual';
}

/**
 * Erro angular entre o alvo e a predição, em graus, com o olho no centro da
 * tela a `distPx` de distância. Usa os vetores reais (não `atan(erro/d)`), então
 * o mesmo erro em px vale menos graus na periferia, como deve.
 */
/**
 * BCEA — área da elipse que contém `p` das amostras (68% por convenção).
 *
 * Complementa o desvio-padrão porque enxerga a FORMA da dispersão: o erro
 * vertical do pipeline é sistematicamente maior que o horizontal, e uma única
 * medida escalar de dispersão esconde isso. Fórmula usual da literatura de
 * qualidade de dado: `BCEA = 2 k π σx σy √(1 − ρ²)`, com `k = −ln(1 − p)`.
 */
export function bcea(
  xs: readonly number[],
  ys: readonly number[],
  p = 0.68,
): number | null {
  const n = Math.min(xs.length, ys.length);
  if (n < 3) return null;
  let mx = 0, my = 0;
  for (let i = 0; i < n; i++) { mx += xs[i]; my += ys[i]; }
  mx /= n; my /= n;
  let sxx = 0, syy = 0, sxy = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx, dy = ys[i] - my;
    sxx += dx * dx; syy += dy * dy; sxy += dx * dy;
  }
  const varX = sxx / (n - 1), varY = syy / (n - 1);
  const sdX = Math.sqrt(varX), sdY = Math.sqrt(varY);
  if (!(sdX > 0) || !(sdY > 0)) return 0;
  const rho = Math.max(-1, Math.min(1, (sxy / (n - 1)) / (sdX * sdY)));
  const k = -Math.log(1 - p);
  const area = 2 * k * Math.PI * sdX * sdY * Math.sqrt(Math.max(0, 1 - rho * rho));
  return Number.isFinite(area) ? area : null;
}

/**
 * Tamanho mínimo de alvo que acomoda o erro medido deste usuário:
 * `S = 2 · (offset + 2σ)` (Feit et al., CHI 2017).
 *
 * É a tradução direta da medição em requisito de interface — e o número que
 * de fato importa para quem depende do dwell para se comunicar.
 */
export function tamanhoMinimoDeAlvo(offset: number | null, sigma: number | null): number | null {
  if (offset === null || sigma === null) return null;
  if (!Number.isFinite(offset) || !Number.isFinite(sigma)) return null;
  return 2 * (offset + 2 * sigma);
}

/** Embaralha uma lista de forma determinística a partir de uma semente. */
export function embaralharComSemente<T>(itens: readonly T[], semente: number): T[] {
  const out = itens.slice();
  let s = semente >>> 0;
  const rnd = () => {
    // xorshift32: determinístico e suficiente para ordenar 13 pontos.
    s ^= s << 13; s >>>= 0;
    s ^= s >> 17;
    s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function erroAngularDeg(
  alvo: { x: number; y: number },
  pred: { x: number; y: number },
  centro: { x: number; y: number },
  distPx: number,
): number {
  const a = { x: alvo.x - centro.x, y: alvo.y - centro.y, z: distPx };
  const b = { x: pred.x - centro.x, y: pred.y - centro.y, z: distPx };
  const na = Math.hypot(a.x, a.y, a.z);
  const nb = Math.hypot(b.x, b.y, b.z);
  if (!(na > 0) || !(nb > 0)) return 0;
  const cos = Math.max(-1, Math.min(1, (a.x * b.x + a.y * b.y + a.z * b.z) / (na * nb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

interface PointDiagnostic {
  isEdge?: boolean;
  groundX: number;
  groundY: number;
  /** Média das predições; ausente quando o ponto não coletou amostra suficiente. */
  predX?: number;
  predY?: number;
  error: number;
  errorX: number;
  errorY: number;
  biasX: number;
  biasY: number;
  errorDeg: number;
  jitterRMS: number;
  sdX: number;
  sdY: number;
  s2sRMS: number;
  jitterFilteredRMS?: number;
  /** Área da elipse de 68% das amostras, em px². */
  bceaPx2?: number;
  nSamples: number;
  /** Quadros esperados na janela útil, pela taxa efetiva medida no ponto. */
  nEsperado?: number;
  /** Fração de amostras válidas: `nSamples / nEsperado`. */
  fracaoValida?: number;
  name: string;
  samplesError: number[];
  meanPose?: { yaw: number; pitch: number; roll: number };
}

// Grade 3×3 de validação em 25/50/75, disjunta da grade de calibração (que
// sai do orçamento de excentricidade e cai em ~17/83 × 5/95 na tela de
// referência). O centro é comum às duas por convenção. Fixa de propósito: uma
// métrica que se move junto com o protocolo não serve para comparar sessões.
const VALIDATION_POINTS = [
  { name: 'P1', screenX: 0.25, screenY: 0.25 },
  { name: 'P2', screenX: 0.50, screenY: 0.25 },
  { name: 'P3', screenX: 0.75, screenY: 0.25 },
  { name: 'P4', screenX: 0.25, screenY: 0.50 },
  { name: 'P5', screenX: 0.50, screenY: 0.50 },
  { name: 'P6', screenX: 0.75, screenY: 0.50 },
  { name: 'P7', screenX: 0.25, screenY: 0.75 },
  { name: 'P8', screenX: 0.50, screenY: 0.75 },
  { name: 'P9', screenX: 0.75, screenY: 0.75 },
];

// Quatro cantos a 5/95: extrapolação em X, onde a UI de fato põe botões. Só
// quatro porque cada ponto custa ~2,3 s (COLLECTION_MS + a pausa de 300 ms) a
// um paciente com fadiga limitante.
const EDGE_POINTS = [
  { name: 'B1', screenX: 0.05, screenY: 0.05 },
  { name: 'B2', screenX: 0.95, screenY: 0.05 },
  { name: 'B3', screenX: 0.05, screenY: 0.95 },
  { name: 'B4', screenX: 0.95, screenY: 0.95 },
];

const ALL_VALIDATION_POINTS = [
  ...VALIDATION_POINTS.map((p) => ({ ...p, isEdge: false })),
  ...EDGE_POINTS.map((p) => ({ ...p, isEdge: true })),
];

/** Distância olho–tela assumida quando a UI não informa geometria (60 cm a 96 dpi). */
const ASSUMED_DIST_PX = 2268;

/**
 * Quanto tempo sem um quadro antes de considerar a cadeia de `requestAnimationFrame`
 * parada. A coleta vive dentro dela; se ela morre — uma exceção num quadro, a
 * aba perdendo o compositor, o worker travando o thread — o teste ficava preso
 * numa tela preta para sempre, sem nada a fazer além de recarregar o app.
 */
const STALL_MS = 3000;
/** Quantas paradas seguidas antes de encerrar o teste com o que já foi medido. */
const STALL_MAX = 3;

let currentFeaturesLeft: number[] = [];
let currentFeaturesRight: number[] = [];
let currentPose: { yaw: number; pitch: number; roll: number } | undefined;
/** Incrementa a cada vetor novo; o laço de coleta roda no rAF (60–180 Hz) e o
 *  vídeo a 30, então sem isto o mesmo vetor seria amostrado várias vezes e o
 *  jitter sairia otimista. */
let currentFrameSeq = 0;
let currentFiltered: { x: number; y: number; seq: number } | null = null;

export let isAccuracyTesting = false;

let currentValidationTarget: { xPx: number; yPx: number; label: string } | null = null;

export function getCurrentTargetPx(): { xPx: number; yPx: number; label: string } | null {
  return currentValidationTarget;
}

/** Chamado pelo engine a cada quadro com features válidas. */
export function feedAccuracyRaw(
  featuresLeft: number[],
  featuresRight: number[],
  _perEyeWeight?: { left: number; right: number },
  pose?: { yaw: number; pitch: number; roll: number },
) {
  currentFeaturesLeft = featuresLeft;
  currentFeaturesRight = featuresRight;
  currentPose = pose;
  currentFrameSeq++;
}

/** Chamado pelo engine com a saída filtrada do mesmo quadro (o que o cursor mostra). */
export function feedAccuracyFiltered(x: number, y: number) {
  currentFiltered = { x, y, seq: currentFrameSeq };
}

/**
 * Inicia o teste. `onComplete` recebe o resultado e a intenção do usuário no
 * overlay final: `'continue'` (Espaço) ou `'redo'` (R).
 */
export function startAccuracyTest(
  onComplete?: (result: AccuracyResult, action: 'continue' | 'redo') => void,
  meta?: RunMeta,
  runtime?: RuntimeInfo,
) {
  isAccuracyTesting = true;

  const overlap = checkValidationOverlap(getCalibrationTargets(), ALL_VALIDATION_POINTS);
  if (overlap.length > 0) {
    console.warn(
      `[accuracy] ⚠ ${overlap.length} ponto(s) de validação coincidem com alvos de ` +
      `calibração (${overlap.map(o => o.validationPoint).join(', ')}). O erro nesses ` +
      `pontos mede memorização, não generalização.`,
    );
  }
  // Ordem sorteada: em ordem fixa o participante antecipa o próximo alvo e a
  // sacada antecipatória se mistura ao efeito de excentricidade. A semente vai
  // no relatório para a rodada ser reproduzível.
  const sementeDaOrdem = (Date.now() ^ (Math.random() * 0xffffffff)) >>> 0;
  const pontosDaRodada = embaralharComSemente(ALL_VALIDATION_POINTS, sementeDaOrdem);

  const overlay = createAccuracyOverlay();
  let pointIndex = 0;
  const pointErrors: number[] = [];
  const diagnostics: PointDiagnostic[] = [];
  let poseBaseline: { yaw: number; pitch: number; roll: number } | null = null;

  // Vigia da cadeia de quadros. `setInterval` continua sendo entregue quando o
  // rAF para, então é ele quem percebe a parada e devolve o controle.
  let ultimoTickMs = performance.now();
  let quadrosComErro = 0;
  /** Distância olho→CÂMERA medida a cada amostra aceita (é o que
   *  `getCurrentCameraDistanceCm` estima, a partir da distância cantal em px e
   *  do FOV). Grandeza DIFERENTE da olho→tela digitada pelo cuidador, que é a
   *  que converte px em graus — ver `distanceCompensation.ts`. Vai ao relatório
   *  como testemunha de quanto a pessoa se moveu, não para confirmar a outra. */
  const distanciasDoTeste: number[] = [];
  let paradas = 0;
  let quadroPendente: (() => void) | null = null;
  let encerrado = false;

  /** Só o agendamento MAIS RECENTE pode rodar. O vigia reagenda um quadro que
   *  o navegador ainda não entregou; quando ele volta a entregar (rAF apenas
   *  atrasado, não morto — GC longo, aba que volta do segundo plano), os DOIS
   *  callbacks disparam e o mesmo `collect` roda duas vezes, abrindo duas
   *  cadeias de coleta sobre o mesmo `pointIndex`: pontos duplicados no
   *  relatório, pontos pulados na tela. */
  let quadroAtual = 0;
  function agendarQuadro(fn: () => void) {
    quadroPendente = fn;
    const meuQuadro = ++quadroAtual;
    requestAnimationFrame(() => {
      if (encerrado || meuQuadro !== quadroAtual) return;
      quadroPendente = null;
      fn();
    });
  }

  const vigia = setInterval(() => {
    if (encerrado) { clearInterval(vigia); return; }
    const parado = performance.now() - ultimoTickMs;
    if (parado < STALL_MS) return;
    paradas++;
    ultimoTickMs = performance.now();
    console.warn(
      `[accuracy] sem quadros há ${Math.round(parado)} ms (parada ${paradas}/${STALL_MAX}).`,
    );
    if (paradas >= STALL_MAX || !quadroPendente) {
      encerrarPorFalha('o navegador parou de entregar quadros durante o teste');
      return;
    }
    // Uma tentativa de retomar: o quadro pendente é reagendado. Por
    // `agendarQuadro` de propósito — é ele quem invalida o agendamento
    // anterior e mantém `quadroPendente` preenchido, para a parada seguinte
    // ainda contar como parada (e não como "não há o que retomar").
    agendarQuadro(quadroPendente);
  }, 1000);

  /** Encerra o teste com o que foi medido até aqui, dizendo por quê. */
  function encerrarPorFalha(motivo: string) {
    if (encerrado) return;
    console.error(`[accuracy] teste interrompido: ${motivo}`);
    finalizar(motivo);
  }

  function finalizar(motivoDeAborto?: string) {
    if (encerrado) return;
    encerrado = true;
    clearInterval(vigia);
    isAccuracyTesting = false;
    currentValidationTarget = null;
    finishTest(overlay, pointErrors, diagnostics, onComplete, meta, runtime, poseBaseline, overlap, distanciasDoTeste, sementeDaOrdem, motivoDeAborto);
  }

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  function runNextPoint() {
    if (encerrado) return;
    if (pointIndex >= pontosDaRodada.length) {
      finalizar();
      return;
    }

    const vp = pontosDaRodada[pointIndex];
    showValidationDot(overlay, vp, pointIndex, vw, vh, pontosDaRodada.length);

    const startTime = performance.now();
    const predictedX: number[] = [];
    const predictedY: number[] = [];
    const filteredX: number[] = [];
    const filteredY: number[] = [];
    const poseYaw: number[] = [];
    const posePitch: number[] = [];
    const poseRoll: number[] = [];
    let primeiraAmostraMs = 0;
    let ultimaAmostraMs = 0;

    const targetScreenX = fracaoDaTelaParaPx(vp.screenX, vw);
    const targetScreenY = fracaoDaTelaParaPx(vp.screenY, vh);
    currentValidationTarget = { xPx: targetScreenX, yPx: targetScreenY, label: vp.name };

    // Começa no seq ATUAL: o vetor que já estava no cache pertence ao ponto
    // anterior, e contá-lo daria a cada ponto uma amostra obsoleta.
    let lastSeenSeq = currentFrameSeq;

    function collect() {
      ultimoTickMs = performance.now();
      const elapsed = ultimoTickMs - startTime;
      const frameNovo = currentFrameSeq !== lastSeenSeq;

      if (!poseBaseline && currentPose) poseBaseline = { ...currentPose };

      if (elapsed >= ACCLIMATION_MS && frameNovo) {
        lastSeenSeq = currentFrameSeq;
        if (currentPose) {
          poseYaw.push(currentPose.yaw);
          posePitch.push(currentPose.pitch);
          poseRoll.push(currentPose.roll);
        }
        // Sem `perEyeWeight` de propósito: o teste mede o modelo treinado, não
        // a heurística de fusão por EAR do cursor.
        //
        // O try/catch não é decoração: `mapGaze` lança quando o vetor e o
        // modelo divergem em dimensão, e uma exceção aqui interrompia a cadeia
        // de rAF — o teste congelava na tela preta, sem relatório e sem volta.
        let gaze: { x: number; y: number } | null = null;
        try {
          gaze = mapGaze(currentFeaturesLeft, currentFeaturesRight);
        } catch (e) {
          quadrosComErro++;
          if (quadrosComErro === 1) console.error('[accuracy] mapGaze lançou durante o teste:', e);
        }
        if (gaze) {
          const agora = performance.now();
          if (predictedX.length === 0) primeiraAmostraMs = agora;
          ultimaAmostraMs = agora;
          predictedX.push(gaze.x);
          predictedY.push(gaze.y);
          const dist = getCurrentCameraDistanceCm();
          if (dist !== null && Number.isFinite(dist)) distanciasDoTeste.push(dist);
          if (currentFiltered && currentFiltered.seq === currentFrameSeq) {
            filteredX.push(currentFiltered.x);
            filteredY.push(currentFiltered.y);
          }
        }
      }

      if (elapsed < COLLECTION_MS) {
        agendarQuadro(collect);
        return;
      }

      const n = predictedX.length;
      const d: PointDiagnostic = {
        isEdge: vp.isEdge,
        groundX: targetScreenX,
        groundY: targetScreenY,
        error: NaN, errorX: NaN, errorY: NaN, biasX: NaN, biasY: NaN, errorDeg: NaN,
        jitterRMS: NaN, sdX: NaN, sdY: NaN, s2sRMS: NaN,
        nSamples: n,
        name: vp.name,
        samplesError: [],
        meanPose: poseYaw.length > 0 ? {
          yaw: poseYaw.reduce((s, v) => s + v, 0) / poseYaw.length,
          pitch: posePitch.reduce((s, v) => s + v, 0) / posePitch.length,
          roll: poseRoll.reduce((s, v) => s + v, 0) / poseRoll.length,
        } : undefined,
      };

      if (n >= MIN_SAMPLES_PER_POINT) {
        const meanPX = predictedX.reduce((s, v) => s + v, 0) / n;
        const meanPY = predictedY.reduce((s, v) => s + v, 0) / n;
        d.predX = meanPX;
        d.predY = meanPY;
        d.biasX = meanPX - targetScreenX;
        d.biasY = meanPY - targetScreenY;
        d.errorX = Math.abs(d.biasX);
        d.errorY = Math.abs(d.biasY);
        d.error = Math.hypot(d.biasX, d.biasY);

        let sumSq = 0, sumSqX = 0, sumSqY = 0, sumS2S = 0;
        for (let i = 0; i < n; i++) {
          const jx = predictedX[i] - meanPX;
          const jy = predictedY[i] - meanPY;
          sumSq += jx * jx + jy * jy;
          sumSqX += jx * jx;
          sumSqY += jy * jy;
          if (i > 0) {
            sumS2S += (predictedX[i] - predictedX[i - 1]) ** 2 + (predictedY[i] - predictedY[i - 1]) ** 2;
          }
          d.samplesError.push(Math.hypot(predictedX[i] - targetScreenX, predictedY[i] - targetScreenY));
        }
        d.jitterRMS = Math.sqrt(sumSq / n);
        d.sdX = Math.sqrt(sumSqX / Math.max(1, n - 1));
        d.sdY = Math.sqrt(sumSqY / Math.max(1, n - 1));
        d.s2sRMS = n > 1 ? Math.sqrt(sumS2S / (n - 1)) : 0;

        d.bceaPx2 = bcea(predictedX, predictedY) ?? undefined;

        if (filteredX.length >= MIN_SAMPLES_PER_POINT) {
          const mfx = filteredX.reduce((s, v) => s + v, 0) / filteredX.length;
          const mfy = filteredY.reduce((s, v) => s + v, 0) / filteredY.length;
          let fs = 0;
          for (let i = 0; i < filteredX.length; i++) fs += (filteredX[i] - mfx) ** 2 + (filteredY[i] - mfy) ** 2;
          d.jitterFilteredRMS = Math.sqrt(fs / filteredX.length);
        }
      } else if (n > 0) {
        console.warn(`[accuracy] ${vp.name}: só ${n} amostra(s) (mínimo ${MIN_SAMPLES_PER_POINT}) — ponto não medido.`);
      }

      const janelaMs = n > 1 ? ultimaAmostraMs - primeiraAmostraMs : 0;
      (d as PointDiagnostic & { windowMs?: number }).windowMs = janelaMs;

      // Perda de amostras: quantos quadros a janela útil deveria ter rendido,
      // à taxa que a própria janela mediu, contra o que chegou. Abaixo de 80%
      // a dispersão do ponto foi estimada sobre menos da metade do esperado.
      if (n > 1 && janelaMs > 0) {
        const taxaHz = ((n - 1) * 1000) / janelaMs;
        const esperado = quadrosEsperados(taxaHz);
        if (esperado > 0) {
          d.nEsperado = esperado;
          d.fracaoValida = Math.min(1, n / esperado);
          if (d.fracaoValida < MIN_VALID_SAMPLE_RATIO) {
            console.warn(
              `[accuracy] ${vp.name}: ${n}/${esperado} amostras ` +
              `(${(d.fracaoValida * 100).toFixed(0)}% < ${(MIN_VALID_SAMPLE_RATIO * 100).toFixed(0)}%).`,
            );
          }
        }
      }

      pointErrors.push(d.error);
      diagnostics.push(d);
      pointIndex++;
      setTimeout(runNextPoint, 300);
    }

    agendarQuadro(collect);
  }

  // 1,5 s de preparação: o usuário acabou de sair da calibração e precisa
  // estabilizar o olhar antes do primeiro alvo.
  setTimeout(runNextPoint, 1500);
}

function createAccuracyOverlay(): HTMLDivElement {
  const overlay = document.createElement('div');
  overlay.id = 'accuracy-overlay';
  overlay.className = 'accuracy-overlay';
  overlay.innerHTML = `
    <div class="accuracy-instruction">
      Teste de Precisão — olhe para cada ponto
    </div>
  `;
  document.body.appendChild(overlay);
  return overlay;
}

function showValidationDot(
  overlay: HTMLDivElement,
  vp: { name: string; screenX: number; screenY: number },
  index: number,
  vw: number,
  vh: number,
  total: number,
) {
  const old = document.getElementById('accuracy-dot');
  if (old) old.remove();

  // Posicionado em px do viewport, a mesma medida do ground-truth (`vw`/`vh`
  // CSS incluem a barra de rolagem; `clientWidth` não).
  const dot = document.createElement('div');
  dot.id = 'accuracy-dot';
  dot.className = 'accuracy-dot';
  // O botão de emergência se afasta de qualquer elemento com este atributo.
  dot.setAttribute('data-calibration-target', '');
  dot.style.left = `${fracaoDaTelaParaPx(vp.screenX, vw)}px`;
  dot.style.top = `${fracaoDaTelaParaPx(vp.screenY, vh)}px`;
  // Alvo bullseye + crosshair: mede-se dispersão de fixação e microssacada
  // menores com ele do que com um círculo simples (Thaler et al., 2013).
  dot.innerHTML = '<div class="dot-cross"></div><div class="dot-inner"></div>';

  const instr = overlay.querySelector('.accuracy-instruction') as HTMLElement;
  if (instr) {
    instr.innerHTML = `Teste de Precisão &nbsp;<span class="highlight">${index + 1}/${total}</span> — olhe para o ponto`;
  }

  overlay.appendChild(dot);
}

// 2% de cada eixo (~38 px em X, ~22 px em Y em 1080p): bem abaixo do menor
// alvo interativo do app.
const OVERLAP_TOLERANCE = 0.02;

/** Alvos de calibração que caíram em cima de pontos de validação. Só detecção. */
export function checkValidationOverlap(
  calibrationTargets: readonly { x: number; y: number }[],
  validationPoints: readonly { name: string; screenX: number; screenY: number }[],
  tolerance: number = OVERLAP_TOLERANCE,
): { validationPoint: string; calibX: number; calibY: number }[] {
  const hits: { validationPoint: string; calibX: number; calibY: number }[] = [];
  for (const v of validationPoints) {
    // O centro pertence às duas grades por convenção.
    if (Math.abs(v.screenX - 0.5) < tolerance && Math.abs(v.screenY - 0.5) < tolerance) continue;
    for (const c of calibrationTargets) {
      if (Math.abs(c.x - v.screenX) < tolerance && Math.abs(c.y - v.screenY) < tolerance) {
        hits.push({ validationPoint: v.name, calibX: c.x, calibY: c.y });
        break;
      }
    }
  }
  return hits;
}

/**
 * Decomposição afim do erro (mínimos quadrados em coordenadas normalizadas):
 *     predX = a·gx + b·gy + c      predY = d·gx + e·gy + f
 * Reporta quanto do erro sobra depois de remover esse mapa. Só os pontos com
 * predição válida entram; o chamador escolhe a população.
 */
export function affineErrorDecomposition(
  points: readonly { groundX: number; groundY: number; predX?: number; predY?: number }[],
  vw: number,
  vh: number,
  meanError: number | null,
): AccuracyResult['affine'] {
  const usable = points.filter(
    (p): p is { groundX: number; groundY: number; predX: number; predY: number } =>
      typeof p.predX === 'number' && Number.isFinite(p.predX) &&
      typeof p.predY === 'number' && Number.isFinite(p.predY),
  );
  if (usable.length < 4 || !(vw > 0) || !(vh > 0)) return undefined;
  if (meanError === null || !(meanError > 0)) return undefined;

  const rows = usable.map(p => [p.groundX / vw, p.groundY / vh, 1]);

  const solve3 = (ys: number[]): number[] | null => {
    const A = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    const b = [0, 0, 0];
    for (let k = 0; k < rows.length; k++) {
      for (let i = 0; i < 3; i++) {
        for (let j = 0; j < 3; j++) A[i][j] += rows[k][i] * rows[k][j];
        b[i] += rows[k][i] * ys[k];
      }
    }
    const M = A.map((r, i) => [...r, b[i]]);
    for (let c = 0; c < 3; c++) {
      let piv = c;
      for (let r = c + 1; r < 3; r++) if (Math.abs(M[r][c]) > Math.abs(M[piv][c])) piv = r;
      [M[c], M[piv]] = [M[piv], M[c]];
      const dv = M[c][c];
      if (!Number.isFinite(dv) || Math.abs(dv) < 1e-12) return null;
      for (let j = c; j <= 3; j++) M[c][j] /= dv;
      for (let r = 0; r < 3; r++) {
        if (r === c) continue;
        const f = M[r][c];
        for (let j = c; j <= 3; j++) M[r][j] -= f * M[c][j];
      }
    }
    return M.map(r => r[3]);
  };

  const cx = solve3(usable.map(p => p.predX / vw));
  const cy = solve3(usable.map(p => p.predY / vh));
  if (!cx || !cy) return undefined;

  let residualSum = 0;
  for (let i = 0; i < usable.length; i++) {
    const [gx, gy] = rows[i];
    const fitX = (cx[0] * gx + cx[1] * gy + cx[2]) * vw;
    const fitY = (cy[0] * gx + cy[1] * gy + cy[2]) * vh;
    residualSum += Math.hypot(fitX - usable[i].predX, fitY - usable[i].predY);
  }
  const residualPx = residualSum / usable.length;

  return {
    gainX: cx[0],
    crossXY: cx[1],
    offsetXPx: cx[2] * vw,
    shearYX: cy[0],
    gainY: cy[1],
    offsetYPx: cy[2] * vh,
    residualPx,
    explainedFraction: Math.max(0, Math.min(1, 1 - residualPx / meanError)),
  };
}

function finishTest(
  overlay: HTMLDivElement,
  pointErrors: number[],
  diagnostics: PointDiagnostic[],
  onComplete?: (result: AccuracyResult, action: 'continue' | 'redo') => void,
  meta?: RunMeta,
  runtime?: RuntimeInfo,
  poseBaseline?: { yaw: number; pitch: number; roll: number } | null,
  validationOverlap?: { validationPoint: string; calibX: number; calibY: number }[],
  /** Série de distâncias olho→câmera medidas durante o teste, em cm. */
  distanciasDoTeste: readonly number[] = [],
  /** Semente da ordem sorteada dos alvos — é o que torna a rodada reproduzível. */
  sementeDaOrdem = 0,
  /** Preenchido quando o teste terminou antes da hora. Vai para o painel e para o JSON. */
  motivoDeAborto?: string,
) {
  overlay.remove();

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  // Geometria: px por cm e distância olho–tela em px.
  let distPx = ASSUMED_DIST_PX;
  let geometryAssumed = true;
  let pxPorCm = 0;
  if (meta && meta.distanciaCm && meta.telaPolegadas) {
    const diagPx = Math.hypot(vw, vh);
    pxPorCm = diagPx / (meta.telaPolegadas * 2.54);
    distPx = meta.distanciaCm * pxPorCm;
    geometryAssumed = !geometriaFoiMedida(meta.screenGeometrySource);
  }

  // Erro angular por ponto, agora que a distância é conhecida.
  const centro = { x: vw / 2, y: vh / 2 };
  for (const d of diagnostics) {
    if (typeof d.predX === 'number' && typeof d.predY === 'number') {
      d.errorDeg = erroAngularDeg({ x: d.groundX, y: d.groundY }, { x: d.predX, y: d.predY }, centro, distPx);
    }
  }

  const agg = agregarErros(diagnostics, vw, vh);
  const { meanError } = agg;
  const medidos = diagnostics.filter((d) => Number.isFinite(d.error));
  const interiores = medidos.filter((d) => !d.isEdge);

  // POPULAÇÕES, e por que são duas (docs/MEDICOES.md §2 "Populações" e §7):
  // acurácia (erro, viés, graus, BCEA) usa só os INTERIORES, porque as bordas
  // sofrem softClamp e geometria plana em sentidos opostos. Precisão
  // (jitter/SD/S2S) usa TODOS os pontos medidos: o tremor de fixação não é
  // distorcido pelo clamp, e a dispersão na periferia é justamente o que
  // dimensiona um botão de canto. Não unificar as duas é deliberado — o único
  // número que combina as duas populações é `alvoMinimoPx` (offset interior +
  // σ de todos), e está declarado assim na §8.
  const meanErrorDeg = media(interiores.map((d) => d.errorDeg).filter(Number.isFinite));
  const jitterRMS = media(medidos.map((d) => d.jitterRMS).filter(Number.isFinite));
  const precisionSdX = media(medidos.map((d) => d.sdX).filter(Number.isFinite));
  const precisionSdY = media(medidos.map((d) => d.sdY).filter(Number.isFinite));
  const precisionS2S = media(medidos.map((d) => d.s2sRMS).filter(Number.isFinite));
  const precisionDeg = jitterRMS !== null ? (Math.atan(jitterRMS / distPx) * 180) / Math.PI : null;
  const jitterFilteredRMS = media(
    medidos.map((d) => d.jitterFilteredRMS).filter((v): v is number => typeof v === 'number' && Number.isFinite(v)),
  );
  const janelas = diagnostics
    .map((d) => (d as PointDiagnostic & { windowMs?: number }).windowMs ?? 0)
    .filter((w) => w > 0);
  const totalAmostras = diagnostics.reduce((s, d) => s + (d.nSamples > 1 ? d.nSamples - 1 : 0), 0);
  const totalJanelaMs = janelas.reduce((s, w) => s + w, 0);
  const sampleRateHz = totalJanelaMs > 0 ? (totalAmostras * 1000) / totalJanelaMs : null;

  let score: string;
  let colorClass: string;
  if (meanError === null) {
    score = 'Não medido';
    colorClass = 'accuracy-poor';
  } else if (meanError < 30) {
    score = 'Excelente';
    colorClass = 'accuracy-excellent';
  } else if (meanError < 60) {
    score = 'Bom';
    colorClass = 'accuracy-good';
  } else if (meanError < 100) {
    score = 'Regular';
    colorClass = 'accuracy-regular';
  } else {
    score = 'Ruim';
    colorClass = 'accuracy-poor';
  }

  let poseDrift: AccuracyResult['poseDrift'] = undefined;
  if (poseBaseline) {
    const deltas = diagnostics
      .filter(d => d.meanPose)
      .map(d => ({
        yaw: d.meanPose!.yaw - poseBaseline.yaw,
        pitch: d.meanPose!.pitch - poseBaseline.pitch,
        roll: d.meanPose!.roll - poseBaseline.roll,
      }));
    if (deltas.length > 0) {
      const absMax = (arr: number[]) => arr.reduce((m, v) => Math.abs(v) > Math.abs(m) ? v : m, 0);
      const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
      poseDrift = {
        baseline: poseBaseline,
        maxDelta: { yaw: absMax(deltas.map(d => d.yaw)), pitch: absMax(deltas.map(d => d.pitch)), roll: absMax(deltas.map(d => d.roll)) },
        meanDelta: { yaw: mean(deltas.map(d => d.yaw)), pitch: mean(deltas.map(d => d.pitch)), roll: mean(deltas.map(d => d.roll)) },
      };
    }
  }

  const fit = getCalibrationFitDiagnostics();
  let poseDeltaCalibToTestDeg: AccuracyResult['poseDeltaCalibToTestDeg'];
  const posesTeste = diagnostics.map((d) => d.meanPose).filter((p): p is NonNullable<typeof p> => !!p);
  if (fit?.poseMean && posesTeste.length > 0) {
    const g = 180 / Math.PI;
    const m = (pick: (p: { yaw: number; pitch: number; roll: number }) => number) =>
      posesTeste.reduce((s, p) => s + pick(p), 0) / posesTeste.length;
    poseDeltaCalibToTestDeg = {
      yaw: (m((p) => p.yaw) - fit.poseMean.yaw) * g,
      pitch: (m((p) => p.pitch) - fit.poseMean.pitch) * g,
      roll: (m((p) => p.roll) - fit.poseMean.roll) * g,
    };
  }

  // Afim sobre os interiores medidos — a mesma população de `meanError`.
  const affine = affineErrorDecomposition(interiores, vw, vh, meanError);
  if (affine) {
    console.log(
      `[accuracy] Decomposição afim (interior): ganhoX=${affine.gainX.toFixed(3)} ` +
      `ganhoY=${affine.gainY.toFixed(3)} offset=(${Math.round(affine.offsetXPx)}, ${Math.round(affine.offsetYPx)})px | ` +
      `resíduo=${Math.round(affine.residualPx)}px (${(affine.explainedFraction * 100).toFixed(0)}% do erro é mapa afim)`,
    );
  }

  // ── Métricas que a literatura de qualidade de dado pede junto ────────────
  const interioresMedidos = diagnostics.filter((d) => !d.isEdge && Number.isFinite(d.error));
  const mediaDe = (vals: number[]) =>
    vals.length > 0 ? vals.reduce((s2, v) => s2 + v, 0) / vals.length : null;

  const bceaPx2 = mediaDe(
    interioresMedidos.map((d) => d.bceaPx2).filter((v): v is number => typeof v === 'number'),
  );
  // px² → graus²: cada eixo divide por (px por grau).
  const pxPorGrau = distPx * Math.PI / 180;
  const bceaDeg2 = bceaPx2 !== null && pxPorGrau > 0 ? bceaPx2 / (pxPorGrau * pxPorGrau) : null;

  const fracoes = diagnostics
    .map((d) => d.fracaoValida)
    .filter((v): v is number => typeof v === 'number');
  const fracaoDeAmostrasValidas = mediaDe(fracoes);
  const pontosComPoucaAmostra = diagnostics
    .filter((d) => typeof d.fracaoValida === 'number' && d.fracaoValida < MIN_VALID_SAMPLE_RATIO)
    .map((d) => d.name);

  // Sigma para o tamanho de alvo: o eixo pior manda, porque o alvo precisa
  // acomodar os dois. É o mesmo raciocínio de Feit et al. ao recomendar alvos
  // mais altos que largos.
  const sigmaPior = precisionSdX !== null && precisionSdY !== null
    ? Math.max(precisionSdX, precisionSdY)
    : jitterRMS;
  const alvoMinimoPx = tamanhoMinimoDeAlvo(meanError, sigmaPior);
  const alvoMinimoDeg = alvoMinimoPx !== null && pxPorGrau > 0 ? alvoMinimoPx / pxPorGrau : null;

  const distancias = distanciasDoTeste.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  const distanciaMedidaCm = distancias.length > 0
    ? {
        // Mediana de verdade: com N par, `distancias[N>>1]` devolve o MAIOR dos
        // dois valores centrais, não a média deles — um campo chamado "mediana"
        // que não é a mediana. `percentileLinear` é a mesma convenção usada em
        // `medianError`/`sampleMedianError` aqui e em `medianaDeDistancias`.
        mediana: percentileLinear(distancias, 0.5),
        min: distancias[0],
        max: distancias[distancias.length - 1],
      }
    : null;

  const result: AccuracyResult = {
    meanError,
    medianError: agg.medianError,
    p90Error: agg.p90Error,
    meanErrorX: agg.meanErrorX,
    meanErrorY: agg.meanErrorY,
    biasX: agg.biasX,
    biasY: agg.biasY,
    maxError: agg.maxError,
    errorPct: agg.errorPct,
    meanErrorDeg,
    jitterRMS,
    precisionSdX,
    precisionSdY,
    precisionS2S,
    precisionDeg,
    jitterFilteredRMS,
    meanErrorInner: agg.meanErrorInner,
    meanErrorEdge: agg.meanErrorEdge,
    score,
    colorClass,
    pointErrors,
    pointJitters: diagnostics.map(d => d.jitterRMS),
    pontosMedidos: agg.pontosMedidos,
    pontosNaoMedidos: agg.pontosNaoMedidos,
    nInterior: agg.nInterior,
    nEdge: agg.nEdge,
    sampleMeanError: agg.sampleMeanError,
    sampleMedianError: agg.sampleMedianError,
    sampleP90Error: agg.sampleP90Error,
    hitRateByRadius: agg.hitRateByRadius,
    sampleRateHz,
    bceaPx2,
    bceaDeg2,
    fracaoDeAmostrasValidas,
    pontosComPoucaAmostra,
    alvoMinimoPx,
    alvoMinimoDeg,
    distanciaMedidaCm,
    poseDrift,
    poseDeltaCalibToTestDeg,
    affine,
    validationOverlap: validationOverlap && validationOverlap.length > 0 ? validationOverlap : undefined,
  };

  try {
    localStorage.setItem('accuracyResult', JSON.stringify({
      meanError, medianError: agg.medianError, p90Error: agg.p90Error, maxError: agg.maxError,
      meanErrorDeg, jitterRMS, score, colorClass, timestamp: Date.now(),
    }));
  } catch { /* storage indisponível */ }

  const pipeline = {
    variant: `${ACTIVE_FEATURE_SET}+${REGRESSOR_MODE}`,
    featureSet: ACTIVE_FEATURE_SET,
    l2csDims: l2csSlotsInSet().length,
    regressor: REGRESSOR_MODE,
    // O snapshot completo das flags: sem ele, um relatório em 224² é
    // indistinguível de um em 448², e `set()` só vale depois do reload.
    experiment: experimentSnapshot(),
    runtime: runtime ?? null,
  };

  const jsonReport = JSON.stringify({
    schema: 'irisflow.accuracy-report/2',
    // Quando presente, o teste não chegou ao fim: o relatório é parcial.
    abortado: motivoDeAborto ?? null,
    protocolo: {
      // Minutos entre o fim do treino e o fim deste teste. É o eixo em que a
      // deriva aparece, e é medido — não digitado.
      minutosDesdeCalibracao: (() => {
        const t = getCalibrationTimestampMs();
        return t === null ? null : Math.round((Date.now() - t) / 60_000);
      })(),
      pontos: diagnostics.length,
      coletaMs: COLLECTION_MS,
      acomodacaoMs: ACCLIMATION_MS,
      janelaUtilMs: COLLECTION_MS - ACCLIMATION_MS,
      fracaoMinimaDeAmostras: MIN_VALID_SAMPLE_RATIO,
      ordem: 'sorteada',
      sementeDaOrdem,
    },
    timestamp: new Date().toISOString(),
    resolution: `${vw}x${vh}`,
    meta: meta ?? null,
    pipeline,
    result,
    diagnostics,
    distanceRange: (() => {
      const r = getDistanceRange();
      const cal = getCalibrationDistancesCm();
      if (!r) return null;
      return {
        status: r.status,
        deltaCm: r.deltaCm,
        ratioAplicado: r.ratio,
        distanciaCalibracaoCameraCm: cal.cameraCm,
        distanciaCalibracaoTelaCm: cal.screenCm,
        distanciaTelaNoTesteCm: r.screenDistanceNowCm,
        dentroDaFaixa: r.status === 'ok',
      };
    })(),
    calibrationFit: fit ?? null,
    geometry: {
      assumed: geometryAssumed,
      source: meta?.screenGeometrySource ?? 'default',
      distPx,
      pxPorCm: pxPorCm || undefined,
      screenScaleFactor: meta?.screenScaleFactor ?? undefined,
      viewportPx: `${vw}x${vh}`,
      screenPx: typeof window !== 'undefined' && window.screen
        ? `${window.screen.width}x${window.screen.height}`
        : undefined,
    },
  }, null, 2);

  // Grava na raiz do projeto pelo endpoint do Vite (dev e preview); sem ele,
  // cai no download do navegador. Os relatórios acumulam — nunca são apagados.
  (async () => {
    try {
      const resp = await fetch('/__/save-accuracy-report', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: jsonReport,
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const data = await resp.json() as { saved?: string; error?: string };
      if (data.error) throw new Error(data.error);
      console.log(`[accuracy] Relatório salvo no projeto: ${data.saved}`);
    } catch (e) {
      console.warn('[accuracy] Endpoint de save indisponível — usando download do navegador', e);
      const blob = new Blob([jsonReport], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `accuracy-report-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  })();

  const px = (v: number | null) => (v === null ? '—' : `${Math.round(v)}px`);
  const deg = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)}°`);
  console.log(`[accuracy] === RESULTADO ===`);
  console.log(
    `[accuracy] acurácia: média=${px(meanError)} (${deg(meanErrorDeg)}) mediana=${px(agg.medianError)} ` +
    `p90=${px(agg.p90Error)} borda=${px(agg.meanErrorEdge)} viés=(${px(agg.biasX)}, ${px(agg.biasY)}) | ` +
    `precisão: jitter=${px(jitterRMS)} (${deg(precisionDeg)}) s2s=${px(precisionS2S)} filtrado=${px(jitterFilteredRMS)} | ` +
    `${score} (${agg.pontosMedidos} medidos, ${agg.pontosNaoMedidos} sem amostra, ${sampleRateHz?.toFixed(1) ?? '—'} Hz)`,
  );
  console.log(
    `[accuracy] qualidade: BCEA68=${bceaDeg2 === null ? '—' : `${bceaDeg2.toFixed(2)}°²`} | ` +
    `amostras válidas=${fracaoDeAmostrasValidas === null ? '—' : `${(fracaoDeAmostrasValidas * 100).toFixed(0)}%`}` +
    `${pontosComPoucaAmostra.length > 0 ? ` (abaixo do mínimo: ${pontosComPoucaAmostra.join(', ')})` : ''} | ` +
    `alvo mínimo=${alvoMinimoPx === null ? '—' : `${Math.round(alvoMinimoPx)}px`}` +
    `${alvoMinimoDeg === null ? '' : ` (${alvoMinimoDeg.toFixed(1)}°)`} | ` +
    `distância medida=${distanciaMedidaCm === null ? '—' : `${distanciaMedidaCm.mediana.toFixed(0)} cm (${distanciaMedidaCm.min.toFixed(0)}–${distanciaMedidaCm.max.toFixed(0)})`}`,
  );
  for (const d of diagnostics) {
    const medido = Number.isFinite(d.error);
    console.log(
      `[accuracy]   ${d.name.padEnd(3)}: ` +
      (medido
        ? `err=${Math.round(d.error)}px (${d.errorDeg.toFixed(2)}°) viés=(${Math.round(d.biasX)}, ${Math.round(d.biasY)}) jitter=${d.jitterRMS.toFixed(1)}px n=${d.nSamples}`
        : `NÃO MEDIDO (${d.nSamples} amostra(s))`),
    );
  }
  console.log(`[accuracy] === FIM ===`);

  showDiagnosticOverlay(diagnostics, result, onComplete, motivoDeAborto);
}

function showDiagnosticOverlay(
  diagnostics: PointDiagnostic[],
  result: AccuracyResult,
  onComplete?: (result: AccuracyResult, action: 'continue' | 'redo') => void,
  motivoDeAborto?: string,
) {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  const overlay = document.createElement('div');
  overlay.id = 'diagnostic-overlay';
  overlay.className = 'diagnostic-overlay';

  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(svgNS, 'svg');
  svg.setAttribute('width', String(vw));
  svg.setAttribute('height', String(vh));
  svg.setAttribute('viewBox', `0 0 ${vw} ${vh}`);
  svg.classList.add('diagnostic-svg');

  for (const d of diagnostics) {
    const medido = typeof d.predX === 'number' && typeof d.predY === 'number';

    const alvo = document.createElementNS(svgNS, 'circle');
    alvo.setAttribute('cx', String(d.groundX));
    alvo.setAttribute('cy', String(d.groundY));
    alvo.setAttribute('r', '7');
    alvo.setAttribute('fill', medido ? '#ef4444' : 'rgba(255,255,255,0.25)');
    alvo.setAttribute('stroke', '#fff');
    alvo.setAttribute('stroke-width', '1.5');
    svg.appendChild(alvo);

    if (medido) {
      const line = document.createElementNS(svgNS, 'line');
      line.setAttribute('x1', String(d.groundX));
      line.setAttribute('y1', String(d.groundY));
      line.setAttribute('x2', String(d.predX));
      line.setAttribute('y2', String(d.predY));
      line.setAttribute('stroke', getErrorColor(d.error));
      line.setAttribute('stroke-width', '2');
      line.setAttribute('stroke-opacity', '0.8');
      svg.appendChild(line);

      const pred = document.createElementNS(svgNS, 'circle');
      pred.setAttribute('cx', String(d.predX));
      pred.setAttribute('cy', String(d.predY));
      pred.setAttribute('r', '7');
      pred.setAttribute('fill', '#22c55e');
      pred.setAttribute('stroke', '#fff');
      pred.setAttribute('stroke-width', '1.5');
      svg.appendChild(pred);
    }

    const labelX = d.groundX + 14;
    const labelY = d.groundY - 14;
    const labelText = medido ? `${Math.round(d.error)}px` : 'sem amostra';
    const labelBg = document.createElementNS(svgNS, 'rect');
    labelBg.setAttribute('x', String(labelX - 2));
    labelBg.setAttribute('y', String(labelY - 13));
    labelBg.setAttribute('width', String(labelText.length * 7 + 8));
    labelBg.setAttribute('height', '18');
    labelBg.setAttribute('rx', '4');
    labelBg.setAttribute('fill', 'rgba(0,0,0,0.7)');
    svg.appendChild(labelBg);

    const text = document.createElementNS(svgNS, 'text');
    text.setAttribute('x', String(labelX + 2));
    text.setAttribute('y', String(labelY));
    text.setAttribute('fill', medido ? getErrorColor(d.error) : '#cbd5e1');
    text.setAttribute('font-size', '12');
    text.setAttribute('font-family', 'system-ui, sans-serif');
    text.setAttribute('font-weight', '600');
    text.textContent = labelText;
    svg.appendChild(text);

    const nameText = document.createElementNS(svgNS, 'text');
    nameText.setAttribute('x', String(d.groundX));
    nameText.setAttribute('y', String(d.groundY + 22));
    nameText.setAttribute('fill', 'rgba(255,255,255,0.5)');
    nameText.setAttribute('font-size', '10');
    nameText.setAttribute('font-family', 'system-ui, sans-serif');
    nameText.setAttribute('text-anchor', 'middle');
    nameText.textContent = d.name;
    svg.appendChild(nameText);
  }

  overlay.appendChild(svg);

  const footer = document.createElement('div');
  footer.className = 'diagnostic-footer';

  const scoreColor = result.colorClass === 'accuracy-excellent' ? '#22c55e'
    : result.colorClass === 'accuracy-good' ? '#38bdf8'
      : result.colorClass === 'accuracy-regular' ? '#fbbf24'
        : '#ef4444';

  const fit = getCalibrationFitDiagnostics();
  const gd = fit?.gridDiagnosis;
  const avisos: string[] = [];
  if (gd?.mensagem) avisos.push(gd.mensagem);
  if (fit && fit.targetsSkipped.length > 0) {
    avisos.push(
      `${fit.targetsSkipped.length} alvo(s) da calibração ficaram de fora do treino. ` +
      'Nessa região o modelo está extrapolando — vale recalibrar com todos os pontos.',
    );
  }
  if (result.poseDeltaCalibToTestDeg) {
    const p = result.poseDeltaCalibToTestDeg;
    if (Math.abs(p.yaw) > 2 || Math.abs(p.pitch) > 2) {
      avisos.push(
        `A cabeça está ${Math.max(Math.abs(p.yaw), Math.abs(p.pitch)).toFixed(1)}° fora da postura da calibração. ` +
        'Um viés uniforme neste teste vem daí.',
      );
    }
  }
  if (motivoDeAborto) {
    avisos.unshift(
      `O teste foi interrompido: ${motivoDeAborto}. As medidas abaixo cobrem só os pontos ` +
      'que deram tempo de medir — não use este relatório como resultado da sessão.',
    );
  }
  const avisosHtml = avisos.length > 0
    ? `<div class="diagnostic-advice">
         <strong>O que explica o resultado</strong>
         ${avisos.map((a) => `<p>${a}</p>`).join('')}
       </div>`
    : '';

  const hit150 = result.hitRateByRadius.find(r => r.radiusPx === 150)?.pct;
  const degTxt = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)}°`);

  footer.innerHTML = `
    <div class="diagnostic-card">
      <div class="diagnostic-title">Teste de Precisão</div>

      <div class="diagnostic-legend">
        <span class="legend-item"><span class="legend-dot" style="background:#ef4444"></span>Alvo</span>
        <span class="legend-item"><span class="legend-dot" style="background:#22c55e"></span>Onde o sistema achou que você olhou</span>
      </div>

      <div class="diagnostic-metrics">
        <div class="metric-item">
          <div class="metric-value" style="color:${scoreColor}">${mostrarPx(result.meanErrorInner)}</div>
          <div class="metric-label">Erro médio · ${degTxt(result.meanErrorDeg)}</div>
        </div>
        <div class="metric-divider"></div>
        <div class="metric-item">
          <div class="metric-value" style="color:${scoreColor}">${mostrarPx(result.meanErrorEdge)}</div>
          <div class="metric-label">Erro na borda</div>
        </div>
        <div class="metric-divider"></div>
        <div class="metric-item">
          <div class="metric-value">${mostrarPx(result.jitterRMS)}</div>
          <div class="metric-label">Precisão (tremor) · ${degTxt(result.precisionDeg)}</div>
        </div>
        <div class="metric-divider"></div>
        <div class="metric-item">
          <div class="metric-value" style="color:${scoreColor}">${result.score}</div>
          <div class="metric-label">Classificação</div>
        </div>
      </div>

      <div class="diagnostic-hitrate">
        Acerto em alvo de 150 px: <strong style="color:${scoreColor}">${hit150 === null || hit150 === undefined ? 'não medido' : `${hit150.toFixed(0)}%`}</strong>
      </div>

      <div class="diagnostic-hitrate">
        Alvo mínimo recomendado para este usuário:
        <strong style="color:${scoreColor}">${result.alvoMinimoPx === null ? 'não medido' : `${Math.round(result.alvoMinimoPx)} px`}</strong>${result.alvoMinimoDeg === null ? '' : ` (${result.alvoMinimoDeg.toFixed(1)}°)`}
        · amostras válidas <strong>${result.fracaoDeAmostrasValidas === null ? '—' : `${(result.fracaoDeAmostrasValidas * 100).toFixed(0)}%`}</strong>
        · distância <strong>${result.distanciaMedidaCm === null ? '—' : `${result.distanciaMedidaCm.mediana.toFixed(0)} cm`}</strong>
      </div>

      ${avisosHtml}

      <div class="diagnostic-point-grid">
        ${diagnostics.map(d => {
          const medido = Number.isFinite(d.error);
          const cls = !medido ? 'diag-none' : d.error < 60 ? 'diag-ok' : d.error < 120 ? 'diag-warn' : 'diag-bad';
          return `<div class="diag-point-card ${cls}">
            <div class="diag-point-name">${d.name}</div>
            <div class="diag-point-error">${medido ? `${Math.round(d.error)}px` : '—'}</div>
          </div>`;
        }).join('')}
      </div>

      <div class="diagnostic-actions">
        <button type="button" class="diagnostic-btn" data-action="continue">Continuar <kbd>Espaço</kbd></button>
        <button type="button" class="diagnostic-btn secondary" data-action="redo">Recalibrar <kbd>R</kbd></button>
      </div>
    </div>
  `;
  overlay.appendChild(footer);
  document.body.appendChild(overlay);
  requestAnimationFrame(() => overlay.classList.add('visible'));

  let encerrado = false;
  function encerrar(action: 'continue' | 'redo') {
    if (encerrado) return;
    encerrado = true;
    document.removeEventListener('keydown', handleKey);
    overlay.classList.remove('visible');
    setTimeout(() => {
      overlay.remove();
      onComplete?.(result, action);
    }, action === 'continue' ? 300 : 0);
  }

  function handleKey(e: KeyboardEvent) {
    if (e.code === 'Space') {
      e.preventDefault();
      encerrar('continue');
    } else if (e.code === 'KeyR') {
      e.preventDefault();
      encerrar('redo');
    }
  }

  footer.querySelectorAll<HTMLButtonElement>('.diagnostic-btn').forEach((b) => {
    b.addEventListener('click', () => encerrar(b.dataset.action === 'redo' ? 'redo' : 'continue'));
  });
  document.addEventListener('keydown', handleKey);
}

function getErrorColor(error: number): string {
  if (error < 50) return '#22c55e';
  if (error < 100) return '#fbbf24';
  return '#ef4444';
}

/** Conjuntos de pontos expostos para os testes. Não é API de produção. */
export const __testingPoints = {
  VALIDATION_POINTS: VALIDATION_POINTS.map((p) => ({ ...p, isEdge: false })),
  ALL_VALIDATION_POINTS,
};
