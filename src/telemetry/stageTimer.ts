// Instrumentação de latência por estágio do pipeline.
//
// O módulo é puro: recebe uma função `now()` no construtor (default
// `performance.now`) para ser testável sem monkey-patching global.
//
// Uso típico no engine:
//   stageTimer.begin('mediapipe');
//   const results = faceLandmarker.detectForVideo(...);
//   stageTimer.end('mediapipe');
//
// Em `getDiagnostics()`:
//   stageLatency: stageTimer.snapshot()
//
// Contrato de erro: chamar `end()` sem `begin()` correspondente é NO-OP com
// contador. `begin()` seguido de outro `begin()` do mesmo nome descarta o
// primeiro (mede só o intervalo mais recente). Isso é intencional — no rAF real
// um branch que retorna cedo sem `end()` não pode paralisar todo o resto.

export interface StageStats {
  /** Última amostra em ms. */
  lastMs: number;
  /** p50 (mediana) sobre a janela deslizante, em ms. */
  p50Ms: number;
  /** p95 sobre a janela deslizante, em ms. */
  p95Ms: number;
  /** Quantidade de amostras contidas na janela deslizante (≤ windowSize). */
  count: number;
  /** Contagem total de amostras registradas (não afetada pela janela). */
  totalSamples: number;
  /** Contagem de chamadas `end()` sem `begin()` correspondente. Se > 0,
   *  há bug no chamador. Exposto no snapshot para diagnóstico, nunca zerado. */
  orphanEnds: number;
}

export interface StageSnapshot {
  [stage: string]: StageStats;
}

export interface StageTimerOptions {
  /**
   * Tamanho da janela deslizante (número de amostras). Default 120 ≈ 4 s a
   * 30 fps, suficiente para p50/p95 estáveis sem que o histórico de 10 min
   * fique dominando as leituras atuais.
   */
  windowSize?: number;
  /**
   * Fonte do relógio. Default `() => performance.now()`. Injetável para os
   * testes usarem um relógio virtual determinístico.
   */
  now?: () => number;
}

const DEFAULT_WINDOW = 120;

/**
 * Ordena a amostra `values` e devolve o percentil `p` (0..1) com interpolação
 * linear entre os dois vizinhos mais próximos. Modifica o array (sort in-place)
 * — sempre chamada sobre uma cópia, nunca sobre o buffer interno.
 */
function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  if (values.length === 1) return values[0];
  values.sort((a, b) => a - b);
  const rank = p * (values.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return values[lo];
  const frac = rank - lo;
  return values[lo] * (1 - frac) + values[hi] * frac;
}

interface StageState {
  buffer: number[];       // círculo de amostras
  head: number;           // próxima posição a escrever
  full: boolean;          // já deu volta no círculo?
  totalSamples: number;
  orphanEnds: number;
  openedAt: number | null; // timestamp do begin() ativo, ou null
  lastMs: number;
}

export class StageTimer {
  private readonly windowSize: number;
  private readonly now: () => number;
  private readonly stages = new Map<string, StageState>();

  constructor(opts: StageTimerOptions = {}) {
    // Janela mínima de 1 evita divisão por zero e casos degenerados nos testes;
    // limite superior arbitrariamente alto porque cada slot é um number (8B),
    // então mesmo 10^5 slots = 800 KB por estágio — sob controle.
    this.windowSize = Math.max(1, opts.windowSize ?? DEFAULT_WINDOW);
    this.now = opts.now ?? (() => performance.now());
  }

  /** Marca o início de um estágio nomeado. Chamar de novo com o mesmo nome
   *  antes de `end()` descarta o `begin()` anterior — o timer só mede o par
   *  begin→end mais recente. */
  begin(stage: string): void {
    const state = this.getOrCreate(stage);
    state.openedAt = this.now();
  }

  /** Fecha o estágio e adiciona a duração à janela deslizante. Se não houve
   *  `begin()` correspondente, incrementa `orphanEnds` e retorna sem gravar. */
  end(stage: string): void {
    const state = this.stages.get(stage);
    if (!state || state.openedAt === null) {
      // Estado inexistente também conta como órfão para o diagnóstico ficar
      // visível — caso raro, aponta typo no nome do estágio.
      if (!state) {
        const created = this.getOrCreate(stage);
        created.orphanEnds++;
      } else {
        state.orphanEnds++;
      }
      return;
    }
    const dt = this.now() - state.openedAt;
    state.openedAt = null;
    this.push(state, dt);
  }

  /** Helper: mede o custo de uma função síncrona. Propaga exceções para o
   *  chamador, mas garante que `end()` roda (nunca vaza `openedAt`). */
  time<T>(stage: string, fn: () => T): T {
    this.begin(stage);
    try {
      return fn();
    } finally {
      this.end(stage);
    }
  }

  /** Registra uma duração pré-medida (útil quando o começo/fim vem de outra
   *  fonte, como o timestamp de captura de um frame). */
  record(stage: string, durationMs: number): void {
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    const state = this.getOrCreate(stage);
    this.push(state, durationMs);
  }

  /** Snapshot de todos os estágios. Não faz alocação além da cópia do buffer
   *  para o `sort` do percentil. Segura para chamar a cada frame — o custo é
   *  O(n log n · S) onde n = windowSize, S = número de estágios. Com defaults
   *  (120, ~8 estágios) fica em torno de ~50 μs. */
  snapshot(): StageSnapshot {
    const out: StageSnapshot = {};
    for (const [name, state] of this.stages) {
      const count = state.full ? state.buffer.length : state.head;
      const values = state.full ? state.buffer.slice() : state.buffer.slice(0, state.head);
      const p50 = percentile(values.slice(), 0.5);
      const p95 = percentile(values.slice(), 0.95);
      out[name] = {
        lastMs: state.lastMs,
        p50Ms: p50,
        p95Ms: p95,
        count,
        totalSamples: state.totalSamples,
        orphanEnds: state.orphanEnds,
      };
    }
    return out;
  }

  /** Descarta janela e contadores de todos os estágios. O engine chama no
   *  `start()` para não misturar sessões. */
  reset(): void {
    this.stages.clear();
  }

  private getOrCreate(stage: string): StageState {
    let s = this.stages.get(stage);
    if (!s) {
      s = {
        buffer: new Array<number>(this.windowSize).fill(0),
        head: 0,
        full: false,
        totalSamples: 0,
        orphanEnds: 0,
        openedAt: null,
        lastMs: 0,
      };
      this.stages.set(stage, s);
    }
    return s;
  }

  private push(state: StageState, ms: number): void {
    state.buffer[state.head] = ms;
    state.head = (state.head + 1) % this.windowSize;
    if (state.head === 0) state.full = true;
    state.totalSamples++;
    state.lastMs = ms;
  }
}

/** Nomes canônicos dos estágios instrumentados no engine.
 *  Consumidores devem preferir estes literais para não divergirem por typo. */
export const STAGE = {
  mediapipe: 'mediapipe',
  l2csCrop: 'l2cs.crop',
  l2csRead: 'l2cs.read',
  features: 'features',
  quality: 'quality',
  predict: 'predict',
  filter: 'filter',
  loopTotal: 'loop.total',
} as const;
