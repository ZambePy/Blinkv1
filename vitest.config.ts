import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.ts'],
    /**
     * Teto de tempo por caso.
     *
     * ── Histórico, porque a trajetória é a lição ─────────────────────────────
     *
     * 5 s (default do vitest) → 30 s → 60 s → **20 s**.
     *
     * Os três primeiros degraus foram reações a falhas INTERMITENTES sob carga
     * paralela: vários testes do núcleo treinam um Ridge completo, incluindo a
     * seleção de λ por validação cruzada leave-one-target-out sobre um grid de
     * 25 valores — 9 alvos × 25 λ = 225 ajustes de mínimos quadrados por
     * chamada. Isolados custavam ~1 s; sob a suíte inteira em workers
     * paralelos, a contenção de CPU empurrava alguns além do teto vigente.
     *
     * Subir o teto tratava o sintoma. A causa era um arquivo gastando o CV de λ
     * para medir uma propriedade que não depende dele:
     * `calibration.eyefusion.test.ts` mede FUSÃO BINOCULAR e rodava ~2700
     * ajustes de mínimos quadrados escolhendo λ que nenhuma asserção observava.
     *
     * Medido: 78,97 s isolado. Com `RidgeRegressor.lambdaOverride` fixo naquele
     * arquivo — e só nele, porque `ridge.test.ts` e
     * `regression_precision_audit.test.ts` de fato medem a seleção de λ e
     * continuam com a CV ligada — caiu para **2,40 s**. Os outros arquivos da
     * mesma família já custavam 2–3,5 s: `calibration.l2csdiag` 3,43 s,
     * `calibration.distance` 3,46 s, `engine.b1-6-b1-7` 2,05 s.
     *
     * Com o pior caso isolado em ~3,5 s, 20 s dá ~6× de margem — o bastante
     * para a contenção de CPU da suíte cheia numa máquina lenta, e baixo o
     * suficiente para um teste de fato travado falhar rápido em vez de segurar
     * o CI por um minuto. Nenhum destes testes espera I/O ou timer real, então
     * o que varia é só tempo de máquina.
     *
     * ⚠️ `calibration.eyefusion.test.ts` declara um timeout PRÓPRIO, que
     * sobrescreve este. Mexer só aqui não tem efeito lá.
     */
    testTimeout: 20_000,
  },
});
