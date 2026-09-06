import {
  DEFAULTS,
  EXPERIMENT,
  sanitizeExperiment,
  type ExperimentConfig,
} from '@tracker/config/experiment';

/**
 * Leitura e gravação das opções do pipeline que a tela de Configurações
 * expõe ao cuidador (filtro, cursor, piscada, varredura, fallback).
 *
 * O core lê essa configuração UMA vez, no boot (`EXPERIMENT`), e grava o
 * mesmo JSON que `__irisflowExp.set` usa no console. Por isso existe a noção
 * de "pendente": o que está no disco só passa a valer depois de recarregar.
 */

/** Mesma chave que `src/config/experiment.ts` usa. */
const STORAGE_KEY = 'irisflow.experiment';

export type ExposedFlag =
  | 'filterMode'
  | 'cursorSizePx'
  | 'dwellRingOnCursor'
  | 'blinkClick'
  | 'scanningMode'
  | 'gazeLostFallback';

export const EXPOSED_FLAGS: readonly ExposedFlag[] = [
  'filterMode',
  'cursorSizePx',
  'dwellRingOnCursor',
  'blinkClick',
  'scanningMode',
  'gazeLostFallback',
];

export type ExperimentPatch = Partial<Pick<ExperimentConfig, ExposedFlag>>;

/** Configuração em vigor nesta sessão (a que o engine leu no boot). */
export function activeExperiment(): ExperimentConfig {
  return { ...EXPERIMENT };
}

/** Configuração gravada no disco — a que vai valer no próximo boot. */
export function pendingExperiment(): ExperimentConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return sanitizeExperiment(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULTS };
  }
}

/** Grava um ajuste e devolve a configuração pendente resultante. */
export function saveExperiment(patch: ExperimentPatch): ExperimentConfig {
  const next = sanitizeExperiment({ ...pendingExperiment(), ...patch });
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Sem storage a mudança vale só até recarregar — e recarregar é
    // justamente o que a aplicaria. Nada a fazer além de seguir.
  }
  return next;
}

/** Quais das opções expostas diferem entre o que está ativo e o pendente. */
export function pendingDiff(pending: ExperimentConfig): ExposedFlag[] {
  const active = activeExperiment();
  return EXPOSED_FLAGS.filter((k) => active[k] !== pending[k]);
}
