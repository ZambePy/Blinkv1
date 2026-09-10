/**
 * Máquina de estados da sobreposição do Modo Computador.
 *
 * Modelo de interação (o mesmo do Tobii Dynavox Windows Control):
 *
 *   1. o paciente ARMA uma tarefa na barra lateral (clicar, duplo, direito,
 *      arrastar, rolar) com um dwell;
 *   2. olha para o alvo na tela; o dwell ali executa a tarefa — com a lupa
 *      ligada, primeiro amplia a região e o segundo dwell, dentro da lupa,
 *      é o que executa;
 *   3. a tarefa DESARMA depois de executar, salvo com "Fixar" ligado.
 *
 * Armar antes de olhar é o que impede o modo de clicar em tudo que o paciente
 * fixa enquanto lê a tela. "Pausar" congela só a área (a barra continua
 * respondendo, senão não haveria como despausar).
 *
 * Puro: recebe eventos já resolvidos (o componente faz o dwell e o DOM) e
 * devolve o estado novo mais uma lista de efeitos — ações para o processo
 * principal ou pedido de captura para a lupa.
 */

import type { Ponto, Retangulo } from '@tracker/computador/geometria';
import { lupaParaTela } from '@tracker/computador/geometria';
import type { AcaoDoSistema } from '@tracker/computador/protocolo';
import type { TeclaNomeada } from '@tracker/computador/entradaWindows';

export type Tarefa = 'clique' | 'duplo' | 'direito' | 'arrastar' | 'rolar';
export type IdDeBotao = Tarefa | 'teclado' | 'lupa' | 'fixar' | 'pausar' | 'emergencia' | 'voltar';

export type Fase =
  | { tipo: 'ocioso' }
  /** Lupa pedida ou aberta em volta de `centro`; `regiao` chega com a captura. */
  | { tipo: 'lupa'; centro: Ponto; regiao: Retangulo | null; imagem: string | null }
  | { tipo: 'arrastando'; origem: Ponto }
  | { tipo: 'rolando'; ancora: Ponto; ultimaRolagemT: number };

export interface EstadoDaMaquina {
  tarefa: Tarefa | null;
  fixar: boolean;
  lupa: boolean;
  pausado: boolean;
  teclado: boolean;
  maiuscula: boolean;
  fase: Fase;
}

export type EventoDaMaquina =
  | { tipo: 'botao'; id: IdDeBotao }
  | { tipo: 'area'; ponto: Ponto }
  | { tipo: 'lupaPronta'; regiao: Retangulo; imagem: string }
  | { tipo: 'lupaFalhou' }
  /** Dwell dentro do painel da lupa. `ponto` é relativo ao painel. */
  | { tipo: 'lupaAlvo'; pontoNoPainel: Ponto; painel: { width: number; height: number } }
  | { tipo: 'lupaCancelada' }
  | { tipo: 'tecla'; id: string }
  | { tipo: 'olhar'; ponto: Ponto; t: number };

export type Efeito =
  | { tipo: 'acao'; acao: AcaoDoSistema }
  | { tipo: 'pedirLupa'; ponto: Ponto };

export interface Passo {
  estado: EstadoDaMaquina;
  efeitos: Efeito[];
}

/** Raio da região que a lupa amplia, em px CSS. */
export const LUPA_RAIO_PX = 110;
/** Fator de ampliação do painel da lupa. */
export const LUPA_ZOOM = 2.5;
/** Distância do olhar à âncora que começa a rolar, e o passo por faixa. */
export const ROLAGEM_ZONA_MORTA_PX = 60;
export const ROLAGEM_FAIXA_PX = 120;
export const ROLAGEM_INTERVALO_MS = 160;

export const ESTADO_INICIAL: EstadoDaMaquina = {
  tarefa: null,
  fixar: false,
  lupa: true,
  pausado: false,
  teclado: false,
  maiuscula: false,
  fase: { tipo: 'ocioso' },
};

const OCIOSO: Fase = { tipo: 'ocioso' };

const acao = (a: AcaoDoSistema): Efeito => ({ tipo: 'acao', acao: a });

/** Executa a tarefa armada em `ponto` (coordenadas da sobreposição). */
function executar(estado: EstadoDaMaquina, ponto: Ponto): Passo {
  const depois = (e: EstadoDaMaquina): EstadoDaMaquina => ({
    ...e,
    fase: OCIOSO,
    tarefa: e.fixar ? e.tarefa : null,
  });
  switch (estado.tarefa) {
    case 'clique':
      return { estado: depois(estado), efeitos: [acao({ tipo: 'clique', botao: 'esquerdo', vezes: 1, ponto })] };
    case 'duplo':
      return { estado: depois(estado), efeitos: [acao({ tipo: 'clique', botao: 'esquerdo', vezes: 2, ponto })] };
    case 'direito':
      return { estado: depois(estado), efeitos: [acao({ tipo: 'clique', botao: 'direito', vezes: 1, ponto })] };
    case 'arrastar':
      if (estado.fase.tipo === 'arrastando') {
        return {
          estado: depois(estado),
          efeitos: [acao({ tipo: 'mover', ponto }), acao({ tipo: 'soltar', botao: 'esquerdo', ponto })],
        };
      }
      // Primeiro ponto: pressiona e espera o segundo. A tarefa continua armada
      // mesmo sem "fixar" — um arrasto tem dois pontos por definição.
      return {
        estado: { ...estado, fase: { tipo: 'arrastando', origem: ponto } },
        efeitos: [acao({ tipo: 'pressionar', botao: 'esquerdo', ponto })],
      };
    case 'rolar':
      return {
        estado: { ...estado, fase: { tipo: 'rolando', ancora: ponto, ultimaRolagemT: 0 } },
        efeitos: [acao({ tipo: 'mover', ponto })],
      };
    default:
      return { estado, efeitos: [] };
  }
}

/** A lupa se aplica às tarefas de ponto único. Arrasto e rolagem não. */
function usaLupa(estado: EstadoDaMaquina): boolean {
  return estado.lupa && (estado.tarefa === 'clique' || estado.tarefa === 'duplo' || estado.tarefa === 'direito');
}

function aoBotao(estado: EstadoDaMaquina, id: IdDeBotao): Passo {
  const efeitos: Efeito[] = [];
  // Qualquer botão encerra um arrasto/rolagem em curso, soltando o que
  // estava pressionado — nada pode ficar preso quando o paciente muda de ideia.
  let e: EstadoDaMaquina = estado;
  if (e.fase.tipo === 'arrastando') {
    efeitos.push(acao({ tipo: 'soltar', botao: 'esquerdo', ponto: e.fase.origem }));
  }
  e = { ...e, fase: OCIOSO };

  switch (id) {
    case 'clique':
    case 'duplo':
    case 'direito':
    case 'arrastar':
    case 'rolar':
      return { estado: { ...e, tarefa: e.tarefa === id ? null : id, pausado: false, teclado: false }, efeitos };
    case 'teclado':
      return { estado: { ...e, teclado: !e.teclado, tarefa: null }, efeitos };
    case 'lupa':
      return { estado: { ...e, lupa: !e.lupa }, efeitos };
    case 'fixar':
      return { estado: { ...e, fixar: !e.fixar }, efeitos };
    case 'pausar':
      return { estado: { ...e, pausado: !e.pausado }, efeitos };
    case 'emergencia':
      return { estado: e, efeitos: [...efeitos, acao({ tipo: 'sair', motivo: 'emergencia' })] };
    case 'voltar':
      return { estado: e, efeitos: [...efeitos, acao({ tipo: 'sair', motivo: 'voltar' })] };
  }
}

function aoArea(estado: EstadoDaMaquina, ponto: Ponto): Passo {
  if (estado.pausado || estado.teclado) return { estado, efeitos: [] };
  if (estado.fase.tipo === 'rolando') {
    // Um dwell durante a rolagem encerra a rolagem.
    return { estado: { ...estado, fase: OCIOSO, tarefa: estado.fixar ? estado.tarefa : null }, efeitos: [] };
  }
  if (estado.fase.tipo === 'lupa') return { estado, efeitos: [] };
  if (!estado.tarefa) return { estado, efeitos: [] };
  if (usaLupa(estado)) {
    return {
      estado: { ...estado, fase: { tipo: 'lupa', centro: ponto, regiao: null, imagem: null } },
      efeitos: [{ tipo: 'pedirLupa', ponto }],
    };
  }
  return executar(estado, ponto);
}

const TECLAS_ESPECIAIS: Record<string, TeclaNomeada> = {
  enter: 'enter', apagar: 'apagar', tab: 'tab', esc: 'esc', espaco: 'espaco',
  cima: 'cima', baixo: 'baixo', esquerda: 'esquerda', direita: 'direita',
  'ctrl+c': 'ctrl+c', 'ctrl+v': 'ctrl+v', 'ctrl+z': 'ctrl+z', 'ctrl+a': 'ctrl+a',
  'alt+tab': 'alt+tab', windows: 'windows',
};

function aoTecla(estado: EstadoDaMaquina, id: string): Passo {
  if (id === 'fechar') return { estado: { ...estado, teclado: false }, efeitos: [] };
  if (id === 'maiuscula') return { estado: { ...estado, maiuscula: !estado.maiuscula }, efeitos: [] };
  const especial = TECLAS_ESPECIAIS[id];
  if (especial) return { estado, efeitos: [acao({ tipo: 'tecla', nome: especial })] };
  if (!id.startsWith('c:')) return { estado, efeitos: [] };
  const ch = id.slice(2);
  if (!ch) return { estado, efeitos: [] };
  const texto = estado.maiuscula ? ch.toUpperCase() : ch;
  // Maiúscula vale para UMA letra, como o Shift de um teclado ocular.
  return { estado: { ...estado, maiuscula: false }, efeitos: [acao({ tipo: 'digitar', texto })] };
}

function aoOlhar(estado: EstadoDaMaquina, ponto: Ponto, t: number): Passo {
  if (estado.fase.tipo !== 'rolando') return { estado, efeitos: [] };
  const { ancora, ultimaRolagemT } = estado.fase;
  if (t - ultimaRolagemT < ROLAGEM_INTERVALO_MS) return { estado, efeitos: [] };
  const dy = ponto.y - ancora.y;
  if (Math.abs(dy) < ROLAGEM_ZONA_MORTA_PX) return { estado, efeitos: [] };
  const faixas = Math.min(3, Math.ceil((Math.abs(dy) - ROLAGEM_ZONA_MORTA_PX) / ROLAGEM_FAIXA_PX));
  // Olhar ABAIXO da âncora rola o conteúdo para baixo (passos negativos).
  const passos = dy > 0 ? -faixas : faixas;
  return {
    estado: { ...estado, fase: { tipo: 'rolando', ancora, ultimaRolagemT: t } },
    efeitos: [acao({ tipo: 'rolar', ponto: ancora, passos })],
  };
}

export function reduzir(estado: EstadoDaMaquina, evento: EventoDaMaquina): Passo {
  switch (evento.tipo) {
    case 'botao':
      return aoBotao(estado, evento.id);
    case 'area':
      return aoArea(estado, evento.ponto);
    case 'lupaPronta':
      if (estado.fase.tipo !== 'lupa') return { estado, efeitos: [] };
      return { estado: { ...estado, fase: { ...estado.fase, regiao: evento.regiao, imagem: evento.imagem } }, efeitos: [] };
    case 'lupaFalhou':
      // Sem captura, executa direto no centro pedido: melhor um clique sem
      // ampliação do que uma tarefa armada que nunca acontece.
      if (estado.fase.tipo !== 'lupa') return { estado, efeitos: [] };
      return executar({ ...estado, fase: OCIOSO }, estado.fase.centro);
    case 'lupaAlvo': {
      if (estado.fase.tipo !== 'lupa' || !estado.fase.regiao) return { estado, efeitos: [] };
      const alvo = lupaParaTela(evento.pontoNoPainel, evento.painel, estado.fase.regiao);
      return executar({ ...estado, fase: OCIOSO }, alvo);
    }
    case 'lupaCancelada':
      if (estado.fase.tipo !== 'lupa') return { estado, efeitos: [] };
      return { estado: { ...estado, fase: OCIOSO }, efeitos: [] };
    case 'tecla':
      return aoTecla(estado, evento.id);
    case 'olhar':
      return aoOlhar(estado, evento.ponto, evento.t);
  }
}

/** Texto curto de estado para o canto da sobreposição. */
export function descricaoDoEstado(e: EstadoDaMaquina): string {
  if (e.pausado) return 'Pausado — a área não responde ao olhar';
  if (e.teclado) return 'Teclado: olhe para uma tecla';
  switch (e.fase.tipo) {
    case 'lupa':
      return 'Lupa: olhe para o ponto exato';
    case 'arrastando':
      return 'Arrastando: olhe para onde soltar';
    case 'rolando':
      return 'Rolando: olhe acima ou abaixo do ponto; fixe para parar';
  }
  switch (e.tarefa) {
    case 'clique':
      return 'Clique armado: olhe para o alvo';
    case 'duplo':
      return 'Clique duplo armado: olhe para o alvo';
    case 'direito':
      return 'Botão direito armado: olhe para o alvo';
    case 'arrastar':
      return 'Arrastar: olhe para o ponto de origem';
    case 'rolar':
      return 'Rolar: olhe para a área a rolar';
    default:
      return 'Escolha uma ação na barra';
  }
}
