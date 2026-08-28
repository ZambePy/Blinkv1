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
import { EXPERIMENT } from './config/experiment';

export interface AccuracyResult {
  meanError: number;      // Erro médio em pixels
  medianError: number;    // Erro mediano em pixels
  p90Error: number;       // Erro P90 em pixels
  meanErrorX: number;     // Erro médio no eixo X
  meanErrorY: number;     // Erro médio no eixo Y
  maxError: number;       // Pior erro em pixels
  errorPct: number;       // Erro médio como % da diagonal da tela
  meanErrorDeg: number;   // Erro médio em graus angulares
  jitterRMS: number;      // RMS da dispersão de predições em torno da própria média por ponto (px)
  /** 0.3 — média dos 9 pontos INTERIORES (25/50/75). Igual a `meanError`;
   *  existe com nome próprio para o leitor não precisar saber que `meanError`
   *  exclui a borda. */
  meanErrorInner: number;
  /** 0.3 — média dos 4 cantos a 5%/95%, onde a predição EXTRAPOLA a grade de
   *  calibração em X. É a região que a grade 25/50/75 nunca mediu e onde a UI
   *  de fato posiciona botões. `NaN` se nenhum ponto de borda foi coletado. */
  meanErrorEdge: number;
  score: string;          // Rótulo qualitativo
  colorClass: string;     // Classe CSS para colorir o painel
  pointErrors: number[];  // Erro por ponto de validação
  pointJitters: number[]; // Jitter RMS por ponto (px)
  /** Erro por AMOSTRA (não por média do ponto). É o que o dwell sente. */
  sampleMeanError: number;
  sampleMedianError: number;
  sampleP90Error: number;          // p90 real, sobre todas as amostras
  /** % de amostras dentro de um alvo de raio R centrado no ponto.
   *  Preditor direto da taxa de sucesso do dwell. */
  hitRateByRadius: { radiusPx: number; pct: number }[];
  /** D9 — decomposição afim do erro. Ajusta, por mínimos quadrados sobre os 9
   *  pares (ground-truth → predito) em coordenadas NORMALIZADAS:
   *
   *      predX = gainX·gx + crossXY·gy + offsetX
   *      predY = shearYX·gx + gainY·gy + offsetY
   *
   *  e reporta quanto do erro sobra depois de remover esse mapa afim
   *  (`residualPx`). É o diagnóstico que separa as duas famílias de causa:
   *
   *   • `residualPx` << `meanError` → o sinal de olhar está bom e o que está
   *     errado é o MAPEAMENTO (ganho/offset/cisalhamento). Causa típica:
   *     amplitude de olhar na calibração diferente da nominal (hipometria nos
   *     alvos excêntricos), deriva de pose entre calibração e teste, ou
   *     geometria de tela divergente.
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
  /** D9 — pontos de validação que coincidiram com alvos de calibração. Quando
   *  presente, o erro reportado nesses pontos mede memorização e o resultado
   *  global está otimista. Ausente no caminho normal. Só registro — nenhuma
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
  /** Distância olho→tela em cm, usada para converter px em graus.
   *
   *  Etapa 1 — desde a introdução de `effectiveViewingDistanceCm`, este campo
   *  pode vir MEDIDO (estimado do tamanho do rosto no frame, uma vez que o
   *  campo de visão da câmera tenha sido calibrado) em vez de digitado. Qual
   *  dos dois foi usado fica registrado em `observacoes`. */
  distanciaCm: number;
  /** Diagonal física do monitor em polegadas. */
  telaPolegadas: number;
  /** Etapa 1 — fator de escala do SO (1 = 100%, 1.5 = 150%). Documental. */
  screenScaleFactor?: number | null;
}

interface PointDiagnostic {
  /** 0.3 — ponto do anel de borda (extrapolação) vs grade interior. */
  isEdge?: boolean;
  groundX: number;
  groundY: number;
  predX: number;
  predY: number;
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
// (a exceção é o centro, comum às duas por convenção): validar nas mesmas
// posições do treino mediria memorização, não generalização.
//
// D9 — a grade de calibração deixou de ser 5%/95% fixo e passou a sair do
// orçamento de excentricidade (`computeCalibrationTargets`). Na tela de
// referência (23,6" a 60 cm) ela cai em ~17%/83% em X e 5%/95% em Y.
//
// 0.3 — CORREÇÃO. Este comentário afirmava "INTERPOLAÇÃO em Y e EXTRAPOLAÇÃO
// em X", o que está errado: 25/75 cabe dentro de 17/83 tanto quanto dentro de
// 5/95, então os DOIS eixos são interpolação. A consequência é mais séria que
// um comentário impreciso — significa que esta grade nunca mediu extrapolação,
// e portanto nunca mediu a borda, que é onde a UI põe botões (`GazeGrid` usa
// x ∈ {1/6, 1/2, 5/6}). Daí o bloco `EDGE_POINTS` abaixo.
//
// Estes 9 pontos NÃO acompanham a grade de calibração de propósito: uma métrica
// que se move junto com o protocolo não serve para comparar sessões ao longo do
// tempo. `meanError` continua sendo a média DESTES nove, pelo mesmo motivo.
//
// ⚠️ Se a geometria configurada colocar um alvo de calibração em cima de um
// destes 9 pontos, o teste passaria a medir memorização e o número ficaria
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

// Hotfix pós-Sprint 0 — paridade com o protocolo de calibração: descartar os
// primeiros ACCLIMATION_MS de cada ponto (fase de sacada + acomodação). Sem
// isso, o jitter reportado mistura movimento sacádico com fixação real.
// COLLECTION_MS engloba acomodação + janela útil (400 + 1000 = 1400 ms/ponto).
const ACCLIMATION_MS = 400;
const COLLECTION_MS = 1400;

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

// Fase 0.1 — alvo do dot atualmente visível ao usuário. Setado por
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

  // D9 — guarda de honestidade da métrica. Roda ANTES do teste para que o
  // aviso apareça no console junto do resto do diagnóstico da sessão.
  const overlap = checkValidationOverlap(getCalibrationTargets(), VALIDATION_POINTS);
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
  // O accuracy test mede o Ridge CRU. Se o bias EMA da sessão (D1-3) tiver
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

    // Fase 0.1 — publica alvo para o gravador. Mantido setado durante toda a
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
        // Passar perEyeWeight ativa a heurística ponderada por EAR (D1-2), que
        // pode degradar o número em usuários com EAR crônico assimétrico entre
        // os olhos — porque a calibração treina os dois regressors com peso
        // igual, sem saber que a inferência vai ponderar. Isolar a heurística
        // aqui devolve o comportamento medido pela tag v0-menor-erro-oculos.
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
      let meanPX = targetScreenX;
      let meanPY = targetScreenY;

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

// D9 — dois pontos "iguais" para efeito de vazamento treino→teste. 2% de cada
// eixo em 1920×1080 são ~38 px em X e ~22 px em Y: bem abaixo do menor alvo
// interativo do app (5° ≈ 200 px), então se um alvo de calibração cai dentro
// disso de um ponto de validação, o teste está medindo memorização.
const OVERLAP_TOLERANCE = 0.02;

/**
 * D9 — detecta alvos de calibração que caíram em cima de pontos de validação.
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
    // O CENTRO da tela pertence às duas grades por convenção — está assim
    // desde antes do D9 e é a exceção documentada no comentário de
    // VALIDATION_POINTS. Consequência honesta, que fica registrada aqui: o
    // erro de P5 é erro de TREINO, não de generalização, e por isso o
    // agregado dos 9 pontos é levemente otimista (1 ponto em 9). Não é o
    // vazamento que este guarda procura — ele procura o caso NÃO intencional,
    // em que a geometria configurada move a grade para cima da validação.
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
 * D9 — decomposição afim do erro de mapeamento.
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
  points: readonly { groundX: number; groundY: number; predX: number; predY: number }[],
  vw: number,
  vh: number,
  meanError: number,
): AccuracyResult['affine'] {
  const usable = points.filter(
    p => Number.isFinite(p.predX) && Number.isFinite(p.predY),
  );
  if (usable.length < 4 || !(vw > 0) || !(vh > 0)) return undefined;

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
  const innerErrors = diagnostics.filter((d) => !d.isEdge).map((d) => d.error).filter(Number.isFinite);
  const edgeErrors = diagnostics.filter((d) => d.isEdge).map((d) => d.error).filter(Number.isFinite);
  const mediaDe = (v: number[]) => (v.length > 0 ? v.reduce((a, b) => a + b, 0) / v.length : NaN);

  const meanErrorInner = mediaDe(innerErrors);
  const meanErrorEdge = mediaDe(edgeErrors);
  const meanError = meanErrorInner;
  const sortedErrors = [...innerErrors].sort((a, b) => a - b);
  const medianError = sortedErrors[Math.floor(sortedErrors.length / 2)] || 0;
  // D9 — antes: `sorted[floor(n*0.9)]`, que com n=9 dá `sorted[8]` — ou seja, o
  // p90 por ponto era LITERALMENTE o máximo, e o relatório publicava dois nomes
  // para o mesmo número (p90Error === maxError em todos os relatórios
  // existentes). Percentil linear-interpolado (mesma convenção do numpy
  // 'linear') resolve sem mudar nenhuma outra métrica.
  const p90Error = percentileLinear(sortedErrors, 0.9);

  const meanErrorX = diagnostics.reduce((s, d) => s + d.errorX, 0) / diagnostics.length || 0;
  const meanErrorY = diagnostics.reduce((s, d) => s + d.errorY, 0) / diagnostics.length || 0;

  const allSampleErrors = diagnostics.flatMap(d => d.samplesError);
  const nSamples = allSampleErrors.length;
  const sampleMeanError = nSamples ? allSampleErrors.reduce((s, v) => s + v, 0) / nSamples : 0;
  const sortedSampleErrors = [...allSampleErrors].sort((a, b) => a - b);
  const sampleMedianError = nSamples > 0 ? sortedSampleErrors[Math.floor(nSamples / 2)] : 0;
  const sampleP90Error = nSamples > 0 ? sortedSampleErrors[Math.min(nSamples - 1, Math.ceil(nSamples * 0.9) - 1)] : 0;

  const radii = [60, 100, 150, 200];
  const hitRateByRadius = radii.map(r => ({
    radiusPx: r,
    pct: nSamples > 0 ? (allSampleErrors.filter(e => e <= r).length / nSamples) * 100 : 0
  }));

  const maxError = Math.max(...pointErrors);
  const diagonal = Math.sqrt(vw ** 2 + vh ** 2);
  const errorPct = (meanError / diagonal) * 100;

  let distPx = ASSUMED_DIST_PX;
  let geometryAssumed = true;
  // Escala do display, quando o caller informou (Etapa 1). Puramente
  // documental — ver o comentário no bloco `geometry` abaixo.
  const displayScaleFactor = meta?.screenScaleFactor ?? null;
  let pxPorCm = 0;

  if (meta && meta.distanciaCm && meta.telaPolegadas) {
    const diagPx = Math.hypot(vw, vh);
    pxPorCm = diagPx / (meta.telaPolegadas * 2.54);
    distPx = meta.distanciaCm * pxPorCm;
    geometryAssumed = false;
  }

  const meanErrorDeg = (Math.atan(meanError / distPx) * 180) / Math.PI;

  const pointJitters = diagnostics.map(d => d.jitterRMS);
  const jitterRMS = pointJitters.length
    ? pointJitters.reduce((s, v) => s + v, 0) / pointJitters.length
    : 0;

  let score: string;
  let colorClass: string;
  if (meanError < 30) {
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

  // D9 — decomposição afim. Só diagnóstico: entra no JSON e no console, nunca
  // em meanError/score. Ver o comentário do campo em `AccuracyResult`.
  const affine = affineErrorDecomposition(diagnostics, vw, vh, meanError);
  if (affine) {
    console.log(
      `[accuracy] Decomposição afim: ganhoX=${affine.gainX.toFixed(3)} ` +
      `ganhoY=${affine.gainY.toFixed(3)} cisalhamento=${affine.shearYX.toFixed(3)} ` +
      `offset=(${Math.round(affine.offsetXPx)}, ${Math.round(affine.offsetYPx)})px | ` +
      `resíduo=${Math.round(affine.residualPx)}px de ${Math.round(meanError)}px ` +
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

  // Exportar relatório em JSON versionável (Sprint 0). `meta` carrega a condição
  // do teste (iluminação, óculos, cabeça, minutos de sessão) para que a entrada
  // no BASELINE.md seja auto-descritiva.
  //
  // pipeline: identifica a versão do pipeline usada. L2CS agora é obrigatório
  // (não há mais A/B), então o campo é fixo em `l2cs+ridge` — preserva o
  // shape do JSON para não quebrar leitores externos (script de sumário,
  // dashboards), mas remove o campo booleano `l2csEnabled` que sinalizava
  // o toggle antigo.
  const pipeline = {
    variant: 'l2cs+ridge' as const,
    regressor: REGRESSOR_MODE,
    gazeCorrectionApplied: EXPERIMENT.applyGazeCorrection,
  };

  // D10 — diagnóstico do AJUSTE da calibração que gerou este modelo. É o que
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
    // D12 — a faixa de distância no momento do teste. Diz se o resultado foi
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
      assumed: geometryAssumed, distPx, pxPorCm: pxPorCm || undefined,
      // Etapa 1, item 2 — configuração de display do SO. NÃO participa da
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
  console.log(`[accuracy] Config (${REGRESSOR_MODE}+geo+L2CS): mean=${Math.round(meanError)}px / ${meanErrorDeg.toFixed(2)}° | max=${Math.round(maxError)}px | p90=${Math.round(p90Error)}px | jitter=${jitterRMS.toFixed(1)}px | ${score}`);
  for (const d of diagnostics) {
    const flag = d.error > 45 ? ' ✗' : '';
    console.log(`[accuracy]   ${d.name.padEnd(18)}: err=${Math.round(d.error)}px jitter=${d.jitterRMS.toFixed(1)}px${flag}`);
  }
  console.log(`[accuracy] === FIM ===`);

  if (EXPERIMENT.applyGazeCorrection) {
    setGazeCorrections(diagnostics.map(d => ({
      refX:    d.predX,
      refY:    d.predY,
      offsetX: d.groundX - d.predX,
      offsetY: d.groundY - d.predY,
    })));
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
          <div class="metric-value" style="color:${scoreColor}">${Math.round(result.meanErrorInner)}px</div>
          <div class="metric-label">Erro Médio (interior)</div>
        </div>
        <div class="metric-divider"></div>
        <div class="metric-item">
          <div class="metric-value" style="color:${scoreColor}">${
            Number.isFinite(result.meanErrorEdge) ? Math.round(result.meanErrorEdge) + 'px' : '—'
          }</div>
          <div class="metric-label">Erro Médio (borda)</div>
        </div>
        <div class="metric">
          <div class="metric-value" style="color:${scoreColor}">${Math.round(result.maxError)}px</div>
          <div class="metric-label">Erro Máximo</div>
        </div>
        <div class="metric-divider"></div>
        <div class="metric-item">
          <div class="metric-value" style="color:${scoreColor}">${result.meanErrorDeg.toFixed(2)}°</div>
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
        Taxa de acerto em alvo de 150 px: <span style="color:${scoreColor}">${result.hitRateByRadius.find(r => r.radiusPx === 150)?.pct.toFixed(0) || 0}%</span>
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
