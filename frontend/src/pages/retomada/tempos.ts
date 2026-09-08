/**
 * Os tempos da checagem de retomada.
 *
 * Em módulo próprio por dois motivos. O primeiro é técnico: a tela é carregada
 * por `lazyNamed`, que exige que todo export do módulo seja um componente.
 *
 * O segundo é que estes números são o orçamento da tela. Somados, decidem
 * quanto tempo alguém que quer falar espera antes de poder falar — e essa conta
 * merece estar num lugar onde dá para vê-la inteira, não espalhada entre
 * `setTimeout`s.
 */

/** Quanto cada alvo fica na tela. Três alvos: ~6,6 s de coleta. */
export const MS_POR_ALVO = 2200;

/**
 * Descartado no começo de cada alvo: a sacada até ele não é fixação.
 *
 * Medido com `Date.now()`, o mesmo relógio do `setTimeout` que fecha o alvo:
 * duas fontes de tempo para a mesma janela poderiam divergir e descartar (ou
 * aceitar) amostras que a outra não descartaria.
 */
export const MS_DE_ACOMODACAO = 700;

/**
 * Se em oito segundos o rosto não entrou no enquadramento, a checagem termina
 * com veredito em vez de esperar para sempre.
 *
 * Uma tela pendurada exigindo uma posição que o paciente talvez não consiga
 * fazer hoje é pior que um "não deu para conferir": esta não tem como saber se
 * ele consegue, e quem está do outro lado não tem como explicar.
 */
export const MS_LIMITE_DE_ENQUADRAMENTO = 8000;
