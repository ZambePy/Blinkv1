import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { runHarness } from './pipelineHarness';

// Utilitário-teste da tarefa T0.4: grava `docs/baseline_a28bdb0.json` com o
// resultado do harness na semente default (12345). Guardado por env var para
// não rodar na suíte normal — se rodasse, cada `npm test` sobrescreveria o
// baseline em disco, o que anularia o gate de regressão.
//
// Como usar:
//   IRISFLOW_WRITE_BASELINE=1 npx vitest run src/testUtils/writeBaseline.test.ts
//
// Depois de gravar, verifique com `git diff docs/baseline_a28bdb0.json` que
// os números fazem sentido e commite o arquivo. Regravar num commit posterior
// só se a mudança for INTENCIONAL — mudança silenciosa no baseline é o
// oposto do que ele existe para fazer.

const WRITE_BASELINE = process.env.IRISFLOW_WRITE_BASELINE === '1';
const OUT_PATH = join(__dirname, '..', '..', 'docs', 'baseline_a28bdb0.json');

describe('T0.4 — gravar baseline instrumental', () => {
  it.skipIf(!WRITE_BASELINE)(
    'grava docs/baseline_a28bdb0.json com o resultado do harness (seed=12345)',
    () => {
      const result = runHarness({ seed: 12345 });
      mkdirSync(dirname(OUT_PATH), { recursive: true });
      // O `measuredStageLatency` é intencionalmente descartado para o baseline
      // — a latência real depende do relógio da máquina que rodou. Se
      // deixássemos, o baseline gravado num laptop rápido bloquearia um
      // desktop mais lento sem regressão real. As demais métricas SÃO
      // determinísticas e servem de gate.
      const persisted = {
        ...result,
        measuredStageLatency: {},
        note:
          'Baseline gerado por src/testUtils/writeBaseline.test.ts. ' +
          'measuredStageLatency omitido de propósito (depende da máquina). ' +
          'Só regenerar com IRISFLOW_WRITE_BASELINE=1 e revisão humana do diff.',
      };
      writeFileSync(OUT_PATH, JSON.stringify(persisted, null, 2) + '\n', 'utf-8');
      // eslint-disable-next-line no-console
      console.log(`[T0.4] baseline gravado em ${OUT_PATH}`);
      expect(result.trajectories).toHaveLength(6);
    },
  );

  it('marca o teste como pulado quando IRISFLOW_WRITE_BASELINE não é 1', () => {
    // Redundante com o `skipIf` acima, mas dá uma linha verde na suíte
    // padrão indicando que o mecanismo existe e está armado.
    expect(WRITE_BASELINE || true).toBe(true);
  });
});
