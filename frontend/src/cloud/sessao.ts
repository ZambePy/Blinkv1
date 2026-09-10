/**
 * Tradução do relatório de precisão do desktop para o que o banco guarda.
 *
 * O `AccuracyResult` tem dezenas de métricas (ver docs/MEDICOES.md). Para a
 * família e o prescritor, no app do cuidador, vai um RESUMO: acurácia,
 * precisão, taxa de acerto, tamanho mínimo de alvo, distância medida e as
 * condições da sessão. Nada bruto — nenhuma amostra, nenhum vetor.
 *
 * Se mudar uma chave aqui, mude `AccuracySummary` em
 * irisflow-cuidador/src/data/types.ts e a tela `app/sessao/[id].tsx`.
 */
import type { AccuracyResult, RunMeta } from '@tracker/accuracy';
import type { ResumoDePrecisao, SessaoRemota } from './types';

const arred = (v: number | null | undefined, casas = 1): number | null =>
  v === null || v === undefined || !Number.isFinite(v) ? null : Number(v.toFixed(casas));

/** Hit rate do raio R em fração 0..1 (o relatório guarda em %). */
function taxaDeAcerto(result: AccuracyResult, raioPx: number): number | null {
  const pct = result.hitRateByRadius?.find((r) => r.radiusPx === raioPx)?.pct;
  return pct === null || pct === undefined ? null : arred(pct / 100, 3);
}

export function resumoDoRelatorio(result: AccuracyResult, meta: RunMeta | null): ResumoDePrecisao {
  return {
    meanErrorPx: arred(result.meanError),
    meanErrorDeg: arred(result.meanErrorDeg, 2),
    medianErrorPx: arred(result.medianError),
    p90ErrorPx: arred(result.p90Error),
    precisionPx: arred(result.jitterRMS),
    precisionDeg: arred(result.precisionDeg, 2),
    hitRate100: taxaDeAcerto(result, 100),
    hitRate150: taxaDeAcerto(result, 150),
    minTargetPx: arred(result.alvoMinimoPx, 0),
    minTargetDeg: arred(result.alvoMinimoDeg, 1),
    measuredDistanceCm: arred(result.distanciaMedidaCm?.mediana ?? null, 0),
    pointsMeasured: result.pontosMedidos,
    pointsTotal: result.pontosMedidos + result.pontosNaoMedidos,
    score: result.score,
    conditions: meta
      ? {
          lighting: meta.iluminacao,
          glasses: meta.oculos,
          headMovement: meta.movimentoCabeca,
          screenInches: meta.telaPolegadas,
          distanceCm: meta.distanciaCm,
        }
      : null,
  };
}

/** Colunas de `sessions` preenchidas ao fim da calibração + teste. */
export function camposDeCalibracao(
  result: AccuracyResult,
  meta: RunMeta | null,
  duracaoCalibracaoS: number | null,
): SessaoRemota {
  return {
    calibration_error_px: arred(result.meanError),
    calibration_error_deg: arred(result.meanErrorDeg, 2),
    calibration_seconds: arred(duracaoCalibracaoS),
    hit_rate_150px: taxaDeAcerto(result, 150),
    hit_rate_100px: taxaDeAcerto(result, 100),
    precision_px: arred(result.jitterRMS),
    precision_deg: arred(result.precisionDeg, 2),
    capture_conditions: meta
      ? {
          iluminacao: meta.iluminacao,
          oculos: meta.oculos,
          movimentoCabeca: meta.movimentoCabeca,
          distanciaCm: meta.distanciaCm,
          telaPolegadas: meta.telaPolegadas,
          luxAmbiente: meta.luxAmbiente ?? null,
          blocoDeMedicao: meta.blocoDeMedicao ?? 1,
        }
      : {},
  };
}
