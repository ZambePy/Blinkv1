/**
 * Janela de estabilidade do passo de posicionamento.
 *
 * Sem ela, "Continuar" fica habilitado no primeiro frame verde — e o cuidador
 * clica no instante de sorte, com o paciente numa pose que ele não sustenta. A
 * calibração inteira parte de uma posição que durou 30 ms.
 *
 * O comportamento que dá sentido à janela é o **reset**: cair para amarelo
 * zera. Um acumulador que apenas somasse tempo verde aprovaria três segundos
 * picotados em trinta lampejos de cem milissegundos — exatamente o caso que a
 * janela existe para reprovar.
 *
 * Máquina pura, sem timer nem relógio próprio: o chamador passa o instante. Dá
 * para testar a regra inteira sem `vi.useFakeTimers`.
 */

export const ESTABILIDADE_EXIGIDA_MS = 3000;

export interface EstadoDeEstabilidade {
  /** Instante do primeiro frame verde da sequência atual. `null` = não está verde. */
  readonly desdeMs: number | null;
}

export const inicial = (): EstadoDeEstabilidade => ({ desdeMs: null });

export function acumular(
  estado: EstadoDeEstabilidade,
  verde: boolean,
  agoraMs: number
): EstadoDeEstabilidade {
  if (!verde) return { desdeMs: null };
  // Já estava verde: preserva o início, senão a contagem reiniciaria a cada
  // amostra e nunca chegaria à janela.
  return estado.desdeMs === null ? { desdeMs: agoraMs } : estado;
}

export function msEstavel(estado: EstadoDeEstabilidade, agoraMs: number): number {
  if (estado.desdeMs === null) return 0;
  // `Math.max(0, …)`: o estado pode atravessar uma suspensão da aba, e tempo
  // negativo virando "estável" liberaria o botão sem ninguém ter ficado parado.
  return Math.max(0, agoraMs - estado.desdeMs);
}

export function estavel(estado: EstadoDeEstabilidade, agoraMs: number): boolean {
  return msEstavel(estado, agoraMs) >= ESTABILIDADE_EXIGIDA_MS;
}

/** Fração [0..1] para a barra de progresso da tela. */
export function progresso(estado: EstadoDeEstabilidade, agoraMs: number): number {
  return Math.min(1, msEstavel(estado, agoraMs) / ESTABILIDADE_EXIGIDA_MS);
}
