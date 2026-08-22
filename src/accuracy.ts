// Teste de validação pós-calibração com Diagnóstico Visual por Ponto
//
// Após coletar dados de 9 pontos de validação, exibe um overlay fullscreen com:
//   • Ponto vermelho = posição real (ground truth)
//   • Ponto verde   = posição predita pelo modelo
//   • Linha conectando cada par
//   • Erro em pixels ao lado de cada par
//   • Resumo de métricas + controles (Espaço para continuar, R para recalibrar)

import { mapGaze, setGazeCorrections, resetSessionBias } from './calibration';
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
  /** Distância olho→tela MEDIDA com fita métrica, em cm. Obrigatório para
   *  que o erro angular tenha significado fora desta máquina. */
  distanciaCm: number;
  /** Diagonal física do monitor em polegadas. */
  telaPolegadas: number;
}

interface PointDiagnostic {
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

// Grade 3×3 disjunta da calibração — calibração usa 10/50/90, precisão usa
// 25/50/75. Sem sobreposição de posições entre treino e teste (a exceção é o
// centro, comum às duas grades por convenção). Se validássemos nas mesmas
// posições da calibração, o erro reportado seria artificialmente baixo (mede
// memorização, não generalização).
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
let currentPerEyeWeight: { left: number; right: number } | undefined;
// Pose da cabeça no frame atual (rad). Alimentado pelo engine a cada frame
// junto com as features. Usado pelo accuracy test para detectar deriva de
// pose entre calibração e teste — a assinatura mais comum de "cursor com
// viés grande" (2026-08-22: shift uniforme de +200 px em Y correlacionado
// com cabeça abaixando ~5°).
let currentPose: { yaw: number; pitch: number; roll: number } | undefined;

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
  perEyeWeight?: { left: number; right: number },
  pose?: { yaw: number; pitch: number; roll: number },
) {
  currentFeaturesLeft = featuresLeft;
  currentFeaturesRight = featuresRight;
  currentPerEyeWeight = perEyeWeight;
  currentPose = pose;
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
    if (pointIndex >= VALIDATION_POINTS.length) {
      isAccuracyTesting = false;
      currentValidationTarget = null;
      finishTest(overlay, pointErrors, diagnostics, onComplete, runMeta, poseBaseline);
      return;
    }

    const vp = VALIDATION_POINTS[pointIndex];
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

    function collect() {
      const elapsed = performance.now() - startTime;

      // Fixa o baseline de pose no primeiro frame válido do teste (ainda na
      // janela de acomodação está OK — o usuário acabou de calibrar e a pose
      // é considerada "de referência").
      if (!poseBaseline && currentPose) {
        poseBaseline = { ...currentPose };
      }

      // Só contabiliza amostras após a fase de acomodação — assim o jitter
      // reportado reflete a fixação, não a sacada de entrada no ponto.
      if (elapsed >= ACCLIMATION_MS) {
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
    instr.innerHTML = `Teste de Precisão &nbsp;<span class="highlight">${index + 1}/${VALIDATION_POINTS.length}</span> — olhe para o ponto`;
  }

  overlay.appendChild(dot);
}

function finishTest(
  overlay: HTMLDivElement,
  pointErrors: number[],
  diagnostics: PointDiagnostic[],
  onComplete?: (result: AccuracyResult, action: 'continue' | 'redo') => void,
  meta?: RunMeta,
  poseBaseline?: { yaw: number; pitch: number; roll: number } | null,
) {
  overlay.remove();

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  const meanError = pointErrors.reduce((s, v) => s + v, 0) / pointErrors.length;
  const sortedErrors = [...pointErrors].sort((a, b) => a - b);
  const medianError = sortedErrors[Math.floor(sortedErrors.length / 2)] || 0;
  const p90Error = sortedErrors[Math.floor(sortedErrors.length * 0.9)] || 0;
  
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

  const result: AccuracyResult = {
    meanError, medianError, p90Error, meanErrorX, meanErrorY, maxError, errorPct, meanErrorDeg,
    jitterRMS, score, colorClass, pointErrors, pointJitters,
    sampleMeanError, sampleMedianError, sampleP90Error, hitRateByRadius,
    poseDrift,
  };

  try {
    localStorage.setItem("accuracyResult", JSON.stringify({
      meanError, medianError, p90Error, meanErrorX, meanErrorY, maxError, errorPct, meanErrorDeg,
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

  const jsonReport = JSON.stringify({
    timestamp: new Date().toISOString(),
    resolution: `${vw}x${vh}`,
    meta: meta ?? null,
    pipeline,
    result,
    diagnostics,
    geometry: { assumed: geometryAssumed, distPx, pxPorCm: pxPorCm || undefined }
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
          <div class="metric-value" style="color:${scoreColor}">${Math.round(result.meanError)}px</div>
          <div class="metric-label">Erro Médio</div>
        </div>
        <div class="metric-divider"></div>
        <div class="metric-item">
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
