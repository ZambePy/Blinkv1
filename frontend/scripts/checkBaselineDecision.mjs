// D8.1 (ROADMAP §5) — lógica pura do gate de regressão de precisão.
//
// Isolada do wrapper CLI (`check_baseline_regression.mjs`) para permitir
// teste unitário sem depender de I/O de relatório nem de caracteres
// não-ASCII que quebram o transform do esbuild em vitest quando estão no
// mesmo arquivo que a lógica.

// Constante compartilhada com o wrapper — a variante-baseline default do
// measure_baseline.mjs. Comparar entre rodadas EXIGE mesma variante nos
// dois relatórios (baseline snapshot vs current).
export const BASELINE_VARIANT_NAME = 'baseline (balanceado-v2, features gravadas)';

// Default de tolerância em %. Preliminar — recalibrar com histórico real
// (ver comentário canônico no wrapper CLI).
export const DEFAULT_TOLERANCE_PCT = 15;

// Decide se `currentMean` regride contra `baselineMean` dentro de uma
// tolerância `%`. Retorna verdict:
//   'ok'         → dentro da tolerância (inclui melhoria);
//   'regression' → excede baseline * (1 + tol/100);
//   'invalid'    → entradas malformadas (NaN, negativo, baseline <= 0).
//
// Comparação é ESTRITAMENTE maior: exatamente no threshold NÃO regride
// (evita false-positive por arredondamento).
export function decideRegression({ baselineMean, currentMean, tolerancePct }) {
  if (!Number.isFinite(baselineMean) || baselineMean <= 0) {
    return { verdict: 'invalid', reason: 'baseline meanErrorPx inválido' };
  }
  if (!Number.isFinite(currentMean) || currentMean < 0) {
    return { verdict: 'invalid', reason: 'current meanErrorPx inválido' };
  }
  const threshold = baselineMean * (1 + tolerancePct / 100);
  const deltaPct = ((currentMean - baselineMean) / baselineMean) * 100;
  if (currentMean > threshold) {
    return { verdict: 'regression', threshold, deltaPct, baselineMean, currentMean };
  }
  return { verdict: 'ok', threshold, deltaPct, baselineMean, currentMean };
}

// Extrai a variante-baseline de um relatório do measure_baseline.mjs.
// Retorna null se ausente (relatório antigo ou custom sem essa variante).
export function findBaselineVariant(report) {
  if (!report || !Array.isArray(report.variants)) return null;
  return report.variants.find((v) => v.name === BASELINE_VARIANT_NAME) ?? null;
}
