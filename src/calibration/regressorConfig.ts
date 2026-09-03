// Configuração estática do `RidgeRegressor`, serializável para atravessar a
// fronteira de um Web Worker — B3.10.
//
// ## O problema
//
// `RidgeRegressor` guarda quatro parâmetros de treino em campos ESTÁTICOS:
// `axisScale`, `independentLambda`, `balanceTargets` e `lambdaOverride`. Isso
// funciona na main thread, onde há um único registro de módulos.
//
// Um Web Worker tem o SEU próprio registro. O `calibration.worker.ts` importa
// `RidgeRegressor` e recebe uma instância nova da classe, com todos os
// estáticos nos defaults — independentemente do que a main thread configurou
// antes de despachar o treino.
//
// O mais caro dos quatro é `axisScale`. O default `{1, 1}` faz o CV pesar erro
// em X e em Y igualmente, quando 1 px de X vale menos que 1 px de Y em fração
// de tela. Em 1920×1080 isso reintroduz exatamente o bug de aspect-ratio que
// `axisScale` existe para corrigir — a nota no repositório mede **3,16× de
// subponderação do eixo X**.
//
// ## Por que um módulo separado
//
// O snapshot precisa ser construído na main thread e aplicado dentro do
// worker. Ter os dois lados na mesma função torna impossível eles divergirem —
// que é como o bug nasceu.

import { RidgeRegressor } from '../ridge';

/** Estado estático do `RidgeRegressor` que afeta o resultado do treino. */
export interface RegressorConfig {
  /** Pesos por eixo na escolha de λ, em pixels de tela. */
  axisScale: { x: number; y: number };
  /** λ independente por eixo, ou um λ conjunto. */
  independentLambda: boolean;
  /** Equaliza o peso total de cada alvo, independente de quantos frames reteve. */
  balanceTargets: boolean;
  /** Substitui o λ do CV. `null` no caminho normal — só o harness escreve. */
  lambdaOverride: number | null;
}

/** Fotografa a configuração corrente, para enviar ao worker. */
export function snapshotConfigDoRegressor(): RegressorConfig {
  return {
    axisScale: { ...RidgeRegressor.axisScale },
    independentLambda: RidgeRegressor.independentLambda,
    balanceTargets: RidgeRegressor.balanceTargets,
    lambdaOverride: RidgeRegressor.lambdaOverride,
  };
}

/**
 * Instala a configuração recebida. Chamada pelo worker ANTES de treinar.
 *
 * Campos ausentes mantêm o valor corrente — requests de versões antigas do
 * cliente não podem zerar a configuração de quem as recebe.
 */
export function aplicarConfigDoRegressor(cfg: Partial<RegressorConfig> | undefined): void {
  if (!cfg) return;
  if (cfg.axisScale && Number.isFinite(cfg.axisScale.x) && Number.isFinite(cfg.axisScale.y)) {
    RidgeRegressor.axisScale = { x: cfg.axisScale.x, y: cfg.axisScale.y };
  }
  if (typeof cfg.independentLambda === 'boolean') {
    RidgeRegressor.independentLambda = cfg.independentLambda;
  }
  if (typeof cfg.balanceTargets === 'boolean') {
    RidgeRegressor.balanceTargets = cfg.balanceTargets;
  }
  if (cfg.lambdaOverride === null || typeof cfg.lambdaOverride === 'number') {
    RidgeRegressor.lambdaOverride = cfg.lambdaOverride;
  }
}
