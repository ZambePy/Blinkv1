/**
 * Adaptador Windows: user32 via `koffi` (FFI puro, Node-API, sem recompilar
 * para cada versão do Electron).
 *
 * Duas chamadas fazem tudo:
 *   `SetCursorPos(x, y)` — move o cursor em pixels físicos da tela virtual.
 *   `SendInput(n, INPUT[], cbSize)` — cliques, roda e teclas, na posição
 *     atual do cursor. É a mesma via que um mouse/teclado USB usa, então
 *     funciona em qualquer programa que aceite entrada normal.
 *
 * Limitação conhecida (UIPI): um processo comum não injeta entrada em janelas
 * ELEVADAS (prompt do UAC, Gerenciador de Tarefas aberto como administrador).
 * Nesses casos o clique é ignorado em silêncio. Rodar o IrisFlow elevado
 * resolve, mas não é o padrão — está documentado no README.
 *
 * O layout das structs está em `src/computador/entradaWindows.ts` (testado:
 * `INPUT` tem 40 bytes em x64 com `dx/dy` como int32 — `long` do koffi segue
 * o C do sistema, e no Linux tem 8 bytes, o que quebraria o teste).
 */

import {
  inputsDeClique,
  inputDeBotao,
  inputDeRolagem,
  inputsDeTecla,
  inputsDeTexto,
  type BotaoDoMouse,
  type TeclaNomeada,
  type InputWin,
} from '../../src/computador/entradaWindows';
import type { CapacidadesDoSistema } from '../../src/computador/protocolo';
import { controleIndisponivel, type ControleDoSistema } from './controle';

interface Nativo {
  SetCursorPos: (x: number, y: number) => number;
  SendInput: (n: number, inputs: InputWin[], cb: number) => number;
  tamanhoInput: number;
}

function carregarNativo(): Nativo {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const koffi = require('koffi') as typeof import('koffi');
  const MOUSEINPUT = koffi.struct('IRIS_MOUSEINPUT', {
    dx: 'int32', dy: 'int32', mouseData: 'uint32', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t',
  });
  const KEYBDINPUT = koffi.struct('IRIS_KEYBDINPUT', {
    wVk: 'uint16', wScan: 'uint16', dwFlags: 'uint32', time: 'uint32', dwExtraInfo: 'uintptr_t',
  });
  const HARDWAREINPUT = koffi.struct('IRIS_HARDWAREINPUT', { uMsg: 'uint32', wParamL: 'uint16', wParamH: 'uint16' });
  const UNIAO = koffi.union('IRIS_INPUT_U', { mi: MOUSEINPUT, ki: KEYBDINPUT, hi: HARDWAREINPUT });
  const INPUT = koffi.struct('IRIS_INPUT', { type: 'uint32', u: UNIAO });

  const user32 = koffi.load('user32.dll');
  // BOOL do Win32 é um int de 32 bits, não um `bool` de 1 byte.
  const SetCursorPos = user32.func('SetCursorPos', 'int', ['int', 'int']) as unknown as Nativo['SetCursorPos'];
  const SendInput = user32.func('SendInput', 'uint32', ['uint32', koffi.pointer(INPUT), 'int']) as Nativo['SendInput'];
  return { SetCursorPos, SendInput, tamanhoInput: koffi.sizeof(INPUT) };
}

export function criarControleWindows(): ControleDoSistema {
  let nativo: Nativo;
  try {
    nativo = carregarNativo();
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn('[computador] koffi/user32 indisponível:', msg);
    return controleIndisponivel(
      'win32',
      'O componente de controle do Windows não carregou. Reinstale o IrisFlow ou rode `npm install` na pasta do projeto (dependência `koffi`).',
    );
  }

  const pressionados = new Set<BotaoDoMouse>();

  // Lotes pequenos: `SendInput` é atômico por chamada, e um texto de 200
  // caracteres vira 400 INPUTs — cabe numa chamada só, mas quebrar em 64
  // evita que um erro no meio deixe um modificador preso.
  const enviar = (inputs: InputWin[]) => {
    for (let i = 0; i < inputs.length; i += 64) {
      const lote = inputs.slice(i, i + 64);
      const ok = nativo.SendInput(lote.length, lote, nativo.tamanhoInput);
      if (ok !== lote.length) console.warn(`[computador] SendInput aceitou ${ok}/${lote.length} eventos`);
    }
  };

  const capacidades = (): CapacidadesDoSistema => ({
    suportado: true, plataforma: 'win32', mouse: true, teclado: true, lupa: true,
  });

  return {
    capacidades,
    mover: (x, y) => {
      if (!nativo.SetCursorPos(Math.round(x), Math.round(y))) {
        console.warn(`[computador] SetCursorPos(${x}, ${y}) falhou`);
      }
    },
    clicar: (botao, vezes) => enviar(inputsDeClique(botao, vezes)),
    pressionar: (botao) => {
      pressionados.add(botao);
      enviar([inputDeBotao(botao, 'pressionar')]);
    },
    soltar: (botao) => {
      pressionados.delete(botao);
      enviar([inputDeBotao(botao, 'soltar')]);
    },
    rolar: (passos) => enviar([inputDeRolagem(passos)]),
    digitar: (texto) => enviar(inputsDeTexto(texto)),
    tecla: (nome: TeclaNomeada) => enviar(inputsDeTecla(nome)),
    liberarTudo: () => {
      for (const b of pressionados) enviar([inputDeBotao(b, 'soltar')]);
      pressionados.clear();
    },
  };
}
