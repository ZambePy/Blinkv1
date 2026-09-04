// P7.1 — cursor de alto contraste com tamanho ajustável.
//
// ── Por que isto é um módulo puro e não CSS ─────────────────────────────────
//
// Duas coisas aqui são aritmética, não estilo, e as duas quebram em silêncio:
//
//   1. **O offset de centralização.** Hoje o `GazeContext` desenha o cursor com
//      `translate3d(sample.x - 24, sample.y - 24)` e um `width:48px` no CSS. O
//      `24` é `48/2` escrito à mão, em outro arquivo. Enquanto o tamanho for
//      fixo, funciona. No instante em que ele vira ajustável — que é o pedido
//      desta tarefa — um cursor de 96 px passa a ser desenhado 24 px acima e à
//      esquerda de onde a pessoa está olhando.
//
//      E esse erro NÃO se parece com um bug de layout. Ele se parece com erro
//      de calibração: um viés constante, na mesma direção, que piora conforme o
//      cursor cresce. O paciente compensa olhando torto, a calibração online
//      aprende o viés compensado, e o problema fica pior. Por isso o offset é
//      derivado aqui e testado.
//
//   2. **O contraste.** "Alto contraste" não é uma cor bonita; é uma razão de
//      luminância que se pode calcular. O cursor atual é
//      `rgba(239,68,68,0.6)` — vermelho translúcido. Sobre o botão de
//      emergência, que é vermelho, ele desaparece. Sobre um fundo claro, os 60%
//      de opacidade o deixam pálido.
//
// ── A estratégia: anel duplo ────────────────────────────────────────────────
//
// Nenhuma cor única é visível sobre todos os fundos. A saída é desenhar DUAS
// bordas concêntricas de luminâncias opostas: uma quase preta e uma quase
// branca. Qualquer que seja o fundo, uma das duas contrasta com ele — é a mesma
// técnica dos cursores do sistema operacional e das miras de jogos.
//
// O preenchimento continua colorido (estado do dwell), mas ele deixou de ser o
// que torna o cursor visível. Isso é o que permite baixar a opacidade do
// preenchimento sem perder o cursor de vista.

/** Razão de contraste WCAG entre duas cores opacas (1 a 21). */
export function contrasteWCAG(a: RGB, b: RGB): number {
  const la = luminanciaRelativa(a);
  const lb = luminanciaRelativa(b);
  const [claro, escuro] = la >= lb ? [la, lb] : [lb, la];
  return (claro + 0.05) / (escuro + 0.05);
}

export interface RGB { r: number; g: number; b: number }

function luminanciaRelativa({ r, g, b }: RGB): number {
  const canal = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(r) + 0.7152 * canal(g) + 0.0722 * canal(b);
}

/**
 * Tamanhos oferecidos, em px de diâmetro.
 *
 * O piso não é estético. Abaixo de ~24 px o cursor fica menor que o jitter
 * residual do rastreamento, e o paciente vê um ponto tremendo em vez de um
 * cursor — a leitura vira "o sistema está com defeito".
 *
 * O teto existe porque um cursor grande demais cobre o alvo que ele deveria
 * apontar: com 128 px sobre uma tecla de teclado ocular, a tecla some debaixo
 * do cursor e a pessoa perde a confirmação visual de onde está.
 */
export const CURSOR_TAMANHOS = {
  pequeno: 32,
  medio: 48,
  grande: 72,
  enorme: 96,
} as const;

export type TamanhoDeCursor = keyof typeof CURSOR_TAMANHOS;

export const CURSOR_TAMANHO_MIN_PX = 24;
export const CURSOR_TAMANHO_MAX_PX = 128;

/** O default é o tamanho de hoje — trocar o visual de todo mundo não é tarefa
 *  desta flag. */
export const CURSOR_TAMANHO_PADRAO: TamanhoDeCursor = 'medio';

/**
 * O par de contraste do anel duplo.
 *
 * Não são `#000` e `#fff` puros de propósito: preto absoluto sobre um tema
 * escuro some tanto quanto branco sobre um claro, e o par abaixo mantém a razão
 * de contraste entre si praticamente igual enquanto continua distinguível de
 * fundos totalmente saturados.
 */
export const ANEL_ESCURO: RGB = { r: 17, g: 17, b: 17 };
export const ANEL_CLARO: RGB = { r: 250, g: 250, b: 250 };

/** Espessura de cada anel, em px. Independe do tamanho: o anel é o que torna o
 *  cursor visível, e afinar num cursor pequeno derrotaria o propósito. */
export const ANEL_ESPESSURA_PX = 3;

export type EstadoDoCursor = 'normal' | 'sobreAlvo' | 'degradado' | 'segurando';

export interface EntradaEstiloCursor {
  /** Diâmetro pedido, em px. Fora da faixa, é preso nos limites. */
  tamanhoPx: number;
  estado: EstadoDoCursor;
  /** Progresso do dwell, 0–1. Usado no preenchimento e na escala. */
  dwellPct: number;
}

export interface EstiloDeCursor {
  /** Diâmetro efetivo, já preso à faixa. */
  tamanhoPx: number;
  /**
   * Quanto subtrair de `x` e `y` para o CENTRO do cursor cair no ponto olhado.
   *
   * Sempre `tamanhoPx / 2`. Existe como campo, e não como conta no chamador,
   * porque foi exatamente a conta no chamador que criou o risco descrito no
   * cabeçalho.
   */
  offsetPx: number;
  /** Escala aplicada no dwell. `transform-origin: center` mantém o centro. */
  escala: number;
  preenchimento: string;
  /** `box-shadow` com os dois anéis concêntricos. */
  anel: string;
  /** O cursor está em estado que sinaliza posição não confiável. */
  tracejado: boolean;
}

export function limitarTamanho(px: number): number {
  if (!Number.isFinite(px)) return CURSOR_TAMANHOS[CURSOR_TAMANHO_PADRAO];
  return Math.min(CURSOR_TAMANHO_MAX_PX, Math.max(CURSOR_TAMANHO_MIN_PX, px));
}

const rgba = ({ r, g, b }: RGB, a: number) => `rgba(${r},${g},${b},${a})`;

/**
 * Traduz estado + tamanho em geometria e cores.
 *
 * Puro: nenhuma leitura de DOM, nenhum relógio. O chamador aplica.
 */
export function estiloDoCursor(entrada: EntradaEstiloCursor): EstiloDeCursor {
  const tamanhoPx = limitarTamanho(entrada.tamanhoPx);
  const pct = Math.min(1, Math.max(0, entrada.dwellPct));

  let preenchimento: string;
  switch (entrada.estado) {
    case 'sobreAlvo':
      preenchimento = `rgba(34,197,94,${(0.5 + pct * 0.4).toFixed(2)})`;
      break;
    case 'degradado':
      preenchimento = 'rgba(234,179,8,0.55)';
      break;
    case 'segurando':
      // Posição congelada do `P7.5`: cinza neutro. Não é um estado de erro (o
      // rastreamento pode voltar em 200 ms), mas também não pode parecer o
      // cursor ativo — senão o paciente continua tentando mirar com ele.
      preenchimento = 'rgba(148,163,184,0.45)';
      break;
    default:
      preenchimento = 'rgba(239,68,68,0.6)';
  }

  // Dois anéis concêntricos via box-shadow: o escuro colado no cursor, o claro
  // por fora dele. Um `border` só daria uma cor — e uma cor sozinha sempre tem
  // um fundo que a engole.
  const e = ANEL_ESPESSURA_PX;
  const anel = [
    `0 0 0 ${e}px ${rgba(ANEL_ESCURO, 0.9)}`,
    `0 0 0 ${e * 2}px ${rgba(ANEL_CLARO, 0.9)}`,
    `0 0 ${Math.round(tamanhoPx / 3)}px rgba(0,0,0,0.35)`,
  ].join(', ');

  return {
    tamanhoPx,
    offsetPx: tamanhoPx / 2,
    escala: entrada.estado === 'sobreAlvo' ? 1 + pct * 0.3 : 1,
    preenchimento,
    anel,
    tracejado: entrada.estado === 'degradado' || entrada.estado === 'segurando',
  };
}
