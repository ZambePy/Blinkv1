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
  it('conjunto sem bloco angular não tem posição nenhuma', () => {
    expect(l2csSlotsInSet('irisCore')).toEqual([]);
  });

  it('compact carrega o bloco inteiro, nas posições do vetor completo', () => {
    const slots = l2csSlotsInSet('compact');
    expect(slots).toHaveLength(L2CS_BLOCK_DIM);
    expect(slots).toEqual([37, 38, 39, 40, 41, 42, 43]);
  });

  it('irisCore+l2cs leva só 2 dims — "as últimas 7" seria a pergunta errada', () => {
    const slots = l2csSlotsInSet('irisCore+l2cs');
    expect(slots).toEqual([4, 5]);
    expect(slots.length).toBeLessThan(L2CS_BLOCK_DIM);
  });

  it('o conjunto ATIVO carrega tan(yaw) e tan(pitch) do L2CS nas posições 4 e 5', () => {
    // Guarda inversa: o pipeline liga o L2CS de propósito. Se este teste
    // voltar a exigir vazio, `ACTIVE_FEATURE_SET` foi revertido para
    // `'irisCore'` sozinho — o que só deve acontecer com `l2cs: 'off'`.
    expect(l2csSlotsInSet(ACTIVE_FEATURE_SET)).toEqual([4, 5]);
  });
});
