// Teste de validação pós-calibração com Diagnóstico Visual por Ponto
//
// Após coletar dados de 9 pontos de validação, exibe um overlay fullscreen com:
//   • Ponto vermelho = posição real (ground truth)
//   • Ponto verde   = posição predita pelo modelo
//   • Linha conectando cada par
//   • Erro em pixels ao lado de cada par
//   • Resumo de métricas + controles (Espaço para continuar, R para recalibrar)

import { mapGaze, setGazeCorrections } from './calibration';
import { REGRESSOR_MODE } from './gazeRegressor';

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

// Flag para indicar que o teste de precisão está rodando
// Usada por main.ts para reduzir suavização durante o teste
export let isAccuracyTesting = false;

// Recebe a posição crua do olhar a cada frame — chamado por main.ts
export function feedAccuracyRaw(
  featuresLeft: number[],
  featuresRight: number[],
) {
  currentFeaturesLeft = featuresLeft;
  currentFeaturesRight = featuresRight;
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
  const overlay = createAccuracyOverlay();
  let pointIndex = 0;
  const pointErrors: number[] = [];
  const diagnostics: PointDiagnostic[] = [];
  const runMeta: RunMeta | undefined = meta;

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  function runNextPoint() {
    if (pointIndex >= VALIDATION_POINTS.length) {
      isAccuracyTesting = false;
      finishTest(overlay, pointErrors, diagnostics, onComplete, runMeta);
      return;
    }

    const vp = VALIDATION_POINTS[pointIndex];
    showValidationDot(overlay, vp, pointIndex);

    const startTime = performance.now();
    const predictedX: number[] = [];
    const predictedY: number[] = [];

    const targetScreenX = vp.screenX * vw;
    const targetScreenY = vp.screenY * vh;

    function collect() {
      const elapsed = performance.now() - startTime;

      // Só contabiliza amostras após a fase de acomodação — assim o jitter
      // reportado reflete a fixação, não a sacada de entrada no ponto.
      if (elapsed >= ACCLIMATION_MS) {
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

      let error = 0;
      let errorX = 0;
      let errorY = 0;
      let meanPX = targetScreenX;
      let meanPY = targetScreenY;
      let jitterRMS = 0;
      if (predictedX.length > 0) {
        meanPX = predictedX.reduce((s, v) => s + v, 0) / predictedX.length;
        meanPY = predictedY.reduce((s, v) => s + v, 0) / predictedY.length;
        const dx = meanPX - targetScreenX;
        const dy2 = meanPY - targetScreenY;
        errorX = Math.abs(dx);
        errorY = Math.abs(dy2);
        error = Math.sqrt(dx * dx + dy2 * dy2);

        // Jitter RMS = raiz da média das distâncias² de cada amostra à média do
        // ponto. Isola o ruído do filtro/regressor do erro de calibração:
        // um alvo pode ter bias alto mas jitter baixo (ou vice-versa).
        let sumSq = 0;
        for (let i = 0; i < predictedX.length; i++) {
          const jx = predictedX[i] - meanPX;
          const jy = predictedY[i] - meanPY;
          sumSq += jx * jx + jy * jy;
        }
        jitterRMS = Math.sqrt(sumSq / predictedX.length);
      }

      pointErrors.push(error);
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

  const maxError = Math.max(...pointErrors);
  const diagonal = Math.sqrt(vw ** 2 + vh ** 2);
  const errorPct = (meanError / diagonal) * 100;

  const meanErrorDeg = (Math.atan(meanError / ASSUMED_DIST_PX) * 180) / Math.PI;

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

  const result: AccuracyResult = {
    meanError, medianError, p90Error, meanErrorX, meanErrorY, maxError, errorPct, meanErrorDeg,
    jitterRMS, score, colorClass, pointErrors, pointJitters,
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
  };

  const jsonReport = JSON.stringify({
    timestamp: new Date().toISOString(),
    resolution: `${vw}x${vh}`,
    meta: meta ?? null,
    pipeline,
    result,
    diagnostics,
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

  setGazeCorrections(diagnostics.map(d => ({
    refX:    d.predX,
    refY:    d.predY,
    offsetX: d.groundX - d.predX,
    offsetY: d.groundY - d.predY,
  })));

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
