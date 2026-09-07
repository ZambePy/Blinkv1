import { describe, it, expect } from 'vitest';
import { checkValidationOverlap } from './accuracy';
import { computeCalibrationTargets, MAX_ECCENTRICITY_DEG, DEFAULT_SCREEN_DIAGONAL_IN, DEFAULT_VIEWING_DISTANCE_CM } from './calibration';

// A grade interior 25/50/75 é interpolação nos dois eixos (cabe dentro do
// fecho de calibração); só o anel de borda em 5%/95% mede extrapolação de
// verdade — onde a UI põe botões.
const GEOM = {
  screenWidthPx: 1920, screenHeightPx: 1080,
  screenDiagonalIn: DEFAULT_SCREEN_DIAGONAL_IN,
  viewingDistanceCm: DEFAULT_VIEWING_DISTANCE_CM,
  maxEccentricityDeg: MAX_ECCENTRICITY_DEG,
};
const alvos = computeCalibrationTargets(GEOM, false);
const faixa = (vals: number[]) => ({ min: Math.min(...vals), max: Math.max(...vals) });
const calX = faixa(alvos.map((t) => t.x));
const calY = faixa(alvos.map((t) => t.y));

describe('grade interior — os dois eixos são interpolação', () => {
  it('25/75 cabe dentro do fecho de calibração em X', () => {
    expect(0.25).toBeGreaterThan(calX.min);
    expect(0.75).toBeLessThan(calX.max);
  });

  it('25/75 cabe dentro do fecho de calibração em Y', () => {
    expect(0.25).toBeGreaterThan(calY.min);
    expect(0.75).toBeLessThan(calY.max);
  });
});

describe('anel de borda — extrapolação de verdade', () => {
  const cantos = [
    { x: 0.05, y: 0.05 }, { x: 0.95, y: 0.05 },
    { x: 0.05, y: 0.95 }, { x: 0.95, y: 0.95 },
  ];

  it('os cantos ficam FORA do fecho de calibração em X', () => {
    for (const c of cantos) {
      expect(c.x < calX.min || c.x > calX.max).toBe(true);
    }
  });

  it('os cantos não colidem com alvos de calibração', () => {
    // Coincidir mediria memorização. Em Y os cantos caem sobre o nível dos
    // alvos (5%/95%), mas o guarda exige coincidência nos DOIS eixos.
    const pontos = cantos.map((c, i) => ({ name: `B${i + 1}`, screenX: c.x, screenY: c.y }));
    expect(checkValidationOverlap(alvos, pontos)).toEqual([]);
  });

  it('são 4 cantos, não o anel de 8 — custo de fadiga', () => {
    // Cada ponto custa 2,3 s. Nove pontos ≈ 21 s, treze ≈ 30 s, dezessete ≈ 39 s.
    // Fadiga degrada a própria medição que se quer fazer.
    expect(cantos).toHaveLength(4);
  });
});
