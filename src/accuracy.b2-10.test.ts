import { describe, it, expect } from 'vitest';
import { geometriaFoiMedida } from './accuracy';

// -----------------------------------------------------------------------------
// B2.10 — `geometryAssumed: false` num relatório cuja diagonal é o hardcode
//         23,6″.
//
//   if (meta && meta.distanciaCm && meta.telaPolegadas) {
//     ...
//     geometryAssumed = false;      // "a geometria foi medida"
//   }
//
// Mas `meta.telaPolegadas` é SEMPRE `settings.screenDiagonalIn`, cujo default é
// **23.6**. Quando o EDID não é utilizável, o código só faz
// `console.log('[display] EDID não utilizável; mantendo diagonal configurada.')`
// e mantém o default. `screenGeometrySource` continua `'default'` — mas **esse
// campo não era propagado** ao `RunMeta` nem ao bloco `geometry` do JSON.
//
// Resultado: um relatório com `assumed: false` e `meanErrorDeg` calculado sobre
// uma diagonal que ninguém verificou. É o cenário que `displayGeometry.ts`
// documenta como valendo **34% de erro angular**.
//
// E com B2.11 (o escape quebrado no comando WMI) o EDID NUNCA funcionou —
// então na prática 100% dos relatórios já emitidos afirmam ter medido uma
// geometria que foi chutada.
//
// Correção: só zerar `geometryAssumed` quando a origem for `'auto'` (EDID) ou
// `'manual'` (o cuidador mediu e digitou).
// -----------------------------------------------------------------------------

describe('B2.10 — geometryAssumed reflete a ORIGEM, não a presença do número', () => {
  it("origem 'default' ⇒ a geometria foi ASSUMIDA", () => {
    // O caso que o bug reportava errado: o número existe (23,6), mas ninguém
    // o mediu. Relatar `assumed: false` aqui é afirmar uma medição que não
    // aconteceu.
    expect(geometriaFoiMedida('default')).toBe(false);
  });

  it("origem 'auto' (EDID) ⇒ a geometria foi MEDIDA", () => {
    expect(geometriaFoiMedida('auto')).toBe(true);
  });

  it("origem 'manual' (o cuidador mediu) ⇒ a geometria foi MEDIDA", () => {
    // Fita métrica também é medição. O que desqualifica é o default de
    // fábrica, não a ausência de sensor.
    expect(geometriaFoiMedida('manual')).toBe(true);
  });

  it('origem ausente ⇒ assumida, nunca medida', () => {
    // Relatórios antigos e chamadas que não informam a origem. Na dúvida, a
    // resposta honesta é "não sei se foi medido", que se reporta como
    // assumido — o oposto do default otimista que o bug tinha.
    expect(geometriaFoiMedida(undefined)).toBe(false);
    expect(geometriaFoiMedida(null)).toBe(false);
  });

  it('origem desconhecida ⇒ assumida', () => {
    // Defesa contra um valor novo do enum ser adicionado e cair silenciosamente
    // no ramo "medido".
    expect(geometriaFoiMedida('sei-la' as never)).toBe(false);
  });
});
