// P5.7 / P5.8 — gaze absoluto por compensação ADITIVA, e referência neutra
// dinâmica.
//
// ── P5.7: a fórmula, e por que ela não é a que já existe ────────────────────
//
//     gaze_abs = gaze_L2CS + (head_atual − head_ref)
//
// O projeto JÁ tem compensação de pose, mas é outra coisa: `poseCompensation.ts`
// desloca a PREDIÇÃO em pixels por `d · tan(Δ)`, depois do Ridge. Esta aqui
// corrige o ÂNGULO, antes de entrar no Ridge. Não são duas escritas da mesma
// ideia:
//
//   geométrica  atua na saída, em pixels, e precisa da distância à tela
//   aditiva     atua na entrada, em radianos, e não precisa de distância
//
// A aditiva assume que o L2CS mede o olhar RELATIVO à cabeça, e que somar a
// rotação da cabeça devolve o olhar no referencial do mundo. É uma aproximação
// de primeira ordem — exata só se o olho estivesse no centro de rotação da
// cabeça, o que não é verdade. Por isso ela entra como alternativa a MEDIR, não
// como substituição.
//
// ── Por que os modos não podem somar duas vezes ─────────────────────────────
//
// Em `'both'`, a tentação é aplicar as duas e esperar que "corrija mais". Não
// corrige: as duas descrevem o MESMO efeito físico em espaços diferentes.
// Aplicar as duas compensa a rotação da cabeça duas vezes, e o erro resultante
// tem o sinal contrário — o cursor passa do alvo em vez de ficar aquém. O modo
// `'both'` existe para MEDIR os dois em paralelo, com a aditiva alimentando o
// diagnóstico enquanto a geométrica atua; nunca para somar os efeitos.

/** Pose da cabeça em radianos. */
export interface PoseCabeca {
  yaw: number;
  pitch: number;
  roll?: number;
}

/**
 * Clamp da variação de pose, em radianos (herdado de `B3.12`).
 *
 * ±π/6 = 30°. Além disso a cabeça saiu do regime em que a aproximação vale, e
 * `atan2` pode ter dado a volta — em `poseCompensation.ts` isso explodia `dx`
 * para dezenas de milhares de pixels. Aqui o dano seria menor (o resultado é um
 * ângulo, não um pixel), mas o pico entraria no buffer temporal do mesmo jeito.
 */
export const CLAMP_POSE_RAD = Math.PI / 6;

export interface GazeAbsoluto {
  yaw: number;
  pitch: number;
  /** A variação de pose bateu no clamp. Quando true, a compensação foi
   *  limitada e o consumidor deveria desconfiar do quadro. */
  clamped: boolean;
}

/**
 * Aplica a compensação aditiva. Puro.
 *
 * Sem referência devolve o gaze intacto — não há o que compensar contra, e
 * inventar uma referência (a pose do primeiro quadro, por exemplo) faria toda a
 * sessão herdar a postura de um instante arbitrário.
 */
export function gazeAbsoluto(
  gaze: PoseCabeca,
  headAtual: PoseCabeca | null | undefined,
  headRef: PoseCabeca | null | undefined,
  clampRad: number = CLAMP_POSE_RAD,
): GazeAbsoluto {
  if (!headAtual || !headRef) {
    return { yaw: gaze.yaw, pitch: gaze.pitch, clamped: false };
  }
  const dYawBruto = headAtual.yaw - headRef.yaw;
  const dPitchBruto = headAtual.pitch - headRef.pitch;
  if (!Number.isFinite(dYawBruto) || !Number.isFinite(dPitchBruto)) {
    return { yaw: gaze.yaw, pitch: gaze.pitch, clamped: false };
  }

  const dYaw = Math.min(clampRad, Math.max(-clampRad, dYawBruto));
  const dPitch = Math.min(clampRad, Math.max(-clampRad, dPitchBruto));
  const clamped = dYaw !== dYawBruto || dPitch !== dPitchBruto;

  return { yaw: gaze.yaw + dYaw, pitch: gaze.pitch + dPitch, clamped };
}

// -----------------------------------------------------------------------------
// P5.8 — referência neutra dinâmica
// -----------------------------------------------------------------------------
//
// ── O problema ──────────────────────────────────────────────────────────────
//
// A referência é a pose em que o modelo foi calibrado. Se o paciente muda de
// postura na cadeira e fica assim, toda predição passa a ser compensada contra
// uma referência que não existe mais — e o erro cresce de forma monotônica sem
// nada acusando.
//
// ── Por que isso é delicado ─────────────────────────────────────────────────
//
// Atualizar a referência é mexer no que dá sentido a toda a compensação. Duas
// guardas são obrigatórias, e uma terceira veio da natureza do sinal:
//
//   1. NUNCA durante a calibração. A referência da calibração é o ponto contra
//      o qual o Ridge minimizou o erro (ver `B1.3`). Trocá-la no meio invalida
//      o modelo que está sendo treinado.
//
//   2. NUNCA durante deriva rápida. A média móvel tem que capturar mudança de
//      POSTURA sustentada, não uma virada de cabeça de 3 s. Sem isso, olhar
//      para o cuidador e voltar redefiniria o "neutro" para o meio do caminho.
//
//   3. Toda atualização é REGISTRADA, com timestamp e delta. Sem isso fica
//      impossível explicar, no Dia 7, por que o erro mudou no meio da sessão —
//      e "o erro mudou e ninguém sabe por quê" é o pior resultado possível de
//      um dia de medição com paciente.

export interface OpcoesReferencia {
  /** Janela da média móvel, em ms. */
  janelaMs?: number;
  /** Tempo mínimo de estabilidade antes de aceitar nova referência, em ms. */
  estabilidadeMinMs?: number;
  /** Velocidade angular acima da qual consideramos "deriva rápida", em rad/s.
   *  Enquanto a cabeça se move mais que isso, o relógio de estabilidade zera. */
  velocidadeMaxRadPorS?: number;
  /** Delta mínimo contra a referência vigente para valer uma atualização.
   *  Abaixo disso a mudança é ruído e trocar só adicionaria instabilidade. */
  deltaMinRad?: number;
}

const JANELA_MS_DEFAULT = 60_000;
const ESTABILIDADE_MIN_MS_DEFAULT = 5_000;
/** ~5,7°/s. Uma virada de cabeça deliberada passa fácil disso; respiração e
 *  micro-ajustes de postura, não. */
const VELOCIDADE_MAX_DEFAULT = 0.1;
/** ~2,9°. Abaixo disso a "mudança de postura" não muda a compensação de forma
 *  perceptível, e trocar a referência só gastaria estabilidade. */
const DELTA_MIN_RAD_DEFAULT = 0.05;

export interface AtualizacaoReferencia {
  /** Hora da troca, no relógio do chamador. */
  timestampMs: number;
  de: PoseCabeca | null;
  para: PoseCabeca;
  /** Deslocamento aplicado, em radianos. */
  delta: { yaw: number; pitch: number };
  /** Amostras que formaram a nova referência. */
  amostras: number;
}

interface Amostra {
  t: number;
  yaw: number;
  pitch: number;
}

export class ReferenciaNeutra {
  private readonly janelaMs: number;
  private readonly estabilidadeMinMs: number;
  private readonly velocidadeMax: number;
  private readonly deltaMin: number;

  private amostras: Amostra[] = [];
  private ref: PoseCabeca | null = null;
  private estavelDesde: number | null = null;
  private ultima: Amostra | null = null;
  private historico: AtualizacaoReferencia[] = [];

  constructor(opts: OpcoesReferencia = {}) {
    this.janelaMs = opts.janelaMs ?? JANELA_MS_DEFAULT;
    this.estabilidadeMinMs = opts.estabilidadeMinMs ?? ESTABILIDADE_MIN_MS_DEFAULT;
    this.velocidadeMax = opts.velocidadeMaxRadPorS ?? VELOCIDADE_MAX_DEFAULT;
    this.deltaMin = opts.deltaMinRad ?? DELTA_MIN_RAD_DEFAULT;
  }

  /** Referência vigente, ou `null` antes da primeira definição. */
  get referencia(): PoseCabeca | null {
    return this.ref;
  }

  /** Todas as atualizações desta sessão, para a telemetria. */
  get atualizacoes(): readonly AtualizacaoReferencia[] {
    return this.historico;
  }

  /**
   * Define a referência explicitamente. É o que a calibração chama ao terminar:
   * a pose média da calibração é a referência de origem, e ela não é negociável
   * até que a guarda de estabilidade autorize outra.
   */
  definir(pose: PoseCabeca, nowMs: number): void {
    this.ref = { yaw: pose.yaw, pitch: pose.pitch, roll: pose.roll };
    this.estavelDesde = null;
    this.amostras = [];
    this.historico.push({
      timestampMs: nowMs,
      de: null,
      para: { ...this.ref },
      delta: { yaw: 0, pitch: 0 },
      amostras: 0,
    });
  }

  /**
   * Alimenta um quadro. Devolve a atualização quando ela acontece, `null` caso
   * contrário — o chamador registra na telemetria.
   */
  atualizar(
    pose: PoseCabeca,
    nowMs: number,
    contexto: { calibrando: boolean },
  ): AtualizacaoReferencia | null {
    if (!Number.isFinite(pose.yaw) || !Number.isFinite(pose.pitch) || !Number.isFinite(nowMs)) {
      return null;
    }

    // GUARDA 1 — durante a calibração, nem acumula. Amostras colhidas enquanto
    // o paciente persegue alvos descrevem a tarefa, não a postura de repouso.
    if (contexto.calibrando) {
      this.amostras = [];
      this.estavelDesde = null;
      this.ultima = null;
      return null;
    }

    const atual: Amostra = { t: nowMs, yaw: pose.yaw, pitch: pose.pitch };

    // GUARDA 2 — deriva rápida zera o relógio de estabilidade.
    if (this.ultima) {
      const dt = (nowMs - this.ultima.t) / 1000;
      if (dt > 0) {
        const velocidade = Math.hypot(pose.yaw - this.ultima.yaw, pose.pitch - this.ultima.pitch) / dt;
        if (velocidade > this.velocidadeMax) {
          this.estavelDesde = null;
          // As amostras da virada não podem entrar na média: elas descrevem o
          // movimento, não a postura nova.
          this.amostras = [];
          this.ultima = atual;
          return null;
        }
      }
    }
    this.ultima = atual;

    this.amostras.push(atual);
    const corte = nowMs - this.janelaMs;
    while (this.amostras.length > 0 && this.amostras[0].t < corte) this.amostras.shift();

    if (this.estavelDesde === null) this.estavelDesde = nowMs;
    if (nowMs - this.estavelDesde < this.estabilidadeMinMs) return null;
    if (this.amostras.length < 2) return null;

    const media = this.media();

    // GUARDA 3 — mudança pequena demais não vale a instabilidade de trocar.
    if (this.ref) {
      const d = Math.hypot(media.yaw - this.ref.yaw, media.pitch - this.ref.pitch);
      if (d < this.deltaMin) return null;
    }

    const evento: AtualizacaoReferencia = {
      timestampMs: nowMs,
      de: this.ref ? { ...this.ref } : null,
      para: { ...media },
      delta: {
        yaw: media.yaw - (this.ref?.yaw ?? media.yaw),
        pitch: media.pitch - (this.ref?.pitch ?? media.pitch),
      },
      amostras: this.amostras.length,
    };
    this.ref = { ...media };
    this.historico.push(evento);
    // Recomeça o relógio: a próxima troca exige outra janela inteira de
    // estabilidade, senão a referência ficaria perseguindo a média a cada
    // quadro depois da primeira atualização.
    this.estavelDesde = nowMs;
    return evento;
  }

  reset(): void {
    this.amostras = [];
    this.ref = null;
    this.estavelDesde = null;
    this.ultima = null;
    this.historico = [];
  }

  private media(): PoseCabeca {
    let sy = 0, sp = 0;
    for (const a of this.amostras) { sy += a.yaw; sp += a.pitch; }
    const n = this.amostras.length;
    return { yaw: sy / n, pitch: sp / n };
  }
}
