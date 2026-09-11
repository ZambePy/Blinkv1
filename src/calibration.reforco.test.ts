import { describe, expect, it } from 'vitest';
import {
  MAX_ECCENTRICITY_DEG,
  MAX_ECCENTRICITY_DEG_BAIXO,
  alvosDeReforco,
  computeCalibrationTargets,
  type CalibrationGeometry,
} from './calibration';

/** A bancada de referência do projeto: 23,6" a 60 cm, 1920×1080. */
const geometria: CalibrationGeometry = {
  screenWidthPx: 1920,
  screenHeightPx: 1080,
  screenDiagonalIn: 23.6,
  viewingDistanceCm: 60,
  maxEccentricityDeg: MAX_ECCENTRICITY_DEG,
  maxEccentricityDegBaixo: MAX_ECCENTRICITY_DEG_BAIXO,
};

describe('grade com orçamento assimétrico (sprint S4)', () => {
  it('a linha de baixo sobe, e só ela', () => {
    const alvos = computeCalibrationTargets(geometria);
    const ys = [...new Set(alvos.map((a) => a.y))].sort((a, b) => a - b);
    expect(ys).toHaveLength(3);
    const [cima, meio, baixo] = ys;
    expect(meio).toBeCloseTo(0.5, 6);
    // A distância do centro para baixo é MENOR que para cima: é a pálpebra,
    // não a simetria da tela, que decide até onde o olho continua visível.
    expect(baixo - 0.5).toBeLessThan(0.5 - cima);
  });

  it('sem a assimetria, a grade volta a ser simétrica — a mudança é só esta', () => {
    const simetrica = computeCalibrationTargets({
      ...geometria, maxEccentricityDegBaixo: MAX_ECCENTRICITY_DEG,
    });
    const ys = [...new Set(simetrica.map((a) => a.y))].sort((a, b) => a - b);
    expect(ys[1] - ys[0]).toBeCloseTo(ys[2] - ys[1], 9);
  });

  it('um orçamento para baixo maior que o geral não amplia nada', () => {
    // Passar 40° para baixo não pode romper o teto de 16° das outras direções:
    // seria contrabandear excentricidade por uma porta lateral.
    const exagerado = computeCalibrationTargets({ ...geometria, maxEccentricityDegBaixo: 40 });
    const simetrica = computeCalibrationTargets({
      ...geometria, maxEccentricityDegBaixo: MAX_ECCENTRICITY_DEG,
    });
    const maxY = (a: { y: number }[]) => Math.max(...a.map((p) => p.y));
    expect(maxY(exagerado)).toBeCloseTo(maxY(simetrica), 9);
  });

  it('o modo rápido também respeita a assimetria', () => {
    const rapida = computeCalibrationTargets(geometria, true);
    expect(rapida).toHaveLength(4);
    const ys = [...new Set(rapida.map((a) => a.y))].sort((a, b) => a - b);
    expect(ys[1] - 0.5).toBeLessThan(0.5 - ys[0]);
  });
});

describe('alvosDeReforco (sprint S4)', () => {
  /** Nove alvos com erro uniforme, exceto os que a chamada pedir. */
  function loo(piores: Record<number, number> = {}, base = 60) {
    const alvos = computeCalibrationTargets(geometria);
    return alvos.map((a, i) => ({ x: a.x, y: a.y, errorPx: piores[i] ?? base }));
  }

  it('grade uniforme não gera reforço nenhum', () => {
    expect(alvosDeReforco(loo(), geometria)).toEqual([]);
  });

  it('um alvo muito pior gera vizinhos ao redor dele', () => {
    // Índice 6 é o canto inferior esquerdo na ordem da grade.
    const reforco = alvosDeReforco(loo({ 6: 300 }), geometria);
    expect(reforco.length).toBeGreaterThan(0);
    const ruim = loo({ 6: 300 })[6];
    for (const p of reforco) {
      // Todo reforço fica do mesmo lado do centro que o alvo ruim.
      expect(Math.sign(p.x - 0.5)).toBe(Math.sign(ruim.x - 0.5));
      expect(Math.sign(p.y - 0.5)).toBe(Math.sign(ruim.y - 0.5));
    }
  });

  it('nunca passa do orçamento angular da grade', () => {
    const reforco = alvosDeReforco(loo({ 6: 900, 8: 800 }), geometria);
    const cantos = computeCalibrationTargets(geometria, true);
    const xMin = Math.min(...cantos.map((c) => c.x));
    const xMax = Math.max(...cantos.map((c) => c.x));
    const yMin = Math.min(...cantos.map((c) => c.y));
    const yMax = Math.max(...cantos.map((c) => c.y));
    for (const p of reforco) {
      expect(p.x).toBeGreaterThanOrEqual(xMin);
      expect(p.x).toBeLessThanOrEqual(xMax);
      expect(p.y).toBeGreaterThanOrEqual(yMin);
      expect(p.y).toBeLessThanOrEqual(yMax);
    }
  });

  it('respeita o teto de alvos extras — o orçamento de fadiga é real', () => {
    const reforco = alvosDeReforco(loo({ 0: 900, 2: 880, 6: 870, 8: 860 }), geometria, {
      piores: 4, maximo: 3,
    });
    expect(reforco.length).toBeLessThanOrEqual(3);
  });

  it('não repete um alvo que a grade já tem', () => {
    const base = loo({ 6: 300 });
    const reforco = alvosDeReforco(base, geometria);
    for (const p of reforco) {
      for (const a of base) {
        expect(Math.hypot(p.x - a.x, p.y - a.y)).toBeGreaterThanOrEqual(0.03);
      }
    }
  });

  it('sem alvos suficientes ou com erro degenerado, não inventa nada', () => {
    expect(alvosDeReforco([], geometria)).toEqual([]);
    expect(alvosDeReforco(loo().slice(0, 2), geometria)).toEqual([]);
    expect(alvosDeReforco(loo({}, 0), geometria)).toEqual([]);
    const comNaN = loo().map((t) => ({ ...t, errorPx: NaN }));
    expect(alvosDeReforco(comNaN, geometria)).toEqual([]);
  });

  it('um alvo apenas um pouco pior não justifica gastar tempo do paciente', () => {
    // 1,3× a mediana está dentro do ruído de uma calibração; o corte é 1,5×.
    expect(alvosDeReforco(loo({ 6: 78 }), geometria)).toEqual([]);
  });
});
