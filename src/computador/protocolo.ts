/**
 * Contrato do Modo Computador entre os três lados: a janela do app (que tem a
 * câmera e o olhar), o processo principal do Electron (que move o mouse do
 * sistema) e a janela de sobreposição (que desenha o cursor e a barra sobre
 * o Windows).
 *
 * É a lista fechada do que a sobreposição pode pedir ao sistema. Ampliar
 * exige ampliar aqui — e justificar, porque cada item é algo que o app passa
 * a poder fazer no computador do paciente.
 */

import type { Ponto, Retangulo } from './geometria';
import type { TeclaNomeada, BotaoDoMouse } from './entradaWindows';

/** Uma amostra de olhar, no sistema de coordenadas de quem a recebe. */
export interface AmostraDeOlhar {
  x: number;
  y: number;
  /** `performance.now()` de quem emitiu; só serve para intervalos. */
  t: number;
  hasFace: boolean;
  eyeState: 'open' | 'closed' | 'unknown';
  degraded: boolean;
  uncalibrated: boolean;
}

export interface ConfiguracaoDoModo {
  /** Tempo de permanência até acionar, em ms (o mesmo do app). */
  dwellMs: number;
  /** Diâmetro do cursor sobre o sistema, já reduzido. */
  tamanhoCursorPx: number;
  /** Lupa em duas etapas ligada por padrão. */
  lupa: boolean;
  /** Tamanho da sobreposição, em px CSS (= DIP do monitor). */
  monitor: { width: number; height: number };
  /** Só informativo, para a barra dizer em que sistema está. */
  plataforma: 'win32' | 'darwin' | 'linux' | string;
}

export type MotivoDeSaida =
  | 'voltar'
  | 'emergencia'
  | 'inatividade'
  | 'tela_mudou'
  | 'janela_fechada'
  /** O olhar parou de chegar ao processo principal (motor travou, câmera caiu). */
  | 'rastreamento_parou'
  /** Amostras sem calibração por tempo demais: nada é clicável, nem a barra. */
  | 'sem_calibracao'
  /** Atalho de teclado do cuidador (Ctrl+Alt+Shift+Esc). */
  | 'atalho'
  | 'erro';

/** O que a sobreposição pede ao processo principal. Coordenadas em px CSS da sobreposição. */
export type AcaoDoSistema =
  | { tipo: 'clique'; botao: BotaoDoMouse; vezes: 1 | 2; ponto: Ponto }
  | { tipo: 'pressionar'; botao: BotaoDoMouse; ponto: Ponto }
  | { tipo: 'soltar'; botao: BotaoDoMouse; ponto: Ponto }
  | { tipo: 'mover'; ponto: Ponto }
  | { tipo: 'rolar'; ponto: Ponto; passos: number }
  | { tipo: 'digitar'; texto: string }
  | { tipo: 'tecla'; nome: TeclaNomeada }
  | { tipo: 'lupa'; ponto: Ponto; raioPx: number }
  /** A sobreposição montou e quer a configuração (além do push do main). */
  | { tipo: 'pronto' }
  /**
   * O mouse FÍSICO entrou/saiu da barra. Com `ligado`, a sobreposição deixa
   * de ser atravessável naquele momento, para um cuidador poder clicar em
   * "IrisFlow"/"Socorro" com o mouse de verdade.
   */
  | { tipo: 'capturarMouse'; ligado: boolean }
  | { tipo: 'sair'; motivo: MotivoDeSaida };

export type RespostaDaAcao =
  | { ok: true }
  | { ok: true; lupa: { imagem: string; regiao: Retangulo } }
  | { ok: true; config: ConfiguracaoDoModo }
  | { ok: false; erro: string };

export interface CapacidadesDoSistema {
  suportado: boolean;
  plataforma: string;
  /** Por que não é suportado, em linguagem para o cuidador. */
  motivo?: string;
  /** Quais grupos funcionam neste sistema. */
  mouse: boolean;
  teclado: boolean;
  lupa: boolean;
}

/** Canais de IPC. Um lugar só, para preload, main e telas não divergirem. */
export const CANAIS = {
  capacidades: 'irisflow:desktop-capabilities',
  iniciar: 'irisflow:desktop-start',
  parar: 'irisflow:desktop-stop',
  olhar: 'irisflow:desktop-gaze',
  parou: 'irisflow:desktop-stopped',
  sobreposicaoOlhar: 'irisflow:overlay-gaze',
  sobreposicaoConfig: 'irisflow:overlay-config',
  sobreposicaoAcao: 'irisflow:overlay-action',
} as const;

const NUMERO = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const PONTO = (v: unknown): v is Ponto =>
  !!v && typeof v === 'object' && NUMERO((v as Ponto).x) && NUMERO((v as Ponto).y);

/**
 * Valida uma amostra vinda do renderer. O IPC é a fronteira de confiança do
 * processo principal: nada passa sem checagem de forma.
 */
export function amostraValida(v: unknown): v is AmostraDeOlhar {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  return (
    NUMERO(a.x) && NUMERO(a.y) && NUMERO(a.t) &&
    typeof a.hasFace === 'boolean' &&
    (a.eyeState === 'open' || a.eyeState === 'closed' || a.eyeState === 'unknown') &&
    typeof a.degraded === 'boolean' && typeof a.uncalibrated === 'boolean'
  );
}

const BOTOES: ReadonlySet<string> = new Set(['esquerdo', 'direito', 'meio']);
const MOTIVOS: ReadonlySet<string> = new Set(['voltar', 'emergencia', 'inatividade', 'tela_mudou', 'janela_fechada', 'rastreamento_parou', 'sem_calibracao', 'atalho', 'erro']);

/** Valida a forma de uma ação. Teclas nomeadas são checadas pelo executor. */
export function acaoValida(v: unknown): v is AcaoDoSistema {
  if (!v || typeof v !== 'object') return false;
  const a = v as Record<string, unknown>;
  switch (a.tipo) {
    case 'clique':
      return BOTOES.has(String(a.botao)) && (a.vezes === 1 || a.vezes === 2) && PONTO(a.ponto);
    case 'pressionar':
    case 'soltar':
      return BOTOES.has(String(a.botao)) && PONTO(a.ponto);
    case 'mover':
      return PONTO(a.ponto);
    case 'rolar':
      return PONTO(a.ponto) && NUMERO(a.passos) && Math.abs(a.passos) <= 20;
    case 'digitar':
      return typeof a.texto === 'string' && a.texto.length > 0 && a.texto.length <= 200;
    case 'tecla':
      return typeof a.nome === 'string';
    case 'lupa':
      return PONTO(a.ponto) && NUMERO(a.raioPx) && a.raioPx >= 40 && a.raioPx <= 600;
    case 'pronto':
      return true;
    case 'capturarMouse':
      return typeof a.ligado === 'boolean';
    case 'sair':
      return MOTIVOS.has(String(a.motivo));
    default:
      return false;
  }
}
