import { describe, it, expect } from 'vitest';
import { geometriaDoAnel, ANEL_ESPESSURA_PX, ANEL_FOLGA_PX } from './dwellRing';
import {
  dwellMsPorPaciente,
  DWELL_FAIXA_RECOMENDADA_MS,
  DWELL_FAIXA_PERMITIDA_MS,
  DEFAULT_DWELL_CONFIG,
} from './dwell';
import { CURSOR_TAMANHOS } from './cursorStyle';

// -----------------------------------------------------------------------------
// P7.2 — dwell 0,8–1,5 s por paciente + anel de progresso no cursor.
// -----------------------------------------------------------------------------

describe('a caixa do SVG cabe o traço inteiro', () => {
  it('o lado soma a espessura do traço, não só o diâmetro', () => {
    // Um traço de espessura `w` num círculo de raio `r` vai de `r-w/2` a
    // `r+w/2`. Dimensionar a caixa como `2r` corta metade da espessura nas
    // quatro bordas, e o anel aparece achatado nos pontos cardeais — que se lê
    // como "está tremendo", num indicador cuja função é dizer "estou contando".
    const g = geometriaDoAnel(48, 0.5);
    expect(g.lado).toBe(2 * g.raio + g.espessura);
  });

  it('a borda externa do traço fica DENTRO da caixa, em todos os tamanhos', () => {
    for (const px of Object.values(CURSOR_TAMANHOS)) {
      const g = geometriaDoAnel(px, 0.5);
      const bordaExterna = g.centro + g.raio + g.espessura / 2;
      expect(bordaExterna).toBeLessThanOrEqual(g.lado);
    }
  });

  it('a borda interna do traço não invade o centro', () => {
    const g = geometriaDoAnel(32, 0.5);
    expect(g.raio - g.espessura / 2).toBeGreaterThan(0);
  });
});

describe('o anel não encosta no cursor', () => {
  it('o raio fica além da borda do cursor, com folga', () => {
    // Encostado, o anel e o preenchimento viram uma mancha só e o progresso
    // deixa de ser legível.
    for (const px of Object.values(CURSOR_TAMANHOS)) {
      const g = geometriaDoAnel(px, 0.5);
      expect(g.raio - g.espessura / 2).toBeGreaterThan(px / 2);
    }
  });

  it('a folga é a declarada', () => {
    expect(geometriaDoAnel(48, 0).raio).toBe(48 / 2 + ANEL_FOLGA_PX);
  });

  it('a espessura não encolhe em cursores pequenos', () => {
    // Afinar o traço num cursor de 32 px derrotaria o anel justamente para
    // quem escolheu o cursor pequeno.
    expect(geometriaDoAnel(32, 0.5).espessura).toBe(ANEL_ESPESSURA_PX);
    expect(geometriaDoAnel(96, 0.5).espessura).toBe(ANEL_ESPESSURA_PX);
  });
});

describe('o progresso mapeia para o dashoffset', () => {
  it('0% = anel vazio (offset = circunferência inteira)', () => {
    const g = geometriaDoAnel(48, 0);
    expect(g.offset).toBeCloseTo(g.circunferencia, 9);
  });

  it('100% = anel cheio (offset = 0)', () => {
    expect(geometriaDoAnel(48, 1).offset).toBeCloseTo(0, 9);
  });

  it('50% = metade', () => {
    const g = geometriaDoAnel(48, 0.5);
    expect(g.offset).toBeCloseTo(g.circunferencia / 2, 9);
  });

  it('é monótono: mais progresso nunca desenha menos anel', () => {
    let anterior = Infinity;
    for (let p = 0; p <= 1.0001; p += 0.05) {
      const o = geometriaDoAnel(48, p).offset;
      expect(o).toBeLessThanOrEqual(anterior + 1e-9);
      anterior = o;
    }
  });

  it('a circunferência confere com o raio', () => {
    const g = geometriaDoAnel(72, 0.3);
    expect(g.circunferencia).toBeCloseTo(2 * Math.PI * g.raio, 9);
  });
});

describe('entradas degeneradas não mentem sobre o progresso', () => {
  it('NaN vira 0%, não 100%', () => {
    // `stroke-dashoffset: NaN` é ignorado pelo navegador, que deixa o traço
    // CHEIO — o paciente veria um dwell completo num dwell que não começou.
    // Falhar para o lado do "não começou" é a única direção segura.
    const g = geometriaDoAnel(48, NaN);
    expect(g.offset).toBeCloseTo(g.circunferencia, 9);
  });

  it('valores fora de 0–1 são presos', () => {
    const cheio = geometriaDoAnel(48, 1);
    const vazio = geometriaDoAnel(48, 0);
    expect(geometriaDoAnel(48, 7).offset).toBeCloseTo(cheio.offset, 9);
    expect(geometriaDoAnel(48, -2).offset).toBeCloseTo(vazio.offset, 9);
  });

  it('todos os campos saem finitos', () => {
    for (const p of [NaN, Infinity, -Infinity, 0.5]) {
      for (const v of Object.values(geometriaDoAnel(48, p))) {
        expect(Number.isFinite(v)).toBe(true);
      }
    }
  });
});

describe('o anel começa às 12 h', () => {
  it('a rotação compensa o zero do SVG', () => {
    // O ângulo zero do SVG fica às 3 h. Sem `-90` o anel encheria pela
    // direita, e o paciente compara com o relógio de parede.
    expect(geometriaDoAnel(48, 0.5).rotacaoDeg).toBe(-90);
  });
});

describe('a faixa de dwell por paciente', () => {
  it('a faixa recomendada é a do plano: 0,8–1,5 s', () => {
    expect(DWELL_FAIXA_RECOMENDADA_MS.min).toBe(800);
    expect(DWELL_FAIXA_RECOMENDADA_MS.max).toBe(1500);
  });

  it('a faixa PERMITIDA é mais larga, e isso é deliberado', () => {
    // O preset `slow` do app é 2500 ms. Estreitar a faixa para cumprir o
    // número do plano retiraria a opção de quem tem fadiga avançada — para
    // quem 2,5 s é a diferença entre clicar e não clicar. O plano descreve o
    // que será MEDIDO no Dia 7, não o que é clinicamente admissível.
    expect(DWELL_FAIXA_PERMITIDA_MS.max).toBeGreaterThanOrEqual(2500);
  });

  it('valores dentro da faixa do plano passam sem marca', () => {
    for (const ms of [800, 1000, 1200, 1500]) {
      const r = dwellMsPorPaciente(ms);
      expect(r.ms).toBe(ms);
      expect(r.foraDaFaixaRecomendada).toBe(false);
      expect(r.ajustado).toBe(false);
    }
  });

  it('o preset `slow` é aceito, mas marcado como fora da faixa medida', () => {
    const r = dwellMsPorPaciente(2500);
    expect(r.ms).toBe(2500);       // aceito
    expect(r.ajustado).toBe(false);
    expect(r.foraDaFaixaRecomendada).toBe(true);  // e sinalizado
  });

  it('valores absurdos são presos, nunca rejeitados', () => {
    // Sem dwell o paciente não chega à tela onde consertaria o valor que
    // quebrou o dwell.
    expect(dwellMsPorPaciente(1).ms).toBe(DWELL_FAIXA_PERMITIDA_MS.min);
    expect(dwellMsPorPaciente(999999).ms).toBe(DWELL_FAIXA_PERMITIDA_MS.max);
    expect(dwellMsPorPaciente(1).ajustado).toBe(true);
  });

  it('NaN cai no default, não no piso', () => {
    // Cair no piso daria ao paciente o dwell mais RÁPIDO que existe por causa
    // de um valor corrompido — cliques acidentais em série.
    const r = dwellMsPorPaciente(NaN);
    expect(r.ms).toBe(DEFAULT_DWELL_CONFIG.dwellMs);
    expect(r.ajustado).toBe(true);
  });
});
