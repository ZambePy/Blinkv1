// P7.2 — anel de progresso ao redor do CURSOR.
//
// ── Por que no cursor e não só no botão ─────────────────────────────────────
//
// O realce de progresso hoje existe só no alvo (`--gaze-dwell-progress` no nó
// sob o olhar). Isso funciona quando o alvo é grande e o olhar está no meio
// dele. Falha em dois casos que são a rotina de quem usa isto:
//
//   - **Alvos pequenos e vizinhos.** Num teclado ocular, o botão sob o olhar
//     tem ~40 px. O progresso desenhado nele fica debaixo do próprio cursor.
//   - **Nenhum alvo.** Olhando para o vazio não há onde desenhar, então o
//     paciente não tem retorno de que o sistema está vivo — que é justamente
//     quando ele mais precisa saber.
//
// O anel no cursor resolve os dois porque ele acompanha o olhar: está sempre no
// centro do campo visual atento, que é onde a fóvea está. Um indicador de
// progresso fora dele exige um sacádico para ser lido — e o sacádico cancela o
// próprio dwell que se queria acompanhar.
//
// ── A armadilha geométrica do SVG ───────────────────────────────────────────
//
// Um traço de espessura `w` num círculo de raio `r` ocupa de `r - w/2` a
// `r + w/2`. Dimensionar o `viewBox` como `2r` — que é a conta intuitiva —
// corta metade da espessura nas quatro bordas.
//
// E o corte não é uniforme: aparece como quatro achatados nos pontos cardeais,
// que se leem como "o anel está tremendo". Num indicador cuja única função é
// dizer "o sistema está contando", parecer instável é a falha exata que ele
// veio evitar. Por isso a caixa é calculada aqui e testada.

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
