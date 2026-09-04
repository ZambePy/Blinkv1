import { describe, it, expect, vi } from 'vitest';
import { FilterChain, type FilterMode } from './filterChain';
import type { GeometriaDeTela } from './angularVelocity';
import { sanitizeExperiment, VALORES_ACEITOS } from '../config/experiment';

// -----------------------------------------------------------------------------
// P7.6 — a cadeia selecionável.
//
// O Sprint 6 entregou os filtros como módulos puros e testados, mas nenhum
// estava LIGADO: `filterMode` não existia. Isso tornava o aceite do `P7.6`
// impossível — ele pede o harness rodando com `filterMode: 'kalmanEma'`.
//
// Mesmo problema do `spec11` no `P6.5`: uma alternativa que não se consegue
// selecionar não é alternativa.
// -----------------------------------------------------------------------------

const TELA: GeometriaDeTela = {
  larguraPx: 1920, alturaPx: 1080, larguraCm: 52.25, distanciaCm: 60,
};

const DT = 1 / 30;

/** Alimenta a cadeia com uma trajetória e devolve a saída. */
function rodar(c: FilterChain, pontos: Array<[number, number]>) {
  return pontos.map(([x, y], i) => c.filter(x, y, i * DT, i * 33.33, DT));
}

describe('a flag existe e tem lista fechada', () => {
  it('os três modos são aceitos, e só eles', () => {
    expect(VALORES_ACEITOS.filterMode).toEqual(['oneEuro', 'kalman', 'kalmanEma']);
    for (const m of VALORES_ACEITOS.filterMode) {
      expect(sanitizeExperiment({ filterMode: m }).filterMode).toBe(m);
    }
    expect(sanitizeExperiment({ filterMode: 'kalmanBayes' }).filterMode).toBe('oneEuro');
  });

  it('o default é o comportamento atual', () => {
    expect(sanitizeExperiment({}).filterMode).toBe('oneEuro');
  });
});

describe('as três cadeias produzem saída finita e suavizada', () => {
  const modos: FilterMode[] = ['oneEuro', 'kalman', 'kalmanEma'];

  for (const mode of modos) {
    it(`${mode}: saída finita sobre trajetória com ruído`, () => {
      const c = new FilterChain({ mode, geometria: TELA });
      let semente = 5;
      const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648 - 0.5; };
      const pontos: Array<[number, number]> = Array.from({ length: 200 }, (_, i) =>
        [500 + i * 2 + rnd() * 20, 300 + rnd() * 20]);
      const saida = rodar(c, pontos);
      expect(saida.every((s) => Number.isFinite(s.x) && Number.isFinite(s.y))).toBe(true);
    });

    it(`${mode}: suaviza — a variância da saída é menor que a da entrada`, () => {
      const c = new FilterChain({ mode, geometria: TELA });
      let semente = 11;
      const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648 - 0.5; };
      const entrada: number[] = [];
      const pontos: Array<[number, number]> = Array.from({ length: 300 }, () => {
        const x = 500 + rnd() * 40;
        entrada.push(x);
        return [x, 300] as [number, number];
      });
      const saida = rodar(c, pontos).slice(100).map((s) => s.x);
      const va = (v: number[]) => {
        const m = v.reduce((a, b) => a + b, 0) / v.length;
        return v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length;
      };
      expect(va(saida)).toBeLessThan(va(entrada.slice(100)));
    });

    it(`${mode}: a primeira amostra passa direto, sem deslize inicial`, () => {
      const c = new FilterChain({ mode, geometria: TELA });
      const p = c.filter(800, 600, 0, 0, DT);
      expect(p.x).toBeCloseTo(800, 6);
      expect(p.y).toBeCloseTo(600, 6);
    });

    it(`${mode}: reset volta ao estado inicial`, () => {
      const c = new FilterChain({ mode, geometria: TELA });
      rodar(c, Array.from({ length: 50 }, (_, i) => [500 + i, 300] as [number, number]));
      c.reset();
      const p = c.filter(100, 100, 0, 0, DT);
      expect(p.x).toBeCloseTo(100, 6);
    });
  }
});

describe('a ORDEM da cadeia: Kalman antes do EMA', () => {
  it('o Kalman recebe a medição crua, não a suavizada', () => {
    // Se o EMA viesse primeiro, o Kalman estimaria a velocidade do FILTRO e
    // não a do olho, e a predição perderia o sentido. O teste observa isso
    // pelo efeito: com movimento sustentado, o Kalman interno aprende a
    // velocidade real.
    const c = new FilterChain({ mode: 'kalmanEma', geometria: TELA });
    const velocidade = 300; // px/s
    for (let i = 0; i < 120; i++) {
      c.filter(100 + velocidade * i * DT, 300, i * DT, i * 33.33, DT);
    }
    expect(c.kalmanInterno!.state.vx).toBeCloseTo(velocidade, -1);
  });

  it('o Kalman interno fica acessível para o blinkHold projetar (P6.3)', () => {
    expect(new FilterChain({ mode: 'kalman' }).kalmanInterno).not.toBeNull();
    expect(new FilterChain({ mode: 'kalmanEma', geometria: TELA }).kalmanInterno).not.toBeNull();
    // `oneEuro` não tem modelo de movimento — não há o que projetar.
    expect(new FilterChain({ mode: 'oneEuro' }).kalmanInterno).toBeNull();
  });
});

describe('kalmanEma SEM geometria degrada, e ANUNCIA', () => {
  it('degrada para kalman puro em vez de assumir uma tela', () => {
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = new FilterChain({ mode: 'kalmanEma', geometria: null });
    expect(c.degradado).toBe(true);
    expect(c.modoEfetivo).toBe('kalman');
    avisos.mockRestore();
  });

  it('o aviso diz que a medição NÃO representa kalmanEma', () => {
    // Silenciar aqui faria o `F8.5` comparar `kalman` contra `kalman` achando
    // que comparou três cadeias — e o resultado "kalmanEma não ajudou" seria
    // lido como conclusão quando é artefato de configuração.
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {});
    new FilterChain({ mode: 'kalmanEma', geometria: null });
    expect(avisos).toHaveBeenCalledWith(expect.stringContaining('NÃO representa kalmanEma'));
    avisos.mockRestore();
  });

  it('COM geometria não degrada e não avisa', () => {
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const c = new FilterChain({ mode: 'kalmanEma', geometria: TELA });
    expect(c.degradado).toBe(false);
    expect(c.modoEfetivo).toBe('kalmanEma');
    expect(avisos).not.toHaveBeenCalled();
    avisos.mockRestore();
  });

  it('`oneEuro` e `kalman` não precisam de geometria', () => {
    const avisos = vi.spyOn(console, 'warn').mockImplementation(() => {});
    expect(new FilterChain({ mode: 'oneEuro' }).degradado).toBe(false);
    expect(new FilterChain({ mode: 'kalman' }).degradado).toBe(false);
    expect(avisos).not.toHaveBeenCalled();
    avisos.mockRestore();
  });
});

describe('kalmanEma expõe o que o diagnóstico precisa', () => {
  it('α e velocidade angular saem no resultado', () => {
    const c = new FilterChain({ mode: 'kalmanEma', geometria: TELA });
    c.filter(500, 300, 0, 0, DT);
    const r = c.filter(700, 300, DT, 33.33, DT);
    expect(r.alpha).not.toBeNull();
    expect(r.velocidadeDegPorSeg).not.toBeNull();
  });

  it('as outras cadeias devolvem null nesses campos, não zero', () => {
    // Zero significaria "velocidade medida como zero"; `null` significa "esta
    // cadeia não mede isso". A distinção é a mesma de `B3.3`.
    for (const mode of ['oneEuro', 'kalman'] as const) {
      const c = new FilterChain({ mode, geometria: TELA });
      c.filter(500, 300, 0, 0, DT);
      const r = c.filter(700, 300, DT, 33.33, DT);
      expect(r.alpha).toBeNull();
      expect(r.velocidadeDegPorSeg).toBeNull();
    }
  });
});

describe('determinismo', () => {
  it('a mesma entrada produz a mesma saída, nos três modos', () => {
    for (const mode of ['oneEuro', 'kalman', 'kalmanEma'] as const) {
      const pontos: Array<[number, number]> = Array.from({ length: 60 }, (_, i) =>
        [500 + Math.sin(i / 5) * 100, 300 + Math.cos(i / 7) * 50] as [number, number]);
      const a = rodar(new FilterChain({ mode, geometria: TELA }), pontos);
      const b = rodar(new FilterChain({ mode, geometria: TELA }), pontos);
      expect(a).toEqual(b);
    }
  });
});
