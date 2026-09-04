// Teste de validação pós-calibração com Diagnóstico Visual por Ponto
//
// Após coletar dados de 9 pontos de validação, exibe um overlay fullscreen com:
//   • Ponto vermelho = posição real (ground truth)
//   • Ponto verde   = posição predita pelo modelo
//   • Linha conectando cada par
//   • Erro em pixels ao lado de cada par
//   • Resumo de métricas + controles (Espaço para continuar, R para recalibrar)

import {
  mapGaze, setGazeCorrections, resetSessionBias, getCalibrationTargets,
  getCalibrationFitDiagnostics, getDistanceRange, getCalibrationDistancesCm,
} from './calibration';
import { REGRESSOR_MODE } from './gazeRegressor';
import { EXPERIMENT, experimentSnapshot } from './config/experiment';
import { ACCLIMATION_MS, COLLECTION_MS } from './accuracyProtocol';
import { ACTIVE_FEATURE_SET, l2csSlotsInSet } from './extractor';

export interface AccuracyResult {
  // ---------------------------------------------------------------------------
  // B3.6/B3.7 — POLÍTICA ÚNICA de ausência: `null` significa "não há pontos
  // medidos para esta métrica". Nunca `NaN`, nunca `0` fabricado.
  //
  // Antes havia TRÊS políticas discordando no mesmo JSON: `meanError` filtrava
  // por `isFinite` (ignorava o ponto), `meanErrorX` fazia `(a/b) || 0` e
  // reportava **0**, e `maxError` reportava **NaN**. Quem lia o relatório via
  // três respostas diferentes para o mesmo evento.
  //
  // B3.7 — cada métrica declara sua POPULAÇÃO em `nInterior`/`nEdge`. Antes,
  // `meanError` usava os 9 interiores enquanto `meanErrorX/Y`, `maxError` e o
  // ajuste afim usavam os 13, e `explainedFraction = 1 − residual₁₃/meanError₉`
  // comparava conjuntos diferentes.
  // ---------------------------------------------------------------------------
  meanError: number | null;      // Erro médio em pixels (pontos INTERIORES)
  medianError: number | null;    // Erro mediano em pixels
  p90Error: number | null;       // Erro P90 em pixels
  meanErrorX: number | null;     // Erro médio no eixo X (mesma população de meanError)
  meanErrorY: number | null;     // Erro médio no eixo Y (idem)
  maxError: number | null;       // Pior erro em pixels (todos os pontos medidos)
  errorPct: number | null;       // Erro médio como % da diagonal da tela
  meanErrorDeg: number | null;   // Erro médio em graus angulares
  jitterRMS: number;      // RMS da dispersão de predições em torno da própria média por ponto (px)
  /** 0.3 — média dos 9 pontos INTERIORES (25/50/75). Igual a `meanError`;
   *  existe com nome próprio para o leitor não precisar saber que `meanError`
   *  exclui a borda. */
  meanErrorInner: number | null;
  /** 0.3 — média dos 4 cantos a 5%/95%, onde a predição EXTRAPOLA a grade de
   *  calibração em X. É a região que a grade 25/50/75 nunca mediu e onde a UI
   *  de fato posiciona botões. `null` se nenhum ponto de borda foi coletado. */
  meanErrorEdge: number | null;
  score: string;          // Rótulo qualitativo
  colorClass: string;     // Classe CSS para colorir o painel
  pointErrors: number[];  // Erro por ponto de validação
  pointJitters: number[]; // Jitter RMS por ponto (px)
  /** Quantos pontos de validação coletaram amostra, e quantos não (B3.6). */
  pontosMedidos: number;
  pontosNaoMedidos: number;
  /** Tamanho de cada população (B3.7). */
  nInterior: number;
  nEdge: number;
  /** Erro por AMOSTRA (não por média do ponto). É o que o dwell sente. */
  sampleMeanError: number | null;
  sampleMedianError: number | null;
  sampleP90Error: number | null;   // p90 real, sobre todas as amostras
  /** % de amostras dentro de um alvo de raio R centrado no ponto.
   *  Preditor direto da taxa de sucesso do dwell. */
  hitRateByRadius: { radiusPx: number; pct: number | null }[];
  /** Decomposição afim do erro. Ajusta, por mínimos quadrados sobre os pares
   *  (ground-truth → predito) em coordenadas NORMALIZADAS:
   *
   *      predX = gainX·gx + crossXY·gy + offsetX
   *      predY = shearYX·gx + gainY·gy + offsetY
   *
   *  e reporta quanto do erro sobra depois de remover esse mapa afim
   *  (`residualPx`). Separa as duas famílias de causa:
   *
   *   • `residualPx` << `meanError` → o sinal de olhar está bom e o que está
   *     errado é o MAPEAMENTO (ganho/offset/cisalhamento). Causa típica:
   *     amplitude de olhar na calibração diferente da nominal, deriva de pose
   *     entre calibração e teste, ou geometria de tela divergente.
   *   • `residualPx` ≈ `meanError` → o erro é incoerente: ruído do regressor,
   *     ponto de calibração contaminado, landmarks instáveis.
   *
   *  Puramente informativo — NÃO entra em `meanError`, `score` nem em nenhuma
   *  métrica exibida como resultado. Undefined com menos de 4 pontos válidos
   *  (o ajuste afim tem 3 parâmetros por eixo). */
  affine?: {
    gainX: number;
    gainY: number;
    crossXY: number;
    shearYX: number;
    offsetXPx: number;
    offsetYPx: number;
    /** Erro médio remanescente após remover o mapa afim (px). */
    residualPx: number;
    /** Fração do erro médio explicada pelo mapa afim, em [0,1]. */
    explainedFraction: number;
  };
  /** Pontos de validação que coincidiram com alvos de calibração. Quando
   *  presente, o erro reportado nesses pontos mede memorização e o resultado
   *  global fica otimista. Ausente no caminho normal. Só registro — nenhuma
   *  métrica é ajustada por causa disto. */
  validationOverlap?: { validationPoint: string; calibX: number; calibY: number }[];
  /** Deriva de pose entre início do teste e ponto de maior desvio. Assinatura
   *  do bug "cursor com viés grande": shift uniforme nos 9 pontos que
   *  correlaciona com cabeça inclinando alguns graus entre calibração e teste.
   *  Delta em radianos. Todos zerados se a pose não estava disponível. */
  poseDrift?: {
    baseline: { yaw: number; pitch: number; roll: number };
    maxDelta: { yaw: number; pitch: number; roll: number };
    // Delta médio da pose durante o teste (média dos deltas por ponto).
    meanDelta: { yaw: number; pitch: number; roll: number };
  };
}

// Metadata sobre a condição em que o teste foi rodado. Preenchida pela UI
// (SettingsScreen) e escrita junto ao AccuracyResult no relatório JSON, para
// tornar o histórico de medições em `docs/BASELINE.md` rastreável.
export interface RunMeta {
  data: string;               // ISO date (yyyy-mm-dd) ou timestamp livre
  iluminacao: 'boa' | 'ruim'; // Iluminação ambiente
  oculos: boolean;            // Uso de óculos
  movimentoCabeca: 'parada' | 'livre';
  minutosDeSessao: number;    // 0, 20, 40 para curva de deriva
  usuario?: string;           // Identificador opcional do participante
  observacoes?: string;
  /** Distância olho→tela em cm, usada para converter px em graus. */
  distanciaCm: number;
  /** Diagonal física do monitor em polegadas. */
  telaPolegadas: number;
  /**
   * De ONDE veio `telaPolegadas` (B2.10).
   *
   * `'default'` significa o hardcode de 23,6″ — um número que ninguém
   * verificou. `'auto'` é EDID; `'manual'` é o cuidador tendo medido e
   * digitado.
   *
   * Sem este campo, o relatório não tinha como distinguir "medi 23,6″" de
   * "assumi 23,6″", e reportava `assumed: false` nos dois casos. O erro
   * angular é calculado sobre essa diagonal — `displayGeometry.ts` documenta
   * que errá-la vale 34% de erro angular.
   *
   * Opcional para relatórios antigos; ausente é tratado como `'default'`.
   */
  screenGeometrySource?: ScreenGeometrySource | null;
  /** Fator de escala do SO (1 = 100%, 1.5 = 150%). Documental. */
  screenScaleFactor?: number | null;
}

/** Origem da diagonal física da tela (B2.10). Espelha o campo homônimo em
 *  `SettingsContext`. */
export type ScreenGeometrySource = 'default' | 'auto' | 'manual';

/**
 * Converte fração de tela em pixels (B3.32).
 *
 * Fonte ÚNICA para posicionar alvos e para calcular o ground-truth.
 *
 * O bug: o alvo era desenhado com `left: ${x*100}vw` — e `vw` **inclui a barra
 * de rolagem** — enquanto o ground-truth vinha de
 * `x * document.documentElement.clientWidth`, que a **exclui**. Com scrollbar
 * clássica de 15 px, até ~15 px de erro sistemático entravam direto no
 * relatório de precisão E nos coeficientes do Ridge, porque o modelo era
 * treinado contra um alvo que não estava onde o código pensava.
 *
 * (O plano marca o item como suspeita quanto à magnitude: em kiosk/fullscreen
 * sem scrollbar o efeito é nulo. Ter uma fonte única elimina a classe de erro
 * independentemente disso.)
 */
export function fracaoDaTelaParaPx(fracao: number, larguraPx: number): number {
  return fracao * larguraPx;
}

/**
 * Métricas agregadas de erro, com POLÍTICA ÚNICA de ausência (B3.6/B3.7).
 *
 * `null` significa "não há pontos medidos para esta métrica" — nunca `NaN`,
 * nunca `0` fabricado.
 */
export interface ErrosAgregados {
  /** Média sobre os pontos INTERIORES medidos. */
  meanErrorInner: number | null;
  /** Média sobre os pontos de BORDA medidos. */
  meanErrorEdge: number | null;
  /** Métrica histórica: igual a `meanErrorInner`. Mantida com este nome porque
   *  é a única com série temporal, e mudar sua população tornaria todo
   *  relatório anterior incomparável sem nada no arquivo indicando a mudança. */
  meanError: number | null;
  medianError: number | null;
  p90Error: number | null;
  /** Erro em X/Y sobre a MESMA população de `meanError` (interiores). Antes
   *  usavam os 13 pontos enquanto `meanError` usava 9 — populações diferentes
   *  no mesmo relatório (B3.7). */
  meanErrorX: number | null;
  meanErrorY: number | null;
  sampleMeanError: number | null;
  sampleMedianError: number | null;
  sampleP90Error: number | null;
  hitRateByRadius: { radiusPx: number; pct: number | null }[];
  maxError: number | null;
  errorPct: number | null;
  /** Quantos pontos de fato coletaram amostra. */
  pontosMedidos: number;
  /** Quantos pontos não coletaram amostra alguma (B3.6). */
  pontosNaoMedidos: number;
  /** Tamanho de cada população, para o leitor do JSON saber sobre quantos
   *  pontos cada número foi calculado (B3.7). */
  nInterior: number;
  nEdge: number;
}

/** Entrada mínima que `agregarErros` consome. */
export interface PontoAgregavel {
  isEdge?: boolean;
  error?: number;
  errorX?: number;
  errorY?: number;
  samplesError?: number[];
}

const HIT_RADII = [60, 100, 150, 200];

/** Formata uma métrica que pode não ter sido medida (B3.6). "—" é a resposta
 *  honesta; "0px" ou "NaNpx" na tela do cuidador, não. */
function mostrarPx(v: number | null): string {
  return v === null ? '—' : `${Math.round(v)}px`;
}

/**
 * Agrega os erros por ponto num conjunto de métricas.
 *
 * Pura e total. Toda a política de ausência mora aqui — antes de B3.6 havia
 * TRÊS políticas discordando dentro do mesmo relatório: `meanError` filtrava
 * por `isFinite`, `meanErrorX` fazia `(a/b) || 0` e reportava **0**, e
 * `maxError` reportava **NaN**. Três números no mesmo JSON dizendo coisas
 * diferentes sobre o mesmo evento.
 */
export function agregarErros(
  pontos: readonly PontoAgregavel[],
  vw: number,
  vh: number,
): ErrosAgregados {
  const medido = (p: PontoAgregavel) => typeof p.error === 'number' && Number.isFinite(p.error);
  const medidos = pontos.filter(medido);
  const interiores = medidos.filter((p) => !p.isEdge);
  const bordas = medidos.filter((p) => p.isEdge);

  const media = (v: number[]): number | null =>
    v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : null;

  const errosInterior = interiores.map((p) => p.error as number);
  const errosBorda = bordas.map((p) => p.error as number);
  const errosTodos = medidos.map((p) => p.error as number);

  const ordenadosInterior = [...errosInterior].sort((a, b) => a - b);
  const meanErrorInner = media(errosInterior);

  // B3.7 — X e Y sobre a MESMA população de `meanError`. Usar os 13 pontos
  // aqui e os 9 lá fazia `explainedFraction = 1 − residual₁₃/meanError₉`
  // comparar populações diferentes, produzindo um número sem significado.
  const errosX = interiores
    .map((p) => p.errorX)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));
  const errosY = interiores
    .map((p) => p.errorY)
    .filter((v): v is number => typeof v === 'number' && Number.isFinite(v));

  const amostras = medidos.flatMap((p) => p.samplesError ?? []).filter(Number.isFinite);
  const nAmostras = amostras.length;
  const ordenadasAmostras = [...amostras].sort((a, b) => a - b);

  const diagonal = Math.hypot(vw, vh);

  return {
    meanErrorInner,
    meanErrorEdge: media(errosBorda),
    meanError: meanErrorInner,
    medianError:
      ordenadosInterior.length > 0
        ? ordenadosInterior[Math.floor(ordenadosInterior.length / 2)]
        : null,
    // Percentil linear-interpolado (convenção numpy 'linear'). Antes era
    // `sorted[floor(n*0.9)]`, que com n=9 dá `sorted[8]` — o p90 era
    // LITERALMENTE o máximo, e o relatório publicava dois nomes para o mesmo
    // número.
    p90Error: ordenadosInterior.length > 0 ? percentileLinear(ordenadosInterior, 0.9) : null,
    meanErrorX: media(errosX),
    meanErrorY: media(errosY),
    sampleMeanError: media(amostras),
    sampleMedianError: nAmostras > 0 ? ordenadasAmostras[Math.floor(nAmostras / 2)] : null,
    sampleP90Error:
      nAmostras > 0
        ? ordenadasAmostras[Math.min(nAmostras - 1, Math.ceil(nAmostras * 0.9) - 1)]
        : null,
    // `null`, não `0` — a única violação que restava da política declarada no
    // cabeçalho deste arquivo ("nunca `0` fabricado").
    //
    // E aqui o zero é especialmente perigoso: 0% de acerto é um resultado
    // catastrófico perfeitamente plausível. Um teste em que NADA foi medido
    // (rosto perdido a sessão inteira, por exemplo) saía indistinguível de um
    // teste em que o rastreamento errou todos os alvos — e a UI imprimia
    // "Taxa de acerto em alvo de 150 px: 0%" para o cuidador ler.
    hitRateByRadius: HIT_RADII.map((r) => ({
      radiusPx: r,
      pct: nAmostras > 0 ? (amostras.filter((e) => e <= r).length / nAmostras) * 100 : null,
    })),
    // B3.6 — `Math.max(...pointErrors)` sobre um array com NaN devolve NaN.
    // Agora só entram pontos medidos, e sem nenhum a resposta é `null`.
    maxError: errosTodos.length > 0 ? Math.max(...errosTodos) : null,
    errorPct:
      meanErrorInner !== null && diagonal > 0 ? (meanErrorInner / diagonal) * 100 : null,
    pontosMedidos: medidos.length,
    pontosNaoMedidos: pontos.length - medidos.length,
    nInterior: interiores.length,
    nEdge: bordas.length,
  };
}

/**
 * A geometria da tela foi MEDIDA, ou apenas assumida? (B2.10)
 *
 * Só `'auto'` (EDID) e `'manual'` (fita métrica do cuidador) contam como
 * medição. `'default'` é o hardcode de 23,6″.
 *
 * Ausente ou desconhecido conta como **assumida**: na dúvida, a resposta
 * honesta é a que não afirma uma medição inexistente. O bug tinha o default
 * invertido — bastava o número existir para ele se declarar medido.
 */
export function geometriaFoiMedida(source: ScreenGeometrySource | null | undefined): boolean {
  return source === 'auto' || source === 'manual';
}

interface PointDiagnostic {
  /** 0.3 — ponto do anel de borda (extrapolação) vs grade interior. */
  isEdge?: boolean;
  groundX: number;
  groundY: number;
  /**
   * Média das predições neste ponto — `undefined` quando o ponto **não
   * coletou amostra alguma** (B3.6).
   *
   * Antes era inicializado com `targetScreenX`/`targetScreenY`, ou seja, no
   * PRÓPRIO ALVO. Um ponto sem amostra entrava no relatório com `error: NaN`
   * mas `predX === groundX` — um acerto exato para o ajuste afim, puxando a
   * decomposição para a identidade e inflando `explainedFraction`.
   */
  predX?: number;
  predY?: number;
  /** `NaN`/ausente quando o ponto não foi medido. Ver `agregarErros` para a
   *  política única de tratamento. */
  error: number;
  errorX: number;
  errorY: number;
  jitterRMS: number;
  name: string;
  samplesError: number[];
  /** Pose média da cabeça durante a janela útil deste ponto (rad).
   *  Diff contra o baseline (capturado no início do teste) diz se a cabeça
   *  moveu — explicação mais comum para viés grande e uniforme. */
  meanPose?: { yaw: number; pitch: number; roll: number };
}

// Grade 3×3 de validação, fixa em 25/50/75. Disjunta da grade de calibração
// (o centro é a exceção, comum às duas por convenção): validar nas mesmas
// posições do treino mediria memorização, não generalização.
//
// A grade de calibração sai do orçamento de excentricidade
// (`computeCalibrationTargets`). Na tela de referência (23,6" a 60 cm) ela
// cai em ~17%/83% em X e 5%/95% em Y — 25/75 cabe dentro tanto de 17/83
// quanto de 5/95, então os DOIS eixos são interpolação. Como esta grade
// nunca mede a borda (onde a UI põe botões), existe o bloco `EDGE_POINTS`
// abaixo para completar o quadro.
//
// Estes 9 pontos NÃO acompanham a grade de calibração de propósito: uma
// métrica que se move junto com o protocolo não serve para comparar sessões
// ao longo do tempo. `meanError` continua sendo a média DESTES nove, pelo
// mesmo motivo.
//
// Se a geometria configurada colocar um alvo de calibração em cima de um
// destes pontos, o teste passaria a medir memorização e o número ficaria
// artificialmente bom. `checkValidationOverlap` detecta e avisa.
const VALIDATION_POINTS = [
  { name: "P1", screenX: 0.25, screenY: 0.25 },
  { name: "P2", screenX: 0.50, screenY: 0.25 },
  { name: "P3", screenX: 0.75, screenY: 0.25 },
  { name: "P4", screenX: 0.25, screenY: 0.50 },
  { name: "P5", screenX: 0.50, screenY: 0.50 },
  { name: "P6", screenX: 0.75, screenY: 0.50 },
  { name: "P7", screenX: 0.25, screenY: 0.75 },
  { name: "P8", screenX: 0.50, screenY: 0.75 },
  { name: "P9", screenX: 0.75, screenY: 0.75 },
];

/**
 * 0.3 — anel de borda, medido junto mas reportado separado.
 *
 * Quatro cantos a 5%/95%. Em X isso é EXTRAPOLAÇÃO de verdade (fora de 17/83);
 * em Y cai sobre o nível dos alvos de calibração, então mede interpolação em Y
 * e extrapolação em X — que é exatamente o regime das bordas laterais da UI.
 *
 * Só quatro pontos, e não os oito do anel completo: cada ponto custa 1,7 s
 * (1,4 s de coleta + 0,3 s de transição) e o usuário-alvo tem ELA. Nove pontos
 * levam ~15 s; treze levam ~22 s. Oito a mais levariam a ~29 s, e fadiga
 * degrada a própria medição que se está tentando fazer.
 *
 * Os cantos são o pior caso — se a borda vai falhar, falha aqui primeiro.
 */
const EDGE_POINTS = [
  { name: "B1", screenX: 0.05, screenY: 0.05 },
  { name: "B2", screenX: 0.95, screenY: 0.05 },
  { name: "B3", screenX: 0.05, screenY: 0.95 },
  { name: "B4", screenX: 0.95, screenY: 0.95 },
];

/** Ordem de apresentação: interior primeiro (comparabilidade histórica), borda
 *  depois. `isEdge` acompanha cada ponto para a agregação separar os dois. */
const ALL_VALIDATION_POINTS = [
  ...VALIDATION_POINTS.map((p) => ({ ...p, isEdge: false })),
  ...EDGE_POINTS.map((p) => ({ ...p, isEdge: true })),
];

// Distância estimada usuário–tela para conversão px → graus
// Assume 60 cm a 96 CSS DPI: 60 × 96 / 2.54 ≈ 2268 px
const ASSUMED_DIST_PX = 2268;

let currentFeaturesLeft: number[] = [];
let currentFeaturesRight: number[] = [];
// Pose da cabeça no frame atual (rad). Alimentado pelo engine a cada frame
// junto com as features. Usado pelo accuracy test para detectar deriva de
// pose entre calibração e teste — a assinatura mais comum de "cursor com
// viés grande" (2026-08-22: shift uniforme de +200 px em Y correlacionado
// com cabeça abaixando ~5°).
let currentPose: { yaw: number; pitch: number; roll: number } | undefined;
/** Incrementa a cada `feedAccuracyRaw`. Ver o comentário lá. */
let currentFrameSeq = 0;

// Flag para indicar que o teste de precisão está rodando
// Usada por main.ts para reduzir suavização durante o teste
export let isAccuracyTesting = false;

// Alvo do dot atualmente visível ao usuário. Setado por
// runNextPoint ao mostrar cada ponto e limpo entre pontos + no fim do
// teste. Consumido pelo gravador de sessão como ground-truth do frame.
let currentValidationTarget: { xPx: number; yPx: number; label: string } | null = null;

export function getCurrentTargetPx(): { xPx: number; yPx: number; label: string } | null {
  return currentValidationTarget;
}

// Recebe a posição crua do olhar a cada frame — chamado por main.ts / engine.ts
export function feedAccuracyRaw(
  featuresLeft: number[],
  featuresRight: number[],
  _perEyeWeight?: { left: number; right: number },
  pose?: { yaw: number; pitch: number; roll: number },
) {
  currentFeaturesLeft = featuresLeft;
  currentFeaturesRight = featuresRight;
  currentPose = pose;
  // 0.3 — sinaliza que chegou vetor NOVO.
  //
  // O laço de coleta roda em `requestAnimationFrame` (60 Hz num monitor comum,
  // 180 Hz no monitor de referência), mas o engine só produz features quando o
  // vídeo entrega quadro novo — 30 Hz. Sem este contador, o mesmo vetor era
  // amostrado 2 a 6 vezes seguidas.
  //
  // Isso não muda a média (o valor repetido não desloca o centro), mas DESTRÓI
  // o jitter: cópias idênticas têm variância zero entre si, então o `jitterRMS`
  // reportado era otimista por um fator de raiz de (taxa de rAF / 30).
  currentFrameSeq++;
}

// Inicia o teste de validação de precisão pós-calibração.
// `meta` é opcional: quando fornecido, é serializado junto do relatório JSON
// para que o histórico em BASELINE.md/RESULTADOS.md preserve a condição de teste.
// `onComplete` recebe o resultado + a intenção do usuário no overlay final:
//   - 'continue' → tecla Espaço (seguir para próximo fluxo)
//   - 'redo'     → tecla R (refazer calibração)
// Callers que ignorem o segundo argumento continuam funcionando (backward-compat).
export function startAccuracyTest(
  onComplete?: (result: AccuracyResult, action: 'continue' | 'redo') => void,
  meta?: RunMeta,
) {
  isAccuracyTesting = true;

  // Guarda de honestidade da métrica. Roda ANTES do teste para que o
  // aviso apareça no console junto do resto do diagnóstico da sessão.
  // B3.8 — a guarda cobre TODOS os pontos de validação, inclusive as bordas.
  //
  // Antes recebia só `VALIDATION_POINTS` (os 9 interiores). Os `EDGE_POINTS`
  // em 5%/95% nunca eram checados — e é justamente em Y que a grade de
  // calibração cai em 5%/95%, então `meanErrorEdge` podia estar medindo
  // memorização sem que nada denunciasse.
  const overlap = checkValidationOverlap(getCalibrationTargets(), ALL_VALIDATION_POINTS);
  if (overlap.length > 0) {
    console.warn(
      `[accuracy] ⚠ ${overlap.length} ponto(s) de validação coincidem com alvos de ` +
      `calibração (${overlap.map(o => o.validationPoint).join(', ')}). O erro nesses ` +
      `pontos mede MEMORIZAÇÃO, não generalização — o resultado global fica ` +
      `otimista. Causa: a geometria configurada posicionou a grade em cima da ` +
      `grade de validação. Ajuste a diagonal/distância em Configurações ou ` +
      `MAX_ECCENTRICITY_DEG.`,
    );
  }
  // O accuracy test mede o Ridge CRU. Se o bias EMA da sessão tiver
  // acumulado resíduos de dwells em botões arbitrários da UI (ex: dwell no
  // botão "Refazer teste" entre rodadas), medir com o bias aplicado enviesa o
  // relatório e não reflete a qualidade real do modelo. Reset defensivo aqui
  // faz o accuracy test ser sempre uma medida limpa do regressor, mesmo se
  // alguém religar a feature no futuro.
  resetSessionBias();
  const overlay = createAccuracyOverlay();
  let pointIndex = 0;
  const pointErrors: number[] = [];
  const diagnostics: PointDiagnostic[] = [];
  const runMeta: RunMeta | undefined = meta;

  // Baseline de pose. Capturado no primeiro frame com pose disponível dentro
  // dos 1.5s de preparação — represents a pose "no momento em que o teste
  // começa", que deveria ser ~igual à pose no momento da calibração.
  // Todos os deltas por ponto e o agregado poseDrift são relativos a ele.
  let poseBaseline: { yaw: number; pitch: number; roll: number } | null = null;

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  function runNextPoint() {
    if (pointIndex >= ALL_VALIDATION_POINTS.length) {
      isAccuracyTesting = false;
      currentValidationTarget = null;
      finishTest(overlay, pointErrors, diagnostics, onComplete, runMeta, poseBaseline, overlap);
      return;
    }

    const vp = ALL_VALIDATION_POINTS[pointIndex];
    showValidationDot(overlay, vp, pointIndex);

    const startTime = performance.now();
    const predictedX: number[] = [];
    const predictedY: number[] = [];
    // Samples de pose durante a janela útil (pós-acclimation) deste ponto,
    // agregados na média no fim para o PointDiagnostic.
    const poseSamplesYaw: number[] = [];
    const poseSamplesPitch: number[] = [];
    const poseSamplesRoll: number[] = [];

    const targetScreenX = vp.screenX * vw;
    const targetScreenY = vp.screenY * vh;

    // Publica alvo para o gravador. Mantido setado durante toda a
    // janela (inclusive os 400 ms de acomodação) porque o dot já está visível
    // ao usuário; qualquer frame gravado nesse intervalo tem ground-truth
    // legítimo desse ponto.
    currentValidationTarget = {
      xPx: targetScreenX, yPx: targetScreenY, label: vp.name,
    };

    // Última sequência já amostrada neste ponto. -1 força a primeira leitura.
    let lastSeenSeq = -1;

    function collect() {
      const elapsed = performance.now() - startTime;
      // 0.3 — um vetor, uma amostra. Ver `currentFrameSeq`.
      const frameNovo = currentFrameSeq !== lastSeenSeq;

      // Fixa o baseline de pose no primeiro frame válido do teste (ainda na
      // janela de acomodação está OK — o usuário acabou de calibrar e a pose
      // é considerada "de referência").
      if (!poseBaseline && currentPose) {
        poseBaseline = { ...currentPose };
      }

      // Só contabiliza amostras após a fase de acomodação — assim o jitter
      // reportado reflete a fixação, não a sacada de entrada no ponto.
      if (elapsed >= ACCLIMATION_MS && frameNovo) {
        lastSeenSeq = currentFrameSeq;
        if (currentPose) {
          poseSamplesYaw.push(currentPose.yaw);
          poseSamplesPitch.push(currentPose.pitch);
          poseSamplesRoll.push(currentPose.roll);
        }
        // Passamos `undefined` de propósito. O accuracy test mede a QUALIDADE
        // DO RIDGE (o modelo treinado), não a estratégia de fusão binocular.
        // Passar perEyeWeight ativa a heurística ponderada por EAR, que pode
        // degradar o número em usuários com EAR crônico assimétrico entre os
        // olhos — a calibração treina os dois regressors com peso igual, sem
        // saber que a inferência vai ponderar. Isolar a heurística aqui
        // devolve o comportamento medido pelo baseline sem óculos.
        // A fusão binocular segue ativa no cursor live (para semiptose/oclusão).
        const gaze = mapGaze(currentFeaturesLeft, currentFeaturesRight);
        if (gaze) {
          predictedX.push(gaze.x);
          predictedY.push(gaze.y);
        }
      }

      if (elapsed < COLLECTION_MS) {
        requestAnimationFrame(collect);
        return;
      }

      let error = NaN;
      let errorX = NaN;
      let errorY = NaN;
      let jitterRMS = NaN;
      let samplesError: number[] = [];
      // B3.6 — `undefined`, não o próprio alvo.
      //
      // A inicialização anterior era `meanPX = targetScreenX`. Um ponto que
      // não coletou amostra alguma (rosto perdido, `mapGaze` nulo o tempo
      // todo) entrava no relatório com `error: NaN` mas `predX === groundX` —
      // ou seja, como um ACERTO EXATO para o ajuste afim, puxando a
      // decomposição para a identidade e inflando `explainedFraction`.
      let meanPX: number | undefined;
      let meanPY: number | undefined;

      if (predictedX.length > 0) {
        meanPX = predictedX.reduce((s, v) => s + v, 0) / predictedX.length;
        meanPY = predictedY.reduce((s, v) => s + v, 0) / predictedY.length;
        
        errorX = Math.abs(meanPX - targetScreenX);
        errorY = Math.abs(meanPY - targetScreenY);
        error = Math.sqrt((meanPX - targetScreenX) ** 2 + (meanPY - targetScreenY) ** 2);

        // Jitter RMS = raiz da média das distâncias² de cada amostra à média do
        // ponto. Isola o ruído do filtro/regressor do erro de calibração:
        // um alvo pode ter bias alto mas jitter baixo (ou vice-versa).
        let sumSq = 0;
        for (let i = 0; i < predictedX.length; i++) {
          const jx = predictedX[i] - meanPX;
          const jy = predictedY[i] - meanPY;
          sumSq += jx * jx + jy * jy;
          
          const ex = predictedX[i] - targetScreenX;
          const ey = predictedY[i] - targetScreenY;
          samplesError.push(Math.sqrt(ex * ex + ey * ey));
        }
        jitterRMS = Math.sqrt(sumSq / predictedX.length);
      }

      pointErrors.push(error);
      const meanPose = poseSamplesYaw.length > 0 ? {
        yaw:   poseSamplesYaw.reduce((s, v) => s + v, 0) / poseSamplesYaw.length,
        pitch: poseSamplesPitch.reduce((s, v) => s + v, 0) / poseSamplesPitch.length,
        roll:  poseSamplesRoll.reduce((s, v) => s + v, 0) / poseSamplesRoll.length,
      } : undefined;
      diagnostics.push({
        isEdge: vp.isEdge,
        groundX: targetScreenX,
        groundY: targetScreenY,
        predX: meanPX,
        predY: meanPY,
        error,
        errorX,
        errorY,
        jitterRMS,
        name: vp.name,
        samplesError,
        meanPose,
      });

      pointIndex++;
      setTimeout(runNextPoint, 300);
    }

    requestAnimationFrame(collect);
  }

  // 1.5s de preparação antes do primeiro ponto — o usuário acabou de
  // sair da calibração (ou de clicar em Testar) e precisa estabilizar o
  // olhar. Sem essa janela, a sacada de entrada contamina P1 e infla o
  // erro global. Casado com o mesmo delay em CalibrationCheck.handleStart.
  setTimeout(runNextPoint, 1500);
}

function createAccuracyOverlay(): HTMLDivElement {
  const overlay = document.createElement("div");
  overlay.id = "accuracy-overlay";
  overlay.className = "accuracy-overlay";
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
  index: number
) {
  const old = document.getElementById("accuracy-dot");
  if (old) old.remove();

  const dot = document.createElement("div");
  dot.id = "accuracy-dot";
  dot.className = "accuracy-dot";
  dot.style.left = `${vp.screenX * 100}vw`;
  dot.style.top = `${vp.screenY * 100}vh`;
  dot.innerHTML = `<div class="dot-inner"></div>`;

  const instr = overlay.querySelector(".accuracy-instruction") as HTMLElement;
  if (instr) {
    instr.innerHTML = `Teste de Precisão &nbsp;<span class="highlight">${index + 1}/${ALL_VALIDATION_POINTS.length}</span> — olhe para o ponto`;
  }

  overlay.appendChild(dot);
}

// Dois pontos "iguais" para efeito de vazamento treino→teste. 2% de cada
// eixo em 1920×1080 são ~38 px em X e ~22 px em Y: bem abaixo do menor alvo
// interativo do app (5° ≈ 200 px), então se um alvo de calibração cai dentro
// disso de um ponto de validação, o teste está medindo memorização.
const OVERLAP_TOLERANCE = 0.02;

/**
 * Detecta alvos de calibração que caíram em cima de pontos de validação.
 *
 * A grade de calibração agora depende da geometria configurada
 * (`computeCalibrationTargets`), então uma combinação de tela/distância pode,
 * em princípio, posicionar um alvo praticamente sobre um dos 9 pontos de
 * validação. Se isso acontecer, o erro reportado naquele ponto mede treino,
 * não generalização, e o número global fica artificialmente bom.
 *
 * Puramente de detecção: não altera nenhuma métrica. Só avisa e registra no
 * JSON, para que ninguém compare um relatório contaminado com um limpo sem
 * saber.
 */
export function checkValidationOverlap(
  calibrationTargets: readonly { x: number; y: number }[],
  validationPoints: readonly { name: string; screenX: number; screenY: number }[],
  tolerance: number = OVERLAP_TOLERANCE,
): { validationPoint: string; calibX: number; calibY: number }[] {
  const hits: { validationPoint: string; calibX: number; calibY: number }[] = [];
  for (const v of validationPoints) {
    // O CENTRO da tela pertence às duas grades por convenção — a exceção
    // documentada no comentário de VALIDATION_POINTS. Consequência honesta:
    // o erro de P5 é erro de TREINO, não de generalização, e por isso o
    // agregado é levemente otimista (1 ponto em 9). Não é o vazamento que
    // este guarda procura — ele procura o caso NÃO intencional, em que a
    // geometria configurada move a grade para cima da validação.
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

/** Percentil com interpolação linear entre as ordens vizinhas (convenção
 *  'linear' do numpy). `sorted` precisa estar ordenado crescente. */
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

/**
 * Decomposição afim do erro de mapeamento.
 *
 * Ajusta por mínimos quadrados, em coordenadas normalizadas [0,1]:
 *     predX = a·gx + b·gy + c
 *     predY = d·gx + e·gy + f
 * Cada eixo é uma regressão de 3 parâmetros sobre os N pontos de validação.
 *
 * O objetivo NÃO é corrigir nada — é dizer, num número, se o erro é um mapa
 * coerente (ganho/offset/cisalhamento errados) ou ruído. Nenhuma métrica
 * exibida depende deste cálculo.
 */
export function affineErrorDecomposition(
  points: readonly { groundX: number; groundY: number; predX?: number; predY?: number }[],
  vw: number,
  vh: number,
  meanError: number | null,
): AccuracyResult['affine'] {
  // B3.6 — pontos sem predição são EXCLUÍDOS. Antes eles chegavam aqui com
  // `predX === groundX` (a inicialização no próprio alvo), o que os fazia
  // parecer acertos exatos e puxava o ajuste na direção da identidade —
  // inflando `explainedFraction` justamente quando havia menos dado.
  const usable = points.filter(
    (p): p is { groundX: number; groundY: number; predX: number; predY: number } =>
      typeof p.predX === 'number' && Number.isFinite(p.predX) &&
      typeof p.predY === 'number' && Number.isFinite(p.predY),
  );
  if (usable.length < 4 || !(vw > 0) || !(vh > 0)) return undefined;
  if (meanError === null || !(meanError > 0)) return undefined;

  const rows = usable.map(p => [p.groundX / vw, p.groundY / vh, 1]);

  // Normal equations 3×3 resolvidas por eliminação com pivotação parcial.
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
    explainedFraction: meanError > 0
      ? Math.max(0, Math.min(1, 1 - residualPx / meanError))
      : 0,
  };
}

function finishTest(
  overlay: HTMLDivElement,
  pointErrors: number[],
  diagnostics: PointDiagnostic[],
  onComplete?: (result: AccuracyResult, action: 'continue' | 'redo') => void,
  meta?: RunMeta,
  poseBaseline?: { yaw: number; pitch: number; roll: number } | null,
  validationOverlap?: { validationPoint: string; calibX: number; calibY: number }[],
) {
  overlay.remove();

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  // 0.3 — interior e borda agregados SEPARADAMENTE.
  //
  // `meanError` continua sendo a média dos NOVE pontos interiores, e só deles.
  // Não é para poupar o número: é que ele é a única métrica com histórico, e
  // mudar o conjunto de pontos que a compõe tornaria todo relatório anterior
  // incomparável sem que nada no arquivo indicasse a mudança.
  //
  // A borda entra como `meanErrorEdge`, e a UI mostra os dois — porque a média
  // interior sozinha subestima o uso real: `GazeGrid` põe botões em
  // x ∈ {1/6, 5/6}, fora do que a grade 25/50/75 alcança.
  const agg = agregarErros(diagnostics, vw, vh);
  const {
    meanErrorInner, meanErrorEdge, meanError, medianError, p90Error,
    meanErrorX, meanErrorY, sampleMeanError, sampleMedianError, sampleP90Error,
    hitRateByRadius, maxError, errorPct,
  } = agg;

  let distPx = ASSUMED_DIST_PX;
  let geometryAssumed = true;
  // Escala do display, quando o caller informou. Puramente
  // documental — ver o comentário no bloco `geometry` abaixo.
  const displayScaleFactor = meta?.screenScaleFactor ?? null;
  let pxPorCm = 0;

  if (meta && meta.distanciaCm && meta.telaPolegadas) {
    const diagPx = Math.hypot(vw, vh);
    pxPorCm = diagPx / (meta.telaPolegadas * 2.54);
    distPx = meta.distanciaCm * pxPorCm;
    // B2.10 — a geometria só deixa de ser "assumida" quando a diagonal veio do
    // EDID ou de uma medição do cuidador. Antes bastava o NÚMERO existir, e
    // como `telaPolegadas` é sempre `settings.screenDiagonalIn` (default
    // 23,6″), todo relatório se declarava medido. Com B2.11 no ar — o escape
    // quebrado que fazia o EDID nunca funcionar — isso significa que 100% dos
    // relatórios já emitidos afirmam ter medido um número chutado.
    geometryAssumed = !geometriaFoiMedida(meta.screenGeometrySource);
  }

  // B3.6 — sem erro médio não há erro angular. `null` em vez de NaN.
  const meanErrorDeg =
    meanError !== null ? (Math.atan(meanError / distPx) * 180) / Math.PI : null;

  const pointJitters = diagnostics.map(d => d.jitterRMS);
  const jitterRMS = pointJitters.length
    ? pointJitters.reduce((s, v) => s + v, 0) / pointJitters.length
    : 0;

  let score: string;
  let colorClass: string;
  if (meanError === null) {
    // B3.6 — nenhum ponto foi medido. Emitir "Ruim" seria um veredito sobre
    // uma medição que não aconteceu; o cuidador precisa saber que o teste
    // falhou, não que o paciente foi mal.
    score = "Não medido";
    colorClass = "accuracy-poor";
  } else if (meanError < 30) {
    score = "Excelente";
    colorClass = "accuracy-excellent";
  } else if (meanError < 60) {
    score = "Bom";
    colorClass = "accuracy-good";
  } else if (meanError < 100) {
    score = "Regular";
    colorClass = "accuracy-regular";
  } else {
    score = "Ruim";
    colorClass = "accuracy-poor";
  }

  // Deriva de pose: quanto a cabeça se afastou do baseline capturado no
  // início do teste. Se maxDelta.pitch > 0.05 rad (~3°), esse é o suspeito
  // número 1 para viés uniforme grande no relatório — o Ridge foi treinado
  // com uma pose e está sendo consultado com outra. Ver 2026-08-22, shift
  // de +200 px em Y correlacionou com cabeça abaixando ~5°.
  let poseDrift: AccuracyResult['poseDrift'] = undefined;
  if (poseBaseline) {
    const deltas = diagnostics
      .filter(d => d.meanPose)
      .map(d => ({
        yaw:   (d.meanPose!.yaw   - poseBaseline.yaw),
        pitch: (d.meanPose!.pitch - poseBaseline.pitch),
        roll:  (d.meanPose!.roll  - poseBaseline.roll),
      }));
    if (deltas.length > 0) {
      const absMax = (arr: number[]) => arr.reduce((m, v) => Math.abs(v) > Math.abs(m) ? v : m, 0);
      const mean = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;
      poseDrift = {
        baseline: poseBaseline,
        maxDelta: {
          yaw:   absMax(deltas.map(d => d.yaw)),
          pitch: absMax(deltas.map(d => d.pitch)),
          roll:  absMax(deltas.map(d => d.roll)),
        },
        meanDelta: {
          yaw:   mean(deltas.map(d => d.yaw)),
          pitch: mean(deltas.map(d => d.pitch)),
          roll:  mean(deltas.map(d => d.roll)),
        },
      };
    }
  }

  // Decomposição afim. Só diagnóstico: entra no JSON e no console, nunca
  // em meanError/score. Ver o comentário do campo em `AccuracyResult`.
  const affine = affineErrorDecomposition(diagnostics, vw, vh, meanError);
  if (affine) {
    console.log(
      `[accuracy] Decomposição afim: ganhoX=${affine.gainX.toFixed(3)} ` +
      `ganhoY=${affine.gainY.toFixed(3)} cisalhamento=${affine.shearYX.toFixed(3)} ` +
      `offset=(${Math.round(affine.offsetXPx)}, ${Math.round(affine.offsetYPx)})px | ` +
      `resíduo=${Math.round(affine.residualPx)}px de ${meanError === null ? "?" : Math.round(meanError)}px ` +
      `(${(affine.explainedFraction * 100).toFixed(0)}% do erro é mapa afim)`,
    );
    // Ganho fora de [0.9, 1.1] com resíduo pequeno é a assinatura de amplitude
    // de olhar divergente entre calibração e uso — não é ruído de regressor.
    const gainOff = Math.max(Math.abs(affine.gainX - 1), Math.abs(affine.gainY - 1));
    if (gainOff > 0.10 && affine.explainedFraction > 0.5) {
      console.warn(
        `[accuracy] ⚠ Erro dominado por ganho (${(gainOff * 100).toFixed(0)}% fora de 1.0) e ` +
        `não por ruído. Suspeitos, nesta ordem: (1) o olhar não alcançou os alvos de ` +
        `calibração — reduza MAX_ECCENTRICITY_DEG; (2) a cabeça mudou de pose entre ` +
        `calibração e teste (ver poseDrift); (3) a geometria configurada (polegadas/cm) ` +
        `não corresponde à tela real.`,
      );
    }
  }

  const result: AccuracyResult = {
    meanError, medianError, p90Error, meanErrorX, meanErrorY, maxError, errorPct, meanErrorDeg,
    meanErrorInner, meanErrorEdge,
    jitterRMS, score, colorClass, pointErrors, pointJitters,
    pontosMedidos: agg.pontosMedidos,
    pontosNaoMedidos: agg.pontosNaoMedidos,
    nInterior: agg.nInterior,
    nEdge: agg.nEdge,
    sampleMeanError, sampleMedianError, sampleP90Error, hitRateByRadius,
    poseDrift, affine,
    validationOverlap: validationOverlap && validationOverlap.length > 0
      ? validationOverlap
      : undefined,
  };

  try {
    localStorage.setItem("accuracyResult", JSON.stringify({
      meanError, medianError, p90Error, meanErrorX, meanErrorY, maxError, errorPct, meanErrorDeg,
      meanErrorInner, meanErrorEdge,
      jitterRMS, score, colorClass
    }));
  } catch (_) { }

  // Exportar relatório em JSON versionável. `meta` carrega a condição
  // do teste (iluminação, óculos, cabeça, minutos de sessão) para que a entrada
  // no histórico seja auto-descritiva.
  //
  // pipeline: identifica a versão do pipeline usada. Deriva do conjunto ativo,
  // então se alguém trocar `ACTIVE_FEATURE_SET`, o rótulo acompanha sozinho.
  const pipeline = {
    variant: `${ACTIVE_FEATURE_SET}+${REGRESSOR_MODE}`,
    featureSet: ACTIVE_FEATURE_SET,
    /** Dimensões do bloco angular presentes no vetor — 0 quando não há L2CS. */
    l2csDims: l2csSlotsInSet().length,
    regressor: REGRESSOR_MODE,
    gazeCorrectionApplied: EXPERIMENT.applyGazeCorrection,

    // ⚠️ O SNAPSHOT COMPLETO DAS FLAGS.
    //
    // Sem ele, um relatório de `l2csInputSize: 224` era byte-indistinguível de
    // um de 448, e um `filterMode: 'kalman'` de um `'oneEuro'`. Duas das três
    // decisões que o Sprint 8 existe para tomar não eram recuperáveis do
    // arquivo depois da sessão.
    //
    // O modo de falha não é hipotético: `__irisflowExp.set` só passa a valer
    // no RELOAD. Esquecer de recarregar entre condições atribui a rodada à
    // condição errada, e nada no relatório denunciaria isso.
    //
    // `experimentSnapshot()` já existia e NÃO tinha nenhum chamador — o
    // comentário do módulo dizia "vai no relatório", e não ia.
    experiment: experimentSnapshot(),
  };

  // Diagnóstico do AJUSTE da calibração que gerou este modelo. É o que
  // permite ler o relatório e saber se o erro medido vem do modelo, dos dados
  // de calibração, ou de algo que mudou entre calibrar e testar. Ver
  // `CalibrationFitDiagnostics` em calibration.ts. Null quando o teste roda
  // sobre um perfil carregado do disco (o ajuste aconteceu noutra sessão).
  const fit = getCalibrationFitDiagnostics();

  const jsonReport = JSON.stringify({
    timestamp: new Date().toISOString(),
    resolution: `${vw}x${vh}`,
    meta: meta ?? null,
    pipeline,
    result,
    diagnostics,
    // A faixa de distância no momento do teste. Diz se o resultado foi
    // obtido na distância de calibração ou compensado, e quanto. Sem isto, dois
    // relatórios com o mesmo `meanError` podem descrever situações diferentes:
    // um medido na posição de calibração e outro a 15 cm dela.
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
    calibrationFit: fit
      ? fit
      : null,
    geometry: {
      assumed: geometryAssumed,
      // B2.10 — a ORIGEM vai junto do veredito. Quem lê o JSON meses depois
      // consegue distinguir "23,6″ medido no EDID" de "23,6″ porque ninguém
      // configurou", em vez de ter que confiar num booleano sem procedência.
      source: meta?.screenGeometrySource ?? 'default',
      distPx, pxPorCm: pxPorCm || undefined,
      // Configuração de display do SO. NÃO participa da
      // conversão px→cm (a escala se cancela: o erro é medido em px CSS e a
      // tela cobre um número fixo de px CSS). Fica registrado porque
      // "1280×800 numa tela de 23,6 polegadas" é a assinatura de escala em
      // 150%, e sem esta anotação quem lê o histórico meses depois conclui
      // que a resolução estava errada.
      screenScaleFactor: displayScaleFactor ?? undefined,
      viewportPx: `${vw}x${vh}`,
      screenPx: typeof window !== 'undefined' && window.screen
        ? `${window.screen.width}x${window.screen.height}`
        : undefined,
    }
  }, null, 2);

  // Preferir gravar direto na raiz do projeto (via middleware do Vite dev):
  // o endpoint apaga accuracy-report-*.json antigos e escreve o novo, então
  // sempre há exatamente um arquivo no repo — sem acúmulo em Downloads.
  // Fallback: se o endpoint não responde (build de produção, offline), cai
  // no download tradicional do browser.
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
      console.warn('[accuracy] Endpoint de save falhou — usando download do browser', e);
      const blob = new Blob([jsonReport], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `accuracy-report-${Date.now()}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }
  })();

  console.log(`[accuracy] === RESULTADO FINAL ===`);
  console.log(`[accuracy] Resolução: ${vw}×${vh}px | distância estimada: ${ASSUMED_DIST_PX}px`);
  if (meta) {
    console.log(`[accuracy] Condição: ${meta.iluminacao} | cabeça=${meta.movimentoCabeca} | óculos=${meta.oculos ? 'sim' : 'não'} | ${meta.minutosDeSessao} min`);
  }
  // B3.6 — `px` formata `null` como "—" em vez de "NaN".
  const px = (v: number | null) => (v === null ? '—' : `${Math.round(v)}px`);
  console.log(
    `[accuracy] Config (${REGRESSOR_MODE}+geo+L2CS): mean=${px(meanError)} / ` +
    `${meanErrorDeg === null ? '—' : meanErrorDeg.toFixed(2) + '°'} | max=${px(maxError)} | ` +
    `p90=${px(p90Error)} | jitter=${jitterRMS.toFixed(1)}px | ${score} ` +
    `(${agg.pontosMedidos} ponto(s) medido(s), ${agg.pontosNaoMedidos} sem amostra)`,
  );
  for (const d of diagnostics) {
    const medido = Number.isFinite(d.error);
    const flag = medido && d.error > 45 ? ' ✗' : '';
    console.log(
      `[accuracy]   ${d.name.padEnd(18)}: ` +
      (medido
        ? `err=${Math.round(d.error)}px jitter=${d.jitterRMS.toFixed(1)}px${flag}`
        : 'SEM AMOSTRA — excluído de todas as métricas'),
    );
  }
  console.log(`[accuracy] === FIM ===`);

  if (EXPERIMENT.applyGazeCorrection) {
    // B3.6 — só pontos MEDIDOS entram no mapa de correção. Um ponto sem
    // amostra tinha `predX === groundX`, então gerava um offset zero que o
    // RBF interpolava como "aqui está perfeito" — contaminando a vizinhança.
    setGazeCorrections(
      diagnostics
        .filter(
          (d): d is typeof d & { predX: number; predY: number } =>
            typeof d.predX === 'number' && typeof d.predY === 'number',
        )
        .map((d) => ({
          refX: d.predX,
          refY: d.predY,
          offsetX: d.groundX - d.predX,
          offsetY: d.groundY - d.predY,
        })),
    );
  }

  showDiagnosticOverlay(diagnostics, result, onComplete);
}

function showDiagnosticOverlay(
  diagnostics: PointDiagnostic[],
  result: AccuracyResult,
  onComplete?: (result: AccuracyResult, action: 'continue' | 'redo') => void
) {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  const overlay = document.createElement("div");
  overlay.id = "diagnostic-overlay";
  overlay.className = "diagnostic-overlay";

  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", String(vw));
  svg.setAttribute("height", String(vh));
  svg.setAttribute("viewBox", `0 0 ${vw} ${vh}`);
  svg.classList.add("diagnostic-svg");

  for (const d of diagnostics) {
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", String(d.groundX));
    line.setAttribute("y1", String(d.groundY));
    line.setAttribute("x2", String(d.predX));
    line.setAttribute("y2", String(d.predY));
    line.setAttribute("stroke", getErrorColor(d.error));
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-opacity", "0.8");
    svg.appendChild(line);

    const redDot = document.createElementNS(svgNS, "circle");
    redDot.setAttribute("cx", String(d.groundX));
    redDot.setAttribute("cy", String(d.groundY));
    redDot.setAttribute("r", "7");
    redDot.setAttribute("fill", "#ef4444");
    redDot.setAttribute("stroke", "#fff");
    redDot.setAttribute("stroke-width", "1.5");
    svg.appendChild(redDot);

    const greenDot = document.createElementNS(svgNS, "circle");
    greenDot.setAttribute("cx", String(d.predX));
    greenDot.setAttribute("cy", String(d.predY));
    greenDot.setAttribute("r", "7");
    greenDot.setAttribute("fill", "#22c55e");
    greenDot.setAttribute("stroke", "#fff");
    greenDot.setAttribute("stroke-width", "1.5");
    svg.appendChild(greenDot);

    const labelX = d.groundX + 14;
    const labelY = d.groundY - 14;

    const labelBg = document.createElementNS(svgNS, "rect");
    const labelText = `${Math.round(d.error)}px`;
    labelBg.setAttribute("x", String(labelX - 2));
    labelBg.setAttribute("y", String(labelY - 13));
    labelBg.setAttribute("width", String(labelText.length * 7 + 8));
    labelBg.setAttribute("height", "18");
    labelBg.setAttribute("rx", "4");
    labelBg.setAttribute("fill", "rgba(0,0,0,0.7)");
    svg.appendChild(labelBg);

    const text = document.createElementNS(svgNS, "text");
    text.setAttribute("x", String(labelX + 2));
    text.setAttribute("y", String(labelY));
    text.setAttribute("fill", getErrorColor(d.error));
    text.setAttribute("font-size", "12");
    text.setAttribute("font-family", "Inter, sans-serif");
    text.setAttribute("font-weight", "600");
    text.textContent = labelText;
    svg.appendChild(text);

    const nameText = document.createElementNS(svgNS, "text");
    nameText.setAttribute("x", String(d.groundX));
    nameText.setAttribute("y", String(d.groundY + 22));
    nameText.setAttribute("fill", "rgba(255,255,255,0.5)");
    nameText.setAttribute("font-size", "10");
    nameText.setAttribute("font-family", "Inter, sans-serif");
    nameText.setAttribute("text-anchor", "middle");
    nameText.textContent = d.name;
    svg.appendChild(nameText);
  }

  overlay.appendChild(svg);

  const footer = document.createElement("div");
  footer.className = "diagnostic-footer";

  const scoreColor = result.colorClass === 'accuracy-excellent' ? '#22c55e'
    : result.colorClass === 'accuracy-good' ? '#00fff0'
      : result.colorClass === 'accuracy-regular' ? '#ffcc00'
        : '#ef4444';

  // O diagnóstico da grade é o que transforma "Ruim" em conselho acionável.
  //
  // O erro médio diz QUE está ruim; a razão periferia/centro diz POR QUÊ. Numa
  // sessão real com 125 px de erro, o centro estava em 106 px e a periferia em
  // 377 px — 3,6×. Não era o pipeline: era a grade pedindo ângulos de olhar
  // fora do alcance, porque a distância configurada não batia com a real.
  // Ver `calibrationGridDiagnosis.ts`.
  const gd = getCalibrationFitDiagnostics()?.gridDiagnosis;
  const gridAviso = gd && gd.mensagem
    ? `<div style="margin:0 0 16px; padding:12px 14px; border-radius:10px; line-height:1.5;
                   background:rgba(255,204,0,0.10); border:1px solid rgba(255,204,0,0.45);
                   color:#ffd75e; font-size:13px; text-align:left;">
         <strong style="display:block; margin-bottom:4px;">Por que ficou ruim</strong>
         ${gd.mensagem}
         <span style="display:block; margin-top:6px; opacity:0.75; font-size:12px;">
           centro ${gd.centroPx.toFixed(0)} px · periferia ${gd.periferiaPx.toFixed(0)} px · ${gd.razao.toFixed(1)}× pior
         </span>
       </div>`
    : '';

  footer.innerHTML = `
    <div class="diagnostic-card">
      <div class="diagnostic-title">Calibração Concluída</div>
      ${EXPERIMENT.applyGazeCorrection ? '<div class="diagnostic-warning" style="color:#ffcc00; font-size:12px; margin-top:4px;">⚠️ Métricas calculadas PRÉ-correção</div>' : ''}

      <div class="diagnostic-legend">
        <span class="legend-item">
          <span class="legend-dot" style="background:#ef4444"></span>
          Ponto real (ground truth)
        </span>
        <span class="legend-item">
          <span class="legend-dot" style="background:#22c55e"></span>
          Ponto predito
        </span>
      </div>

      <div class="diagnostic-metrics">
        <div class="metric-item">
          <div class="metric-value" style="color:${scoreColor}">${mostrarPx(result.meanErrorInner)}</div>
          <div class="metric-label">Erro Médio (interior)</div>
        </div>
        <div class="metric-divider"></div>
        <div class="metric-item">
          <div class="metric-value" style="color:${scoreColor}">${mostrarPx(result.meanErrorEdge)}</div>
          <div class="metric-label">Erro Médio (borda)</div>
        </div>
        <div class="metric">
          <div class="metric-value" style="color:${scoreColor}">${mostrarPx(result.maxError)}</div>
          <div class="metric-label">Erro Máximo</div>
        </div>
        <div class="metric-divider"></div>
        <div class="metric-item">
          <div class="metric-value" style="color:${scoreColor}">${
            result.meanErrorDeg === null ? '—' : result.meanErrorDeg.toFixed(2) + '°'
          }</div>
          <div class="metric-label">Erro Angular</div>
        </div>
        <div class="metric-divider"></div>
        <div class="metric-item">
          <div class="metric-value" style="color:${scoreColor}">${result.score}</div>
          <div class="metric-label">Classificação</div>
        </div>
      </div>
      
      ${gridAviso}

      <div style="text-align:center; font-size:14px; font-weight:600; color:#fff; margin-bottom:16px;">
        Taxa de acerto em alvo de 150 px: <span style="color:${scoreColor}">${(() => {
          const h = result.hitRateByRadius.find(r => r.radiusPx === 150)?.pct;
          // `??` e não `||`: com `||`, um acerto legítimo de 0% viraria o
          // texto de "não medido". São coisas diferentes e precisam ler
          // diferente.
          return h === null || h === undefined ? 'não medido' : `${h.toFixed(0)}%`;
        })()}</span>
      </div>

      <div class="diagnostic-point-grid">
        ${diagnostics.map(d => `
          <div class="diag-point-card ${d.error < 60 ? 'diag-ok' : d.error < 120 ? 'diag-warn' : 'diag-bad'}">
            <div class="diag-point-name">${d.name}</div>
            <div class="diag-point-error">${Math.round(d.error)}px</div>
          </div>
        `).join('')}
      </div>

      <div class="diagnostic-actions">
        Pressione <kbd>Espaço</kbd> para continuar ou <kbd>R</kbd> para recalibrar
      </div>
    </div>
  `;
  overlay.appendChild(footer);

  document.body.appendChild(overlay);

  requestAnimationFrame(() => overlay.classList.add("visible"));

  function handleKey(e: KeyboardEvent) {
    if (e.code === 'Space') {
      e.preventDefault();
      overlay.classList.remove("visible");
      setTimeout(() => {
        overlay.remove();
        document.removeEventListener('keydown', handleKey);
        onComplete?.(result, 'continue');
      }, 300);
    } else if (e.code === 'KeyR') {
      e.preventDefault();
      overlay.remove();
      document.removeEventListener('keydown', handleKey);
      onComplete?.(result, 'redo');
    }
  }

  document.addEventListener('keydown', handleKey);
}

function getErrorColor(error: number): string {
  if (error < 50) return '#22c55e';
  if (error < 100) return '#ffcc00';
  return '#ef4444';
}

/** Conjuntos de pontos expostos para os testes de B3.8 verificarem que a
 *  guarda de sobreposição cobre as bordas. Não é API de produção. */
export const __testingPoints = {
  VALIDATION_POINTS: VALIDATION_POINTS.map((p) => ({ ...p, isEdge: false })),
  ALL_VALIDATION_POINTS,
};
