import { describe, it, expect } from 'vitest';
import {
  GammaCorrector,
  gammaFromHistogram,
  histogramFromGray,
  GAMMA_MIN,
  GAMMA_MAX,
  GAMMA_HYSTERESIS,
  GAMMA_TARGET_MEAN,
} from './gamma';

// P4.6 — correção de gama derivada do histograma.
//
// ── A convenção, porque a especificação é ambígua ────────────────────────────
//
// `saida = 255 · (entrada/255)^γ`. Com essa convenção **γ < 1 CLAREIA** e γ > 1
// escurece. A frase do plano ("subexposto (γ < 0,8) aumenta, superexposto
// (γ > 1,2) diminui") lê-se então como: numa imagem subexposta o γ ESCOLHIDO
// cai abaixo de 0,8, e o efeito disso é aumentar o brilho. É a leitura que
// mantém a faixa [0,6; 1,4] simétrica em torno de 1,0.
//
// ── Por que histerese ────────────────────────────────────────────────────────
//
// O γ é recalculado a cada frame a partir do histograma, e o histograma treme
// com ruído de sensor. Sem histerese, γ oscila entre frames vizinhos, a LUT é
// reconstruída toda hora, e — pior — o crop que alimenta o L2CS muda de
// aparência sem que a cena tenha mudado. Isso é ruído injetado na entrada do
// modelo, que é exatamente o que o pré-processamento deveria remover.

/** Histograma de uma imagem sintética com média conhecida. */
function histComMedia(media0a1: number, espalhamento = 20): Int32Array {
  const centro = Math.round(media0a1 * 255);
  const h = new Int32Array(256);
  for (let d = -espalhamento; d <= espalhamento; d++) {
    const i = Math.min(255, Math.max(0, centro + d));
    h[i] += 100;
  }
  return h;
}

describe('histogramFromGray', () => {
  it('conta cada pixel exatamente uma vez', () => {
    const h = histogramFromGray(new Uint8ClampedArray([0, 0, 128, 255]));
    expect(h[0]).toBe(2);
    expect(h[128]).toBe(1);
    expect(h[255]).toBe(1);
    expect(h.reduce((a, b) => a + b, 0)).toBe(4);
  });
});

describe('gammaFromHistogram', () => {
  it('imagem no alvo devolve γ ≈ 1 — nada a corrigir', () => {
    const g = gammaFromHistogram(histComMedia(GAMMA_TARGET_MEAN));
    expect(g).toBeCloseTo(1.0, 1);
  });

  it('imagem subexposta escolhe γ < 0,8 (clareia)', () => {
    const g = gammaFromHistogram(histComMedia(0.15));
    expect(g).toBeLessThan(0.8);
    expect(g).toBeGreaterThanOrEqual(GAMMA_MIN);
  });

  it('imagem superexposta escolhe γ > 1,2 (escurece)', () => {
    const g = gammaFromHistogram(histComMedia(0.85));
    expect(g).toBeGreaterThan(1.2);
    expect(g).toBeLessThanOrEqual(GAMMA_MAX);
  });

  it('a faixa é fechada em [0,6; 1,4], mesmo no extremo', () => {
    expect(gammaFromHistogram(histComMedia(0.02, 1))).toBe(GAMMA_MIN);
    expect(gammaFromHistogram(histComMedia(0.99, 1))).toBe(GAMMA_MAX);
    expect(GAMMA_MIN).toBe(0.6);
    expect(GAMMA_MAX).toBe(1.4);
  });

  it('é monótono: quanto mais escura a imagem, menor o γ', () => {
    const gs = [0.10, 0.20, 0.30, 0.45, 0.60, 0.75].map((m) => gammaFromHistogram(histComMedia(m)));
    for (let i = 1; i < gs.length; i++) expect(gs[i]).toBeGreaterThanOrEqual(gs[i - 1]);
  });

  it('histograma vazio devolve 1,0 em vez de NaN', () => {
    // Um NaN aqui viraria uma LUT inteira de NaN e um crop preto entregue ao
    // L2CS — o modo de falha silencioso que este repositório já pagou caro.
    expect(gammaFromHistogram(new Int32Array(256))).toBe(1.0);
  });

  it('imagem toda preta não explode o logaritmo', () => {
    const h = new Int32Array(256);
    h[0] = 1000;
    const g = gammaFromHistogram(h);
    expect(Number.isFinite(g)).toBe(true);
    expect(g).toBe(GAMMA_MIN);
  });
});

describe('GammaCorrector — histerese', () => {
  it('ruído de ±2% no histograma NÃO muda o γ', () => {
    const c = new GammaCorrector();
    const base = c.update(histComMedia(0.25));
    const reconstrucoesIniciais = c.lutRebuilds;
    // Perturba o histograma em ±2% e realimenta várias vezes.
    for (let k = 0; k < 10; k++) {
      const h = histComMedia(0.25);
      for (let i = 0; i < 256; i++) {
        h[i] = Math.round(h[i] * (k % 2 === 0 ? 1.02 : 0.98));
      }
      expect(c.update(h)).toBe(base);
    }
    expect(c.lutRebuilds).toBe(reconstrucoesIniciais);
  });

  it('mudança real de iluminação passa pela histerese', () => {
    const c = new GammaCorrector();
    const escuro = c.update(histComMedia(0.15));
    const claro = c.update(histComMedia(0.80));
    expect(claro).toBeGreaterThan(escuro + GAMMA_HYSTERESIS);
  });

  it('a LUT é reconstruída SÓ quando o γ muda, não a cada frame', () => {
    // Exercita o padrão real de uso: um `update` por frame, seguido de um uso
    // da LUT. A construção é preguiçosa (γ que muda sem frame processado não
    // paga LUT), então o contador só faz sentido com o uso no meio.
    const c = new GammaCorrector();
    const frame = new Uint8ClampedArray([10, 20, 30, 255]);

    c.update(histComMedia(0.20));
    c.applyRGBA(frame);
    expect(c.lutRebuilds).toBe(1);

    // Dez frames com a mesma iluminação: nenhuma reconstrução.
    for (let i = 0; i < 10; i++) {
      c.update(histComMedia(0.20));
      c.update(histComMedia(0.205)); // dentro da histerese
      c.applyRGBA(frame);
    }
    expect(c.lutRebuilds).toBe(1);

    // Mudança real de iluminação: exatamente uma reconstrução.
    c.update(histComMedia(0.80));
    c.applyRGBA(frame);
    expect(c.lutRebuilds).toBe(2);
  });

  it('o limiar de histerese é o declarado, e não um número solto', () => {
    expect(GAMMA_HYSTERESIS).toBeGreaterThan(0);
    expect(GAMMA_HYSTERESIS).toBeLessThan(0.2);
  });

  it('reset volta ao estado neutro', () => {
    const c = new GammaCorrector();
    c.update(histComMedia(0.15));
    expect(c.gamma).toBeLessThan(1);
    c.reset();
    expect(c.gamma).toBe(1.0);
    expect(c.lutRebuilds).toBe(0);
  });
});

describe('GammaCorrector — aplicação', () => {
  function rgbaCinza(valores: number[]): Uint8ClampedArray {
    const out = new Uint8ClampedArray(valores.length * 4);
    valores.forEach((v, i) => {
      out[i * 4] = v; out[i * 4 + 1] = v; out[i * 4 + 2] = v; out[i * 4 + 3] = 200;
    });
    return out;
  }

  it('γ = 1 é identidade', () => {
    const c = new GammaCorrector();
    const src = rgbaCinza([0, 50, 128, 200, 255]);
    const out = c.applyRGBA(src);
    expect(Array.from(out)).toEqual(Array.from(src));
  });

  it('γ < 1 clareia todos os tons intermediários, preservando 0 e 255', () => {
    const c = new GammaCorrector();
    c.update(histComMedia(0.15)); // γ < 1
    const out = c.applyRGBA(rgbaCinza([0, 64, 128, 192, 255]));
    expect(out[0]).toBe(0);                    // preto continua preto
    expect(out[4]).toBeGreaterThan(64);
    expect(out[8]).toBeGreaterThan(128);
    expect(out[12]).toBeGreaterThan(192);
    expect(out[16]).toBe(255);                 // branco continua branco
  });

  it('γ > 1 escurece os tons intermediários', () => {
    const c = new GammaCorrector();
    c.update(histComMedia(0.85)); // γ > 1
    const out = c.applyRGBA(rgbaCinza([0, 64, 128, 192, 255]));
    expect(out[4]).toBeLessThan(64);
    expect(out[8]).toBeLessThan(128);
    expect(out[16]).toBe(255);
  });

  it('preserva o alfa e não altera a entrada', () => {
    const c = new GammaCorrector();
    c.update(histComMedia(0.15));
    const src = rgbaCinza([10, 90, 200]);
    const copia = Uint8ClampedArray.from(src);
    const out = c.applyRGBA(src);
    expect(out[3]).toBe(200);
    expect(Array.from(src)).toEqual(Array.from(copia));
  });

  it('o mapeamento é monótono — não inverte ordem de tons', () => {
    const c = new GammaCorrector();
    c.update(histComMedia(0.15));
    const lut = c.lut();
    for (let i = 1; i < 256; i++) expect(lut[i]).toBeGreaterThanOrEqual(lut[i - 1]);
  });

  it('é determinístico entre execuções', () => {
    const a = new GammaCorrector();
    const b = new GammaCorrector();
    a.update(histComMedia(0.2));
    b.update(histComMedia(0.2));
    const src = rgbaCinza([5, 77, 199, 255]);
    expect(Array.from(a.applyRGBA(src))).toEqual(Array.from(b.applyRGBA(src)));
  });

  it('buffer que não é múltiplo de 4 é rejeitado alto', () => {
    const c = new GammaCorrector();
    expect(() => c.applyRGBA(new Uint8ClampedArray(7))).toThrow(/RGBA/i);
  });
});
