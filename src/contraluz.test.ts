import { describe, expect, it } from 'vitest';
import {
  classificarContraluz,
  mensagemDeContraluz,
  RAZAO_ATENCAO,
  RAZAO_FORTE,
  separarLuminancia,
} from './contraluz';

/** Monta um quadro RGBA cinza com um retângulo de outro cinza dentro. */
function quadro(
  largura: number,
  altura: number,
  fundo: number,
  retangulo: { x0: number; y0: number; x1: number; y1: number },
  dentro: number,
): Uint8ClampedArray {
  const px = new Uint8ClampedArray(largura * altura * 4);
  for (let y = 0; y < altura; y++) {
    for (let x = 0; x < largura; x++) {
      const i = (y * largura + x) * 4;
      const v =
        x >= retangulo.x0 && x < retangulo.x1 && y >= retangulo.y0 && y < retangulo.y1 ? dentro : fundo;
      px[i] = px[i + 1] = px[i + 2] = Math.round(v * 255);
      px[i + 3] = 255;
    }
  }
  return px;
}

describe('separação de luminância', () => {
  it('separa o que está dentro do retângulo do que está fora', () => {
    // 10×10, rosto ocupando o quadrante superior esquerdo 4×4.
    const px = quadro(10, 10, 0.8, { x0: 0, y0: 0, x1: 4, y1: 4 }, 0.2);
    const r = separarLuminancia(px, 10, 10, { x: 0, y: 0, largura: 0.4, altura: 0.4 });
    expect(r.rosto).toBeCloseTo(0.2, 2);
    expect(r.fundo).toBeCloseTo(0.8, 2);
  });

  it('não conta o rosto duas vezes no fundo', () => {
    const px = quadro(10, 10, 1, { x0: 0, y0: 0, x1: 10, y1: 10 }, 0);
    const r = separarLuminancia(px, 10, 10, { x: 0, y: 0, largura: 1, altura: 1 });
    expect(r.rosto).toBeCloseTo(0, 3);
    // Fundo vazio devolve 0, não NaN.
    expect(r.fundo).toBe(0);
  });

  it('retângulo fora do quadro não estoura os índices', () => {
    const px = quadro(8, 8, 0.5, { x0: 0, y0: 0, x1: 0, y1: 0 }, 0);
    const r = separarLuminancia(px, 8, 8, { x: -0.5, y: -0.5, largura: 3, altura: 3 });
    expect(Number.isFinite(r.rosto)).toBe(true);
    expect(Number.isFinite(r.fundo)).toBe(true);
  });

  it('usa a ponderação perceptual, não a média dos canais', () => {
    // Verde puro é bem mais claro que azul puro para o olho — e para a
    // exposição automática da câmera, que é o que estamos modelando.
    const verde = new Uint8ClampedArray([0, 255, 0, 255]);
    const azul = new Uint8ClampedArray([0, 0, 255, 255]);
    const lv = separarLuminancia(verde, 1, 1, { x: 0, y: 0, largura: 1, altura: 1 }).rosto;
    const la = separarLuminancia(azul, 1, 1, { x: 0, y: 0, largura: 1, altura: 1 }).rosto;
    expect(lv).toBeGreaterThan(la * 4);
  });
});

describe('classificação de contraluz', () => {
  it('sala iluminada de frente não é contraluz', () => {
    const m = classificarContraluz(0.55, 0.5);
    expect(m.nivel).toBe('ok');
    expect(m.razao).toBeLessThan(1);
  });

  it('janela atrás da pessoa vira contraluz forte', () => {
    // O caso real: rosto em silhueta, fundo estourado.
    const m = classificarContraluz(0.18, 0.75);
    expect(m.nivel).toBe('forte');
    expect(mensagemDeContraluz(m)).toContain('cortina');
  });

  it('respeita as bordas dos limiares', () => {
    expect(classificarContraluz(0.5, 0.5 * (RAZAO_ATENCAO - 0.01)).nivel).toBe('ok');
    expect(classificarContraluz(0.5, 0.5 * RAZAO_ATENCAO).nivel).toBe('atencao');
    expect(classificarContraluz(0.5, 0.5 * RAZAO_FORTE).nivel).toBe('forte');
  });

  it('rosto escuro demais é "indefinido", nunca "sem contraluz"', () => {
    // Quarto escuro com a janela ao fundo: a divisão explodiria, e devolver
    // 'ok' aqui afirmaria "o rosto está tão claro quanto o fundo" — falso, e
    // falso exatamente no caso que este módulo existe para pegar.
    const m = classificarContraluz(0.001, 0.4);
    expect(m.nivel).toBe('indefinido');
    expect(m.razao).toBe(0);
    expect(mensagemDeContraluz(m)).toContain('escuro demais');
  });

  it('valores inválidos não produzem NaN nem veredito positivo', () => {
    const m = classificarContraluz(Number.NaN, Number.POSITIVE_INFINITY);
    expect(Number.isFinite(m.razao)).toBe(true);
    expect(m.nivel).toBe('indefinido');
  });

  it('a mensagem de atenção não manda fechar a cortina como se fosse grave', () => {
    const m = classificarContraluz(0.4, 0.4 * 2);
    expect(m.nivel).toBe('atencao');
    expect(mensagemDeContraluz(m)).toContain('Ainda funciona');
  });
});
