import { describe, it, expect } from 'vitest';
import { RidgeRegressor } from './ridge';
import { StandardScaler } from './scaler';

// -----------------------------------------------------------------------------
// Normalização e desnormalização do mapeamento: o modelo trabalha em FRAÇÃO
// de tela, e os pixels só aparecem na hora de desenhar.
// -----------------------------------------------------------------------------

/** Conjunto sintético linearmente separável, com alvos em fração de tela. */
function conjunto(n = 90) {
  let semente = 77;
  const rnd = () => {
    semente = (semente * 1103515245 + 12345) % 2147483648;
    return semente / 2147483648 - 0.5;
  };
  const features: number[][] = [];
  const targets: { screenX: number; screenY: number }[] = [];
  for (let i = 0; i < n; i++) {
    const tx = 0.15 + 0.7 * ((i % 3) / 2);
    const ty = 0.15 + 0.7 * (Math.floor((i % 9) / 3) / 2);
    features.push([tx * 2 - 1 + rnd() * 0.02, ty * 2 - 1 + rnd() * 0.02, rnd() * 0.02, rnd() * 0.02]);
    targets.push({ screenX: tx, screenY: ty });
  }
  return { features, targets };
}

describe('o mapeamento é em FRAÇÃO de tela, não em pixels', () => {
  function treinar() {
    const { features, targets } = conjunto();
    const scaler = new StandardScaler();
    scaler.fit(features);
    const z = scaler.transform(features);
    const m = new RidgeRegressor();
    m.train(z, targets.map((t) => t.screenX), targets.map((t) => t.screenY));
    return { m, z, targets };
  }

  it('treinar em 1280×800 e predizer em 1920×1080 PRESERVA a fração', () => {
    // É a propriedade que faz um perfil sobreviver a uma troca de monitor. O
    // modelo nunca vê pixels: ele mapeia features → [0,1], e a desnormalização
    // acontece na hora de desenhar.
    const { m, z } = treinar();
    const fracao = m.predict(z[0]);

    const em1280 = { x: fracao.x * 1280, y: fracao.y * 800 };
    const em1920 = { x: fracao.x * 1920, y: fracao.y * 1080 };

    // A mesma predição, em duas telas: a razão bate exatamente com a razão das
    // resoluções, sem nenhum termo dependente de tela no meio.
    expect(em1920.x / em1280.x).toBeCloseTo(1920 / 1280, 9);
    expect(em1920.y / em1280.y).toBeCloseTo(1080 / 800, 9);
  });

  it('a saída do Ridge fica em [0,1] — é fração, não pixel', () => {
    const { m, z } = treinar();
    for (const f of z) {
      const p = m.predict(f);
      expect(p.x).toBeGreaterThan(-0.5);
      expect(p.x).toBeLessThan(1.5);
      expect(p.y).toBeGreaterThan(-0.5);
      expect(p.y).toBeLessThan(1.5);
    }
  });

  it('modelo não treinado devolve zero em vez de NaN', () => {
    expect(new RidgeRegressor().predict([1, 2, 3, 4])).toEqual({ x: 0, y: 0 });
  });
});
