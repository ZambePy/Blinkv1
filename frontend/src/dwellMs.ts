/**
 * Tempo de permanência (dwell), em milissegundos.
 *
 * Era um enum de três valores — lento, normal, rápido. Três degraus não cobrem
 * a distância entre um paciente com ELA avançada, que pode precisar de três
 * segundos para fixar, e alguém com boa fixação, para quem 2,5 s é uma espera
 * irritante em cada letra digitada. Entre 0,8 e 2,5 s não havia nada.
 *
 * Os presets sobrevivem como atalhos, não como o único caminho.
 */

/** Abaixo disto o clique dispara antes de a fixação estabilizar. */
export const DWELL_MIN_MS = 400;
/** Acima disto uma frase leva minutos. */
export const DWELL_MAX_MS = 4000;

export const DWELL_PADRAO_MS = 1500;

export const PRESETS_DE_DWELL = [
  { id: 'lento', ms: 2500 },
  { id: 'normal', ms: 1500 },
  { id: 'rapido', ms: 800 },
] as const;

export type PresetDeDwell = (typeof PRESETS_DE_DWELL)[number];

/** Quanto o valor pode desviar de um preset e ainda ser "aquele preset". */
const TOLERANCIA_DE_PRESET_MS = 25;

const LEGADO: Record<string, number> = {
  slow: 2500,
  normal: 1500,
  fast: 800,
};

/**
 * Converte o enum antigo.
 *
 * Quem já configurou "lento" não pode perder a escolha e voltar ao padrão na
 * primeira abertura depois da atualização: para alguns pacientes isso deixa o
 * app inoperável até alguém perceber por quê.
 */
export function dwellMsDoLegado(speed: 'slow' | 'normal' | 'fast'): number {
  return LEGADO[speed] ?? DWELL_PADRAO_MS;
}

/**
 * Prende o valor na faixa.
 *
 * `NaN` — que um campo de slider vazio produz — vira o padrão, e não passa
 * adiante: um dwell `NaN` nunca completa, e o paciente fica sem conseguir
 * clicar em nada sem qualquer sinal do motivo.
 */
export function limitarDwellMs(ms: number): number {
  if (!Number.isFinite(ms)) {
    return Number.isNaN(ms) ? DWELL_PADRAO_MS : ms > 0 ? DWELL_MAX_MS : DWELL_MIN_MS;
  }
  return Math.min(DWELL_MAX_MS, Math.max(DWELL_MIN_MS, ms));
}

/**
 * O preset correspondente ao valor, ou `null` quando ele está entre dois.
 *
 * `null` é a resposta certa e não um caso de borda: o slider existe justamente
 * para permitir valores que não são preset, e destacar um atalho que não
 * corresponde ao configurado mentiria sobre o estado.
 */
export function presetMaisProximo(ms: number): PresetDeDwell | null {
  return PRESETS_DE_DWELL.find((p) => Math.abs(p.ms - ms) <= TOLERANCIA_DE_PRESET_MS) ?? null;
}
