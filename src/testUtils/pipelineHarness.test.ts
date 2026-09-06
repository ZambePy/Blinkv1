import { describe, it, expect } from 'vitest';
import { runHarness, compareToBaseline, DEFAULT_TOLERANCES, type HarnessResult } from './pipelineHarness';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// O harness sintético é o gate de mérito do pipeline: roda sem lançar, é
// determinístico (mesma semente ⇒ mesmo resultado) e, quando existe o baseline
// versionado ao lado do harness, nenhuma métrica pode regredir além da tolerância. Sem
// baseline o gate é ignorado (não falha).

const BASELINE_PATH = join(__dirname, 'harness-baseline.json');

describe('pipelineHarness — smoke e determinismo', () => {
  it('roda as 6 trajetórias com semente default sem lançar', () => {
    const result = runHarness();
    expect(result.trajectories).toHaveLength(6);
    for (const t of result.trajectories) {
      expect(t.frames).toBeGreaterThan(0);
      expect(Number.isFinite(t.meanErrorPx)).toBe(true);
      expect(Number.isFinite(t.p90ErrorPx)).toBe(true);
      expect(Number.isFinite(t.jitterRmsPx)).toBe(true);
      expect(t.samplesRejected).toBeGreaterThanOrEqual(0);
    }
    expect(result.featureDim).toBeGreaterThan(0);
    expect(result.screen.w).toBe(1920);
    expect(result.screen.h).toBe(1080);
  });

  it('duas execuções com a mesma semente devolvem exatamente o mesmo resultado', () => {
    const a = runHarness({ seed: 42 });
    const b = runHarness({ seed: 42 });
    // Compara as métricas por trajetória — não comparamos `measuredStageLatency`
    // porque a latência real depende do relógio da máquina. As métricas de
    // trajetória, sim, são funções puras da semente.
    for (let i = 0; i < a.trajectories.length; i++) {
      const ta = a.trajectories[i];
      const tb = b.trajectories[i];
      expect(tb.name).toBe(ta.name);
      expect(tb.frames).toBe(ta.frames);
      expect(tb.meanErrorPx).toBe(ta.meanErrorPx);
      expect(tb.p90ErrorPx).toBe(ta.p90ErrorPx);
      expect(tb.jitterRmsPx).toBe(ta.jitterRmsPx);
      expect(tb.samplesRejected).toBe(ta.samplesRejected);
    }
  });

  it('sementes diferentes produzem trajetórias com métricas diferentes', () => {
    const a = runHarness({ seed: 1 });
    const b = runHarness({ seed: 2 });
    // Ao menos uma trajetória tem que diferir em alguma métrica — se todas
    // baterem exatamente entre sementes, o harness não está usando a semente
    // (bug crítico).
    let anyDifferent = false;
    for (let i = 0; i < a.trajectories.length; i++) {
      if (a.trajectories[i].meanErrorPx !== b.trajectories[i].meanErrorPx) {
        anyDifferent = true;
        break;
      }
    }
    expect(anyDifferent).toBe(true);
  });

  it('a trajetória blink-during-fixation rejeita ~10% dos frames', () => {
    // Reproduz o contrato da trajetória: 3 blinks a cada 30 frames ≈ 10%.
    // Sanidade contra alguém trocar o pattern sem atualizar as tolerâncias.
    const result = runHarness();
    const t = result.trajectories.find((x) => x.name === 'blink-during-fixation');
    expect(t).toBeDefined();
    if (!t) return;
    const rejectionRate = t.samplesRejected / t.frames;
    expect(rejectionRate).toBeGreaterThan(0.05);
    expect(rejectionRate).toBeLessThan(0.20);
  });

  it('a trajetória face-loss-2s rejeita exatamente 60 frames', () => {
    // A janela de perda é `f >= 60 && f < 120` = 60 frames. Contrato explícito
    // que qualquer mudança no simulador precisa preservar (senão o teste de
    // baseline reporta uma "regressão" que na verdade é mudança de definição).
    const result = runHarness();
    const t = result.trajectories.find((x) => x.name === 'face-loss-2s');
    expect(t?.samplesRejected).toBe(60);
  });
});

describe('pipelineHarness — regressão contra baseline', () => {
  it('não regride contra harness-baseline.json (quando disponível)', () => {
    if (!existsSync(BASELINE_PATH)) {
      // Sem baseline este teste é no-op; `writeBaseline.test.ts` grava o arquivo.
      console.warn(
        `[pipelineHarness.test] baseline não encontrado em ${BASELINE_PATH}; ` +
        `pulando gate de regressão. Rode writeBaseline.test.ts com IRISFLOW_WRITE_BASELINE=1.`,
      );
      return;
    }
    const baseline: HarnessResult = JSON.parse(readFileSync(BASELINE_PATH, 'utf-8'));
    const current = runHarness({ seed: baseline.seed });
    const cmp = compareToBaseline(current, baseline, DEFAULT_TOLERANCES);

    if (!cmp.ok) {
      const regressed = cmp.entries.filter((e) => e.regressed);
      const lines = regressed.map(
        (e) =>
          `  - ${e.trajectory}/${e.metric}: baseline=${e.baseline.toFixed(3)} ` +
          `current=${e.current.toFixed(3)} (tol=${e.toleranceAbs} abs, ${(e.toleranceRel * 100).toFixed(0)}% rel)`,
      );
      throw new Error(
        `[pipelineHarness] regressão detectada em ${regressed.length} métrica(s):\n${lines.join('\n')}`,
      );
    }
    expect(cmp.ok).toBe(true);
  });
});
