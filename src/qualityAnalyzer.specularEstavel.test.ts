import { describe, it, expect } from 'vitest';
import { estabilidadeEspecular, ESPECULAR_ESTAVEL_MIN } from './qualityAnalyzer';

// -----------------------------------------------------------------------------
// Separar assinatura de óculos de reflexo que atrapalha.
//
// O sintoma: o sistema acusava reflexo quase sempre que havia óculos, o
// usuário calibrava assim mesmo, e o erro saía normal. Ou seja, o aviso não
// previa degradação nenhuma.
//
// A causa não era o limiar, era o DISCRIMINADOR. `specularPersistence` — a
// fração de quadros com brilho alto — foi criada para separar reflexo de ruído
// passageiro, e faz isso bem. Mas para separar óculos de reflexo nocivo ela
// está invertida: um brilho fixo na armação ou na lente está presente em TODOS
// os quadros, então marca persistência ≈ 1,0 e dispara o aviso sempre. Um
// reflexo de janela que realmente atrapalha se MOVE, e pode até ser
// intermitente.
//
// O que separa os dois é se a mancha clara muda de lugar entre quadros. Parada
// = assinatura do próprio óculos, e o detector enxerga em volta dela sessão
// inteira. Movendo = algo entrando e saindo do olho, que é o que estraga o
// landmark.
// -----------------------------------------------------------------------------

/** Máscara de brilho como o analisador produz: 1 = pixel quase saturado. */
const mascara = (...pixels: number[]) => Uint8Array.from(pixels);

describe('mancha parada — assinatura de óculos', () => {
  it('máscara idêntica entre quadros é totalmente estável', () => {
    const a = mascara(0, 1, 1, 0, 0, 0, 0, 0);
    expect(estabilidadeEspecular(a, a)).toBe(1);
  });

  it('a estabilidade de uma mancha parada fica acima do limiar', () => {
    const a = mascara(0, 1, 1, 1, 0, 0, 0, 0);
    expect(estabilidadeEspecular(a, a)).toBeGreaterThanOrEqual(ESPECULAR_ESTAVEL_MIN);
  });

  it('tolera um pixel tremendo na borda — a cabeça nunca está imóvel', () => {
    const a = mascara(0, 1, 1, 1, 1, 1, 1, 1, 1, 0);
    const b = mascara(0, 1, 1, 1, 1, 1, 1, 1, 0, 0);
    expect(estabilidadeEspecular(a, b)).toBeGreaterThanOrEqual(ESPECULAR_ESTAVEL_MIN);
  });
});

describe('mancha que se move — reflexo de verdade', () => {
  it('mancha que troca de lugar tem estabilidade baixa', () => {
    const a = mascara(1, 1, 1, 1, 0, 0, 0, 0);
    const b = mascara(0, 0, 0, 0, 1, 1, 1, 1);
    expect(estabilidadeEspecular(a, b)).toBe(0);
  });

  it('mancha que se move fica abaixo do limiar', () => {
    const a = mascara(1, 1, 1, 0, 0, 0, 0, 0);
    const b = mascara(0, 0, 1, 1, 1, 0, 0, 0);
    expect(estabilidadeEspecular(a, b)).toBeLessThan(ESPECULAR_ESTAVEL_MIN);
  });

  it('mancha que aparece do nada não é estável', () => {
    const a = mascara(0, 0, 0, 0, 0, 0, 0, 0);
    const b = mascara(1, 1, 1, 1, 0, 0, 0, 0);
    expect(estabilidadeEspecular(a, b)).toBe(0);
  });

  it('mancha que some não é estável', () => {
    const a = mascara(1, 1, 1, 1, 0, 0, 0, 0);
    const b = mascara(0, 0, 0, 0, 0, 0, 0, 0);
    expect(estabilidadeEspecular(a, b)).toBe(0);
  });
});

describe('casos degenerados', () => {
  it('sem brilho em quadro nenhum devolve 1 — nada instável acontecendo', () => {
    // Não há mancha; chamar isso de "instável" produziria aviso onde não há
    // nem reflexo.
    const vazia = mascara(0, 0, 0, 0);
    expect(estabilidadeEspecular(vazia, vazia)).toBe(1);
  });

  it('sem quadro anterior devolve 1 — um quadro só não mostra movimento', () => {
    // O primeiro quadro da sessão não pode acusar instabilidade: não há com o
    // que comparar, e um falso positivo aqui reaparece a cada boot.
    expect(estabilidadeEspecular(mascara(1, 1, 0, 0), null)).toBe(1);
  });

  it('tamanhos diferentes devolvem 1 em vez de lançar', () => {
    // O crop periocular muda de tamanho conforme a bbox do rosto. Um throw
    // aqui derrubaria a análise de qualidade a 30 Hz.
    expect(() => estabilidadeEspecular(mascara(1, 1), mascara(1, 1, 0, 0))).not.toThrow();
    expect(estabilidadeEspecular(mascara(1, 1), mascara(1, 1, 0, 0))).toBe(1);
  });
});
