import { describe, it, expect } from 'vitest';
import { applyPreprocessRGBA, PREPROCESS_ORDER } from './pipeline';
import { GammaCorrector, histogramFromGray } from './gamma';
import { preprocessFromRGBA, IMAGENET_MEAN, IMAGENET_STD } from '../l2cs/crop';

// P4.7 — auditar a normalização ImageNet.
//
// A normalização em si JÁ ESTAVA CORRETA e foi verificada na análise: RGB na
// ordem certa, NCHW com planos contíguos, `/255` antes de `(x−mean)/std`,
// mean/std batendo com `l2cs.meta.json`. Esta tarefa não mexe nela. O que ela
// faz é fechar as duas portas que o caminho novo abriu:
//
//   1. CLAHE e gama têm que rodar ANTES da normalização, sobre bytes 0..255.
//      Depois seria sobre valores já centrados em zero, onde "histograma" e
//      "gama" não significam mais nada — e o erro não teria sintoma visível,
//      só um modelo recebendo entrada fora da distribuição de treino.
//   2. Ninguém pode normalizar duas vezes. Uma segunda passagem levaria a
//      entrada para ~(x−0,45)/0,225 sobre um valor já centrado, e o L2CS
//      responderia com ângulos plausíveis sobre lixo — o mesmo modo de falha
//      de `B3.1`.

/** Imagem sintética com valores conhecidos. */
function rgbaGradiente(w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    const v = 40 + Math.round((i / (w * h - 1)) * 60); // faixa estreita: 40..100
    out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 255;
  }
  return out;
}

describe('ordem do pré-processamento', () => {
  it('a ordem declarada é CLAHE → gama → normalização', () => {
    expect(PREPROCESS_ORDER).toEqual(['clahe', 'gamma', 'normalize']);
  });

  it('os passos aplicados saem na ordem declarada', () => {
    const w = 32, h = 32;
    const r = applyPreprocessRGBA(rgbaGradiente(w, h), w, h, {
      clahe: true,
      gamma: new GammaCorrector(),
    });
    expect(r.steps).toEqual(['clahe', 'gamma']);
  });

  it('só CLAHE, só gama, ou nenhum: os passos refletem o que rodou', () => {
    const w = 16, h = 16;
    const src = rgbaGradiente(w, h);
    expect(applyPreprocessRGBA(src, w, h, { clahe: true }).steps).toEqual(['clahe']);
    expect(applyPreprocessRGBA(src, w, h, { gamma: new GammaCorrector() }).steps).toEqual(['gamma']);
    expect(applyPreprocessRGBA(src, w, h, {}).steps).toEqual([]);
  });

  it('sem nenhum passo, devolve a MESMA referência — custo zero quando desligado', () => {
    // O caminho quente roda a 10 Hz sobre 448². Copiar 800 KB por frame para
    // não fazer nada seria pagar pelo estágio desligado.
    const w = 8, h = 8;
    const src = rgbaGradiente(w, h);
    expect(applyPreprocessRGBA(src, w, h, {}).rgba).toBe(src);
  });

  it('o gama enxerga o histograma DEPOIS do CLAHE, não antes', () => {
    // Se a ordem invertesse, o γ seria escolhido a partir de um histograma que
    // o CLAHE ainda vai mudar, e a correção chegaria sempre defasada de um
    // estágio. Verificável pelo γ resultante: CLAHE espalha a faixa 40..100,
    // então a média sobe e o γ escolhido difere do que sairia do original.
    const w = 32, h = 32;
    const src = rgbaGradiente(w, h);
    const g = new GammaCorrector();
    applyPreprocessRGBA(src, w, h, { clahe: true, gamma: g });
    const gamaComClahe = g.gamma;

    const gSemClahe = new GammaCorrector();
    applyPreprocessRGBA(src, w, h, { gamma: gSemClahe });
    expect(gamaComClahe).not.toBe(gSemClahe.gamma);
  });
});

describe('normalização — aplicada exatamente uma vez', () => {
  it('o pré-processamento NÃO normaliza: a saída continua sendo bytes 0..255', () => {
    const w = 32, h = 32;
    const r = applyPreprocessRGBA(rgbaGradiente(w, h), w, h, {
      clahe: true,
      gamma: new GammaCorrector(),
    });
    expect(r.rgba).toBeInstanceOf(Uint8ClampedArray);
    expect(Array.from(r.rgba).every((v) => v >= 0 && v <= 255)).toBe(true);
    // Alfa intacto — o L2CS ignora, mas um alfa corrompido denunciaria que
    // algum passo tratou o buffer como 3 canais.
    for (let i = 3; i < r.rgba.length; i += 4) expect(r.rgba[i]).toBe(255);
  });

  it('normalizar o resultado dá exatamente (x/255 − mean)/std, uma vez só', () => {
    const size = 8;
    const r = applyPreprocessRGBA(rgbaGradiente(size, size), size, size, { clahe: true });
    const tensor = preprocessFromRGBA(r.rgba, size);
    const px = size * size;
    for (let i = 0; i < px; i++) {
      expect(tensor[i]).toBeCloseTo((r.rgba[i * 4] / 255 - IMAGENET_MEAN[0]) / IMAGENET_STD[0], 6);
      expect(tensor[px + i]).toBeCloseTo((r.rgba[i * 4 + 1] / 255 - IMAGENET_MEAN[1]) / IMAGENET_STD[1], 6);
      expect(tensor[2 * px + i]).toBeCloseTo((r.rgba[i * 4 + 2] / 255 - IMAGENET_MEAN[2]) / IMAGENET_STD[2], 6);
    }
  });

  it('os valores normalizados ficam na faixa que o modelo espera', () => {
    // Com bytes em 0..255, o extremo é (0−mean)/std e (1−mean)/std por canal.
    const size = 8;
    const src = new Uint8ClampedArray(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      src[i * 4] = i % 2 === 0 ? 0 : 255;
      src[i * 4 + 1] = i % 2 === 0 ? 0 : 255;
      src[i * 4 + 2] = i % 2 === 0 ? 0 : 255;
      src[i * 4 + 3] = 255;
    }
    const r = applyPreprocessRGBA(src, size, size, { clahe: true, gamma: new GammaCorrector() });
    const tensor = preprocessFromRGBA(r.rgba, size);
    let menor = Infinity, maior = -Infinity;
    for (const v of tensor) { if (v < menor) menor = v; if (v > maior) maior = v; }
    const menorTeorico = Math.min(...IMAGENET_MEAN.map((m, i) => (0 - m) / IMAGENET_STD[i]));
    const maiorTeorico = Math.max(...IMAGENET_MEAN.map((m, i) => (1 - m) / IMAGENET_STD[i]));
    expect(menor).toBeGreaterThanOrEqual(menorTeorico - 1e-6);
    expect(maior).toBeLessThanOrEqual(maiorTeorico + 1e-6);
  });

  it('uma segunda normalização seria detectável — a asserção que guarda a porta', () => {
    // Não é teste do código: é a demonstração de qual seria o dano, para que
    // quem introduzir a segunda passagem veja o número aqui.
    const uma = (v: number) => (v / 255 - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    const duas = (v: number) => (uma(v) / 255 - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    expect(uma(128)).toBeCloseTo(0.077, 2);
    expect(duas(128)).toBeCloseTo(-2.117, 2);
    expect(Math.abs(duas(128) - uma(128))).toBeGreaterThan(2);
  });
});

describe('CLAHE restrito à região dos olhos (P4.5)', () => {
  it('fora da região, o pixel não é tocado', () => {
    const w = 64, h = 64;
    const src = rgbaGradiente(w, h);
    const r = applyPreprocessRGBA(src, w, h, {
      clahe: true,
      eyeRegion: { x: 16, y: 16, width: 32, height: 16 },
    });
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const dentro = x >= 16 && x < 48 && y >= 16 && y < 32;
        if (dentro) continue;
        const i = (y * w + x) * 4;
        expect(r.rgba[i]).toBe(src[i]);
      }
    }
  });

  it('dentro da região, o contraste aumenta', () => {
    const w = 64, h = 64;
    const src = rgbaGradiente(w, h);
    const regiao = { x: 16, y: 16, width: 32, height: 16 };
    const r = applyPreprocessRGBA(src, w, h, { clahe: true, eyeRegion: regiao });
    const antes: number[] = [];
    const depois: number[] = [];
    for (let y = regiao.y; y < regiao.y + regiao.height; y++) {
      for (let x = regiao.x; x < regiao.x + regiao.width; x++) {
        const i = (y * w + x) * 4;
        antes.push(src[i]);
        depois.push(r.rgba[i]);
      }
    }
    const desvio = (v: number[]) => {
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length);
    };
    expect(desvio(depois)).toBeGreaterThan(desvio(antes));
  });

  it('região fora dos limites é rejeitada em vez de ler lixo', () => {
    const w = 32, h = 32;
    expect(() => applyPreprocessRGBA(rgbaGradiente(w, h), w, h, {
      clahe: true, eyeRegion: { x: 20, y: 20, width: 40, height: 40 },
    })).toThrow(/região|regiao/i);
  });

  it('região degenerada é rejeitada', () => {
    const w = 32, h = 32;
    expect(() => applyPreprocessRGBA(rgbaGradiente(w, h), w, h, {
      clahe: true, eyeRegion: { x: 0, y: 0, width: 0, height: 8 },
    })).toThrow(/região|regiao/i);
  });
});

describe('integração gama ↔ histograma', () => {
  it('o γ vem do histograma do frame corrente, não de um valor fixo', () => {
    const w = 32, h = 32;
    const escuro = new Uint8ClampedArray(w * h * 4).fill(255);
    for (let i = 0; i < w * h; i++) {
      escuro[i * 4] = 30; escuro[i * 4 + 1] = 30; escuro[i * 4 + 2] = 30;
    }
    const g = new GammaCorrector();
    applyPreprocessRGBA(escuro, w, h, { gamma: g });
    expect(g.gamma).toBeLessThan(1); // clareia

    const luma = new Uint8ClampedArray(w * h).fill(30);
    expect(g.gamma).toBeCloseTo(
      new GammaCorrector().update(histogramFromGray(luma)), 6,
    );
  });
});
