import type React from 'react';

/**
 * Realce visual que vale para mouse E para foco.
 *
 * Espalhados por várias telas havia botões que só reagiam a `onMouseOver` /
 * `onMouseOut`. Quem chega ao botão por Tab — ou pelo dwell, que move o foco —
 * simplesmente não recebia retorno nenhum. Num app cuja premissa é que o
 * usuário não usa mouse, isso não é detalhe de lint: é metade dos usuários sem
 * saber onde está.
 *
 * `enter` e `leave` recebem o elemento e mexem no estilo dele; os quatro
 * handlers (hover + foco) saem prontos para espalhar no JSX.
 */
export const hoverAndFocus = (
  enter: (el: HTMLElement) => void,
  leave: (el: HTMLElement) => void
) => {
  const on = (fn: (el: HTMLElement) => void) => (e: React.SyntheticEvent<HTMLElement>) => {
    fn(e.currentTarget);
  };
  return {
    onMouseOver: on(enter),
    onFocus: on(enter),
    onMouseOut: on(leave),
    onBlur: on(leave),
  };
};

/** Atalho para o caso mais comum: trocar só o fundo entre dois valores. */
export const hoverAndFocusBackground = (base: string, highlight: string) =>
  hoverAndFocus(
    (el) => {
      el.style.background = highlight;
    },
    (el) => {
      el.style.background = base;
    }
  );
