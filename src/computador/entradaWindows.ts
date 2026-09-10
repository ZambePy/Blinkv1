/**
 * Montagem das estruturas `INPUT` do Windows (user32 `SendInput`).
 *
 * Só a montagem: nenhuma chamada nativa aqui. O processo principal do Electron
 * entrega estes objetos ao `koffi`, que os grava na memória com o layout da
 * struct. Separar a montagem da chamada é o que permite testar, num Linux sem
 * user32, que um "clique duplo" vira DOWN/UP/DOWN/UP e que "ção" sai como
 * três unidades UTF-16 com `KEYEVENTF_UNICODE` — os dois erros que aparecem
 * de verdade quando se escreve isto de cabeça.
 *
 * Referência: docs.microsoft.com/windows/win32/api/winuser/ns-winuser-input
 */

export const INPUT_MOUSE = 0;
export const INPUT_KEYBOARD = 1;

export const MOUSEEVENTF_MOVE = 0x0001;
export const MOUSEEVENTF_LEFTDOWN = 0x0002;
export const MOUSEEVENTF_LEFTUP = 0x0004;
export const MOUSEEVENTF_RIGHTDOWN = 0x0008;
export const MOUSEEVENTF_RIGHTUP = 0x0010;
export const MOUSEEVENTF_MIDDLEDOWN = 0x0020;
export const MOUSEEVENTF_MIDDLEUP = 0x0040;
export const MOUSEEVENTF_WHEEL = 0x0800;
export const MOUSEEVENTF_HWHEEL = 0x1000;

export const KEYEVENTF_EXTENDEDKEY = 0x0001;
export const KEYEVENTF_KEYUP = 0x0002;
export const KEYEVENTF_UNICODE = 0x0004;

/** Uma "unidade" de roda no Windows. */
export const WHEEL_DELTA = 120;

export type BotaoDoMouse = 'esquerdo' | 'direito' | 'meio';

export interface MouseInput {
  dx: number;
  dy: number;
  mouseData: number;
  dwFlags: number;
  time: number;
  dwExtraInfo: number;
}

export interface KeybdInput {
  wVk: number;
  wScan: number;
  dwFlags: number;
  time: number;
  dwExtraInfo: number;
}

/** Um `INPUT` como o koffi o recebe (união com uma única chave preenchida). */
export type InputWin =
  | { type: typeof INPUT_MOUSE; u: { mi: MouseInput } }
  | { type: typeof INPUT_KEYBOARD; u: { ki: KeybdInput } };

const mouse = (dwFlags: number, mouseData = 0): InputWin => ({
  type: INPUT_MOUSE,
  u: { mi: { dx: 0, dy: 0, mouseData: mouseData >>> 0, dwFlags, time: 0, dwExtraInfo: 0 } },
});

const tecla = (wVk: number, wScan: number, dwFlags: number): InputWin => ({
  type: INPUT_KEYBOARD,
  u: { ki: { wVk, wScan, dwFlags, time: 0, dwExtraInfo: 0 } },
});

const FLAGS_DO_BOTAO: Record<BotaoDoMouse, { down: number; up: number }> = {
  esquerdo: { down: MOUSEEVENTF_LEFTDOWN, up: MOUSEEVENTF_LEFTUP },
  direito: { down: MOUSEEVENTF_RIGHTDOWN, up: MOUSEEVENTF_RIGHTUP },
  meio: { down: MOUSEEVENTF_MIDDLEDOWN, up: MOUSEEVENTF_MIDDLEUP },
};

/** Clique(s) na posição ATUAL do cursor — mova antes com `SetCursorPos`. */
export function inputsDeClique(botao: BotaoDoMouse, vezes: 1 | 2 = 1): InputWin[] {
  const f = FLAGS_DO_BOTAO[botao];
  const um = [mouse(f.down), mouse(f.up)];
  return vezes === 2 ? [...um, ...um] : um;
}

export function inputDeBotao(botao: BotaoDoMouse, acao: 'pressionar' | 'soltar'): InputWin {
  const f = FLAGS_DO_BOTAO[botao];
  return mouse(acao === 'pressionar' ? f.down : f.up);
}

/**
 * Rolagem vertical. `passos` positivo rola para CIMA (convenção do Windows:
 * `mouseData` positivo = afastar da pessoa). O chamador que quiser "rolar
 * para baixo" passa negativo. `mouseData` é DWORD, então o negativo vai em
 * complemento de dois — o `>>> 0` em `mouse()` cuida disso.
 */
export function inputDeRolagem(passos: number, horizontal = false): InputWin {
  const delta = Math.trunc(passos * WHEEL_DELTA) | 0;
  return mouse(horizontal ? MOUSEEVENTF_HWHEEL : MOUSEEVENTF_WHEEL, delta);
}

/** Teclas virtuais usadas pelo teclado da sobreposição. */
export const VK = {
  BACK: 0x08,
  TAB: 0x09,
  RETURN: 0x0d,
  SHIFT: 0x10,
  CONTROL: 0x11,
  MENU: 0x12, // Alt
  ESCAPE: 0x1b,
  SPACE: 0x20,
  PRIOR: 0x21, // Page Up
  NEXT: 0x22, // Page Down
  END: 0x23,
  HOME: 0x24,
  LEFT: 0x25,
  UP: 0x26,
  RIGHT: 0x27,
  DOWN: 0x28,
  DELETE: 0x2e,
  LWIN: 0x5b,
  A: 0x41,
  C: 0x43,
  D: 0x44,
  T: 0x54,
  V: 0x56,
  W: 0x57,
  X: 0x58,
  Z: 0x5a,
  F4: 0x73,
} as const;

/** Teclas que o Windows só reconhece com o bit "estendida". */
const ESTENDIDAS = new Set<number>([
  VK.PRIOR, VK.NEXT, VK.END, VK.HOME, VK.LEFT, VK.UP, VK.RIGHT, VK.DOWN, VK.DELETE, VK.LWIN,
]);

/**
 * Nomes de tecla que a sobreposição pode pedir. Lista fechada de propósito: o
 * renderer não pode pedir "qualquer combinação" — é a lista que define o que
 * um processo com acesso ao IPC consegue fazer no computador do paciente.
 */
export const TECLAS_NOMEADAS = {
  enter: [VK.RETURN],
  apagar: [VK.BACK],
  tab: [VK.TAB],
  esc: [VK.ESCAPE],
  espaco: [VK.SPACE],
  cima: [VK.UP],
  baixo: [VK.DOWN],
  esquerda: [VK.LEFT],
  direita: [VK.RIGHT],
  inicio: [VK.HOME],
  fim: [VK.END],
  pagina_cima: [VK.PRIOR],
  pagina_baixo: [VK.NEXT],
  delete: [VK.DELETE],
  windows: [VK.LWIN],
  'alt+tab': [VK.MENU, VK.TAB],
  'alt+f4': [VK.MENU, VK.F4],
  'ctrl+c': [VK.CONTROL, VK.C],
  'ctrl+v': [VK.CONTROL, VK.V],
  'ctrl+x': [VK.CONTROL, VK.X],
  'ctrl+z': [VK.CONTROL, VK.Z],
  'ctrl+a': [VK.CONTROL, VK.A],
  'ctrl+w': [VK.CONTROL, VK.W],
  'ctrl+t': [VK.CONTROL, VK.T],
  'win+d': [VK.LWIN, VK.D],
} as const;

export type TeclaNomeada = keyof typeof TECLAS_NOMEADAS;

export function ehTeclaNomeada(nome: unknown): nome is TeclaNomeada {
  return typeof nome === 'string' && Object.prototype.hasOwnProperty.call(TECLAS_NOMEADAS, nome);
}

/**
 * Pressiona a sequência (modificadores primeiro) e solta na ordem inversa —
 * soltar o Alt antes do Tab cancela o alternador de janelas.
 */
export function inputsDeTecla(nome: TeclaNomeada): InputWin[] {
  const vks = TECLAS_NOMEADAS[nome];
  const down = vks.map((vk) => tecla(vk, 0, ESTENDIDAS.has(vk) ? KEYEVENTF_EXTENDEDKEY : 0));
  const up = [...vks]
    .reverse()
    .map((vk) => tecla(vk, 0, KEYEVENTF_KEYUP | (ESTENDIDAS.has(vk) ? KEYEVENTF_EXTENDEDKEY : 0)));
  return [...down, ...up];
}

/** Teto por chamada: o teclado da sobreposição manda uma tecla por vez; um
 *  texto colado nunca passa disto. */
export const TEXTO_MAX_POR_ENVIO = 200;

/**
 * Digita texto arbitrário em qualquer programa, via `KEYEVENTF_UNICODE`.
 *
 * Cada unidade UTF-16 vira um par DOWN/UP com `wScan` = a unidade — é assim
 * que acentos, "ç" e emojis (pares substitutos) chegam inteiros, sem depender
 * do layout de teclado configurado no Windows. Quebra de linha vira Enter de
 * verdade, porque `\n` como Unicode não dispara o envio em campos de chat.
 */
export function inputsDeTexto(texto: string): InputWin[] {
  const out: InputWin[] = [];
  const limitado = texto.slice(0, TEXTO_MAX_POR_ENVIO);
  for (let i = 0; i < limitado.length; i++) {
    const unidade = limitado.charCodeAt(i);
    if (unidade === 0x0a) {
      out.push(...inputsDeTecla('enter'));
      continue;
    }
    if (unidade === 0x0d) continue;
    out.push(tecla(0, unidade, KEYEVENTF_UNICODE));
    out.push(tecla(0, unidade, KEYEVENTF_UNICODE | KEYEVENTF_KEYUP));
  }
  return out;
}
