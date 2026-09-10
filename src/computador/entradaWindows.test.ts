import { describe, it, expect } from 'vitest';
import {
  inputsDeClique,
  inputDeBotao,
  inputDeRolagem,
  inputsDeTecla,
  inputsDeTexto,
  ehTeclaNomeada,
  INPUT_MOUSE,
  INPUT_KEYBOARD,
  MOUSEEVENTF_LEFTDOWN,
  MOUSEEVENTF_LEFTUP,
  MOUSEEVENTF_RIGHTDOWN,
  MOUSEEVENTF_WHEEL,
  KEYEVENTF_KEYUP,
  KEYEVENTF_UNICODE,
  KEYEVENTF_EXTENDEDKEY,
  VK,
  WHEEL_DELTA,
  TEXTO_MAX_POR_ENVIO,
} from './entradaWindows';

const flagsDoMouse = (i: { type: number; u: { mi?: { dwFlags: number } } }) => i.u.mi!.dwFlags;

describe('cliques', () => {
  it('clique simples é DOWN seguido de UP', () => {
    const c = inputsDeClique('esquerdo');
    expect(c.map(flagsDoMouse)).toEqual([MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP]);
    expect(c.every((i) => i.type === INPUT_MOUSE)).toBe(true);
  });

  it('clique duplo repete o par — dois eventos no mesmo lote é o que o Windows lê como duplo', () => {
    expect(inputsDeClique('esquerdo', 2).map(flagsDoMouse)).toEqual([
      MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP, MOUSEEVENTF_LEFTDOWN, MOUSEEVENTF_LEFTUP,
    ]);
  });

  it('botão direito usa as flags certas', () => {
    expect(flagsDoMouse(inputsDeClique('direito')[0])).toBe(MOUSEEVENTF_RIGHTDOWN);
    expect(flagsDoMouse(inputDeBotao('direito', 'pressionar'))).toBe(MOUSEEVENTF_RIGHTDOWN);
  });
});

describe('rolagem', () => {
  it('um passo para cima é +WHEEL_DELTA', () => {
    const r = inputDeRolagem(1);
    expect(flagsDoMouse(r)).toBe(MOUSEEVENTF_WHEEL);
    expect(r.u.mi!.mouseData).toBe(WHEEL_DELTA);
  });
  it('para baixo vai como DWORD em complemento de dois', () => {
    expect(inputDeRolagem(-2).u.mi!.mouseData).toBe((-2 * WHEEL_DELTA) >>> 0);
  });
});

describe('teclas nomeadas', () => {
  it('combinação pressiona modificador primeiro e solta por último', () => {
    const seq = inputsDeTecla('alt+tab').map((i) => i.u.ki!);
    expect(seq.map((k) => k.wVk)).toEqual([VK.MENU, VK.TAB, VK.TAB, VK.MENU]);
    expect(seq[0].dwFlags & KEYEVENTF_KEYUP).toBe(0);
    expect(seq[3].dwFlags & KEYEVENTF_KEYUP).toBe(KEYEVENTF_KEYUP);
  });

  it('setas levam o bit de tecla estendida', () => {
    const [down] = inputsDeTecla('baixo');
    expect(down.u.ki!.dwFlags & KEYEVENTF_EXTENDEDKEY).toBe(KEYEVENTF_EXTENDEDKEY);
    const [enter] = inputsDeTecla('enter');
    expect(enter.u.ki!.dwFlags & KEYEVENTF_EXTENDEDKEY).toBe(0);
  });

  it('só aceita nomes da lista fechada', () => {
    expect(ehTeclaNomeada('ctrl+v')).toBe(true);
    expect(ehTeclaNomeada('ctrl+alt+del')).toBe(false);
    expect(ehTeclaNomeada('__proto__')).toBe(false);
  });
});

describe('texto', () => {
  it('cada caractere vira DOWN/UP Unicode com o código UTF-16', () => {
    const seq = inputsDeTexto('ção');
    expect(seq).toHaveLength(6);
    expect(seq.every((i) => i.type === INPUT_KEYBOARD)).toBe(true);
    expect(seq[0].u.ki!.wScan).toBe('ç'.charCodeAt(0));
    expect(seq[0].u.ki!.dwFlags).toBe(KEYEVENTF_UNICODE);
    expect(seq[1].u.ki!.dwFlags).toBe(KEYEVENTF_UNICODE | KEYEVENTF_KEYUP);
  });

  it('emoji (par substituto) sai como duas unidades', () => {
    expect(inputsDeTexto('😀')).toHaveLength(4);
  });

  it('quebra de linha vira Enter de verdade', () => {
    const seq = inputsDeTexto('a\n');
    expect(seq[2].u.ki!.wVk).toBe(VK.RETURN);
    expect(seq).toHaveLength(4);
  });

  it('limita o tamanho por envio', () => {
    expect(inputsDeTexto('x'.repeat(TEXTO_MAX_POR_ENVIO + 50))).toHaveLength(TEXTO_MAX_POR_ENVIO * 2);
  });
});
