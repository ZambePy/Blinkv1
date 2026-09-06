import { describe, it, expect } from 'vitest';
import { runHarness, compareToBaseline, type HarnessResult } from './pipelineHarness';
import baselineJson from './harness-baseline.json';
import { EXPERIMENT } from '../config/experiment';
import { ACTIVE_FEATURE_SET } from '../extractor';

// -----------------------------------------------------------------------------
// Integração ponta a ponta no harness.
//
// O que se pedia era que o harness rodasse com `filterMode: 'kalmanEma'` e
// todas as métricas ficassem dentro da tolerância declarada em
// `harness-baseline.json`.
//
// A primeira metade era literalmente impossível: `runHarness` instanciava
// `OneEuroFilter2D` diretamente, sem caminho que trocasse o filtro. Isso está
// corrigido — a cadeia agora vem de `FilterChain` e o modo é selecionável.
//
// A segunda metade — "dentro da tolerância" — NÃO se cumpre, e este arquivo
// registra a medição em vez de afrouxar a tolerância até passar. Ver o bloco
// `describe` sobre o `kalmanEma` abaixo.
// -----------------------------------------------------------------------------

const baseline = baselineJson as unknown as HarnessResult;

describe('o portão: o pipeline roda ponta a ponta', () => {
  it('as três cadeias completam todas as trajetórias sem NaN', () => {
    // Este é o portão de entrada que de fato importa: se o pipeline não
    // roda, não há o que medir com humano na cadeira.
    for (const mode of ['oneEuro', 'kalman', 'kalmanEma'] as const) {
      const r = runHarness({ filterMode: mode });
      expect(r.trajectories.length).toBeGreaterThan(0);
      for (const t of r.trajectories) {
        expect(Number.isFinite(t.meanErrorPx), `${mode}/${t.name}`).toBe(true);
        expect(Number.isFinite(t.p90ErrorPx), `${mode}/${t.name}`).toBe(true);
        expect(Number.isFinite(t.jitterRmsPx), `${mode}/${t.name}`).toBe(true);
        expect(t.frames).toBeGreaterThan(0);
      }
    }
  });

  it('o modo pedido é o modo EFETIVO — nenhuma cadeia degradou em silêncio', () => {
    // O harness passa geometria de tela justamente para isto. Sem ela o
    // `kalmanEma` viraria `kalman` puro e o resultado "kalmanEma não ajudou"
    // seria artefato de configuração lido como conclusão.
    for (const mode of ['oneEuro', 'kalman', 'kalmanEma'] as const) {
      expect(runHarness({ filterMode: mode }).filterMode).toBe(mode);
    }
  });

  it('o resultado DIZ o que mediu', () => {
    const r = runHarness();
    expect(r.filterMode).toBe(EXPERIMENT.filterMode);
    expect(r.featureSet).toBe(ACTIVE_FEATURE_SET);
  });
});

describe('a troca de filtro preservou o comportamento default', () => {
  it("`oneEuro` reproduz o baseline com ZERO regressões", () => {
    // A prova de que substituir `OneEuroFilter2D` por `FilterChain` não mexeu
    // no caminho que roda hoje. Se este teste falhar, a refatoração mudou o
    // produto — e todo baseline gravado antes dela deixa de valer.
    const c = compareToBaseline(runHarness({ filterMode: 'oneEuro' }), baseline);
    const regressoes = c.entries.filter((e) => e.regressed);
    expect(regressoes.map((e) => `${e.trajectory}/${e.metric}`)).toEqual([]);
    expect(c.ok).toBe(true);
  });

  it('o default do harness continua sendo o baseline', () => {
    expect(compareToBaseline(runHarness(), baseline).ok).toBe(true);
  });
});

describe('kalmanEma NÃO passa no aceite — e a medição fica registrada', () => {
  it('regride sobre as trajetórias sintéticas, e isso é reportado, não escondido', () => {
    // MEDIDO: `saccade-20deg` meanErrorPx vai de 53,16 (baseline) para ~148 px.
    //
    // Afrouxar `DEFAULT_TOLERANCES` até isto passar seria transformar o portão
    // num carimbo. A tolerância existe para detectar regressão;
    // ajustá-la à regressão que ela detectou é apagar o instrumento.
    const c = compareToBaseline(runHarness({ filterMode: 'kalmanEma' }), baseline);
    expect(c.ok).toBe(false);
    expect(c.entries.some((e) => e.regressed)).toBe(true);
  });

  it('a causa é medível: o harness não tem latência para a predição cancelar', () => {
    // O Kalman prediz `predictAheadFrames` à frente para compensar o atraso do
    // pipeline. O harness roda `predict` e `filter` no mesmo quadro da
    // medição — atraso zero. Predizer à frente de um sinal que não está
    // atrasado é overshoot puro.
    //
    // A assinatura disso é o erro crescer MONOTONICAMENTE com o horizonte.
    // Se em vez disso houvesse um mínimo interno, a explicação estaria errada.
    const erros = [0, 1, 2].map((pa) => {
      const r = runHarness({ filterMode: 'kalman', kalman: { predictAheadFrames: pa } });
      return r.trajectories.find((t) => t.name === 'saccade-20deg')!.meanErrorPx;
    });
    expect(erros[1]).toBeGreaterThan(erros[0]);
    expect(erros[2]).toBeGreaterThan(erros[1]);
  });

  it('e por isso o harness NÃO pode decidir sobre o kalmanEma', () => {
    // A conclusão que este arquivo autoriza é estreita: sobre trajetórias
    // sintéticas SEM latência, o kalmanEma é pior. O pipeline real tem 2–3
    // quadros de atraso, que é justamente o que a predição existe para
    // cancelar — e nenhum deles existe aqui.
    //
    // Quem decide é a medição com humano e com o pipeline real. O que o
    // harness entrega é a possibilidade de fazer a comparação, que antes não
    // havia.
    //
    // Este teste trava o default: enquanto ninguém mediu no pipeline real, a
    // cadeia que roda em produção é a do baseline.
    expect(EXPERIMENT.filterMode).toBe('oneEuro');
  });
});

describe('as flags de interface não mudam o baseline', () => {
  it('as flags de medição nascem no comportamento atual', () => {
    // As flags são selecionáveis, mas o DEFAULT continua sendo o produto de
    // hoje: ligar uma flag é uma decisão de medição, não um efeito colateral
    // de instalá-la. A exceção é `gazeLostFallback`, que é comportamento de
    // segurança (esconder o cursor e avisar quando o gaze some) e por isso
    // nasce ligada.
    expect(EXPERIMENT.cursorSizePx).toBe(48);
    expect(EXPERIMENT.dwellRingOnCursor).toBe(false);
    expect(EXPERIMENT.blinkClick).toBe(false);
    expect(EXPERIMENT.scanningMode).toBe(false);
    expect(EXPERIMENT.gazeLostFallback).toBe(true);
  });

  it('as flags de interface não tocam no harness — e é por isso que elas não aparecem aqui', () => {
    // Cursor, anel, piscada-clique, varredura e fallback são todos DEPOIS do
    // ponto que o harness mede (ele para na saída filtrada). Um teste que
    // ligasse essas flags e afirmasse "as métricas não mudaram" estaria
    // medindo nada e reportando como evidência.
    const a = runHarness({ seed: 4242 });
    const b = runHarness({ seed: 4242 });
    expect(a.trajectories).toEqual(b.trajectories);
  });
});
