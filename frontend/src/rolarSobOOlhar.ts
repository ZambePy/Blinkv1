/**
 * Aplica a rolagem por olhar no elemento certo.
 *
 * Separado do `GazeContext` porque a pergunta "o que rola quando o olhar está
 * aqui?" é sobre o DOM e nada tem a ver com o despachante de olhar — e porque
 * assim dá para testá-la com um DOM montado à mão, sem câmera.
 *
 * O **ancestral rolável mais próximo** manda. Sem isso, olhar na borda de baixo
 * dentro de uma lista rolaria a página inteira em vez da lista, e o conteúdo
 * que a pessoa está lendo sairia da tela.
 */

/** Elementos que rolam de verdade: têm transbordo E overflow que o permite. */
export function podeRolarVerticalmente(el: Element): boolean {
  if (!(el instanceof HTMLElement)) return false;

  // 1 px de folga: `scrollHeight` e `clientHeight` divergem por arredondamento
  // de subpixel em telas com escala, e sem a folga metade dos contêineres
  // pareceria rolável sem ter para onde rolar.
  if (el.scrollHeight - el.clientHeight <= 1) return false;

  const overflow = getComputedStyle(el).overflowY;
  return overflow === 'auto' || overflow === 'scroll' || overflow === 'overlay';
}

/**
 * O ancestral rolável mais próximo do ponto, ou `null` quando só a janela rola.
 */
export function alvoDeRolagem(x: number, y: number): HTMLElement | null {
  const inicio = document.elementFromPoint(x, y);
  let no: Element | null = inicio;

  while (no && no !== document.body && no !== document.documentElement) {
    if (podeRolarVerticalmente(no)) return no as HTMLElement;
    no = no.parentElement;
  }
  return null;
}

/**
 * Rola o que estiver sob o ponto.
 *
 * `velocidadePxS` vem da máquina pura de bordas; `deltaMs` é o intervalo desde
 * a última amostra. Multiplicar os dois — em vez de rolar um passo fixo por
 * quadro — mantém a velocidade em pixels por segundo mesmo quando a taxa de
 * amostras varia, que é justamente o caso numa webcam de 15 fps.
 */
export function rolarSobOOlhar(x: number, y: number, velocidadePxS: number, deltaMs: number): void {
  // Um `deltaMs` absurdo (aba em segundo plano, engasgo do detector) rolaria a
  // página inteira num quadro. 100 ms é ~3 amostras a 30 fps.
  const dt = Math.min(100, Math.max(0, deltaMs)) / 1000;
  const passo = velocidadePxS * dt;
  if (passo === 0) return;

  const alvo = alvoDeRolagem(x, y);
  if (alvo) {
    alvo.scrollTop += passo;
    return;
  }

  // `behavior: 'auto'` de propósito: 'smooth' acumularia animações a cada
  // amostra e a rolagem continuaria depois de o olhar sair da borda.
  window.scrollBy({ top: passo, behavior: 'auto' });
}
