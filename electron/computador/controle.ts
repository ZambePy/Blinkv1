/**
 * Controle do mouse e do teclado do SISTEMA, a partir do processo principal.
 *
 * Uma interface, uma implementação por sistema operacional. O resto do Modo
 * Computador (sobreposição, mapeamento, dwell) não sabe em que SO está.
 *
 *   Windows  → `windows.ts`: user32 via FFI (`koffi`), sem compilar nada.
 *   Linux    → `linux.ts`: `xdotool` (X11). Em Wayland o SO não deixa um
 *              programa mover o cursor de outro; o adaptador diz isso.
 *   macOS    → `macos.ts`: ainda sem adaptador. Exige helper assinado com
 *              permissão de Acessibilidade — fica registrado o motivo.
 *
 * Coordenadas: pixels FÍSICOS da tela virtual. Quem converte é a sessão.
 */

import type { BotaoDoMouse, TeclaNomeada } from '../../src/computador/entradaWindows';
import type { CapacidadesDoSistema } from '../../src/computador/protocolo';

export interface ControleDoSistema {
  capacidades(): CapacidadesDoSistema;
  mover(xFisico: number, yFisico: number): void;
  clicar(botao: BotaoDoMouse, vezes: 1 | 2): void;
  pressionar(botao: BotaoDoMouse): void;
  soltar(botao: BotaoDoMouse): void;
  /** `passos` positivo = para cima. */
  rolar(passos: number): void;
  digitar(texto: string): void;
  tecla(nome: TeclaNomeada): void;
  /** Solta qualquer botão que tenha ficado pressionado (saída do modo). */
  liberarTudo(): void;
}

/** Adaptador que não faz nada e explica por quê. */
export function controleIndisponivel(plataforma: string, motivo: string): ControleDoSistema {
  const nada = () => {};
  return {
    capacidades: () => ({ suportado: false, plataforma, motivo, mouse: false, teclado: false, lupa: false }),
    mover: nada,
    clicar: nada,
    pressionar: nada,
    soltar: nada,
    rolar: nada,
    digitar: nada,
    tecla: nada,
    liberarTudo: nada,
  };
}

let instancia: ControleDoSistema | null = null;

/**
 * Escolhe o adaptador pela plataforma. Carregamento tardio: o `koffi` só é
 * exigido quando o paciente entra no modo, não na abertura do app — um
 * módulo nativo ausente não pode impedir a calibração de começar.
 */
export function controleDoSistema(): ControleDoSistema {
  if (instancia) return instancia;
  switch (process.platform) {
    case 'win32': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { criarControleWindows } = require('./windows') as typeof import('./windows');
      instancia = criarControleWindows();
      break;
    }
    case 'linux': {
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { criarControleLinux } = require('./linux') as typeof import('./linux');
      instancia = criarControleLinux();
      break;
    }
    case 'darwin':
      instancia = controleIndisponivel(
        'darwin',
        'No macOS o controle do computador pelo olhar ainda não está disponível: exige um componente assinado com permissão de Acessibilidade, previsto para uma versão futura.',
      );
      break;
    default:
      instancia = controleIndisponivel(process.platform, 'Sistema operacional não suportado pelo Modo Computador.');
  }
  return instancia;
}

/** Só para testes: descarta o adaptador em cache. */
export function _redefinirControle(): void {
  instancia = null;
}
