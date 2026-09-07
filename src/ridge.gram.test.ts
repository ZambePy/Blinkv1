import { describe, it, expect } from 'vitest';
import { trainRidgeModel, computeNormalEquations, LAMBDA_GRID } from './ridge';

/**
 * As equações normais (Φᵀ W Φ e Φᵀ W y) NÃO dependem de λ — só a regularização
 * somada à diagonal depende. Mesmo argumento que já vale para `penaltyMatrix`.
 *
 * Sem reusá-las, a busca de λ recomputa a Gram a cada tentativa: com 27 dims e
 * ~570 amostras por fold são ~447 mil multiplicações por chamada, × 25 λ × 9
 * folds × 2 olhos. Medido antes desta mudança: 1346 ms dos 1537 ms que a
 * calibração inteira levava — a tela congelada no fim do último alvo.
 *
 * O contrato aqui é que reusar não pode MUDAR o modelo. Se mudar, o ganho de
 * tempo virou mudança silenciosa de resultado, e todo relatório anterior deixa
 * de ser comparável.
 */

function dados(n: number, dims: number) {
  let semente = 7;
  const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648 - 0.5; };
  const features: number[][] = [];
  const targets: { screenX: number; screenY: number }[] = [];
  const groups: string[] = [];
  for (let i = 0; i < n; i++) {
    const x = (i % 3) / 2, y = Math.floor(i / 3 % 3) / 2;
    features.push(Array.from({ length: dims }, (_, d) => (d % 2 ? y : x) * (1 + d * 0.1) + rnd() * 0.02));
    targets.push({ screenX: x, screenY: y });
    groups.push(`${x},${y}`);
  }
  return { features, targets, groups };
}

describe('equações normais reusadas entre os λ', () => {
  it('modelo com Gram precomputada é IDÊNTICO ao sem', () => {
    const { features, targets } = dados(90, 8);
    const ne = computeNormalEquations(features, targets, null);
    for (const lambda of [0.001, 0.1, 1, 10]) {
      const semReuso = trainRidgeModel(features, targets, lambda);
      const comReuso = trainRidgeModel(features, targets, lambda, { normalEquations: ne });
      expect(comReuso.betaX, `λ=${lambda} betaX`).toEqual(semReuso.betaX);
      expect(comReuso.betaY, `λ=${lambda} betaY`).toEqual(semReuso.betaY);
      expect(comReuso.nearSingularCols, `λ=${lambda}`).toEqual(semReuso.nearSingularCols);
    }
  });

  it('idêntico também com pesos por amostra', () => {
    const { features, targets } = dados(60, 6);
    const pesos = features.map((_, i) => 1 + (i % 4) * 0.5);
    const ne = computeNormalEquations(features, targets, pesos);
    const semReuso = trainRidgeModel(features, targets, 0.05, { sampleWeights: pesos });
    const comReuso = trainRidgeModel(features, targets, 0.05, { sampleWeights: pesos, normalEquations: ne });
    expect(comReuso.betaX).toEqual(semReuso.betaX);
    expect(comReuso.betaY).toEqual(semReuso.betaY);
  });

  it('idêntico com penalidade anisotrópica (o caminho do CV real)', () => {
    const { features, targets, groups } = dados(90, 8);
    const ne = computeNormalEquations(features, targets, null);
    for (const lambda of [LAMBDA_GRID[0], LAMBDA_GRID[LAMBDA_GRID.length - 1]]) {
      const semReuso = trainRidgeModel(features, targets, lambda, { groups });
      const comReuso = trainRidgeModel(features, targets, lambda, { groups, normalEquations: ne });
      expect(comReuso.betaX, `λ=${lambda}`).toEqual(semReuso.betaX);
      expect(comReuso.betaY, `λ=${lambda}`).toEqual(semReuso.betaY);
      expect(comReuso.penalty).toBe(semReuso.penalty);
    }
  });

  it('λ por eixo diferente também bate', () => {
    const { features, targets } = dados(60, 6);
    const ne = computeNormalEquations(features, targets, null);
    const semReuso = trainRidgeModel(features, targets, { x: 0.01, y: 5 });
    const comReuso = trainRidgeModel(features, targets, { x: 0.01, y: 5 }, { normalEquations: ne });
    expect(comReuso.betaX).toEqual(semReuso.betaX);
    expect(comReuso.betaY).toEqual(semReuso.betaY);
  });

  it('perfil vazio continua devolvendo modelo vazio', () => {
    expect(trainRidgeModel([], [], 1, { normalEquations: null }).numFeatures).toBe(0);
  });
});
