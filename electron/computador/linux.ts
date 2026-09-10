/**
 * Adaptador Linux: `xdotool` (X11).
 *
 * Em Wayland nenhum programa pode mover o cursor de outro sem passar por
 * `ydotool` (uinput, exige o usuário no grupo `input`) ou pelo portal
 * RemoteDesktop — os dois exigem configuração do sistema, então este
 * adaptador declara não suportado e explica, em vez de falhar em silêncio.
 *
 * Coordenadas físicas: no X11 sem escala fracionária, físico = lógico.
 */

import { execFile, spawnSync } from 'node:child_process';
import type { BotaoDoMouse, TeclaNomeada } from '../../src/computador/entradaWindows';
import { controleIndisponivel, type ControleDoSistema } from './controle';

const BOTAO_X11: Record<BotaoDoMouse, string> = { esquerdo: '1', meio: '2', direito: '3' };

const TECLA_X11: Record<TeclaNomeada, string> = {
  enter: 'Return', apagar: 'BackSpace', tab: 'Tab', esc: 'Escape', espaco: 'space',
  cima: 'Up', baixo: 'Down', esquerda: 'Left', direita: 'Right', inicio: 'Home', fim: 'End',
  pagina_cima: 'Prior', pagina_baixo: 'Next', delete: 'Delete', windows: 'super',
  'alt+tab': 'alt+Tab', 'alt+f4': 'alt+F4', 'ctrl+c': 'ctrl+c', 'ctrl+v': 'ctrl+v', 'ctrl+x': 'ctrl+x',
  'ctrl+z': 'ctrl+z', 'ctrl+a': 'ctrl+a', 'ctrl+w': 'ctrl+w', 'ctrl+t': 'ctrl+t', 'win+d': 'super+d',
};

function temXdotool(): boolean {
  const r = spawnSync('xdotool', ['version'], { stdio: 'ignore', timeout: 2000 });
  return r.status === 0;
}

export function criarControleLinux(): ControleDoSistema {
  if (process.env.XDG_SESSION_TYPE === 'wayland' && !process.env.DISPLAY) {
    return controleIndisponivel('linux', 'Sessão Wayland: o sistema não permite que um programa controle o cursor. Entre numa sessão X11 (Xorg) para usar o Modo Computador.');
  }
  if (!temXdotool()) {
    return controleIndisponivel('linux', 'O programa `xdotool` não está instalado. Instale com o gerenciador de pacotes (ex.: `sudo apt install xdotool`).');
  }

  const pressionados = new Set<BotaoDoMouse>();
  // Assíncrono e em fila: `xdotool type` de 200 caracteres leva segundos, e
  // bloquear o processo principal por isso congelaria a sobreposição.
  let fila: Promise<void> = Promise.resolve();
  const x = (...args: string[]) => {
    fila = fila.then(() => new Promise<void>((resolve) => {
      execFile('xdotool', args, { timeout: 15_000 }, (err) => {
        if (err) console.warn('[computador] xdotool falhou:', args.join(' '), err.message);
        resolve();
      });
    }));
  };

  return {
    capacidades: () => ({ suportado: true, plataforma: 'linux', mouse: true, teclado: true, lupa: true }),
    mover: (px, py) => x('mousemove', String(Math.round(px)), String(Math.round(py))),
    clicar: (botao, vezes) => x('click', '--repeat', String(vezes), '--delay', '80', BOTAO_X11[botao]),
    pressionar: (botao) => { pressionados.add(botao); x('mousedown', BOTAO_X11[botao]); },
    soltar: (botao) => { pressionados.delete(botao); x('mouseup', BOTAO_X11[botao]); },
    rolar: (passos) => {
      const botao = passos > 0 ? '4' : '5';
      x('click', '--repeat', String(Math.min(20, Math.abs(Math.trunc(passos)) || 1)), botao);
    },
    digitar: (texto) => x('type', '--delay', '20', '--', texto),
    tecla: (nome) => x('key', TECLA_X11[nome]),
    liberarTudo: () => { for (const b of pressionados) x('mouseup', BOTAO_X11[b]); pressionados.clear(); },
  };
}
