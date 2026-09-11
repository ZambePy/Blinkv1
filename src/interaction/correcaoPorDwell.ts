/**
 * Correção contínua do olhar a partir dos dwells concluídos (sprint S3).
 *
 * ## A ideia
 *
 * Quando o dwell dispara num botão, o centro daquele botão é uma estimativa
 * razoável de onde o olhar estava. A diferença entre esse centro e a posição do
 * cursor no instante do disparo é o desvio corrente do sistema. Guardando o
 * desvio como um deslocamento aditivo e atualizando devagar,
 *
 *     offset ← offset + k · (centro − olhar)
 *
 * o sistema persegue a deriva sozinho, o dia inteiro, sem pedir nada a ninguém.
 * É de graça: o rótulo já existe, só ninguém estava usando.
 *
 * ## Por que aqui e não numa recalibração
 *
 * A medição de deriva do projeto registrou o viés vertical INVERTENDO 190 px
 * entre duas rodadas separadas por dez minutos, com a pessoa saindo da cadeira,
 * e diagnosticou o formato certo: a acurácia piorou enquanto a precisão
 * melhorou, que é assinatura de deslocamento puro. Deslocamento puro é
 * exatamente o que uma correção aditiva remove — e recalibrar custa dois
 * minutos de alguém que se comunica pelo olhar.
 *
 * ## As guardas, que são o que separa isto de um estrago
 *
 * A literatura assume que todo dwell concluído acertou o alvo pretendido. Com
 * botão grande e isolado isso é quase sempre verdade; num teclado ocular, não —
 * e aprender de uma tecla errada ensina o erro. Por isso quem chama decide a
 * elegibilidade (`deveAprender`), e o módulo ainda assim se protege:
 *
 *   1. **Salto grande não é deriva**, é o dwell tendo acertado outra coisa.
 *   2. **Resfriamento** depois de cada seleção: o pós-sacada não é amostra.
 *   3. **Teto de norma**: acima dele não é deriva, é calibração quebrada, e a
 *      resposta certa é recalibrar — não escorregar a tela inteira.
 *   4. **Decaimento**: sem seleção nova, o deslocamento volta devagar para
 *      zero. Evidência velha não governa o cursor de hoje.
 *   5. **Reinício** ao recalibrar, ao trocar de perfil e ao mudar o viewport.
 *      O deslocamento pertence à sessão, não à pessoa.
 *
 * Tudo em espaço NORMALIZADO (0..1), como o resto do `mapGaze` antes da
 * conversão final: assim o deslocamento sobrevive a uma mudança de tamanho de
 * janela sem virar outro número.
 */

import { EXPERIMENT } from '../config/experiment';

export interface Ponto {
  x: number;
  y: number;
}

/**
 * Fração do resíduo incorporada a cada seleção.
 *
 * 0,05 é o valor do estudo com 43 participantes que mediu 3,15° → 0,91°. Baixo
 * de propósito: cada seleção é uma evidência fraca (o centro do botão não é
 * exatamente onde a pessoa olhava), e vinte delas é que fazem uma correção.
 */
export const K = 0.05;

/** Resíduo acima disto não é deriva — é o dwell tendo acertado outro alvo. */
export const SALTO_MAX_PX = 180;

/** Depois de uma seleção, o olhar já está indo embora. */
export const RESFRIAMENTO_MS = 300;

/**
 * Teto da norma do deslocamento, em unidades normalizadas.
 *
 * 0,08 são ~154 px numa tela de 1920 e ~86 px numa de 1080 de altura — pouco
 * mais que o dobro do erro médio medido em M1 (74 px). Acima disso não é
 * deriva: é calibração quebrada, mudança de posição grande ou aprendizado de
 * alvo errado, e nenhum dos três se conserta deslizando a tela.
 */
export const TETO_NORMALIZADO = 0.08;

/**
 * Meia-vida do decaimento, em ms.
 *
 * Dez minutos: com seleções a cada poucos segundos o deslocamento se mantém sem
 * esforço, e uma pausa longa o dissolve. É a resposta honesta a "faz meia hora
 * que ninguém usa; este deslocamento ainda vale?" — provavelmente não.
 */
export const MEIA_VIDA_MS = 10 * 60_000;

export interface EstadoDaCorrecao {
  offset: Ponto;
  /** Instante da última seleção aceita. */
  ultimaSelecaoMs: number | null;
  /** Instante do último decaimento aplicado. */
  ultimoDecaimentoMs: number | null;
  /** Seleções incorporadas desde o último reinício. Só diagnóstico. */
  selecoes: number;
  /** Seleções recusadas por salto grande. Sinal de dwell acertando errado. */
  recusasPorSalto: number;
}

export function criarEstado(): EstadoDaCorrecao {
  return {
    offset: { x: 0, y: 0 },
    ultimaSelecaoMs: null,
    ultimoDecaimentoMs: null,
    selecoes: 0,
    recusasPorSalto: 0,
  };
}

/** Condições de sistema sob as quais um dwell concluído vale como rótulo. */
export interface ContextoDaSelecao {
  /** O alvo é grande e sem vizinho acionável (`data-isolado`). */
  alvoIsolado: boolean;
  /** O rastreamento está degradado: a posição não vale como rótulo. */
  degradado: boolean;
  /** Modo apresentação: nada do que acontece na tela é uso real. */
  apresentacao: boolean;
  /** Há uma emergência em curso: o pior momento possível para experimentar. */
  emergencia: boolean;
  /** A seleção veio de um alvo de emergência ou de recuperação. */
  alvoEspecial: boolean;
  /**
   * A predição deste quadro estava SATURADA — o `softClamp` a comprimiu contra
   * a borda.
   *
   * Sem esta guarda existe realimentação positiva: com o alvo perto da borda, o
   * clamp aproxima o cursor da borda, o resíduo contra o centro do botão sai
   * inflado, o deslocamento cresce, e o cursor satura mais ainda — até o teto.
   * Um quadro saturado não diz onde a pessoa olhava; diz onde o clamp a pôs.
   */
  saturado?: boolean;
}

/**
 * A seleção pode virar rótulo?
 *
 * Pura e separada de propósito: é a regra que decide quando o sistema aprende
 * sozinho, e ela merece ser lida e testada sem um DOM em volta.
 */
export function deveAprender(ctx: ContextoDaSelecao): boolean {
  if (!ctx.alvoIsolado) return false;
  if (ctx.degradado) return false;
  if (ctx.apresentacao) return false;
  if (ctx.emergencia) return false;
  if (ctx.alvoEspecial) return false;
  if (ctx.saturado) return false;
  return true;
}

function norma(p: Ponto): number {
  return Math.hypot(p.x, p.y);
}

export interface ResultadoDaSelecao {
  estado: EstadoDaCorrecao;
  aceita: boolean;
  motivo: 'aceita' | 'resfriamento' | 'salto' | 'invalida';
}

/**
 * Incorpora uma seleção concluída.
 *
 * `centroDoAlvo` e `olhar` chegam em PIXELS (é o que o DOM tem); `viewport` é o
 * que converte para o espaço normalizado em que o deslocamento vive.
 */
export function registrarSelecao(
  estado: EstadoDaCorrecao,
  entrada: {
    centroDoAlvo: Ponto;
    olhar: Ponto;
    agoraMs: number;
    viewport: { largura: number; altura: number };
  },
): ResultadoDaSelecao {
  const { centroDoAlvo, olhar, agoraMs, viewport } = entrada;

  const finito = (p: Ponto) => Number.isFinite(p.x) && Number.isFinite(p.y);
  if (!finito(centroDoAlvo) || !finito(olhar) || !Number.isFinite(agoraMs)) {
    return { estado, aceita: false, motivo: 'invalida' };
  }
  if (!(viewport.largura > 0) || !(viewport.altura > 0)) {
    return { estado, aceita: false, motivo: 'invalida' };
  }

  if (estado.ultimaSelecaoMs !== null && agoraMs - estado.ultimaSelecaoMs < RESFRIAMENTO_MS) {
    return { estado, aceita: false, motivo: 'resfriamento' };
  }

  const residuoPx = { x: centroDoAlvo.x - olhar.x, y: centroDoAlvo.y - olhar.y };
  if (norma(residuoPx) > SALTO_MAX_PX) {
    return {
      estado: { ...estado, recusasPorSalto: estado.recusasPorSalto + 1 },
      aceita: false,
      motivo: 'salto',
    };
  }

  const residuo = {
    x: residuoPx.x / viewport.largura,
    y: residuoPx.y / viewport.altura,
  };

  let offset = {
    x: estado.offset.x + K * residuo.x,
    y: estado.offset.y + K * residuo.y,
  };

  // Teto pela NORMA, não por eixo: limitar cada eixo em separado deformaria a
  // direção da correção, corrigindo mais em X do que em Y por acidente.
  const n = norma(offset);
  if (n > TETO_NORMALIZADO) {
    const escala = TETO_NORMALIZADO / n;
    offset = { x: offset.x * escala, y: offset.y * escala };
  }

  return {
    estado: {
      ...estado,
      offset,
      ultimaSelecaoMs: agoraMs,
      ultimoDecaimentoMs: agoraMs,
      selecoes: estado.selecoes + 1,
    },
    aceita: true,
    motivo: 'aceita',
  };
}

/**
 * Aplica o decaimento e devolve o deslocamento corrente.
 *
 * Separado de `aplicar` porque o decaimento depende do tempo e a aplicação
 * acontece a 30 Hz: chamar isto uma vez por quadro é o que faz a meia-vida ser
 * de verdade.
 */
export function decair(estado: EstadoDaCorrecao, agoraMs: number): EstadoDaCorrecao {
  if (!Number.isFinite(agoraMs)) return estado;
  if (estado.ultimoDecaimentoMs === null) {
    return { ...estado, ultimoDecaimentoMs: agoraMs };
  }
  const dt = agoraMs - estado.ultimoDecaimentoMs;
  if (dt <= 0) return estado;
  const fator = Math.pow(0.5, dt / MEIA_VIDA_MS);
  return {
    ...estado,
    offset: { x: estado.offset.x * fator, y: estado.offset.y * fator },
    ultimoDecaimentoMs: agoraMs,
  };
}

/** Soma o deslocamento a um ponto normalizado. */
export function aplicar(estado: EstadoDaCorrecao, p: Ponto): Ponto {
  return { x: p.x + estado.offset.x, y: p.y + estado.offset.y };
}

// ── Instância do app ────────────────────────────────────────────────────────
//
// O módulo é puro acima desta linha; abaixo vive a única instância que o
// `mapGaze` consulta. Mantida aqui, e não num contexto do React, porque
// `mapGaze` roda fora da árvore de componentes.

let estadoGlobal = criarEstado();
/** Espelha `EXPERIMENT.correcaoPorDwell`, lido uma vez no import. A medição
 *  troca a flag pela URL e recarrega — não em tempo de execução. */
let ligado = EXPERIMENT.correcaoPorDwell;

export function reiniciarCorrecao(): void {
  estadoGlobal = criarEstado();
}

export function definirCorrecaoLigada(v: boolean): void {
  ligado = v;
  if (!v) estadoGlobal = criarEstado();
}

export function correcaoLigada(): boolean {
  return ligado;
}

/** Estado corrente, para diagnóstico e testes. Cópia rasa: não mute. */
export function estadoDaCorrecao(): Readonly<EstadoDaCorrecao> {
  return estadoGlobal;
}

/**
 * Quanto do teto o deslocamento já consumiu, de 0 a 1.
 *
 * É o termômetro da deriva (macete B2): enquanto a correção dá conta, ninguém
 * precisa recalibrar; quando ela encosta no teto, o que mudou não é deriva —
 * é a cadeira, a luz ou a distância. `null` com a correção desligada ou sem
 * nenhuma seleção aprendida, porque aí o número não significa nada.
 */
export function fracaoDoTetoDaCorrecao(): number | null {
  if (!ligado) return null;
  if (estadoGlobal.selecoes === 0) return null;
  return Math.min(1, norma(estadoGlobal.offset) / TETO_NORMALIZADO);
}

/** Chamado pelo dispatcher quando um dwell elegível conclui. */
export function aprenderComSelecao(entrada: {
  centroDoAlvo: Ponto;
  olhar: Ponto;
  agoraMs: number;
  viewport: { largura: number; altura: number };
}): boolean {
  if (!ligado) return false;
  const r = registrarSelecao(estadoGlobal, entrada);
  estadoGlobal = r.estado;
  return r.aceita;
}

/**
 * Aplica a correção a um ponto normalizado, decaindo primeiro.
 *
 * Chamado uma vez por quadro no `mapGaze`, depois das compensações de
 * distância e pose e ANTES do `softClamp` — o clamp é quem garante que o
 * resultado final caiba na tela, e corrigir depois dele poderia empurrar o
 * ponto para fora de novo.
 */
export function corrigirPorDwell(p: Ponto, agoraMs: number): Ponto {
  if (!ligado) return p;
  estadoGlobal = decair(estadoGlobal, agoraMs);
  return aplicar(estadoGlobal, p);
}
