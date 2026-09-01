import { describe, it, expect } from 'vitest';
import { computeFitDiagnostics } from './calibration';
import { ACTIVE_FEATURE_SET, l2csSlotsInSet } from './extractor';

/**
 * O relatório `accuracy-report-1788225161304` publicou `l2csValidFraction: 0`
 * rodando com `ACTIVE_FEATURE_SET = 'irisCore'`. Lido de fora, "0% das amostras
 * tinham L2CS válido" é sinal de falha grave do modelo angular. A verdade era
 * outra: `irisCore` não carrega bloco angular nenhum, e o cálculo — que
 * perguntava "as últimas 7 dimensões são zero?" — caía num `continue` porque o
 * vetor tem 4. Um diagnóstico que só sabia responder 0.
 *
 * "Não se aplica" e "aplica e falhou" agora são valores diferentes.
 */

/** Grade de alvos com features minimamente informativas, 2 amostras por alvo. */
function amostras(dims: number, preencherSlots: number[] | null) {
  const featuresLeft: number[][] = [];
  const featuresRight: number[][] = [];
  const targets: { screenX: number; screenY: number }[] = [];
  let semente = 3;
  const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648 - 0.5; };
  for (const x of [0.2, 0.5, 0.8]) {
    for (const y of [0.2, 0.5, 0.8]) {
      for (let k = 0; k < 4; k++) {
        const v = Array.from({ length: dims }, (_, d) => (d === 0 ? x : d === 1 ? y : rnd() * 0.01));
        // Zera tudo que for slot angular e depois preenche só o pedido: assim o
        // teste controla exatamente quantas amostras têm bloco "válido".
        for (const s of l2csSlotsInSet('iris12+l2cs')) if (s < v.length) v[s] = 0;
        if (preencherSlots) for (const s of preencherSlots) if (s < v.length) v[s] = 0.3;
        featuresLeft.push(v); featuresRight.push([...v]);
        targets.push({ screenX: x, screenY: y });
      }
    }
  }
  return { featuresLeft, featuresRight, targets };
}

describe('l2csValidFraction — distingue "não se aplica" de "falhou"', () => {
  it('conjunto ativo sem bloco angular devolve null, não 0', () => {
    // Guarda o cenário exato do relatório: irisCore, 4 dims, sem L2CS.
    expect(l2csSlotsInSet(ACTIVE_FEATURE_SET)).toEqual([]);
    const a = amostras(4, null);
    const d = computeFitDiagnostics(a.featuresLeft, a.featuresRight, a.targets, undefined, { w: 1920, h: 1080 });
    expect(d.l2csValidFraction).toBeNull();
    expect(d.l2csValidFraction).not.toBe(0);
  });

  it('o campo não é decorativo: quando há bloco, ainda mede', () => {
    // Verificação da mecânica em si — se um dia o conjunto ativo voltar a
    // carregar L2CS, a contagem tem de continuar funcionando.
    const slots = l2csSlotsInSet('iris12+l2cs');
    expect(slots.length).toBeGreaterThan(0);
    const a = amostras(19, slots);
    const preenchidas = a.featuresLeft.filter((v) => slots.some((s) => v[s] !== 0)).length;
    expect(preenchidas).toBe(a.featuresLeft.length);
  });
});
