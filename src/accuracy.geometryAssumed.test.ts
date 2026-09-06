import { describe, it, expect } from 'vitest';
import { geometriaFoiMedida } from './accuracy';

// `geometryAssumed` no relatório depende da ORIGEM da geometria
// (`screenGeometrySource`), não da mera presença de um número: a diagonal
// default (23,6″) existe sempre, mas ninguém a mediu. Só 'auto' (EDID) e
// 'manual' contam como medição.

describe('geometryAssumed reflete a origem da geometria, não a presença do número', () => {
  it("origem 'default' ⇒ a geometria foi assumida", () => {
    // O número existe (23,6), mas ninguém o mediu. Relatar `assumed: false`
    // aqui é afirmar uma medição que não aconteceu.
    expect(geometriaFoiMedida('default')).toBe(false);
  });

  it("origem 'auto' (EDID) ⇒ a geometria foi medida", () => {
    expect(geometriaFoiMedida('auto')).toBe(true);
  });

  it("origem 'manual' (o cuidador mediu) ⇒ a geometria foi medida", () => {
    // Fita métrica também é medição. O que desqualifica é o default de
    // fábrica, não a ausência de sensor.
    expect(geometriaFoiMedida('manual')).toBe(true);
  });

  it('origem ausente ⇒ assumida, nunca medida', () => {
    // Relatórios antigos e chamadas que não informam a origem: na dúvida,
    // reporta-se como assumido.
    expect(geometriaFoiMedida(undefined)).toBe(false);
    expect(geometriaFoiMedida(null)).toBe(false);
  });

  it('origem desconhecida ⇒ assumida', () => {
    // Defesa contra um valor novo do enum ser adicionado e cair silenciosamente
    // no ramo "medido".
    expect(geometriaFoiMedida('sei-la' as never)).toBe(false);
  });
});
