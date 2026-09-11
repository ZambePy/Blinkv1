import { describe, expect, it } from 'vitest';
import { RidgeRegressor } from './ridge';
import { normalizarPorGrupo } from './calibration/pesoDaAmostra';

/**
 * Sprint S1: a amostra ruim continua entrando no treino, mas com peso baixo.
 *
 * O teste monta um caso onde a resposta certa é conhecida — um mapa linear
 * exato — e envenena algumas amostras de um alvo. Sem peso, o Ridge persegue o
 * veneno; com peso, ele o ignora quase por completo.
 */

/** Mapa verdadeiro: x = 100 + 800·f0, y = 50 + 600·f1. */
const verdadeX = (f: number[]) => 100 + 800 * f[0];
const verdadeY = (f: number[]) => 50 + 600 * f[1];

function conjunto(veneno: number) {
  const features: number[][] = [];
  const tx: number[] = [];
  const ty: number[] = [];
  const grupos: string[] = [];
  const pesos: number[] = [];

  const alvos = [
    [0.1, 0.1], [0.5, 0.1], [0.9, 0.1],
    [0.1, 0.5], [0.5, 0.5], [0.9, 0.5],
    [0.1, 0.9], [0.5, 0.9], [0.9, 0.9],
  ];

  alvos.forEach(([a, b], k) => {
    for (let i = 0; i < 10; i++) {
      // Ruído determinístico e minúsculo: o teste não é sobre ruído.
      const f = [a + Math.sin(k * 7 + i) * 0.002, b + Math.cos(k * 5 + i) * 0.002];
      // O último alvo tem 4 amostras envenenadas — o equivalente a quatro
      // quadros com a pálpebra caída em cima do olho.
      const ruim = k === 8 && i >= 6;
      features.push(ruim ? [f[0] - veneno, f[1] - veneno] : f);
      tx.push(verdadeX([a, b]));
      ty.push(verdadeY([a, b]));
      grupos.push(`${k}`);
      pesos.push(ruim ? 0.05 : 1);
    }
  });

  return { features, tx, ty, grupos, pesos };
}

function erroMedio(r: RidgeRegressor, features: number[][], tx: number[], ty: number[]): number {
  let soma = 0;
  for (let i = 0; i < features.length; i++) {
    const p = r.predict(features[i]);
    soma += Math.hypot(p.x - tx[i], p.y - ty[i]);
  }
  return soma / features.length;
}

describe('pesos de qualidade no Ridge', () => {
  it('a amostra envenenada manda menos quando pesa menos', () => {
    const { features, tx, ty, grupos, pesos } = conjunto(0.25);
    const normalizados = normalizarPorGrupo(pesos, grupos);

    const semPeso = new RidgeRegressor();
    semPeso.train(features, tx, ty, grupos);

    const comPeso = new RidgeRegressor();
    comPeso.train(features, tx, ty, grupos, undefined, normalizados);

    // Mede nas amostras LIMPAS: é onde o veneno não deveria ter chegado.
    const limpas = features.map((f, i) => ({ f, i })).filter(({ i }) => pesos[i] === 1);
    const fL = limpas.map((c) => c.f);
    const xL = limpas.map((c) => tx[c.i]);
    const yL = limpas.map((c) => ty[c.i]);

    const eSem = erroMedio(semPeso, fL, xL, yL);
    const eCom = erroMedio(comPeso, fL, xL, yL);
    expect(eCom).toBeLessThan(eSem);
  });

  it('sem amostra ruim, o peso uniforme não muda nada', () => {
    const { features, tx, ty, grupos } = conjunto(0);
    const semPeso = new RidgeRegressor();
    semPeso.train(features, tx, ty, grupos);
    const comPeso = new RidgeRegressor();
    comPeso.train(features, tx, ty, grupos, undefined, features.map(() => 1));

    const a = semPeso.predict(features[0]);
    const b = comPeso.predict(features[0]);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
  });

  it('vetor de peso com comprimento errado é ignorado, não corrompe o ajuste', () => {
    const { features, tx, ty, grupos } = conjunto(0);
    const referencia = new RidgeRegressor();
    referencia.train(features, tx, ty, grupos);
    const curto = new RidgeRegressor();
    curto.train(features, tx, ty, grupos, undefined, [1, 1, 1]);

    const a = referencia.predict(features[5]);
    const b = curto.predict(features[5]);
    expect(b.x).toBeCloseTo(a.x, 6);
    expect(b.y).toBeCloseTo(a.y, 6);
  });
});
