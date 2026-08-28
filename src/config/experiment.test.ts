import { describe, it, expect } from 'vitest';
import { loadEnvOverrides, EXPERIMENT } from './experiment';

// D7.1 (ROADMAP §5) — a config de experimento em Node passa a aceitar override
// via env-var `IRISFLOW_EXP_<key>=<value>`, permitindo que
// `measure_baseline.mjs` varra `isotropicLandmarks` entre variantes do replay
// sem editar código. Estes testes garantem que:
//   (i)  env-var em booleano é interpretada corretamente ("true"/"1" → true);
//   (ii) env-var em número é convertida (não fica string, o que quebraria
//        cálculos de vetor);
//   (iii) chave desconhecida é ignorada (não trava rodada com typo);
//   (iv) sem env-var, o default é preservado (garantia de retrocompat).
//
// Estratégia de teste: testamos a função pura `loadEnvOverrides(env)` passando
// um objeto env sintético. Isso substitui uma versão anterior que usava
// `vi.resetModules()` para reimportar o módulo com env-vars diferentes —
// resetModules estressa o pool do vitest o suficiente pra causar timeout
// intermitente em `qualityAnalyzer.a1-5.test.ts` (jsdom+canvas). Testar a
// função pura tem o mesmo alcance sem esse custo.

describe('loadEnvOverrides (D7.1)', () => {
  it('sem env-var, retorna objeto vazio', () => {
    expect(loadEnvOverrides({})).toEqual({});
  });

  it('env sem prefixo IRISFLOW_EXP_ é ignorada', () => {
    expect(loadEnvOverrides({ NODE_ENV: 'production', PATH: '/usr/bin' })).toEqual({});
  });

  it('IRISFLOW_EXP_isotropicLandmarks=true liga a flag', () => {
    expect(loadEnvOverrides({ IRISFLOW_EXP_isotropicLandmarks: 'true' })).toEqual({ isotropicLandmarks: true });
  });

  it('IRISFLOW_EXP_isotropicLandmarks=1 também liga (equivalência "1"/"true")', () => {
    expect(loadEnvOverrides({ IRISFLOW_EXP_isotropicLandmarks: '1' })).toEqual({ isotropicLandmarks: true });
  });

  it('IRISFLOW_EXP_isotropicLandmarks=false devolve override false explícito', () => {
    // Falso EXPLÍCITO tem que sobrepor localStorage (ou default), então o
    // override é passado adiante, não omitido.
    expect(loadEnvOverrides({ IRISFLOW_EXP_isotropicLandmarks: 'false' })).toEqual({ isotropicLandmarks: false });
  });

  it('override numérico converte string para Number', () => {
    const r = loadEnvOverrides({ IRISFLOW_EXP_expandFactor: '1.6' });
    expect(r.expandFactor).toBe(1.6);
    expect(typeof r.expandFactor).toBe('number');
  });

  it('chave desconhecida é ignorada (typo não trava)', () => {
    expect(loadEnvOverrides({ IRISFLOW_EXP_flagInexistente: 'true' })).toEqual({});
  });

  it('override numérico com valor não-parseável é ignorado', () => {
    // Preserva o default — não polui o override com NaN.
    expect(loadEnvOverrides({ IRISFLOW_EXP_expandFactor: 'abc' })).toEqual({});
  });

  it('múltiplas env-vars simultâneas — cada uma resolve independentemente', () => {
    const r = loadEnvOverrides({
      IRISFLOW_EXP_isotropicLandmarks: 'true',
      IRISFLOW_EXP_expandFactor: '1.8',
    });
    expect(r).toEqual({ isotropicLandmarks: true, expandFactor: 1.8 });
  });
});

// Smoke test do snapshot exportado — só garante que a montagem no boot não
// crashou e que o objeto tem shape esperado (defaults ainda são o default
// quando não há env-var IRISFLOW_EXP_* no ambiente atual do teste).
describe('EXPERIMENT (snapshot)', () => {
  it('carrega com shape completo (todas as chaves de ExperimentConfig existem)', () => {
    expect(EXPERIMENT).toHaveProperty('expandFactor');
    expect(EXPERIMENT).toHaveProperty('l2csCadenceMs');
    expect(EXPERIMENT).toHaveProperty('isotropicLandmarks');
    expect(EXPERIMENT).toHaveProperty('lockCameraExposure');
  });
});
