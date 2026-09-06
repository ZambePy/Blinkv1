import { describe, it, expect } from 'vitest';
import { geometriaDoAnel, ANEL_ESPESSURA_PX, ANEL_FOLGA_PX } from './dwellRing';
import { CURSOR_TAMANHOS } from './cursorStyle';

// -----------------------------------------------------------------------------
// Dwell 0,8–1,5 s por paciente + anel de progresso no cursor.
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
