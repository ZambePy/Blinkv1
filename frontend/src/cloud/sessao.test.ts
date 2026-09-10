import { describe, it, expect } from 'vitest';
import type { AccuracyResult, RunMeta } from '@tracker/accuracy';
import { camposDeCalibracao, resumoDoRelatorio } from './sessao';

// O que vai para o app do cuidador é um resumo: os nomes daqui são o contrato
// com `AccuracySummary` em irisflow-cuidador/src/data/types.ts.

const resultado = {
  meanError: 61.26, medianError: 55.1, p90Error: 98.4, meanErrorX: 40, meanErrorY: 35,
  biasX: 3, biasY: -2, maxError: 140, errorPct: 2.5, meanErrorDeg: 0.951,
  jitterRMS: 33.9, precisionSdX: 20, precisionSdY: 22, precisionS2S: 12, precisionDeg: 0.524,
  jitterFilteredRMS: 10, meanErrorInner: 58, meanErrorEdge: 80, score: 'Bom', colorClass: 'ok',
  pointErrors: [], pointJitters: [], pontosMedidos: 12, pontosNaoMedidos: 1, nInterior: 9, nEdge: 3,
  sampleMeanError: 60, sampleMedianError: 54, sampleP90Error: 97,
  hitRateByRadius: [
    { radiusPx: 60, pct: 50 }, { radiusPx: 100, pct: 88.4 }, { radiusPx: 150, pct: 96.1 }, { radiusPx: 200, pct: 99 },
  ],
  sampleRateHz: 29.8, bceaPx2: 1200, bceaDeg2: 0.3, fracaoDeAmostrasValidas: 0.95, pontosComPoucaAmostra: [],
  alvoMinimoPx: 258.4, alvoMinimoDeg: 4.02, distanciaMedidaCm: { mediana: 61.2, min: 59, max: 63 },
} as unknown as AccuracyResult;

const meta: RunMeta = {
  data: '2026-09-08', iluminacao: 'boa', oculos: false, movimentoCabeca: 'parada', minutosDeSessao: 3,
  distanciaCm: 60, telaPolegadas: 23.6, luxAmbiente: 320, blocoDeMedicao: 1,
};

describe('resumoDoRelatorio', () => {
  it('traduz o relatório para o resumo do cuidador (hit rate em fração, arredondado)', () => {
    const r = resumoDoRelatorio(resultado, meta);
    expect(r).toMatchObject({
      meanErrorPx: 61.3, meanErrorDeg: 0.95, medianErrorPx: 55.1, p90ErrorPx: 98.4,
      precisionPx: 33.9, precisionDeg: 0.52,
      hitRate100: 0.884, hitRate150: 0.961,
      minTargetPx: 258, minTargetDeg: 4,
      measuredDistanceCm: 61,
      pointsMeasured: 12, pointsTotal: 13, score: 'Bom',
      conditions: { lighting: 'boa', glasses: false, headMovement: 'parada', screenInches: 23.6, distanceCm: 60 },
    });
  });

  it('métricas ausentes viram null, nunca 0 fabricado', () => {
    const vazio = { ...resultado, meanError: null, precisionDeg: null, hitRateByRadius: [], distanciaMedidaCm: null } as unknown as AccuracyResult;
    const r = resumoDoRelatorio(vazio, null);
    expect(r.meanErrorPx).toBeNull();
    expect(r.precisionDeg).toBeNull();
    expect(r.hitRate100).toBeNull();
    expect(r.measuredDistanceCm).toBeNull();
    expect(r.conditions).toBeNull();
  });

  it('não leva dado bruto: nenhuma amostra ou erro por ponto', () => {
    const r = resumoDoRelatorio(resultado, meta) as unknown as Record<string, unknown>;
    expect(r).not.toHaveProperty('pointErrors');
    expect(r).not.toHaveProperty('pointJitters');
    expect(JSON.stringify(r)).not.toMatch(/sample|landmark|vector/i);
  });
});

describe('camposDeCalibracao', () => {
  it('preenche as colunas de sessions e as condições de captura', () => {
    const c = camposDeCalibracao(resultado, meta, 27.4);
    expect(c).toMatchObject({
      calibration_error_px: 61.3, calibration_error_deg: 0.95, calibration_seconds: 27.4,
      hit_rate_150px: 0.961, hit_rate_100px: 0.884, precision_px: 33.9, precision_deg: 0.52,
    });
    expect(c.capture_conditions).toMatchObject({ iluminacao: 'boa', luxAmbiente: 320, blocoDeMedicao: 1 });
  });
});
