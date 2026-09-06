import { describe, it, expect } from 'vitest';
import {
  BlinkDetector,
  extractCompactFeatures,
  irisVisibilityFromEar,
} from './extractor';
import type { Point3D } from './extractor';

// `irisVisibilityPercentage` é a fração de abertura do olho em relação ao
// repouso DA PESSOA (`BlinkDetector.restingEar`), não `min(1, ear / 0.25)`:
// com divisor fixo a conta satura em 1,0 (0,314 / 0,25 = 1,26) até para olho
// parcialmente fechado, e o gate `< 0.3` da calibração nunca dispara.

describe('irisVisibilityFromEar — a função pura', () => {
  it('olho na abertura de repouso vale 1,0', () => {
    expect(irisVisibilityFromEar(0.31, 0.31)).toBeCloseTo(1.0, 6);
  });

  it('olho pela metade vale ~0,5, não satura em 1,0', () => {
    expect(irisVisibilityFromEar(0.155, 0.31)).toBeCloseTo(0.5, 6);
    // Com divisor fixo: min(1, 0.155/0.25) = 0,62 — e com EAR anisotrópico
    // (0,275) daria 1,0 cravado. O gate de `< 0.3` nunca dispararia.
    expect(Math.min(1, 0.155 / 0.25)).toBeGreaterThan(0.6);
  });

  it('olho quase fechado cai abaixo do limiar de 0,3 que o gate usa', () => {
    expect(irisVisibilityFromEar(0.06, 0.31)).toBeLessThan(0.3);
  });

  it('olho mais aberto que o repouso é grampeado em 1,0, não 1,4', () => {
    expect(irisVisibilityFromEar(0.45, 0.31)).toBe(1);
  });

  it('nunca devolve negativo', () => {
    expect(irisVisibilityFromEar(-0.01, 0.31)).toBe(0);
  });

  it('sem linha de base devolve undefined — não medido nunca é zero', () => {
    // Devolver 0 diria "íris totalmente oculta" e reprovaria o quadro; devolver
    // 1 diria "perfeitamente visível" e aprovaria qualquer coisa. As duas são
    // afirmações que ninguém mediu. `undefined` é a única resposta honesta
    // enquanto o repouso da pessoa não foi observado.
    expect(irisVisibilityFromEar(0.31, null)).toBeUndefined();
  });

  it('linha de base degenerada devolve undefined em vez de dividir por zero', () => {
    expect(irisVisibilityFromEar(0.31, 0)).toBeUndefined();
    expect(irisVisibilityFromEar(0.31, -1)).toBeUndefined();
    expect(irisVisibilityFromEar(0.31, NaN)).toBeUndefined();
  });

  it('EAR não-finito devolve undefined', () => {
    expect(irisVisibilityFromEar(NaN, 0.31)).toBeUndefined();
    expect(irisVisibilityFromEar(Infinity, 0.31)).toBeUndefined();
  });

  it('a escala é RELATIVA: a mesma fração vale para anatomias diferentes', () => {
    // Duas pessoas com aberturas de repouso bem diferentes, ambas com o olho
    // pela metade. Um divisor fixo trataria as duas de forma diferente.
    expect(irisVisibilityFromEar(0.11, 0.22)).toBeCloseTo(0.5, 6);
    expect(irisVisibilityFromEar(0.21, 0.42)).toBeCloseTo(0.5, 6);
  });
});

describe('BlinkDetector.restingEar — a linha de base', () => {
  it('é null enquanto não há histórico suficiente', () => {
    const d = new BlinkDetector({ minHistory: 5 });
    expect(d.restingEar).toBeNull();
    for (let i = 0; i < 4; i++) d.update(0.31, 1000 + i);
    expect(d.restingEar).toBeNull();
  });

  it('vira a média dos quadros SEM piscada assim que há histórico', () => {
    const d = new BlinkDetector({ minHistory: 5 });
    for (let i = 0; i < 5; i++) d.update(0.30, 1000 + i);
    expect(d.restingEar).toBeCloseTo(0.30, 6);
  });

  it('a piscada NÃO contamina a linha de base', () => {
    // É a propriedade que torna a razão interpretável: se o olho fechado
    // entrasse na média, o repouso desceria e a piscada seguinte pareceria
    // menos fechada do que é.
    const d = new BlinkDetector({ minHistory: 5 });
    for (let i = 0; i < 10; i++) d.update(0.30, 1000 + i);
    const antes = d.restingEar!;
    for (let i = 0; i < 5; i++) d.update(0.02, 2000 + i); // piscadas
    expect(d.restingEar).toBeCloseTo(antes, 6);
  });

  it('reset apaga a linha de base — sessão nova, pessoa possivelmente outra', () => {
    const d = new BlinkDetector({ minHistory: 5 });
    for (let i = 0; i < 5; i++) d.update(0.30, 1000 + i);
    d.reset();
    expect(d.restingEar).toBeNull();
  });
});

// -----------------------------------------------------------------------------
// Caminho real: `extractCompactFeatures` com rosto sintético.
// -----------------------------------------------------------------------------

/** Rosto com abertura ocular de tamanho físico conhecido (mesmo molde de
 *  extractor.earIsotropico.test.ts, que reproduz a anisotropia do MediaPipe). */
function rosto(alturaPx: number, larguraPx: number, W: number, H: number): Point3D[] {
  const p: Point3D[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const meiaLargura = larguraPx / W / 2;
  const meiaAltura = alturaPx / H / 2;
  const olho = (cx: number, cy: number, idx: { e: number; d: number; c: number; b: number }) => {
    p[idx.e] = { x: cx - meiaLargura, y: cy, z: 0 };
    p[idx.d] = { x: cx + meiaLargura, y: cy, z: 0 };
    p[idx.c] = { x: cx, y: cy - meiaAltura, z: 0 };
    p[idx.b] = { x: cx, y: cy + meiaAltura, z: 0 };
  };
  olho(0.40, 0.45, { e: 33, d: 133, c: 159, b: 145 });
  olho(0.60, 0.45, { e: 362, d: 263, c: 386, b: 374 });
  p[468] = { x: 0.40, y: 0.45, z: 0 };
  p[473] = { x: 0.60, y: 0.45, z: 0 };
  for (const i of [469, 470, 471, 472]) p[i] = { x: 0.40, y: 0.45, z: 0 };
  for (const i of [474, 475, 476, 477]) p[i] = { x: 0.60, y: 0.45, z: 0 };
  p[1] = { x: 0.5, y: 0.5, z: 0 };
  p[10] = { x: 0.5, y: 0.3, z: 0 };
  p[152] = { x: 0.5, y: 0.7, z: 0 };
  return p;
}

describe('extractCompactFeatures — o campo publicado', () => {
  const W = 1920, H = 1080;
  const ABERTO = { altura: 12, largura: 34 };   // EAR isotrópico ~0,353

  it('antes da linha de base, o campo é undefined em vez de 1,0 fabricado', () => {
    const d = new BlinkDetector({ minHistory: 15 });
    const r = extractCompactFeatures(rosto(ABERTO.altura, ABERTO.largura, W, H), undefined, null, d, W, H);
    expect(r.advancedFeatures?.quality?.irisVisibilityPercentage).toBeUndefined();
  });

  it('com a linha de base formada, olho aberto dá ~1,0', () => {
    const d = new BlinkDetector({ minHistory: 15 });
    const face = rosto(ABERTO.altura, ABERTO.largura, W, H);
    for (let i = 0; i < 20; i++) extractCompactFeatures(face, undefined, null, d, W, H);
    const r = extractCompactFeatures(face, undefined, null, d, W, H);
    expect(r.advancedFeatures!.quality!.irisVisibilityPercentage!).toBeCloseTo(1.0, 2);
  });

  it('olho pela metade não satura', () => {
    const d = new BlinkDetector({ minHistory: 15 });
    const aberto = rosto(ABERTO.altura, ABERTO.largura, W, H);
    for (let i = 0; i < 20; i++) extractCompactFeatures(aberto, undefined, null, d, W, H);

    const meio = rosto(ABERTO.altura / 2, ABERTO.largura, W, H);
    const r = extractCompactFeatures(meio, undefined, null, d, W, H);
    const v = r.advancedFeatures!.quality!.irisVisibilityPercentage!;

    // Com divisor fixo: o EAR isotrópico deste rosto pela metade é 0,176, e
    // 0,176/0,25 = 0,71 — com EAR anisotrópico (0,314) daria 1,0 cravado. Em
    // nenhum dos dois casos o gate de `< 0.3` chegaria perto de disparar.
    expect(v).toBeLessThan(0.7);
    expect(v).toBeCloseTo(0.5, 1);
  });

  it('o campo é comparável entre pessoas de anatomia diferente', () => {
    // Duas anatomias com aberturas de repouso distintas; as duas com o olho
    // fechando para 40% do próprio repouso têm que publicar ~0,4.
    const medir = (alturaRepouso: number) => {
      const d = new BlinkDetector({ minHistory: 15 });
      const aberto = rosto(alturaRepouso, ABERTO.largura, W, H);
      for (let i = 0; i < 20; i++) extractCompactFeatures(aberto, undefined, null, d, W, H);
      const r = extractCompactFeatures(rosto(alturaRepouso * 0.4, ABERTO.largura, W, H), undefined, null, d, W, H);
      return r.advancedFeatures!.quality!.irisVisibilityPercentage!;
    };
    expect(medir(10)).toBeCloseTo(0.4, 1);
    expect(medir(18)).toBeCloseTo(0.4, 1);
  });
});
