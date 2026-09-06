/**
 * Roda `fn` depois que o navegador pintou o estado atual.
 *
 * Um único `requestAnimationFrame` não basta: o callback dele roda ANTES da
 * pintura do quadro, então trabalho pesado ali ainda segura a tela. Com dois,
 * o primeiro entra no quadro que desenha o estado novo e o segundo só roda no
 * quadro seguinte — quando a pintura já aconteceu.
 *
 * A rede de timer não é decoração: aba oculta congela o `requestAnimationFrame`
 * indefinidamente. Sem ela, trocar de aba na hora errada deixa a tela presa num
 * estado de transição para sempre. Vale também para jsdom/SSR, onde `rAF` pode
 * não existir.
 */
export function esperarPintura(fn: () => void, redeMs = 250): void {
  let feito = false;
  const rodar = () => {
    if (feito) return;
    feito = true;
    fn();
  };
  if (typeof requestAnimationFrame === 'function') {
    requestAnimationFrame(() => { requestAnimationFrame(rodar); });
  }
  setTimeout(rodar, redeMs);
}
