import { describe, it, expect } from 'vitest';
import { l2csSlotsInSet, ACTIVE_FEATURE_SET } from './extractor';
import { L2CS_BLOCK_DIM } from './l2cs/block';

/**
 * O diagnóstico `l2csValidFraction` conferia "as últimas L2CS_BLOCK_DIM
 * dimensões são todas zero?" e abandonava com `continue` quando o vetor era
 * mais curto que 7. Com o conjunto ativo em `irisCore` (4 dims) isso nunca
 * conta nada, e o relatório publicava `l2csValidFraction: 0` — lido como "0%
 * das amostras tinham L2CS válido", um alarme de falha grave, quando a verdade
 * é que o conjunto ativo não CARREGA bloco L2CS nenhum.
 *
 * Estas posições são a fonte para distinguir "não se aplica" de "aplica e está
 * zerado" — e valem também para `irisCore+l2cs`, que leva só 2 das 7 dims e
 * onde "as últimas 7" já era a pergunta errada.
 */
describe('l2csSlotsInSet', () => {
  it('conjuntos sem bloco angular não têm posição nenhuma', () => {
    expect(l2csSlotsInSet('irisCore')).toEqual([]);
    expect(l2csSlotsInSet('iris12')).toEqual([]);
    expect(l2csSlotsInSet('irisCore+pose')).toEqual([]);
    expect(l2csSlotsInSet('iris12+posecross')).toEqual([]);
  });

  it('iris12+l2cs leva as 7 dims, e elas são as últimas do vetor projetado', () => {
    const slots = l2csSlotsInSet('iris12+l2cs');
    expect(slots).toHaveLength(L2CS_BLOCK_DIM);
    // 12 de íris + 7 do bloco = índices 12..18 no vetor projetado.
    expect(slots).toEqual([12, 13, 14, 15, 16, 17, 18]);
  });

  it('irisCore+l2cs leva só 2 dims — "as últimas 7" seria a pergunta errada', () => {
    const slots = l2csSlotsInSet('irisCore+l2cs');
    expect(slots).toEqual([4, 5]);
    expect(slots.length).toBeLessThan(L2CS_BLOCK_DIM);
  });

  it('com pose no meio, as posições continuam apontando para o bloco certo', () => {
    // 'irisCore+l2cs+pose' = [0,1,2,3, 22,23,24, 25,26, 37,38]
    // O bloco angular são os dois últimos: posições 9 e 10.
    expect(l2csSlotsInSet('irisCore+l2cs+pose')).toEqual([9, 10]);
  });

  it('o conjunto ATIVO hoje não carrega bloco angular', () => {
    // Guarda contra o relatório voltar a dizer "l2cs+ridge" sem L2CS: se este
    // teste passar a falhar, o conjunto ativo mudou e o rótulo tem de mudar junto.
    expect(l2csSlotsInSet(ACTIVE_FEATURE_SET)).toEqual([]);
  });
});
