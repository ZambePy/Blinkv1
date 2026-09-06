// Hold on blink: congelar o cursor durante a piscada.
//
// Durante uma piscada não há íris para medir. Descartar o quadro deixa o
// cursor onde estava — e se a piscada acontece no meio de uma sacada, ele
// trava no meio do caminho e depois salta. Congelar na posição PREDITA pelo
// Kalman usa o modelo de velocidade constante como melhor estimativa de onde
// o olho está enquanto ninguém consegue medir.
//
// O teto de 2 s separa "piscada" (100–400 ms) de "olho fechado". Continuar
// projetando velocidade constante por dez segundos mandaria o cursor para
// fora da tela com confiança total. Depois do teto o hold para de afirmar
// uma posição que ninguém mediu; o que fazer é decisão do chamador.
//
// Durante o hold o cursor tem posição confiável, então o progresso do dwell
// deve ser PRESERVADO. Depois do teto, não — aí é ausência de verdade.

import type { Kalman2D } from './kalman2d';

/** Teto do hold, em ms. Além disso não é piscada. */
export const BLINK_HOLD_MAX_MS = 2000;

export type EstadoHold =
  /** Não há piscada; o pipeline segue normal. */
  | 'normal'
  /** Piscando, dentro do teto: cursor congelado na predição do Kalman. */
  | 'segurando'
  /** O teto estourou: olho fechado, não piscada. O chamador degrada. */
  | 'expirado';

export interface ResultadoHold {
  estado: EstadoHold;
  /** Posição a usar neste quadro. `null` em `'expirado'` — não há posição
   *  defensável, e devolver a última seria afirmar o que ninguém mediu. */
  posicao: { x: number; y: number } | null;
  /** Duração do episódio atual, em ms. 0 fora de episódio. */
  duracaoMs: number;
  /** O dwell deve preservar o progresso neste quadro? `true` durante o hold
   *  (a posição é confiável), `false` depois do teto. */
  preservarDwell: boolean;
}

export interface BlinkHoldOptions {
  maxMs?: number;
  /** Intervalo nominal de quadro, em segundos — usado na projeção. */
  nominalDt?: number;
}

/**
 * Máquina de estados do hold. Pura em relação ao tempo: recebe `nowMs`.
 *
 * Não decide se houve piscada — recebe isso pronto do `BlinkDetector`, que já
 * tem o limiar adaptativo por pessoa. Duplicar o critério aqui daria duas
 * respostas para a mesma pergunta.
 */
export class BlinkHold {
  private readonly maxMs: number;
  private readonly nominalDt: number;
  private inicioMs: number | null = null;

  constructor(opts: BlinkHoldOptions = {}) {
    this.maxMs = opts.maxMs ?? BLINK_HOLD_MAX_MS;
    this.nominalDt = opts.nominalDt ?? 1 / 30;
  }

  /** Está em episódio de hold agora? */
  get segurando(): boolean {
    return this.inicioMs !== null;
  }

  /**
   * Um quadro.
   *
   * `kalman` é consultado, não modificado — a projeção não deve avançar o
   * estado do filtro, senão o hold reescreveria o modelo com dados que não
   * existem.
   */
  update(
    piscando: boolean,
    nowMs: number,
    kalman: Pick<Kalman2D, 'predict' | 'ready'>,
  ): ResultadoHold {
    if (!piscando) {
      this.inicioMs = null;
      return { estado: 'normal', posicao: null, duracaoMs: 0, preservarDwell: false };
    }

    if (this.inicioMs === null) this.inicioMs = nowMs;
    const duracaoMs = nowMs - this.inicioMs;

    if (duracaoMs > this.maxMs) {
      // Não é mais piscada. Sem posição defensável: devolver a última
      // projeção seria afirmar, com confiança, algo que ninguém mediu há
      // mais de dois segundos.
      return { estado: 'expirado', posicao: null, duracaoMs, preservarDwell: false };
    }

    if (!kalman.ready) {
      // Piscada antes de o filtro ter qualquer estado — não há o que projetar.
      return { estado: 'segurando', posicao: null, duracaoMs, preservarDwell: true };
    }

    // Projeta a partir do início do episódio: quantos quadros já se passaram
    // desde a última medição real.
    const quadros = duracaoMs / 1000 / this.nominalDt;
    const p = kalman.predict(quadros, this.nominalDt);
    return {
      estado: 'segurando',
      posicao: { x: p.x, y: p.y },
      duracaoMs,
      preservarDwell: true,
    };
  }

  reset(): void {
    this.inicioMs = null;
  }
}
