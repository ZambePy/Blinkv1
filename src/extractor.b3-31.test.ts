import { describe, it, expect } from 'vitest';
import {
  BlinkDetector,
  extractCompactFeatures,
  irisVisibilityFromEar,
} from './extractor';
import type { Point3D } from './extractor';

// -----------------------------------------------------------------------------
// B3.31 — `irisVisibilityPercentage` era uma constante disfarçada de medida.
//
// A expressão era `Math.min(1.0, ear / 0.25)`, com o comentário do módulo
// afirmando que este era o único campo de qualidade "medido de verdade".
//
// O problema não é o `min` — é o divisor. 0,25 é um número fixo comparado
// contra o EAR de um rosto qualquer, e o EAR de repouso NÃO é universal:
// depende da anatomia da pálpebra da pessoa, da distância à câmera e da pose.
// Com a mediana medida no repositório, a conta satura:
//
//   antes de B2.6 (EAR anisotrópico):  0,551 / 0,25 = 2,20  → min → 1,0
//   depois de B2.6 (EAR isotrópico):   0,314 / 0,25 = 1,26  → min → 1,0
//
// Ou seja: **nem o B2.6 resolveu**. O campo continuava grampeado em 1,0 em
// praticamente todo quadro de olho aberto, e — pior — também num olho
// PARCIALMENTE fechado, que é justamente o caso que o gate de qualidade da
// calibração tenta barrar com `irisVisibilityPercentage < 0.3`.
//
// A correção é medir contra o repouso DA PESSOA, que o `BlinkDetector` já
// mantém: ele acumula a média do EAR dos quadros sem piscada exatamente para
// adaptar o limiar. Reusar essa estatística transforma o campo numa fração real
// de abertura em vez de um teto constante.
// -----------------------------------------------------------------------------

describe('irisVisibilityFromEar — a função pura', () => {
  it('olho na abertura de repouso vale 1,0', () => {
    expect(irisVisibilityFromEar(0.31, 0.31)).toBeCloseTo(1.0, 6);
  });

  it('olho pela metade vale ~0,5 — era exatamente isto que saturava em 1,0', () => {
    expect(irisVisibilityFromEar(0.155, 0.31)).toBeCloseTo(0.5, 6);
    // A fórmula antiga, para comparação: min(1, 0.155/0.25) = 0,62 — e com o
    // EAR pré-B2.6 (0,275) daria 1,0 cravado. O gate de `< 0.3` nunca disparava.
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

  it('SEM linha de base devolve undefined — não medido nunca é zero (B3.3)', () => {
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
    // pela metade. Um divisor fixo trataria as duas de forma diferente — que é
    // o defeito original.
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

/** Rosto com abertura ocular de tamanho físico conhecido (mesmo molde do teste
 *  de `B2.6`, onde a anisotropia do MediaPipe é reproduzida de propósito). */
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

  it('OLHO PELA METADE não satura mais — a regressão que define este bug', () => {
    const d = new BlinkDetector({ minHistory: 15 });
    const aberto = rosto(ABERTO.altura, ABERTO.largura, W, H);
    for (let i = 0; i < 20; i++) extractCompactFeatures(aberto, undefined, null, d, W, H);

    const meio = rosto(ABERTO.altura / 2, ABERTO.largura, W, H);
    const r = extractCompactFeatures(meio, undefined, null, d, W, H);
    const v = r.advancedFeatures!.quality!.irisVisibilityPercentage!;

    // O comportamento antigo devolvia exatamente 1,0 aqui: o EAR isotrópico
    // deste rosto pela metade ainda é 0,176, e 0,176/0,25 = 0,71 — e com o EAR
    // ANISOTRÓPICO original (0,314) daria 1,0 cravado. Em nenhum dos dois casos
    // o gate de `< 0.3` chegaria perto de disparar.
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
