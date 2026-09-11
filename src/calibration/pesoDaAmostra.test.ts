import { describe, expect, it } from 'vitest';
import {
  FATOR_BLOCO_ZERADO,
  PESO_MINIMO,
  normalizarPorGrupo,
  pesoDaAmostra,
  resumoDePesos,
} from './pesoDaAmostra';

const bom = {
  irisVisibilityPercentage: 0.9,
  detectorConfidence: 0.95,
  brightnessEstimate: 0.45,
  contrastEstimate: 0.25,
  blurEstimate: 0.2,
  specularRatio: 0.0,
};

describe('pesoDaAmostra', () => {
  it('quadro bom vale 1', () => {
    expect(pesoDaAmostra({ qualidade: bom })).toBeCloseTo(1, 6);
  });

  it('sem qualidade medida, vale 1 — nunca penaliza o que não foi medido', () => {
    expect(pesoDaAmostra({})).toBe(1);
    expect(pesoDaAmostra({ qualidade: null })).toBe(1);
    expect(pesoDaAmostra({ qualidade: {} })).toBe(1);
  });

  it('nunca chega a zero: peso zero é o porteiro de volta', () => {
    const pessimo = pesoDaAmostra({
      qualidade: {
        irisVisibilityPercentage: 0,
        detectorConfidence: 0,
        brightnessEstimate: 0,
        contrastEstimate: 0,
        blurEstimate: 1,
        specularRatio: 1,
      },
      blocoZerado: true,
    });
    expect(pessimo).toBe(PESO_MINIMO);
    expect(pessimo).toBeGreaterThan(0);
  });

  it('a pálpebra semifechada pesa menos que a aberta, mas continua entrando', () => {
    const aberto = pesoDaAmostra({ qualidade: { ...bom, irisVisibilityPercentage: 0.9 } });
    const meio = pesoDaAmostra({ qualidade: { ...bom, irisVisibilityPercentage: 0.42 } });
    expect(meio).toBeLessThan(aberto);
    expect(meio).toBeGreaterThan(PESO_MINIMO);
  });

  it('brilho penaliza nos dois lados', () => {
    const escuro = pesoDaAmostra({ qualidade: { ...bom, brightnessEstimate: 0.10 } });
    const certo = pesoDaAmostra({ qualidade: { ...bom, brightnessEstimate: 0.45 } });
    const estourado = pesoDaAmostra({ qualidade: { ...bom, brightnessEstimate: 0.90 } });
    expect(escuro).toBeLessThan(certo);
    expect(estourado).toBeLessThan(certo);
  });

  it('bloco angular zerado custa caro, mas não elimina a amostra', () => {
    const p = pesoDaAmostra({ qualidade: bom, blocoZerado: true });
    expect(p).toBeCloseTo(FATOR_BLOCO_ZERADO, 6);
  });

  it('a confiança do L2CS entra suave: no pior caso ainda vale 0,6', () => {
    const baixa = pesoDaAmostra({ qualidade: bom, l2csConfianca: 0.15 });
    const alta = pesoDaAmostra({ qualidade: bom, l2csConfianca: 0.5 });
    expect(baixa).toBeCloseTo(0.6, 6);
    expect(alta).toBeCloseTo(1, 6);
  });

  it('valores não numéricos são ignorados em vez de virarem NaN', () => {
    const p = pesoDaAmostra({
      qualidade: { irisVisibilityPercentage: NaN, blurEstimate: undefined },
      l2csConfianca: NaN,
    });
    expect(Number.isFinite(p)).toBe(true);
    expect(p).toBe(1);
  });
});

describe('normalizarPorGrupo', () => {
  it('cada alvo sai com média 1, então o peso não vota em qual alvo importa', () => {
    // O alvo "baixo" tem qualidade pior em TODAS as amostras — exatamente o
    // caso da linha inferior da grade. Depois de normalizar, ele mantém o mesmo
    // peso total do alvo "centro".
    const pesos = [1.0, 0.9, 0.8, 0.2, 0.15, 0.1];
    const grupos = ['centro', 'centro', 'centro', 'baixo', 'baixo', 'baixo'];
    const n = normalizarPorGrupo(pesos, grupos);
    const soma = (g: string) => n.filter((_, i) => grupos[i] === g).reduce((a, b) => a + b, 0);
    expect(soma('centro')).toBeCloseTo(3, 6);
    expect(soma('baixo')).toBeCloseTo(3, 6);
  });

  it('preserva a ordem relativa dentro do grupo', () => {
    const n = normalizarPorGrupo([0.2, 0.4, 0.8], ['a', 'a', 'a']);
    expect(n[0]).toBeLessThan(n[1]);
    expect(n[1]).toBeLessThan(n[2]);
  });

  it('grupo degenerado volta a peso 1 em vez de propagar NaN', () => {
    expect(normalizarPorGrupo([0, 0], ['a', 'a'])).toEqual([1, 1]);
    expect(normalizarPorGrupo([NaN], ['a'])).toEqual([1]);
  });

  it('comprimentos diferentes são erro, não silêncio', () => {
    expect(() => normalizarPorGrupo([1, 2], ['a'])).toThrow(RangeError);
  });
});

describe('resumoDePesos', () => {
  it('resume para o diagnóstico', () => {
    const r = resumoDePesos([1, 0.5, 0.25, 0.25]);
    expect(r).not.toBeNull();
    expect(r!.medio).toBeCloseTo(0.5, 6);
    expect(r!.minimo).toBeCloseTo(0.25, 6);
    expect(r!.fracaoAbaixoDeMeio).toBeCloseTo(0.5, 6);
  });

  it('sem amostra, devolve null em vez de zero fabricado', () => {
    expect(resumoDePesos([])).toBeNull();
  });
});
