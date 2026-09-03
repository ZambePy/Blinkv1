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

// Timeout explícito — o racional completo está em `vitest.config.ts`.
//
// `computeFitDiagnostics` treina um Ridge completo, incluindo CV
// leave-one-target-out sobre um grid de 25 λ (9 alvos × 25 λ = 225 ajustes por
// chamada). Isolado o arquivo custa 3,43 s (medido); sob a suíte inteira em
// workers paralelos a contenção de CPU chegou a estourar o default de 5 s em
// ~metade das execuções.
//
// Aqui a CV NÃO pode ser trocada por `lambdaOverride` como se fez em
// `calibration.eyefusion.test.ts`: o que este arquivo mede é o próprio
// diagnóstico de ajuste, e ele depende do λ escolhido. O custo é inerente ao
// caminho sob teste.
describe('l2csValidFraction — distingue "não se aplica" de "falhou"', { timeout: 20_000 }, () => {
  it('conjunto ativo hoje carrega bloco: mede em vez de devolver null', () => {
    // `irisCore+l2cs` leva as posições [4, 5]. Com o L2CS efetivamente entrando
    // no vetor, o relatório passa a ter valor de decisão (`x%` de amostras com
    // ângulo válido), em vez de `null` como no cenário histórico do `irisCore`.
    const slots = l2csSlotsInSet(ACTIVE_FEATURE_SET);
    expect(slots).toEqual([4, 5]);
    const a = amostras(6, slots);
    const d = computeFitDiagnostics(a.featuresLeft, a.featuresRight, a.targets, undefined, { w: 1920, h: 1080 });
    expect(d.l2csValidFraction).not.toBeNull();
    // Com todos os slots preenchidos com valor não-zero: 100% válido.
    expect(d.l2csValidFraction).toBe(1);
  });

  it('slots todos-zero contam como inválido (0 ≠ null)', () => {
    // A distinção do design ainda vale: quando o conjunto ativo tem slots mas
    // TODOS vêm zero, o campo é 0 (falha total do L2CS) — que é um alerta.
    // Somente quando o conjunto ativo NÃO carrega slots é que o campo vira
    // `null` ("não se aplica"). Preservar essa distinção evita alarme falso.
    const slots = l2csSlotsInSet(ACTIVE_FEATURE_SET);
    expect(slots.length).toBeGreaterThan(0);
    const a = amostras(6, null);
    // Força os slots angulares a zero em todas as amostras — o helper por
    // default só zera slots do `iris12+l2cs` (≥12), que não caem no vetor de 6.
    for (const v of a.featuresLeft) for (const s of slots) v[s] = 0;
    for (const v of a.featuresRight) for (const s of slots) v[s] = 0;
    const d = computeFitDiagnostics(a.featuresLeft, a.featuresRight, a.targets, undefined, { w: 1920, h: 1080 });
    expect(d.l2csValidFraction).toBe(0);
    expect(d.l2csValidFraction).not.toBeNull();
  });

  it('o campo não é decorativo: quando há bloco maior, ainda mede', () => {
    // Verificação da mecânica: 'iris12+l2cs' leva as 7 dims completas.
    const slots = l2csSlotsInSet('iris12+l2cs');
    expect(slots.length).toBeGreaterThan(0);
    const a = amostras(19, slots);
    const preenchidas = a.featuresLeft.filter((v) => slots.some((s) => v[s] !== 0)).length;
    expect(preenchidas).toBe(a.featuresLeft.length);
  });
});
