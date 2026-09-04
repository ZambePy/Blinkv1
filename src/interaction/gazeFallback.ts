// P7.5 — fallback de gaze perdido: última posição válida por 2 s, depois
// "Posicione o rosto".
//
// ── O buraco que isto fecha ─────────────────────────────────────────────────
//
// Hoje, quando o rosto some, o `GazeContext` baixa a opacidade do cursor para
// 0.35 e **para por aí**. O cursor fica congelado na última posição, para
// sempre, a 35% de opacidade. O `stepDwell` não clica (o `sampleIsValid` já
// exige `hasFace`), então não há clique cego — mas também não há NADA que diga
// ao paciente o que aconteceu.
//
// O sintoma para quem está na cadeira é: o cursor parou de responder. Ele não
// tem como distinguir "a câmera não me vê" de "o app travou" de "a calibração
// morreu". E o cuidador, olhando de fora, vê um cursor na tela — o que sugere
// que o sistema está funcionando.
//
// ── Por que segurar 2 s antes de esconder ───────────────────────────────────
//
// Perdas curtas são a regra, não a exceção: o detector de rosto pula quadros,
// a pessoa vira a cabeça 200 ms, o auto-exposure da webcam pisca. Esconder o
// cursor a cada perda produziria um pisca-pisca que é pior que o congelamento.
//
// Segurar é honesto por 2 s porque a última posição ainda descreve
// razoavelmente onde a pessoa olhava. Depois disso não descreve mais nada — e
// aí a resposta certa é remover o cursor e DIZER o que fazer, não continuar
// desenhando um palpite velho.
//
// ── A diferença para o `blinkHold` (`P6.3`) ─────────────────────────────────
//
// Os dois seguram por até 2000 ms, e a semelhança termina aí. O `blinkHold`
// segura durante uma PISCADA: os olhos fecharam, mas a pessoa continua olhando
// para o alvo, então ele projeta a posição pelo Kalman e **preserva o dwell**
// (`preservarDwell: true`).
//
// Aqui a causa é outra: o rosto sumiu. Ninguém sabe para onde a pessoa está
// olhando — pode ter virado a cabeça para falar com alguém. Projetar seria
// inventar, e preservar o dwell seria deixar um relógio correndo sobre um
// alvo que o olhar talvez tenha abandonado. Por isso este módulo **congela** a
// posição em vez de projetar, e **zera** o dwell em vez de preservá-lo.
//
// É exatamente a distinção que o `B2.5` deixou anotada como pendente no
// `blinkHold`: "piscada" e "perdi o rosto" pedem políticas opostas.

/** Quanto tempo a última posição válida continua sendo desenhada, em ms. */
export const FALLBACK_HOLD_MS = 2000;

/**
 * Mensagem exibida quando o hold expira.
 *
 * Imperativa e acionável de propósito. "Rosto não detectado" descreve o estado
 * do software; "Posicione o rosto na câmera" diz ao paciente o que fazer — e
 * quem lê isto pode não ter como pedir ajuda para interpretar a tela.
 */
export const MENSAGEM_SEM_ROSTO = 'Posicione o rosto na câmera';

export type EstadoFallback =
  /** Gaze válido — o cursor segue a medição. */
  | 'ativo'
  /** Sem gaze há menos de `holdMs` — o cursor fica onde estava. */
  | 'segurando'
  /** Sem gaze há mais de `holdMs` — o cursor some e a mensagem aparece. */
  | 'perdido';

export interface EntradaFallback {
  /** Há predição de gaze utilizável neste quadro. */
  gazeValido: boolean;
  /** Posição medida. Ignorada quando `gazeValido` é `false`. */
  x: number;
  y: number;
  nowMs: number;
}

export interface ResultadoFallback {
  estado: EstadoFallback;
  /** Onde desenhar o cursor. `null` significa "não desenhe" — não "(0,0)". */
  posicao: { x: number; y: number } | null;
  /** O cursor deve estar visível. */
  mostrarCursor: boolean;
  /**
   * Mensagem para o banner, ou `null`.
   *
   * `null` durante o hold: 2 s de perda é rotina, e um banner que pisca a cada
   * quadro perdido treina o paciente a ignorá-lo.
   */
  mensagem: string | null;
  /** Há quanto tempo o gaze está perdido, em ms. `0` quando ativo. */
  perdidoHaMs: number;
  /**
   * O dwell em curso deve ser descartado.
   *
   * `true` no quadro em que a perda começa — ver a nota sobre `blinkHold` no
   * cabeçalho. Só no primeiro quadro: zerar repetidamente seria inofensivo
   * hoje, mas transformaria "zere isto" num sinal de nível em vez de borda, e
   * o chamador não teria como saber se a perda é nova.
   */
  zerarDwell: boolean;
}

export interface OpcoesFallback {
  holdMs?: number;
}

/**
 * Máquina de estados do fallback.
 *
 * Guarda estado (a última posição válida e desde quando o gaze sumiu), então é
 * uma classe — mas não lê relógio nem toca no DOM: o instante vem na entrada.
 */
export class GazeFallback {
  private readonly holdMs: number;
  private ultimaValida: { x: number; y: number } | null = null;
  /**
   * Instante do último gaze VÁLIDO — a âncora do hold.
   *
   * Não é o mesmo que "primeiro quadro em que observei a perda", e a diferença
   * importa: se o loop inteiro travar, nenhum quadro perdido chega, o contador
   * ancorado na observação nunca avança e o cursor fantasma volta — que é
   * exatamente o defeito que este módulo veio corrigir. Ancorado na última
   * medição válida, o hold expira pelo relógio de quem perguntar.
   */
  private ultimaValidaMs: number | null = null;
  private perdidoDesde: number | null = null;

  constructor(opts: OpcoesFallback = {}) {
    this.holdMs = opts.holdMs ?? FALLBACK_HOLD_MS;
  }

  step(entrada: EntradaFallback): ResultadoFallback {
    if (entrada.gazeValido) {
      this.ultimaValida = { x: entrada.x, y: entrada.y };
      this.ultimaValidaMs = entrada.nowMs;
      this.perdidoDesde = null;
      return {
        estado: 'ativo',
        posicao: { x: entrada.x, y: entrada.y },
        mostrarCursor: true,
        mensagem: null,
        perdidoHaMs: 0,
        zerarDwell: false,
      };
    }

    const primeiroQuadroDaPerda = this.perdidoDesde === null;
    if (primeiroQuadroDaPerda) this.perdidoDesde = entrada.nowMs;
    const perdidoHaMs = this.ultimaValidaMs === null
      ? entrada.nowMs - this.perdidoDesde!
      : entrada.nowMs - this.ultimaValidaMs;

    // Perda que começa ANTES de existir qualquer posição válida: o app acabou
    // de abrir, ou a calibração ainda não rodou. Não há o que segurar, e
    // segurar `(0,0)` desenharia um cursor no canto superior esquerdo — que o
    // paciente leria como uma posição de olhar. Vai direto para 'perdido'.
    if (this.ultimaValida === null) {
      return {
        estado: 'perdido',
        posicao: null,
        mostrarCursor: false,
        mensagem: MENSAGEM_SEM_ROSTO,
        perdidoHaMs,
        zerarDwell: primeiroQuadroDaPerda,
      };
    }

    if (perdidoHaMs > this.holdMs) {
      return {
        estado: 'perdido',
        posicao: null,
        mostrarCursor: false,
        mensagem: MENSAGEM_SEM_ROSTO,
        perdidoHaMs,
        zerarDwell: primeiroQuadroDaPerda,
      };
    }

    return {
      estado: 'segurando',
      // A MESMA posição, quadro após quadro. Não projetada: ver o cabeçalho.
      posicao: { ...this.ultimaValida },
      mostrarCursor: true,
      mensagem: null,
      perdidoHaMs,
      zerarDwell: primeiroQuadroDaPerda,
    };
  }

  reset(): void {
    this.ultimaValida = null;
    this.ultimaValidaMs = null;
    this.perdidoDesde = null;
  }
}
