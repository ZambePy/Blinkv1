// EMA adaptativo com α escolhido pela velocidade ANGULAR, mais zona morta (no
// mesmo módulo por compartilhar a conversão angular).
//
// Um EMA de α fixo obriga a escolher entre suave e responsivo. Adaptar α pela
// velocidade dá as duas coisas: em fixação (< 5°/s) α = 0,08 e o cursor fica
// firme; numa sacada (> 15°/s) α = 0,35 e ele acompanha.
//
// Em graus, e não em pixels: o mesmo deslocamento em pixels é um ângulo
// diferente em cada setup (111 px/grau numa 23,6" a 60 cm, 130 numa 40" a
// 100 cm). Limiar em pixels deixaria o filtro mais ou menos responsivo
// conforme o monitor.
//
// Sem geometria a velocidade é `null`: não há default razoável, porque assumir
// 111 px/grau é assumir uma tela e uma distância específicas. Nesse caso o
// chamador usa α fixo e sabe que está fazendo isso.

import {
  velocidadeAngularDegPorSeg,
  pixelsParaGraus,
  type GeometriaDeTela,
} from './angularVelocity';

/** Velocidade abaixo da qual o filtro assume fixação. */
export const VELOCIDADE_LENTA_DEG_S = 5;
/** Velocidade acima da qual o filtro assume movimento. */
export const VELOCIDADE_RAPIDA_DEG_S = 15;
/** α em fixação — bem suave. */
export const ALPHA_LENTO = 0.08;
/** α em movimento — bem responsivo. */
export const ALPHA_RAPIDO = 0.35;

/**
 * α para uma velocidade angular, com interpolação monotônica entre os limites.
 *
 * Interpolação LINEAR na velocidade, de propósito: é auditável de cabeça, o
 * que uma sigmoide não seria.
 */
export function alphaPorVelocidade(
  velocidadeDegPorSeg: number,
  lento = ALPHA_LENTO,
  rapido = ALPHA_RAPIDO,
): number {
  if (!Number.isFinite(velocidadeDegPorSeg)) return lento;
  const v = Math.max(0, velocidadeDegPorSeg);
  if (v <= VELOCIDADE_LENTA_DEG_S) return lento;
  if (v >= VELOCIDADE_RAPIDA_DEG_S) return rapido;
  const t = (v - VELOCIDADE_LENTA_DEG_S) / (VELOCIDADE_RAPIDA_DEG_S - VELOCIDADE_LENTA_DEG_S);
  return lento + (rapido - lento) * t;
}

export interface AdaptiveEmaOptions {
  geometria: GeometriaDeTela;
  alphaLento?: number;
  alphaRapido?: number;
  /** Zona morta em graus. `0` desliga. */
  deadZoneDeg?: number;
  /** Janela da zona morta, em ms: o movimento precisa ficar abaixo do limiar
   *  por este tempo para o cursor ser considerado parado. */
  deadZoneJanelaMs?: number;
}

/** Movimento menor que isto, sustentado, é microtremor. */
export const DEAD_ZONE_DEG = 0.3;
/** Janela da zona morta, em ms. */
export const DEAD_ZONE_JANELA_MS = 200;

export interface ResultadoEma {
  x: number;
  y: number;
  /** α efetivamente usado neste quadro. Exposto para o diagnóstico: sem ele não
   *  há como explicar por que o cursor ficou firme ou solto num momento. */
  alpha: number;
  /** Velocidade angular estimada, em °/s. `null` sem quadro anterior. */
  velocidadeDegPorSeg: number | null;
  /** O quadro caiu na zona morta e a saída foi congelada. */
  naZonaMorta: boolean;
}

export class AdaptiveEma {
  private readonly geo: GeometriaDeTela;
  private readonly alphaLento: number;
  private readonly alphaRapido: number;
  private readonly deadZoneDeg: number;
  private readonly deadZoneJanelaMs: number;

  private temAnterior = false;
  private sx = 0;
  private sy = 0;
  /** Última medição CRUA — a velocidade sai dela, não da saída filtrada.
   *  Medir a velocidade sobre a saída realimenta o filtro: mais suavização →
   *  velocidade menor → α menor → mais suavização. Trava no lento. */
  private mxAnterior = 0;
  private myAnterior = 0;
  /** Instante da medição anterior. Separado de `ancoraDesdeMs` de propósito: a
   *  VELOCIDADE se mede entre quadros consecutivos, a ZONA MORTA se mede desde
   *  a âncora. Usar o mesmo relógio para os dois faria a velocidade cair
   *  artificialmente quanto mais tempo o cursor ficasse parado. */
  private tAnterior = 0;
  /** Âncora da zona morta e desde quando ela vale. */
  private ancoraX = 0;
  private ancoraY = 0;
  private ancoraDesdeMs = 0;

  constructor(opts: AdaptiveEmaOptions) {
    this.geo = opts.geometria;
    this.alphaLento = opts.alphaLento ?? ALPHA_LENTO;
    this.alphaRapido = opts.alphaRapido ?? ALPHA_RAPIDO;
    this.deadZoneDeg = opts.deadZoneDeg ?? DEAD_ZONE_DEG;
    this.deadZoneJanelaMs = opts.deadZoneJanelaMs ?? DEAD_ZONE_JANELA_MS;
  }

  filter(mx: number, my: number, nowMs: number): ResultadoEma {
    if (!Number.isFinite(mx) || !Number.isFinite(my)) {
      return {
        x: this.sx, y: this.sy, alpha: this.alphaLento,
        velocidadeDegPorSeg: null, naZonaMorta: false,
      };
    }

    if (!this.temAnterior) {
      this.temAnterior = true;
      this.sx = mx; this.sy = my;
      this.mxAnterior = mx; this.myAnterior = my; this.tAnterior = nowMs;
      this.ancoraX = mx; this.ancoraY = my; this.ancoraDesdeMs = nowMs;
      return { x: mx, y: my, alpha: this.alphaRapido, velocidadeDegPorSeg: null, naZonaMorta: false };
    }

    // Tempo desde o QUADRO ANTERIOR — não desde a âncora da zona morta.
    const dtSec = Math.max(1e-6, (nowMs - this.tAnterior) / 1000);
    const velocidade = velocidadeAngularDegPorSeg(
      this.mxAnterior, this.myAnterior, mx, my, dtSec, this.geo,
    );

    // Zona morta. A distância é medida contra a ÂNCORA, não contra o quadro anterior. Se
    // fosse contra o anterior, uma deriva lenta e constante passaria: cada
    // passo cabe na zona morta, e o cursor escorregaria sem nunca "se mover".
    const desvioGraus = pixelsParaGraus(
      Math.hypot(mx - this.ancoraX, my - this.ancoraY), this.geo,
    );
    const dentroDoLimiar = this.deadZoneDeg > 0 && desvioGraus !== null && desvioGraus < this.deadZoneDeg;

    if (dentroDoLimiar) {
      const tempoParado = nowMs - this.ancoraDesdeMs;
      if (tempoParado >= this.deadZoneJanelaMs) {
        // Parado o bastante: congela a saída, mas CONTINUA seguindo a medição
        // crua para a velocidade não zerar artificialmente no próximo quadro.
        this.mxAnterior = mx; this.myAnterior = my; this.tAnterior = nowMs;
        return {
          x: this.sx, y: this.sy,
          alpha: 0,
          velocidadeDegPorSeg: velocidade,
          naZonaMorta: true,
        };
      }
    } else {
      // Saiu da zona: reancora AQUI e reinicia o relógio.
      this.ancoraX = mx; this.ancoraY = my; this.ancoraDesdeMs = nowMs;
    }

    const alpha = velocidade === null
      // Sem geometria utilizável não dá para escolher α por velocidade. O
      // conservador é o suave: um cursor firme demais é irritante, um cursor
      // solto demais é inutilizável.
      ? this.alphaLento
      : alphaPorVelocidade(velocidade, this.alphaLento, this.alphaRapido);

    this.sx = this.sx + alpha * (mx - this.sx);
    this.sy = this.sy + alpha * (my - this.sy);
    this.mxAnterior = mx; this.myAnterior = my; this.tAnterior = nowMs;

    return { x: this.sx, y: this.sy, alpha, velocidadeDegPorSeg: velocidade, naZonaMorta: false };
  }

  reset(): void {
    this.temAnterior = false;
    this.sx = 0; this.sy = 0;
    this.mxAnterior = 0; this.myAnterior = 0; this.tAnterior = 0;
    this.ancoraX = 0; this.ancoraY = 0; this.ancoraDesdeMs = 0;
  }
}
