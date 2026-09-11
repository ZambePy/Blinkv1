import { describe, expect, it } from 'vitest';
import {
  EstabilidadeDoPonto,
  JANELA,
  RAZAO_ESTAVEL,
  Z_ESTAVEL,
  decidirFechamento,
} from './estabilidadeDoPonto';

/**
 * Ruído determinístico e reprodutível.
 *
 * Um `sin(i·k)` NÃO serve aqui: a série é periódica e as duas metades da janela
 * caem em fases diferentes, o que produz uma diferença sistemática entre as
 * médias — o critério a lê corretamente como deriva, e o teste é que estava
 * errado. Congruência linear devolve algo que se comporta como ruído branco na
 * escala de doze amostras.
 */
function fabricaDeRuido(semente: number): () => number {
  let estado = semente >>> 0;
  return () => {
    estado = (estado * 1664525 + 1013904223) >>> 0;
    return estado / 0xffffffff - 0.5;
  };
}

function encher(e: EstabilidadeDoPonto, n: number, f: (i: number) => [number, number]) {
  for (let i = 0; i < n; i++) {
    const [x, y] = f(i);
    e.registrar(x, y);
  }
}

describe('EstabilidadeDoPonto', () => {
  it('não decide nada antes da janela encher', () => {
    const e = new EstabilidadeDoPonto();
    const r = fabricaDeRuido(3);
    encher(e, JANELA - 1, () => [r(), r()]);
    const v = e.avaliar();
    expect(v.estavel).toBe(false);
    expect(v.z).toBeNull();
    expect(v.amostras).toBe(JANELA - 1);
  });

  // O critério é estatístico, então a afirmação honesta também é: sobre muitas
  // janelas, quase toda fixação é reconhecida e quase nenhuma sacada passa.
  // Um teste de semente única aqui só mediria a sorte daquela semente.
  function fracaoEstavel(n: number, gerar: (r: () => number, i: number) => [number, number]): number {
    let estaveis = 0;
    for (let semente = 1; semente <= n; semente++) {
      const e = new EstabilidadeDoPonto();
      const r = fabricaDeRuido(semente * 7919);
      encher(e, JANELA, (i) => gerar(r, i));
      if (e.avaliar().estavel) estaveis++;
    }
    return estaveis / n;
  }

  it('olhar parado é reconhecido como estável na grande maioria das janelas', () => {
    const f = fracaoEstavel(600, (r) => [0.30 + r() * 0.01, 0.20 + r() * 0.01]);
    // A simulação que fixou os limiares dá ~93%. O piso de 85% deixa folga para
    // a diferença entre ruído uniforme (aqui) e gaussiano (lá) sem afrouxar.
    expect(f).toBeGreaterThan(0.85);
  });

  it('deriva grande nunca passa como fixação', () => {
    const f = fracaoEstavel(600, (r, i) => [0.10 + i * 0.02 + r() * 0.001, 0.20 + r() * 0.001]);
    expect(f).toBe(0);
  });

  it('acomodação exponencial — o olho ainda chegando — é reconhecida quase sempre', () => {
    // Amplitude de 6 desvios decaindo com constante de 4 amostras: o formato de
    // um olho terminando de pousar no alvo depois da janela de acomodação.
    const f = fracaoEstavel(600, (r, i) => [
      0.30 + 6 * 0.01 * Math.exp(-i / 4) + r() * 0.01,
      0.20 + r() * 0.01,
    ]);
    expect(f).toBeLessThan(0.15);
  });

  it('o veredicto reporta as duas medidas, para o log poder explicar a decisão', () => {
    const e = new EstabilidadeDoPonto();
    const r = fabricaDeRuido(1234);
    encher(e, JANELA, () => [0.3 + r() * 0.01, 0.2 + r() * 0.01]);
    const v = e.avaliar();
    expect(v.z).not.toBeNull();
    expect(v.razao).not.toBeNull();
    expect(v.estavel).toBe(v.z! < Z_ESTAVEL && v.razao! < RAZAO_ESTAVEL);
  });

  it('olhar ainda viajando para o alvo não é estável', () => {
    // Deriva constante com ruído pequeno: as duas medidas denunciam.
    const e = new EstabilidadeDoPonto();
    const r = fabricaDeRuido(11);
    encher(e, JANELA, (i) => [0.10 + i * 0.02 + r() * 0.001, 0.20 + r() * 0.001]);
    const v = e.avaliar();
    expect(v.estavel).toBe(false);
    expect(v.razao).toBeGreaterThan(RAZAO_ESTAVEL);
  });

  it('deriva em um eixo só já basta para não fechar', () => {
    const e = new EstabilidadeDoPonto();
    const r = fabricaDeRuido(23);
    encher(e, JANELA, (i) => [0.30 + r() * 0.001, 0.20 + i * 0.02]);
    expect(e.avaliar().estavel).toBe(false);
  });

  it('landmark congelado NÃO é fixação perfeita', () => {
    // Série constante. O desvio "zero" na verdade sai em ~1e-17 por resto de
    // soma em ponto flutuante, e sem o piso relativo z viraria 0 — o pior dado
    // possível fecharia o ponto imediatamente, disfarçado de fixação perfeita.
    const e = new EstabilidadeDoPonto();
    encher(e, JANELA, () => [0.3, 0.2]);
    const v = e.avaliar();
    expect(v.estavel).toBe(false);
    expect(v.z).toBeNull();
    expect(v.razao).toBeNull();
  });

  it('ignora amostra não finita em vez de propagar NaN', () => {
    const e = new EstabilidadeDoPonto();
    e.registrar(NaN, 0.2);
    e.registrar(0.3, Infinity);
    expect(e.tamanho).toBe(0);
  });

  it('a janela é deslizante: só as últimas amostras contam', () => {
    const e = new EstabilidadeDoPonto();
    // Primeiro uma deriva enorme, depois estabilidade. A deriva sai da janela.
    encher(e, JANELA, (i) => [i * 0.5, i * 0.5]);
    expect(e.avaliar().estavel).toBe(false);
    const rx = fabricaDeRuido(5);
    const ry = fabricaDeRuido(61);
    encher(e, JANELA, () => [5 + rx() * 0.01, 5 + ry() * 0.01]);
    expect(e.tamanho).toBe(JANELA);
    expect(e.avaliar().estavel).toBe(true);
  });

  it('reiniciar zera a janela entre alvos', () => {
    const e = new EstabilidadeDoPonto();
    const r = fabricaDeRuido(31);
    encher(e, JANELA, () => [r(), r()]);
    e.reiniciar();
    expect(e.tamanho).toBe(0);
    expect(e.avaliar().estavel).toBe(false);
  });
});

describe('decidirFechamento', () => {
  const base = {
    decorridoUtilMs: 1000,
    minUtilMs: 900,
    maxUtilMs: 3000,
    amostrasAceitas: 20,
    minAmostras: 15,
    estavel: true,
  };

  it('fecha cedo quando estabilizou e as condições mínimas foram cumpridas', () => {
    expect(decidirFechamento(base)).toEqual({ fechar: true, motivo: 'estavel' });
  });

  it('não fecha antes do tempo mínimo, mesmo estável', () => {
    expect(decidirFechamento({ ...base, decorridoUtilMs: 500 }).fechar).toBe(false);
  });

  it('não fecha sem amostras suficientes, mesmo estável', () => {
    expect(decidirFechamento({ ...base, amostrasAceitas: 3 }).fechar).toBe(false);
  });

  it('o teto fecha o ponto mesmo instável e sem amostra — o paciente não fica preso', () => {
    const d = decidirFechamento({
      ...base, decorridoUtilMs: 3000, amostrasAceitas: 0, estavel: false,
    });
    expect(d).toEqual({ fechar: true, motivo: 'teto' });
  });

  it('instável antes do teto continua coletando', () => {
    expect(decidirFechamento({ ...base, estavel: false })).toEqual({
      fechar: false, motivo: 'coletando',
    });
  });
});
