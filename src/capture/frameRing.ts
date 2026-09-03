// P4.1 — buffer circular de frames com descarte do MAIS ANTIGO.
//
// ── Por que o mais antigo, e não o mais novo ──────────────────────────────────
//
// A fila natural de um produtor/consumidor descarta o que chega quando está
// cheia (drop-tail): é o comportamento certo quando cada item importa, como num
// log. Aqui é o oposto. Um frame de 200 ms atrás, processado com precisão
// perfeita, continua sendo a resposta errada — o cursor precisa dizer onde o
// olho está agora. Então quando o consumidor atrasa, quem morre é o frame
// velho (drop-head).
//
// Isso não é hipotético neste pipeline: o L2CS leva 300+ ms por inferência
// enquanto a câmera entrega a 30 Hz. Sem uma política explícita, o atraso vira
// fila e a fila vira latência acumulada, que é o pior modo de falha possível
// para um cursor — ele fica correto e tardio, o que o usuário lê como
// "o programa está lento" e não como "o programa está errado".
//
// ── O que este módulo NÃO faz ────────────────────────────────────────────────
//
// Não captura nada, não conhece `VideoFrame`, `ImageBitmap` nem worker. É um
// container genérico e puro, para poder ser exercitado no harness sem browser.
// A ponte com a captura real é `captureWorker.ts` (P4.2).
//
// ── Contabilidade ────────────────────────────────────────────────────────────
//
// `pushed = taken + dropped + occupancy`, sempre. A identidade é o que separa
// "descarte controlado" de "vazamento silencioso" — se ela não fecha, o número
// de frames que chegou ao modelo é desconhecido, e toda medição de taxa em cima
// disso é fabricada. Os descartes são separados por causa porque as duas dizem
// coisas diferentes ao operador:
//
//   droppedOverflow  o ring encheu → o consumidor está mais lento que a
//                    capacidade do buffer. Aumentar a capacidade adia o
//                    problema (e aumenta a latência); resolver é acelerar o
//                    consumidor.
//   droppedStale     havia frame mais novo no momento do consumo → é o regime
//                    NORMAL de um consumidor a 10 Hz com câmera a 30 Hz. Não é
//                    defeito; é a política funcionando.

/** Capacidade default. Três frames a 30 Hz = 100 ms de folga: o bastante para
 *  absorver um pico de agendamento sem deixar o cursor atrasar visivelmente. */
export const RING_DEFAULT_CAPACITY = 3;

export interface RingFrame<T> {
  /** Índice de chegada, 0-based e monotônico dentro da sessão. */
  readonly seq: number;
  /** Hora da CAPTURA, não da entrega (a distinção que B2.1 pagou caro para
   *  aprender: carimbar a chegada faz um dado velho parecer recém-nascido). */
  readonly tCaptureMs: number;
  readonly payload: T;
}

export interface FrameRingStats {
  capacity: number;
  /** Frames dentro do buffer agora. */
  occupancy: number;
  /** Pior ocupação já vista na sessão. Sobrevive ao `clear()` — é diagnóstico
   *  de sessão, não estado de buffer. */
  highWaterMark: number;
  pushed: number;
  taken: number;
  /** `droppedOverflow + droppedStale`. */
  dropped: number;
  /** Descartados por o buffer estar cheio na chegada. */
  droppedOverflow: number;
  /** Descartados por existir frame mais novo no momento do consumo (ou por
   *  `clear()`, que também os torna obsoletos sem que tenham sido usados). */
  droppedStale: number;
}

export class FrameRing<T> {
  private readonly capacity: number;
  private readonly slots: Array<RingFrame<T> | null>;
  /** Posição do frame mais antigo. */
  private head = 0;
  private size = 0;
  private seqCounter = 0;

  private pushed = 0;
  private taken = 0;
  private droppedOverflow = 0;
  private droppedStale = 0;
  private highWaterMark = 0;

  constructor(capacity: number = RING_DEFAULT_CAPACITY) {
    // Capacidade inválida cai no default em vez de criar um ring degenerado:
    // um buffer de tamanho 0 aceitaria push e devolveria null em toda leitura,
    // o que apareceria como "a câmera parou" em vez de "alguém passou 0 aqui".
    const c = Math.trunc(capacity);
    this.capacity = Number.isFinite(c) && c >= 1 ? c : RING_DEFAULT_CAPACITY;
    this.slots = new Array<RingFrame<T> | null>(this.capacity).fill(null);
  }

  /**
   * Insere um frame. Quando o buffer está cheio, o mais antigo é evictado e
   * devolvido — o chamador pode querer liberar o recurso associado (um
   * `VideoFrame` do WebCodecs precisa de `.close()` explícito, senão a pipeline
   * de decode trava depois de alguns frames).
   */
  push(payload: T, tCaptureMs: number): { evicted: RingFrame<T> | null } {
    const frame: RingFrame<T> = { seq: this.seqCounter++, tCaptureMs, payload };
    this.pushed++;

    let evicted: RingFrame<T> | null = null;
    if (this.size === this.capacity) {
      evicted = this.slots[this.head];
      this.slots[this.head] = null;
      this.head = (this.head + 1) % this.capacity;
      this.size--;
      this.droppedOverflow++;
    }

    const tail = (this.head + this.size) % this.capacity;
    this.slots[tail] = frame;
    this.size++;
    if (this.size > this.highWaterMark) this.highWaterMark = this.size;
    return { evicted };
  }

  /**
   * Consome o frame MAIS RECENTE e descarta os anteriores, contando-os como
   * obsoletos. É o caminho que o pipeline usa: entre dois consumos a câmera
   * entregou 2 ou 3 frames, e só o último descreve onde o olho está.
   */
  takeLatest(): RingFrame<T> | null {
    if (this.size === 0) return null;
    const lastIdx = (this.head + this.size - 1) % this.capacity;
    const frame = this.slots[lastIdx];
    // Os que ficaram para trás não foram usados — some-os à conta de obsoletos
    // antes de limpar, senão a identidade `pushed = taken + dropped + occupancy`
    // deixa de fechar.
    this.droppedStale += this.size - 1;
    this.taken++;
    this.emptySlots();
    return frame;
  }

  /**
   * Consome em ordem FIFO. Existe para quem precisa da SEQUÊNCIA (medir jitter
   * de chegada, reproduzir uma gravação), não para o caminho quente do cursor.
   */
  takeOldest(): RingFrame<T> | null {
    if (this.size === 0) return null;
    const frame = this.slots[this.head];
    this.slots[this.head] = null;
    this.head = (this.head + 1) % this.capacity;
    this.size--;
    this.taken++;
    return frame;
  }

  /** Lê o mais recente sem consumir. Não altera contador nenhum. */
  peekLatest(): RingFrame<T> | null {
    if (this.size === 0) return null;
    return this.slots[(this.head + this.size - 1) % this.capacity];
  }

  /**
   * Esvazia o buffer. Os frames descartados contam como obsoletos: sumiram sem
   * chegar ao modelo, e um contador que os ignorasse mentiria sobre a fração de
   * frames processados.
   */
  clear(): void {
    this.droppedStale += this.size;
    this.emptySlots();
  }

  /** Zera os contadores da sessão, preservando o conteúdo. Chamado no `start()`
   *  do engine para não misturar sessões — a lição de B1.7. */
  resetStats(): void {
    this.pushed = this.size;
    this.taken = 0;
    this.droppedOverflow = 0;
    this.droppedStale = 0;
    this.highWaterMark = this.size;
  }

  stats(): FrameRingStats {
    return {
      capacity: this.capacity,
      occupancy: this.size,
      highWaterMark: this.highWaterMark,
      pushed: this.pushed,
      taken: this.taken,
      dropped: this.droppedOverflow + this.droppedStale,
      droppedOverflow: this.droppedOverflow,
      droppedStale: this.droppedStale,
    };
  }

  private emptySlots(): void {
    // Anula as posições em vez de só mexer nos índices: manter a referência
    // viva num slot morto segura o `VideoFrame`/`ImageBitmap` inteiro no heap.
    for (let i = 0; i < this.capacity; i++) this.slots[i] = null;
    this.head = 0;
    this.size = 0;
  }
}
