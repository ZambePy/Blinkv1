/**
 * Idade de um carimbo, em texto de cuidador.
 *
 * "há 3 dias" é o que decide se vale reaproveitar uma calibração — o número
 * cru não ajuda ninguém, e "salva" sozinho não diz se foi hoje ou no mês
 * passado, com o paciente noutra posição.
 *
 * Extraído do `CalibrationCheck`, onde estava cravado: o menu principal precisa
 * do MESMO texto, e duas cópias divergiriam no primeiro ajuste — uma diria
 * "há 1 dia" e a outra "de ontem" para o mesmo carimbo.
 */

export const SEM_DATA = 'sem data';

const DIA_MS = 24 * 60 * 60 * 1000;

export function idadeEmTexto(carimboMs: number | null, agoraMs: number = Date.now()): string {
  if (carimboMs === null || !Number.isFinite(carimboMs)) return SEM_DATA;

  // `Math.max(0, …)`: fuso trocado, relógio corrigido ou máquina que voltou do
  // sono com hora errada produzem carimbo no futuro. "há -2 dias" na tela é
  // pior que arredondar para hoje.
  const dias = Math.floor(Math.max(0, agoraMs - carimboMs) / DIA_MS);

  if (dias === 0) return 'de hoje';
  if (dias === 1) return 'de ontem';
  return `há ${dias} dias`;
}
