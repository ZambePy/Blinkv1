// Teste de validação pós-calibração com Diagnóstico Visual por Ponto
//
// Após coletar dados de 9 pontos de validação, exibe um overlay fullscreen com:
//   • Ponto vermelho = posição real (ground truth)
//   • Ponto verde   = posição predita pelo modelo
//   • Linha conectando cada par
//   • Erro em pixels ao lado de cada par
//   • Resumo de métricas + controles (Espaço para continuar, R para recalibrar)

import { mapGaze, mapGazeWithConfig, hasDevConfigs, startPreCalibration } from './calibration';

export interface AccuracyResult {
  meanError: number;      // Erro médio em pixels
  maxError: number;       // Pior erro em pixels
  errorPct: number;       // Erro médio como % da diagonal da tela
  meanErrorDeg: number;   // Erro médio em graus angulares
  score: string;          // Rótulo qualitativo
  colorClass: string;     // Classe CSS para colorir o painel
  pointErrors: number[];  // Erro por ponto de validação
}

interface PointDiagnostic {
  groundX: number;
  groundY: number;
  predX: number;
  predY: number;
  error: number;
  name: string;
  errorB: number | null;
  errorC: number | null;
}

// 9 pontos de validação em grade 3×3
const VALIDATION_POINTS = [
  { name: "Superior Esq", screenX: 0.10, screenY: 0.10 },
  { name: "Superior Centro", screenX: 0.50, screenY: 0.10 },
  { name: "Superior Dir", screenX: 0.90, screenY: 0.10 },
  { name: "Médio Esq", screenX: 0.10, screenY: 0.50 },
  { name: "Centro", screenX: 0.50, screenY: 0.50 },
  { name: "Médio Dir", screenX: 0.90, screenY: 0.50 },
  { name: "Inferior Esq", screenX: 0.10, screenY: 0.90 },
  { name: "Inferior Centro", screenX: 0.50, screenY: 0.90 },
  { name: "Inferior Dir", screenX: 0.90, screenY: 0.90 },
];

const COLLECTION_MS = 1000;

// Distância estimada usuário–tela para conversão px → graus
// Assume 60 cm a 96 CSS DPI: 60 × 96 / 2.54 ≈ 2268 px
const ASSUMED_DIST_PX = 2268;

let currentFeaturesLeft: number[] = [];
let currentFeaturesRight: number[] = [];
let currentFusedLeft: number[] | null = null;
let currentFusedRight: number[] | null = null;

// Flag para indicar que o teste de precisão está rodando
// Usada por main.ts para reduzir suavização durante o teste
export let isAccuracyTesting = false;

// Recebe a posição crua do olhar a cada frame — chamado por main.ts
export function feedAccuracyRaw(
  featuresLeft: number[],
  featuresRight: number[],
  fusedLeft?: number[] | null,
  fusedRight?: number[] | null,
) {
  currentFeaturesLeft = featuresLeft;
  currentFeaturesRight = featuresRight;
  currentFusedLeft  = fusedLeft  ?? null;
  currentFusedRight = fusedRight ?? null;
}

// Inicia o teste de validação de precisão pós-calibração
export function startAccuracyTest(onComplete: (result: AccuracyResult) => void) {
  isAccuracyTesting = true;
  const overlay = createAccuracyOverlay();
  let pointIndex = 0;
  const pointErrors: number[] = [];
  const diagnostics: PointDiagnostic[] = [];

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  function runNextPoint() {
    if (pointIndex >= VALIDATION_POINTS.length) {
      isAccuracyTesting = false;
      finishTest(overlay, pointErrors, diagnostics, onComplete);
      return;
    }

    const vp = VALIDATION_POINTS[pointIndex];
    showValidationDot(overlay, vp, pointIndex);

    const startTime = performance.now();
    const predictedX: number[] = [];
    const predictedY: number[] = [];
    const predictedBX: number[] = [];
    const predictedBY: number[] = [];
    const predictedCX: number[] = [];
    const predictedCY: number[] = [];

    const targetScreenX = vp.screenX * vw;
    const targetScreenY = vp.screenY * vh;

    function collect() {
      const elapsed = performance.now() - startTime;

      const gaze = mapGaze(currentFeaturesLeft, currentFeaturesRight);
      if (gaze) {
        predictedX.push(gaze.x);
        predictedY.push(gaze.y);
      }

      const gazeB = mapGazeWithConfig('B', currentFeaturesLeft, currentFeaturesRight);
      if (gazeB) { predictedBX.push(gazeB.x); predictedBY.push(gazeB.y); }
      const gazeC = mapGazeWithConfig('C', currentFeaturesLeft, currentFeaturesRight, currentFusedLeft, currentFusedRight);
      if (gazeC) { predictedCX.push(gazeC.x); predictedCY.push(gazeC.y); }

      if (elapsed < COLLECTION_MS) {
        requestAnimationFrame(collect);
        return;
      }

      // Calcula erro Euclidiano médio para este ponto
      let error = 0;
      let meanPX = targetScreenX;
      let meanPY = targetScreenY;
      if (predictedX.length > 0) {
        meanPX = predictedX.reduce((s, v) => s + v, 0) / predictedX.length;
        meanPY = predictedY.reduce((s, v) => s + v, 0) / predictedY.length;
        const dx = meanPX - targetScreenX;
        const dy2 = meanPY - targetScreenY;
        error = Math.sqrt(dx * dx + dy2 * dy2);
      }

      let errorB: number | null = null;
      if (predictedBX.length > 0) {
        const bx = predictedBX.reduce((s, v) => s + v, 0) / predictedBX.length;
        const by = predictedBY.reduce((s, v) => s + v, 0) / predictedBY.length;
        errorB = Math.sqrt((bx - targetScreenX) ** 2 + (by - targetScreenY) ** 2);
      }
      let errorC: number | null = null;
      if (predictedCX.length > 0) {
        const cx = predictedCX.reduce((s, v) => s + v, 0) / predictedCX.length;
        const cy = predictedCY.reduce((s, v) => s + v, 0) / predictedCY.length;
        errorC = Math.sqrt((cx - targetScreenX) ** 2 + (cy - targetScreenY) ** 2);
      }

      pointErrors.push(error);
      diagnostics.push({
        groundX: targetScreenX,
        groundY: targetScreenY,
        predX: meanPX,
        predY: meanPY,
        error,
        name: vp.name,
        errorB,
        errorC,
      });

      pointIndex++;
      setTimeout(runNextPoint, 300);
    }

    requestAnimationFrame(collect);
  }

  // Pequena pausa inicial para o usuário se preparar
  setTimeout(runNextPoint, 500);
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
  onComplete: (result: AccuracyResult) => void
) {
  // Remove o overlay de coleta
  overlay.remove();

  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  const meanError = pointErrors.reduce((s, v) => s + v, 0) / pointErrors.length;
  const maxError = Math.max(...pointErrors);
  const diagonal = Math.sqrt(vw ** 2 + vh ** 2);
  const errorPct = (meanError / diagonal) * 100;

  // Converte erro médio para graus angulares
  const meanErrorDeg = (Math.atan(meanError / ASSUMED_DIST_PX) * 180) / Math.PI;

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
    meanError, maxError, errorPct, meanErrorDeg,
    score, colorClass, pointErrors,
  };

  // Persiste resultado para exibir após reload
  try {
    localStorage.setItem("accuracyResult", JSON.stringify({
      meanError, maxError, errorPct, meanErrorDeg, score, colorClass
    }));
  } catch (_) { }

  // Mostra o diagnóstico visual antes de chamar onComplete
  showDiagnosticOverlay(diagnostics, result, onComplete);
}

function showDiagnosticOverlay(
  diagnostics: PointDiagnostic[],
  result: AccuracyResult,
  onComplete: (result: AccuracyResult) => void
) {
  const vw = document.documentElement.clientWidth;
  const vh = document.documentElement.clientHeight;

  const overlay = document.createElement("div");
  overlay.id = "diagnostic-overlay";
  overlay.className = "diagnostic-overlay";

  // SVG para desenhar linhas, pontos e labels
  const svgNS = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(svgNS, "svg");
  svg.setAttribute("width", String(vw));
  svg.setAttribute("height", String(vh));
  svg.setAttribute("viewBox", `0 0 ${vw} ${vh}`);
  svg.classList.add("diagnostic-svg");

  for (const d of diagnostics) {
    // Linha conectando ground truth → predição
    const line = document.createElementNS(svgNS, "line");
    line.setAttribute("x1", String(d.groundX));
    line.setAttribute("y1", String(d.groundY));
    line.setAttribute("x2", String(d.predX));
    line.setAttribute("y2", String(d.predY));
    line.setAttribute("stroke", getErrorColor(d.error));
    line.setAttribute("stroke-width", "2");
    line.setAttribute("stroke-opacity", "0.8");
    svg.appendChild(line);

    // Ponto vermelho — ground truth
    const redDot = document.createElementNS(svgNS, "circle");
    redDot.setAttribute("cx", String(d.groundX));
    redDot.setAttribute("cy", String(d.groundY));
    redDot.setAttribute("r", "7");
    redDot.setAttribute("fill", "#ef4444");
    redDot.setAttribute("stroke", "#fff");
    redDot.setAttribute("stroke-width", "1.5");
    svg.appendChild(redDot);

    // Ponto verde — predição
    const greenDot = document.createElementNS(svgNS, "circle");
    greenDot.setAttribute("cx", String(d.predX));
    greenDot.setAttribute("cy", String(d.predY));
    greenDot.setAttribute("r", "7");
    greenDot.setAttribute("fill", "#22c55e");
    greenDot.setAttribute("stroke", "#fff");
    greenDot.setAttribute("stroke-width", "1.5");
    svg.appendChild(greenDot);

    // Label com erro em pixels
    const labelX = d.groundX + 14;
    const labelY = d.groundY - 14;

    // Background do label
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

    // Nome do ponto
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

  // Footer com informações e controles
  const footer = document.createElement("div");
  footer.className = "diagnostic-footer";

  const scoreColor = result.colorClass === 'accuracy-excellent' ? '#22c55e'
    : result.colorClass === 'accuracy-good' ? '#00fff0'
      : result.colorClass === 'accuracy-regular' ? '#ffcc00'
        : '#ef4444';

  const { B: hasB, C: hasC, cReason } = hasDevConfigs();
  let comparisonHtml = '';
  if (hasB || hasC) {
    const errorsB = diagnostics.map(d => d.errorB);
    const errorsC = diagnostics.map(d => d.errorC);

    const meanA = result.meanError;
    const maxA  = result.maxError;
    const degA  = result.meanErrorDeg;

    const validB = errorsB.filter((e): e is number => e !== null);
    const meanB  = validB.length ? validB.reduce((s, v) => s + v, 0) / validB.length : null;
    const maxB   = validB.length ? Math.max(...validB) : null;
    const degB   = meanB !== null ? (Math.atan(meanB / ASSUMED_DIST_PX) * 180) / Math.PI : null;

    const validC = errorsC.filter((e): e is number => e !== null);
    const meanC  = validC.length ? validC.reduce((s, v) => s + v, 0) / validC.length : null;
    const maxC   = validC.length ? Math.max(...validC) : null;
    const degC   = meanC !== null ? (Math.atan(meanC / ASSUMED_DIST_PX) * 180) / Math.PI : null;

    const THRESH_PX  = 45;
    const THRESH_DEG = 1.5;
    const flag = (err: number | null) => err !== null && err > THRESH_PX ? ' ✗' : '';
    const fmtErr = (e: number | null) => e !== null ? `${Math.round(e)}px${flag(e)}` : 'N/A';
    const fmtMean = (m: number | null, d: number | null) =>
      m !== null ? `${Math.round(m)}px / ${d!.toFixed(2)}°${(m > THRESH_PX || d! > THRESH_DEG) ? ' ✗' : ''}` : 'N/A';

    const rows = diagnostics.map(d => `
      <tr style="border-top:1px solid #222">
        <td style="padding:3px 6px;color:#aaa">${d.name}</td>
        <td style="text-align:right;padding:3px 6px;color:${d.error > THRESH_PX ? '#ef4444' : '#22c55e'}">${Math.round(d.error)}px${flag(d.error)}</td>
        ${hasB ? `<td style="text-align:right;padding:3px 6px;color:${d.errorB !== null && d.errorB > THRESH_PX ? '#ef4444' : '#22c55e'}">${fmtErr(d.errorB)}</td>` : ''}
        ${hasC ? `<td style="text-align:right;padding:3px 6px;color:${d.errorC !== null && d.errorC > THRESH_PX ? '#ef4444' : '#22c55e'}">${fmtErr(d.errorC)}</td>` : ''}
      </tr>
    `).join('');

    comparisonHtml = `
      <div style="margin-top:16px;border-top:1px solid #333;padding-top:12px">
        <div style="font-size:11px;font-weight:600;color:#00fff0;margin-bottom:8px;letter-spacing:.05em">
          COMPARAÇÃO DEV — A vs B${hasC ? ' vs C' : ''} (não é produção)
        </div>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <tr style="color:#666">
            <th style="text-align:left;padding:3px 6px">Ponto</th>
            <th style="text-align:right;padding:3px 6px">A Ridge+geo</th>
            ${hasB ? '<th style="text-align:right;padding:3px 6px">B KR+geo</th>' : ''}
            ${hasC ? '<th style="text-align:right;padding:3px 6px">C KR+fused</th>' : ''}
          </tr>
          ${rows}
          <tr style="border-top:2px solid #444;font-weight:600">
            <td style="padding:4px 6px;color:#ccc">Média / graus</td>
            <td style="text-align:right;padding:4px 6px;color:${meanA > THRESH_PX || degA > THRESH_DEG ? '#ef4444' : '#22c55e'}">${fmtMean(meanA, degA)}</td>
            ${hasB ? `<td style="text-align:right;padding:4px 6px;color:${meanB !== null && (meanB > THRESH_PX || (degB ?? 0) > THRESH_DEG) ? '#ef4444' : '#22c55e'}">${fmtMean(meanB, degB)}</td>` : ''}
            ${hasC ? `<td style="text-align:right;padding:4px 6px;color:${meanC !== null && (meanC > THRESH_PX || (degC ?? 0) > THRESH_DEG) ? '#ef4444' : '#22c55e'}">${fmtMean(meanC, degC)}</td>` : ''}
          </tr>
          <tr>
            <td style="padding:2px 6px;color:#666">Máximo</td>
            <td style="text-align:right;padding:2px 6px;color:#888">${Math.round(maxA)}px</td>
            ${hasB ? `<td style="text-align:right;padding:2px 6px;color:#888">${maxB !== null ? Math.round(maxB)+'px' : 'N/A'}</td>` : ''}
            ${hasC ? `<td style="text-align:right;padding:2px 6px;color:#888">${maxC !== null ? Math.round(maxC)+'px' : 'N/A'}</td>` : ''}
          </tr>
        </table>
        <div style="font-size:10px;color:#555;margin-top:6px">✗ = acima do limiar de produção (≤45px / ≤1.5°)</div>
        ${hasB && !hasC && cReason ? `<div style="font-size:10px;color:#888;margin-top:6px">Config C não disponível: ${cReason}</div>` : ''}
      </div>
    `;
  }

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

      ${comparisonHtml}

      <div class="diagnostic-actions">
        Pressione <kbd>Espaço</kbd> para continuar ou <kbd>R</kbd> para recalibrar
      </div>
    </div>
  `;
  overlay.appendChild(footer);

  document.body.appendChild(overlay);

  // Animação de entrada
  requestAnimationFrame(() => overlay.classList.add("visible"));

  // Handle keyboard
  function handleKey(e: KeyboardEvent) {
    if (e.code === 'Space') {
      e.preventDefault();
      overlay.classList.remove("visible");
      setTimeout(() => {
        overlay.remove();
        document.removeEventListener('keydown', handleKey);
        onComplete(result);
      }, 300);
    } else if (e.code === 'KeyR') {
      e.preventDefault();
      overlay.remove();
      document.removeEventListener('keydown', handleKey);
      onComplete(result);
      // Trigger recalibração
      startPreCalibration();
    }
  }

  document.addEventListener('keydown', handleKey);
}

function getErrorColor(error: number): string {
  if (error < 50) return '#22c55e';    // Verde - excelente
  if (error < 100) return '#ffcc00';   // Amarelo - regular
  return '#ef4444';                     // Vermelho - ruim
}
