import { describe, expect, it } from 'vitest';
import {
  ESCALA_DE_ATRASO_MS,
  PESOS_PADRAO,
  atrasoPorCorrelacao,
  custoDoFiltro,
  escolherMelhorCandidato,
  rmsAmostraAAmostra,
} from './custoDoFiltro';
import { FilterChain } from './filterChain';

describe('custoDoFiltro', () => {
  it('soma a razão de precisão com o atraso normalizado', () => {
    const c = custoDoFiltro({ dispersaoFiltrada: 5, dispersaoCrua: 10, atrasoMs: 100 });
    // 1 × 0,5 + 3 × 1,0
    expect(c).toBeCloseTo(0.5 + 3, 9);
  });

  it('atraso pesa três vezes mais que tremor — é a escolha do artigo', () => {
    const soTremor = custoDoFiltro({ dispersaoFiltrada: 10, dispersaoCrua: 10, atrasoMs: 0 });
    const soAtraso = custoDoFiltro({
      dispersaoFiltrada: 0, dispersaoCrua: 10, atrasoMs: ESCALA_DE_ATRASO_MS,
    });
    expect(soAtraso).toBeCloseTo(soTremor * PESOS_PADRAO.wL, 9);
  });

  it('o filtro que suaviza de graça vence o que suaviza caro', () => {
    const deGraca = custoDoFiltro({ dispersaoFiltrada: 4, dispersaoCrua: 10, atrasoMs: 0 });
    const caro = custoDoFiltro({ dispersaoFiltrada: 2, dispersaoCrua: 10, atrasoMs: 60 });
    expect(deGraca).toBeLessThan(caro);
  });

  it('medida impossível custa Infinity em vez de eleger um candidato por bug', () => {
    expect(custoDoFiltro({ dispersaoFiltrada: 5, dispersaoCrua: 0, atrasoMs: 10 })).toBe(Infinity);
    expect(custoDoFiltro({ dispersaoFiltrada: NaN, dispersaoCrua: 10, atrasoMs: 10 })).toBe(Infinity);
    expect(custoDoFiltro({ dispersaoFiltrada: 5, dispersaoCrua: 10, atrasoMs: -1 })).toBe(Infinity);
  });
});

describe('atrasoPorCorrelacao', () => {
  it('mede o deslocamento que melhor alinha entrada e saída', () => {
    const entrada = Array.from({ length: 60 }, (_, i) => Math.sin(i / 5) * 100);
    const atrasoAmostras = 3;
    const saida = entrada.map((_, i) => entrada[Math.max(0, i - atrasoAmostras)]);
    expect(atrasoPorCorrelacao(entrada, saida, 33)).toBeCloseTo(atrasoAmostras * 33, 6);
  });

  it('sinal sem atraso mede zero', () => {
    const entrada = Array.from({ length: 40 }, (_, i) => Math.sin(i / 4) * 50);
    expect(atrasoPorCorrelacao(entrada, [...entrada], 33)).toBe(0);
  });

  it('série curta ou constante devolve null em vez de um número inventado', () => {
    expect(atrasoPorCorrelacao([1, 2, 3], [1, 2, 3], 33)).toBeNull();
    const constante = Array.from({ length: 30 }, () => 5);
    expect(atrasoPorCorrelacao(constante, [...constante], 33)).toBeNull();
    expect(atrasoPorCorrelacao([1, 2, 3, 4, 5, 6, 7, 8], [1, 2, 3, 4, 5, 6, 7, 8], 0)).toBeNull();
  });
});

describe('rmsAmostraAAmostra', () => {
  it('mede tremor e não confunde deriva com ruído', () => {
    // O par que separa as duas coisas é (desvio total, RMS-S2S), como a §1.1 do
    // MEDICOES.md descreve: uma rampa longa tem desvio ENORME e S2S minúsculo;
    // um tremor de mesma amplitude tem desvio pequeno e S2S grande.
    const rampa = Array.from({ length: 50 }, (_, i) => i * 1);      // deriva lenta
    const tremor = Array.from({ length: 50 }, (_, i) => (i % 2 === 0 ? 0 : 25)); // ruído
    const dp = (v: number[]) => {
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
    };
    expect(dp(rampa)).toBeGreaterThan(dp(tremor));
    expect(rmsAmostraAAmostra(rampa)!).toBeLessThan(rmsAmostraAAmostra(tremor)!);
  });

  it('série curta devolve null', () => {
    expect(rmsAmostraAAmostra([1])).toBeNull();
  });
});

describe('escolherMelhorCandidato', () => {
  const cand = (nome: string, dispersaoFiltrada: number, atrasoMs: number) => ({
    parametros: nome,
    medida: { dispersaoFiltrada, dispersaoCrua: 10, atrasoMs },
    custo: custoDoFiltro({ dispersaoFiltrada, dispersaoCrua: 10, atrasoMs }),
  });

  it('escolhe o de menor custo', () => {
    const m = escolherMelhorCandidato([cand('a', 8, 40), cand('b', 5, 5), cand('c', 3, 90)]);
    expect(m?.parametros).toBe('b');
  });

  it('empate fica com o de menor atraso', () => {
    // Mesmo custo por construção: 0,3 + 3×0,1 = 0,6 e 0,6 + 3×0,0 = 0,6.
    const a = cand('lento', 3, 10);
    const b = cand('rapido', 6, 0);
    expect(a.custo).toBeCloseTo(b.custo, 9);
    expect(escolherMelhorCandidato([a, b])?.parametros).toBe('rapido');
  });

  it('sem candidato válido devolve null, não uma escolha arbitrária', () => {
    expect(escolherMelhorCandidato([])).toBeNull();
    expect(escolherMelhorCandidato([cand('x', 5, -1)])).toBeNull();
  });
});

describe('varredura de verdade sobre a cadeia', () => {
  const geometria = { larguraPx: 1920, alturaPx: 1080, larguraCm: 52.25, distanciaCm: 60 };

  /** Fixação com tremor, depois uma sacada, depois outra fixação. */
  function trajetoria(): { x: number; y: number; t: number }[] {
    let semente = 424242;
    const r = () => {
      semente = (semente * 1664525 + 1013904223) >>> 0;
      return semente / 0xffffffff - 0.5;
    };
    const pts: { x: number; y: number; t: number }[] = [];
    for (let i = 0; i < 90; i++) {
      const base = i < 45 ? 500 : 1200;
      pts.push({ x: base + r() * 40, y: 400 + r() * 40, t: i * 33 });
    }
    return pts;
  }

  it('o estabilizador de fixação reduz o custo em relação à cadeia sem ele', () => {
    const pts = trajetoria();
    const medir = (estabilizar: boolean) => {
      const chain = new FilterChain({ mode: 'oneEuro', geometria, estabilizarFixacao: estabilizar });
      const saida: number[] = [];
      for (const p of pts) saida.push(chain.filter(p.x, p.y, p.t / 1000, p.t).x);
      const entrada = pts.map((p) => p.x);
      return {
        dispersaoFiltrada: rmsAmostraAAmostra(saida)!,
        dispersaoCrua: rmsAmostraAAmostra(entrada)!,
        atrasoMs: atrasoPorCorrelacao(entrada, saida, 33) ?? 0,
      };
    };
    const sem = medir(false);
    const com = medir(true);
    // A média da fixação é o ganho: menos tremor na saída.
    expect(com.dispersaoFiltrada).toBeLessThan(sem.dispersaoFiltrada);
    expect(custoDoFiltro(com)).toBeLessThan(custoDoFiltro(sem));
  });

  it('a razão de filtro do One Euro em produção é péssima — é o espaço vazio da M1', () => {
    const pts = trajetoria();
    const chain = new FilterChain({ mode: 'oneEuro' });
    const saida: number[] = [];
    for (const p of pts) saida.push(chain.filter(p.x, p.y, p.t / 1000, p.t).x);
    const razao = rmsAmostraAAmostra(saida)! / rmsAmostraAAmostra(pts.map((p) => p.x))!;
    // A M1 mediu 0,99 na bancada. O harness reproduz a ordem de grandeza: o
    // filtro de produção quase não suaviza.
    expect(razao).toBeGreaterThan(0.7);
  });
});
