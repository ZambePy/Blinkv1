// P4.2 — captura fora do thread principal.
//
// ── Nota de realidade, antes de qualquer código ──────────────────────────────
//
// A captura NÃO é o gargalo deste pipeline. O gargalo é o L2CS: 300+ ms por
// inferência contra ~1–2 ms de `getImageData`. Mover a captura para um worker
// reduz jitter de agendamento e devolve o thread principal para a UI — não
// resolve latência, e vender isso como solução de latência seria repetir o
// padrão de defeito que a análise do plano lista como origem da maior parte dos
// bugs deste repositório. A medição de antes/depois é de `T0.5`, em runtime
// real, e é a única coisa que autoriza afirmar ganho.
//
// ── O que fica aqui e o que fica no arquivo do worker ────────────────────────
//
// Este módulo é a parte DECIDÍVEL e testável: detectar o que o navegador expõe,
// escolher a estratégia, e rodar o laço de captura sobre uma fonte injetada. O
// laço não conhece `MediaStreamTrackProcessor` — recebe um `AsyncIterable`, que
// é exatamente o que `processor.readable` vira quando iterado. Isso permite
// exercitá-lo no vitest com uma fonte falsa, sem browser.
//
// O arquivo de entrada do worker (`capture.worker.ts`) é a casca fina que
// constrói o `MediaStreamTrackProcessor` de verdade e chama este laço.
//
// ── Sobre `close()` ──────────────────────────────────────────────────────────
//
// Um `VideoFrame` do WebCodecs segura memória de vídeo que o GC não coleta em
// tempo hábil. A especificação é explícita: sem `close()`, a pipeline de decode
// estanca depois de alguns frames. Por isso o laço fecha todo frame que o ring
// evicta, e todo frame que sobrar no ring quando ele para. Vazar aqui não
// aparece como erro — aparece como a câmera "travando" depois de alguns
// segundos, que é o tipo de sintoma que se atribui ao hardware.

import type { FrameRing, RingFrame } from './frameRing';

/** O que o ambiente expõe, medido — nunca inferido de user agent. */
export interface CaptureEnvironment {
  hasWorker: boolean;
  hasMediaStreamTrackProcessor: boolean;
  hasRequestVideoFrameCallback: boolean;
  hasOffscreenCanvas: boolean;
}

export type CaptureStrategy =
  /** Captura no worker via `MediaStreamTrackProcessor` + `ReadableStream`. */
  | 'worker-track-processor'
  /** Thread principal, acordando na cadência da CÂMERA (`requestVideoFrameCallback`). */
  | 'main-rvfc'
  /** Thread principal, acordando na cadência de COMPOSIÇÃO (`requestAnimationFrame`). */
  | 'main-raf';

export interface CapturePlan {
  strategy: CaptureStrategy;
  /** true só quando a captura de fato sai do thread principal. */
  offMainThread: boolean;
  reasons: string[];
}

/**
 * Detecta capacidades a partir de um escopo INJETADO.
 *
 * Recebe o escopo em vez de ler `globalThis` para poder ser testado sem
 * monkey-patching global — a mesma disciplina do `StageTimer` com o relógio.
 * Escopo ausente devolve tudo `false`: em Node (harness) nada disso existe, e
 * assumir suporte seria escolher uma estratégia impossível.
 */
export function detectCaptureEnvironment(scope: unknown = globalThis): CaptureEnvironment {
  const s = (scope ?? {}) as Record<string, unknown>;
  const videoProto = (s.HTMLVideoElement as { prototype?: Record<string, unknown> } | undefined)?.prototype;
  return {
    hasWorker: typeof s.Worker !== 'undefined',
    hasMediaStreamTrackProcessor: typeof s.MediaStreamTrackProcessor !== 'undefined',
    hasRequestVideoFrameCallback: typeof videoProto?.requestVideoFrameCallback === 'function',
    hasOffscreenCanvas: typeof s.OffscreenCanvas !== 'undefined',
  };
}

/**
 * Escolhe a estratégia de captura, com a justificativa.
 *
 * A ordem é fixa e a degradação é explícita. Não existe caminho em que o módulo
 * finja ter capturado fora do thread principal — `offMainThread` é a resposta
 * honesta, e `T0.5` mede a consequência.
 */
export function planCaptureStrategy(env: CaptureEnvironment): CapturePlan {
  const reasons: string[] = [];

  if (env.hasWorker && env.hasMediaStreamTrackProcessor) {
    reasons.push(
      'MediaStreamTrackProcessor disponível: os frames são lidos dentro do worker, ' +
      'e o thread principal só recebe o resultado.',
    );
    if (!env.hasOffscreenCanvas) {
      reasons.push(
        'sem OffscreenCanvas: o crop 448² continua no thread principal — a captura sai, ' +
        'o recorte não.',
      );
    }
    return { strategy: 'worker-track-processor', offMainThread: true, reasons };
  }

  if (!env.hasWorker) reasons.push('sem Worker: não há para onde mover a captura.');
  else reasons.push('sem MediaStreamTrackProcessor: o worker não consegue ler a track diretamente.');

  if (env.hasRequestVideoFrameCallback) {
    reasons.push(
      'requestVideoFrameCallback disponível: a captura fica no thread principal, mas acorda ' +
      'na cadência da CÂMERA, não na da tela.',
    );
    return { strategy: 'main-rvfc', offMainThread: false, reasons };
  }

  reasons.push(
    'sem requestVideoFrameCallback: sobra requestAnimationFrame, que acorda na cadência de ' +
    'composição. A 30 fps de câmera com tela a 60 Hz, metade dos despertares não tem frame ' +
    'novo e um frame novo espera até ~16 ms para ser notado — é jitter de agendamento puro, ' +
    'e é o comportamento de hoje.',
  );
  return { strategy: 'main-raf', offMainThread: false, reasons };
}

// -----------------------------------------------------------------------------
// Laço de captura
// -----------------------------------------------------------------------------

/** Contrato mínimo de um frame capturado: saber se despedir. `VideoFrame` e
 *  `ImageBitmap` têm `close()`; um `ImageData` não tem, e o campo é opcional. */
export interface ClosableFrame {
  close?: () => void;
}

export interface CaptureLoopOptions<T extends ClosableFrame> {
  /** Fonte de frames. No worker é `processor.readable` iterado; no teste é um
   *  gerador. O laço NUNCA aguarda o consumidor — só a fonte. */
  source: AsyncIterable<{ frame: T; tCaptureMs: number }>;
  ring: FrameRing<T>;
  /** Notificação por frame inserido. É onde o consumidor decide se puxa agora.
   *  Exceção aqui é registrada e não derruba a captura. */
  onFrame?: (f: RingFrame<T>) => void;
}

export interface CaptureLoopStats {
  framesCaptured: number;
  errors: number;
  stopped: boolean;
}

export interface CaptureLoop {
  /** Consome a fonte até o fim, até `stop()`, ou até a fonte falhar. Nunca
   *  rejeita: falha de captura é um estado do sistema, não uma exceção do
   *  chamador — quem chama é um `useEffect` ou o boot do worker, e nos dois
   *  casos uma rejeição não teria tratamento útil. */
  run(): Promise<void>;
  stop(): void;
  stats(): CaptureLoopStats;
}

export function createCaptureLoop<T extends ClosableFrame>(
  opts: CaptureLoopOptions<T>,
): CaptureLoop {
  let framesCaptured = 0;
  let errors = 0;
  let stopped = false;

  function fechar(frame: T | null | undefined): void {
    try {
      frame?.close?.();
    } catch (e) {
      // Fechar duas vezes é erro em alguns navegadores. Não é motivo para
      // derrubar a captura.
      console.warn('[capture] close() falhou:', e);
    }
  }

  function drenar(): void {
    for (;;) {
      const f = opts.ring.takeOldest();
      if (!f) break;
      fechar(f.payload);
    }
  }

  const loop: CaptureLoop = {
    async run(): Promise<void> {
      try {
        for await (const item of opts.source) {
          if (stopped) {
            fechar(item.frame);
            break;
          }
          const { evicted } = opts.ring.push(item.frame, item.tCaptureMs);
          // O frame evictado morreu aqui: ninguém mais tem referência para ele.
          if (evicted) fechar(evicted.payload);
          framesCaptured++;

          const inserido = opts.ring.peekLatest();
          if (opts.onFrame && inserido) {
            try {
              opts.onFrame(inserido);
            } catch (e) {
              errors++;
              console.error('[capture] onFrame lançou:', e);
            }
          }
          if (stopped) break;
        }
      } catch (e) {
        errors++;
        console.error('[capture] fonte falhou:', e);
      } finally {
        // Vale para os três caminhos de saída (fim da fonte, stop, erro): o que
        // ficou no ring não vai ser processado, e segurar `VideoFrame` vivo
        // estanca a pipeline de decode do navegador.
        drenar();
      }
    },
    stop(): void {
      stopped = true;
    },
    stats(): CaptureLoopStats {
      return { framesCaptured, errors, stopped };
    },
  };
  return loop;
}
