import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { detectOutlierPoints, type CalibrationPoint } from './calibration';
import { EXPERIMENT } from './config/experiment';

// Fase 1.A: desliga expansão polinomial neste arquivo — os testes constroem
// features 4-D com mapeamento identidade para target. Com polynomialFeatures=true
// a expansão para 14 dims com apenas 4 amostras de treino causa near-singularity
// e falsos positivos no detector de outliers. O comportamento do detector em si
// é correto; o que muda é apenas a dimensão dos dados sintéticos.
beforeAll(() => {
  (EXPERIMENT as { polynomialFeatures: boolean }).polynomialFeatures = false;
});
afterAll(() => {
  (EXPERIMENT as { polynomialFeatures: boolean }).polynomialFeatures = true;
});

// D4.1 (ROADMAP §5) — detectOutlierPoints.
//
// Estratégia dos testes: construímos uma grade sintética em que o mapeamento
// feature → target é LINEAR e SEM ruído, então o Ridge LOO consegue prever
// cada alvo deixado de fora com erro perto de zero. Isso deixa o algoritmo
// de MAD sair com resíduos ~ 0 em todos os alvos. Quando injetamos um ponto
// com features EMBARALHADAS (ruído estruturado), o resíduo naquele alvo
// explode em relação à mediana e a asserção captura o outlier.

/** 9 alvos numa grade 3×3 em [0.1, 0.5, 0.9] × [0.1, 0.5, 0.9]. */
function makeGrid(): { x: number; y: number }[] {
  const grid = [];
  const vals = [0.1, 0.5, 0.9];
  for (const y of vals) for (const x of vals) grid.push({ x, y });
  return grid;
}

/** Ponto sintético cujas features SÃO literalmente o target (mapeamento
 *  identidade). Duas amostras por alvo para simular a captura real. */
function goodPoint(x: number, y: number): CalibrationPoint {
  return {
    screenX: x,
    screenY: y,
    featuresLeft:  [x, y, x * y, x - y],
    featuresRight: [x, y, x * y, y - x],
  };
}

describe('detectOutlierPoints', () => {
  it('sem ruído (todos os pontos bons) → 0 outliers', () => {
    const grid = makeGrid();
    const pts: CalibrationPoint[] = [];
    for (const { x, y } of grid) {
      pts.push(goodPoint(x, y));
      pts.push(goodPoint(x, y));
    }
    const rep = detectOutlierPoints(pts);
    expect(rep.reason).toBeUndefined();
    expect(rep.targetCount).toBe(9);
    expect(rep.perTarget).toHaveLength(9);
    expect(rep.outlierIndices).toHaveLength(0);
    for (const t of rep.perTarget) expect(t.isOutlier).toBe(false);
  });

  it('1 ponto ruim entre 8 bons → marca justamente aquele alvo', () => {
    const grid = makeGrid();
    const badIdx = 4; // alvo central
    const pts: CalibrationPoint[] = [];
    for (let i = 0; i < grid.length; i++) {
      const { x, y } = grid[i];
      if (i === badIdx) {
        // Features desconectadas do target — Ridge treinado sem esse alvo
        // não consegue predizê-lo minimamente.
        pts.push({
          screenX: x,
          screenY: y,
          featuresLeft:  [10, -10, 5, -5],
          featuresRight: [-10, 10, -5, 5],
        });
        pts.push({
          screenX: x,
          screenY: y,
          featuresLeft:  [10, -10, 5, -5],
          featuresRight: [-10, 10, -5, 5],
        });
      } else {
        pts.push(goodPoint(x, y));
        pts.push(goodPoint(x, y));
      }
    }
    const rep = detectOutlierPoints(pts);
    expect(rep.reason).toBeUndefined();
    const flagged = rep.perTarget.filter((t) => t.isOutlier);
    expect(flagged.length).toBeGreaterThanOrEqual(1);
    // O alvo central (0.5, 0.5) DEVE estar entre os flagged.
    expect(flagged.some((t) => t.screenX === 0.5 && t.screenY === 0.5)).toBe(true);
    // Índices retornados devem apontar para as amostras do alvo ruim.
    // Duas amostras por alvo × 1 alvo ruim = ao menos 2 índices.
    expect(rep.outlierIndices.length).toBeGreaterThanOrEqual(2);
  });

  it('< 3 alvos únicos → reason: insufficient_targets, perTarget vazio', () => {
    const pts: CalibrationPoint[] = [
      goodPoint(0.1, 0.1),
      goodPoint(0.5, 0.5),
    ];
    const rep = detectOutlierPoints(pts);
    expect(rep.reason).toBe('insufficient_targets');
    expect(rep.perTarget).toHaveLength(0);
    expect(rep.outlierIndices).toHaveLength(0);
  });

  it('features vazias → reason: training_failed', () => {
    const grid = makeGrid();
    const pts: CalibrationPoint[] = grid.flatMap(({ x, y }) => [
      { screenX: x, screenY: y, featuresLeft: [], featuresRight: [] },
    ]);
    const rep = detectOutlierPoints(pts);
    expect(rep.reason).toBe('training_failed');
  });

  it('N=3 alvos (mínimo aceitável) — roda sem crash, MAD sobre 3 pontos', () => {
    // Riscos do ROADMAP D4: MAD com N pequeno é frágil. Este teste garante
    // que o algoritmo pelo menos não CRASHA no limite inferior, e reporta
    // targetCount fidedigno. Não afirma nada sobre a robustez estatística —
    // que o próprio ROADMAP marca como "sinal indicativo, não conclusivo".
    const pts: CalibrationPoint[] = [
      goodPoint(0.1, 0.5), goodPoint(0.1, 0.5),
      goodPoint(0.5, 0.5), goodPoint(0.5, 0.5),
      goodPoint(0.9, 0.5), goodPoint(0.9, 0.5),
    ];
    const rep = detectOutlierPoints(pts);
    expect(rep.reason).toBeUndefined();
    expect(rep.targetCount).toBe(3);
    expect(rep.perTarget).toHaveLength(3);
    // Sem ruído, todos ~ 0 residual → nenhum acima do threshold.
    expect(rep.outlierIndices).toHaveLength(0);
  });

  it('median residual e mad são não-negativos e finitos no caso feliz', () => {
    const grid = makeGrid();
    const pts: CalibrationPoint[] = grid.flatMap(({ x, y }) => [
      goodPoint(x, y), goodPoint(x, y),
    ]);
    const rep = detectOutlierPoints(pts);
    expect(Number.isFinite(rep.medianResidual)).toBe(true);
    expect(rep.medianResidual).toBeGreaterThanOrEqual(0);
    expect(Number.isFinite(rep.mad)).toBe(true);
    expect(rep.mad).toBeGreaterThanOrEqual(0);
    expect(rep.madThreshold).toBeGreaterThanOrEqual(0);
  });

  it('outlierIndices coincide com todas as amostras dos alvos marcados', () => {
    // Se um alvo tem 3 amostras e é marcado como outlier, os 3 índices devem
    // aparecer em outlierIndices — a UI que consumir isso vai querer descartar
    // TODAS as amostras daquele alvo, não uma só.
    const grid = makeGrid();
    const pts: CalibrationPoint[] = [];
    const badX = 0.9, badY = 0.1; // canto — 3 amostras ruins
    for (const { x, y } of grid) {
      if (x === badX && y === badY) {
        for (let i = 0; i < 3; i++) {
          pts.push({
            screenX: x,
            screenY: y,
            featuresLeft:  [999, -999, 999, -999],
            featuresRight: [-999, 999, -999, 999],
          });
        }
      } else {
        pts.push(goodPoint(x, y));
        pts.push(goodPoint(x, y));
      }
    }
    const rep = detectOutlierPoints(pts);
    const badTarget = rep.perTarget.find((t) => t.screenX === badX && t.screenY === badY);
    expect(badTarget?.isOutlier).toBe(true);
    // 3 amostras do alvo ruim → outlierIndices contém ao menos 3 índices
    // consecutivos apontando para esse alvo.
    expect(rep.outlierIndices.length).toBeGreaterThanOrEqual(3);
    // Cada índice reportado como outlier realmente aponta pra uma amostra do
    // alvo (badX, badY).
    for (const idx of rep.outlierIndices) {
      expect(pts[idx].screenX).toBe(badX);
      expect(pts[idx].screenY).toBe(badY);
    }
  });
});
