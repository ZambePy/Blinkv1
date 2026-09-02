import { describe, it, expect } from 'vitest';
import { computeFitDiagnostics } from './calibration';

// Regressão da conflação de unidades.
//
// A métrica antiga fazia `hypot(dx_normalizado, dy_normalizado) × diagonal`.
// Isso trata fração-da-largura e fração-da-altura como se valessem o mesmo, e
// depois escala pela diagonal: num erro puro de Y o resultado saía 104% maior
// que o real. O relatório 1787858613170 reportou treino=170px por causa disso.
describe('erro de ajuste em pixels, por eixo', () => {
  it('sem regressor treinado devolve zero em vez de NaN', () => {
    const d = computeFitDiagnostics([[0]], [[0]], [{ screenX: 0.5, screenY: 0.5 }], undefined, { w: 1920, h: 1080 });
    expect(Number.isFinite(d.trainErrorPx)).toBe(true);
  });

  it('a agregação por alvo continua reportando amostras', () => {
    const feats = [[0], [0], [1], [1]];
    const targets = [
      { screenX: 0.2, screenY: 0.5 }, { screenX: 0.2, screenY: 0.5 },
      { screenX: 0.8, screenY: 0.5 }, { screenX: 0.8, screenY: 0.5 },
    ];
    const d = computeFitDiagnostics(feats, feats, targets, undefined, { w: 1920, h: 1080 });
    expect(d.samplesPerTarget).toEqual([2, 2]);
  });
});
