// Anel de progresso ao redor do CURSOR.
//
// O realce de progresso só no alvo falha em alvos pequenos e vizinhos (num
// teclado ocular o botão fica debaixo do próprio cursor) e quando não há alvo
// nenhum. O anel no cursor acompanha o olhar, então está sempre na fóvea; um
// indicador fora dela exige um sacádico que cancela o próprio dwell.
//
// Armadilha do SVG: um traço de espessura `w` num círculo de raio `r` ocupa
// de `r - w/2` a `r + w/2`. Dimensionar o `viewBox` como `2r` corta metade da
// espessura nos pontos cardeais, e o anel parece tremer. Por isso a caixa é
// calculada aqui e testada.

/** Espessura do traço do anel, em px. */
export const ANEL_ESPESSURA_PX = 4;

/**
 * Folga entre a borda do cursor e o raio do anel, em px.
 *
 * Sem folga, o anel encosta no preenchimento do cursor e os dois viram uma
 * mancha só — perde-se a leitura do progresso, que é a única coisa que o anel
 * faz.
 */
export const ANEL_FOLGA_PX = 6;

export interface GeometriaDoAnel {
  /** Raio do círculo do traço, em px. */
  raio: number;
  /** Lado do `viewBox` quadrado, já com a espessura do traço somada. */
  lado: number;
  /** Centro do `viewBox` — `lado / 2` em ambos os eixos. */
  centro: number;
  espessura: number;
  /** Perímetro, usado como `stroke-dasharray`. */
  circunferencia: number;
  /** `stroke-dashoffset` do progresso corrente. */
  offset: number;
  /**
   * Rotação a aplicar no círculo, em graus.
   *
   * `-90` porque o ângulo zero do SVG fica às 3 h. Sem isso o anel começaria a
   * encher pela direita, e o paciente compara com o relógio de parede: um
   * indicador circular que não começa às 12 h se lê como andando para trás.
   */
  rotacaoDeg: number;
}

/**
 * Geometria do anel para um cursor de `tamanhoCursorPx` de diâmetro.
 *
 * Puro. `pct` fora de 0–1 é preso — um `NaN` vindo de uma divisão por zero no
 * cálculo do progresso não pode virar um `stroke-dashoffset: NaN`, que o
 * navegador ignora deixando o anel CHEIO: o paciente veria dwell completo num
 * dwell que não começou.
 */
export function geometriaDoAnel(tamanhoCursorPx: number, pct: number): GeometriaDoAnel {
  const espessura = ANEL_ESPESSURA_PX;
  const raio = tamanhoCursorPx / 2 + ANEL_FOLGA_PX;
  // `+ espessura` e não `+ espessura/2`: o traço transborda o raio para os dois
  // lados, então a caixa cresce metade em cada uma das duas bordas do eixo.
  const lado = 2 * raio + espessura;
  const circunferencia = 2 * Math.PI * raio;
  const p = Number.isFinite(pct) ? Math.min(1, Math.max(0, pct)) : 0;
  return {
    raio,
    lado,
    centro: lado / 2,
    espessura,
    circunferencia,
    // Cheio (offset = circunferência) em 0%, vazio (offset = 0) em 100%.
    offset: circunferencia * (1 - p),
    rotacaoDeg: -90,
  };
}
