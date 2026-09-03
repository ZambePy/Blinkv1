import { describe, it, expect } from 'vitest';
import { runHarness, compareToBaseline, DEFAULT_TOLERANCES, type HarnessResult } from './pipelineHarness';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// -----------------------------------------------------------------------------
// O harness é O JUIZ das tarefas até o Dia 7. Este teste garante 3 coisas:
//
//   1. Ele roda sem lançar sobre a suíte padrão (smoke test).
//   2. É determinístico — mesma semente ⇒ mesmo resultado bit a bit.
//   3. Quando existe `docs/baseline_a28bdb0.json` (produzido por T0.4),
//      o resultado corrente não regride nenhuma métrica além da tolerância.
//
// O ponto 3 é o gate de mérito: qualquer PR que piorar erro/jitter/rejeições
// numa das 6 trajetórias sintéticas faz este teste falhar. Sem baseline
// versionado, o teste ignora o gate (não falha) — porque falhar por ausência
// de baseline transformaria o `T0.4` em pré-condição de CI, o que só faz
// sentido depois do baseline ser gerado uma vez.
// -----------------------------------------------------------------------------

const BASELINE_PATH = join(__dirname, '..', '..', 'docs', 'baseline_a28bdb0.json');

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
  it('não regride contra docs/baseline_a28bdb0.json (quando disponível)', () => {
    if (!existsSync(BASELINE_PATH)) {
      // Documentado no cabeçalho: sem baseline, este teste é NO-OP. A
      // primeira execução de T0.4 grava o arquivo e a partir daí este teste
      // vira gate real.
      console.warn(
        `[pipelineHarness.test] baseline não encontrado em ${BASELINE_PATH}; ` +
        `pulando gate de regressão. Rode T0.4 para congelar o baseline.`,
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
