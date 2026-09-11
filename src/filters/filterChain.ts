// Cadeia de filtragem selecionável por flag de lista fechada, com o
// comportamento atual (`'oneEuro'`) como default.
//
//   'oneEuro'    passa-baixa com corte adaptativo. O DEFAULT e o baseline.
//   'kalman'     Kalman posição+velocidade com predição. Tem MODELO do
//                movimento, então pode antecipar em vez de sempre atrasar.
//   'kalmanEma'  Kalman seguido de EMA adaptativo com zona morta. O Kalman
//                antecipa; o EMA remove o ruído que a predição amplifica em
//                fixação.
//
// A ordem em `kalmanEma` não é arbitrária: o Kalman precisa da medição CRUA
// para estimar velocidade. Alimentá-lo com um sinal já suavizado faria a
// velocidade estimada ser a do filtro, não a do olho.

import { OneEuroFilter2D } from '../oneEuroFilter';
import { Kalman2D, type Kalman2DOptions } from './kalman2d';
import { AdaptiveEma, type AdaptiveEmaOptions } from './adaptiveEma';
import type { GeometriaDeTela } from './angularVelocity';
import { EstabilizadorDeFixacao, type EstadoDoOlho } from './estabilizadorDeFixacao';

export type FilterMode = 'oneEuro' | 'kalman' | 'kalmanEma';

export interface SaidaDoFiltro {
  x: number;
  y: number;
  /** α do EMA no quadro, quando a cadeia o inclui. `null` nas demais. */
  alpha: number | null;
  /** Velocidade angular estimada em °/s, quando disponível. */
  velocidadeDegPorSeg: number | null;
  /** O quadro caiu na zona morta do EMA. */
  naZonaMorta: boolean;
  /** Estado do olho decidido pelo estabilizador (sprint S5). `null` quando o
   *  estágio está desligado ou sem geometria. */
  estadoDoOlho: EstadoDoOlho | null;
  /** Quantas amostras entraram na média da fixação. 1 = nenhuma média. */
  amostrasNaMedia: number;
}

export interface FilterChainOptions {
  mode: FilterMode;
  /** Necessária para `kalmanEma` — o EMA adaptativo e a zona morta trabalham em
   *  graus. Sem ela, a cadeia degrada para `kalman` puro e diz por quê. */
  geometria?: GeometriaDeTela | null;
  kalman?: Kalman2DOptions;
  ema?: Omit<AdaptiveEmaOptions, 'geometria'>;
  /** Parâmetros do One Euro, quando o modo é `'oneEuro'`. */
  oneEuro?: { freq?: number; mincutoff?: number; beta?: number };
  /**
   * Estabilizador por estado do olho (sprint S5), aplicado DEPOIS do filtro
   * escolhido: durante a fixação a saída vira a média da janela, e na sacada
   * volta a ser a amostra filtrada.
   *
   * Precisa de `geometria` — o critério é em graus. Sem ela o estágio se
   * declara inativo e a cadeia se comporta como antes.
   */
  estabilizarFixacao?: boolean;
}

/**
 * Cadeia de filtragem com o modo escolhido na construção.
 *
 * O modo NÃO muda em tempo de execução: trocar de filtro no meio da sessão
 * descartaria o estado interno (velocidade estimada, média corrente) e
 * produziria um salto visível. Quem quiser comparar constrói duas cadeias.
 */
export class FilterChain {
  private readonly mode: FilterMode;
  private readonly oneEuro: OneEuroFilter2D | null = null;
  private readonly kalman: Kalman2D | null = null;
  private readonly ema: AdaptiveEma | null = null;
  private readonly estabilizador: EstabilizadorDeFixacao | null = null;
  private readonly degradou: boolean;

  constructor(opts: FilterChainOptions) {
    this.mode = opts.mode;
    // Vive fora do `if` por modo: o estabilizador é ortogonal ao filtro
    // escolhido — ele compõe com os três.
    if (opts.estabilizarFixacao) {
      const est = new EstabilizadorDeFixacao(opts.geometria ?? null);
      if (est.ativo) {
        this.estabilizador = est;
      } else {
        console.warn(
          '[filterChain] estabilizarFixacao pedido SEM geometria de tela. ' +
          'O critério de fixação é em graus e não tem como converter. ' +
          'Seguindo sem o estágio.',
        );
      }
    }

    if (opts.mode === 'oneEuro') {
      const o = opts.oneEuro ?? {};
      this.oneEuro = new OneEuroFilter2D(o.freq ?? 30, o.mincutoff ?? 0.02, o.beta ?? 1.5);
      this.degradou = false;
      return;
    }

    this.kalman = new Kalman2D(opts.kalman);

    if (opts.mode === 'kalmanEma') {
      if (opts.geometria) {
        this.ema = new AdaptiveEma({ ...opts.ema, geometria: opts.geometria });
        this.degradou = false;
      } else {
        // Sem geometria de tela, o EMA adaptativo e a zona morta não têm como
        // trabalhar em graus. Degrada para Kalman puro e ANUNCIA: uma cadeia
        // que silenciosamente vira outra invalidaria qualquer comparação.
        this.degradou = true;
        console.warn(
          "[filterChain] modo 'kalmanEma' pedido SEM geometria de tela. " +
          'O EMA adaptativo trabalha em graus e não tem como escolher α. ' +
          'Degradando para Kalman puro — a medição desta sessão NÃO representa kalmanEma.',
        );
      }
      return;
    }

    this.degradou = false;
  }

  /** Modo EFETIVAMENTE ativo — pode diferir do pedido, ver `degradou`. */
  get modoEfetivo(): FilterMode {
    return this.degradou ? 'kalman' : this.mode;
  }

  /** A cadeia degradou por falta de geometria. */
  get degradado(): boolean {
    return this.degradou;
  }

  /**
   * Filtra uma amostra.
   *
   * `tSec` é o relógio em SEGUNDOS (o One Euro trabalha assim); `nowMs` é o
   * mesmo instante em ms, que o EMA usa para a janela da zona morta. Passar os
   * dois evita uma conversão que já causou confusão de unidade neste projeto.
   */
  filter(x: number, y: number, tSec: number, nowMs: number, dtSec?: number): SaidaDoFiltro {
    const saida = this.filtrarSemEstabilizador(x, y, tSec, nowMs, dtSec);
    if (!this.estabilizador) return saida;

    // O estabilizador vem por ÚLTIMO, sobre a saída já filtrada: ele não
    // substitui o filtro, decide quando a média vale mais que a amostra.
    const e = this.estabilizador.processar(saida.x, saida.y, nowMs);
    return {
      ...saida,
      x: e.x,
      y: e.y,
      estadoDoOlho: e.estado,
      amostrasNaMedia: e.amostrasNaMedia,
    };
  }

  private filtrarSemEstabilizador(
    x: number, y: number, tSec: number, nowMs: number, dtSec?: number,
  ): SaidaDoFiltro {
    if (this.oneEuro) {
      const p = this.oneEuro.filter(x, y, tSec);
      return {
        x: p.x, y: p.y, alpha: null, velocidadeDegPorSeg: null, naZonaMorta: false,
        estadoDoOlho: null, amostrasNaMedia: 1,
      };
    }

    // Kalman recebe a medição CRUA — ver a nota de ordem no cabeçalho.
    const k = this.kalman!.filter(x, y, dtSec);
    if (!this.ema) {
      return {
        x: k.x, y: k.y, alpha: null, velocidadeDegPorSeg: null, naZonaMorta: false,
        estadoDoOlho: null, amostrasNaMedia: 1,
      };
    }
    const e = this.ema.filter(k.x, k.y, nowMs);
    return {
      x: e.x, y: e.y,
      alpha: e.alpha,
      velocidadeDegPorSeg: e.velocidadeDegPorSeg,
      naZonaMorta: e.naZonaMorta,
      estadoDoOlho: null,
      amostrasNaMedia: 1,
    };
  }

  /** O Kalman por trás da cadeia, para o `blinkHold` projetar.
   *  `null` no modo `'oneEuro'`, que não tem modelo de movimento. */
  get kalmanInterno(): Kalman2D | null {
    return this.kalman;
  }

  reset(): void {
    this.oneEuro?.reset();
    this.kalman?.reset();
    this.ema?.reset();
    this.estabilizador?.reset();
  }
}
