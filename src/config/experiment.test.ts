import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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
// Cada teste usa `vi.resetModules()` porque `EXPERIMENT` é snapshot único
// no boot do módulo; mudar env depois do primeiro import não teria efeito.

describe('experiment.ts — override por env-var (D7.1)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Limpa qualquer IRISFLOW_EXP_* residual de outros testes
    for (const key of Object.keys(process.env)) {
      if (key.startsWith('IRISFLOW_EXP_')) delete process.env[key];
    }
    vi.resetModules();
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.resetModules();
  });

  it('sem env-var, preserva defaults (retrocompat)', async () => {
    const { EXPERIMENT } = await import('./experiment');
    expect(EXPERIMENT.isotropicLandmarks).toBe(false);
    expect(EXPERIMENT.lockCameraExposure).toBe(false);
    expect(EXPERIMENT.applyDistanceCorrection).toBe(false);
    expect(EXPERIMENT.expandFactor).toBe(1.4);
  });

  it('IRISFLOW_EXP_isotropicLandmarks=true liga a flag', async () => {
    process.env.IRISFLOW_EXP_isotropicLandmarks = 'true';
    const { EXPERIMENT } = await import('./experiment');
    expect(EXPERIMENT.isotropicLandmarks).toBe(true);
  });

  it('IRISFLOW_EXP_isotropicLandmarks=1 também liga (equivalência "1"/"true")', async () => {
    process.env.IRISFLOW_EXP_isotropicLandmarks = '1';
    const { EXPERIMENT } = await import('./experiment');
    expect(EXPERIMENT.isotropicLandmarks).toBe(true);
  });

  it('IRISFLOW_EXP_isotropicLandmarks=false mantém desligado', async () => {
    process.env.IRISFLOW_EXP_isotropicLandmarks = 'false';
    const { EXPERIMENT } = await import('./experiment');
    expect(EXPERIMENT.isotropicLandmarks).toBe(false);
  });

  it('override numérico converte string para Number', async () => {
    process.env.IRISFLOW_EXP_expandFactor = '1.6';
    const { EXPERIMENT } = await import('./experiment');
    expect(EXPERIMENT.expandFactor).toBe(1.6);
    expect(typeof EXPERIMENT.expandFactor).toBe('number');
  });

  it('chave desconhecida é ignorada (typo não trava)', async () => {
    process.env.IRISFLOW_EXP_flagInexistente = 'true';
    const { EXPERIMENT } = await import('./experiment');
    expect(EXPERIMENT.isotropicLandmarks).toBe(false);
    // Objeto não ganha propriedade nova
    expect((EXPERIMENT as unknown as Record<string, unknown>).flagInexistente).toBeUndefined();
  });

  it('override numérico com valor não-parseável é ignorado (preserva default)', async () => {
    process.env.IRISFLOW_EXP_expandFactor = 'abc';
    const { EXPERIMENT } = await import('./experiment');
    expect(EXPERIMENT.expandFactor).toBe(1.4); // default
  });

  it('múltiplas env-vars simultâneas — cada uma resolve independentemente', async () => {
    process.env.IRISFLOW_EXP_isotropicLandmarks = 'true';
    process.env.IRISFLOW_EXP_expandFactor = '1.8';
    const { EXPERIMENT } = await import('./experiment');
    expect(EXPERIMENT.isotropicLandmarks).toBe(true);
    expect(EXPERIMENT.expandFactor).toBe(1.8);
  });
});
