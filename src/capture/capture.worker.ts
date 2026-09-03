/// <reference lib="webworker" />

// P4.2 — casca do worker de captura.
//
// ⚠️ ESTE ARQUIVO NÃO É COBERTO POR TESTE, e isso é deliberado.
//
// Tudo que dá para decidir sem browser está em `captureWorker.ts`, que é puro e
// testado: a escolha de estratégia e o laço de consumo. O que sobra aqui é o
// que só existe dentro de um Worker real — `MediaStreamTrackProcessor`,
// `ReadableStream` de `VideoFrame`, `postMessage` com transferables. Testar
// isso em jsdom exigiria mocar as três coisas, e um teste assim provaria que os
// mocks funcionam, não que a captura funciona.
//
// A verificação desta casca é de runtime, no Dia 7, com `T0.5` medindo o
// estágio de captura no thread principal antes e depois. Enquanto isso não
// acontecer, a flag `captureWorker` fica desligada por default e este arquivo
// não entra em nenhum caminho de produção.
//
// ── Protocolo ────────────────────────────────────────────────────────────────
//
//   main → worker   { type: 'start', track: MediaStreamTrack }   (transferable)
//                   { type: 'stop' }
//   worker → main   { type: 'frame', bitmap: ImageBitmap, tCaptureMs }  (transfer)
//                   { type: 'stats', framesCaptured, dropped, occupancy }
//                   { type: 'error', message }
//
// O frame vai como `ImageBitmap` e não como `VideoFrame` porque o consumidor do
// outro lado é `drawImage` num canvas 2D, que aceita os dois — e `ImageBitmap`
// tem suporte mais amplo. A conversão acontece aqui, no worker, que é o ponto
// da tarefa: o custo fica fora do thread principal.

import { FrameRing } from './frameRing';
import { createCaptureLoop, type CaptureLoop } from './captureWorker';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/** Capacidade do ring dentro do worker. Igual à do lado principal: 3 frames a
 *  30 Hz = 100 ms de folga. */
const RING_CAPACITY = 3;

/** Intervalo de envio de estatísticas ao thread principal. 1 s é diagnóstico,
 *  não caminho quente — mandar por frame só geraria tráfego de postMessage. */
const STATS_INTERVAL_MS = 1000;

interface StartMessage {
  type: 'start';
  track: unknown; // MediaStreamTrack — o tipo real não existe no lib do worker
}
interface StopMessage { type: 'stop' }
type InboundMessage = StartMessage | StopMessage;

let loop: CaptureLoop | null = null;
let ring: FrameRing<ImageBitmap> | null = null;
let statsTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Converte o `ReadableStream<VideoFrame>` do `MediaStreamTrackProcessor` num
 * `AsyncIterable` no formato que o laço consome.
 *
 * O `VideoFrame` é fechado AQUI, logo depois de virar `ImageBitmap`: o bitmap é
 * a cópia que segue viagem, e segurar os dois seria dobrar o uso de memória de
 * vídeo por frame.
 */
async function* framesDoProcessor(
  readable: ReadableStream<VideoFrame>,
): AsyncGenerator<{ frame: ImageBitmap; tCaptureMs: number }> {
  const reader = readable.getReader();
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) return;
      if (!value) continue;
      // `timestamp` do VideoFrame é em microssegundos, na base de tempo da
      // track — não é `performance.now()`. Convertemos para ms e deixamos a
      // origem explícita: comparar isto com um `performance.now()` do thread
      // principal sem alinhar as bases é o bug B2.1 de novo, em outra roupa.
      const tCaptureMs = value.timestamp / 1000;
      try {
        const bitmap = await createImageBitmap(value);
        yield { frame: bitmap, tCaptureMs };
      } finally {
        value.close();
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function pararTudo(): void {
  loop?.stop();
  loop = null;
  if (statsTimer !== null) {
    clearInterval(statsTimer);
    statsTimer = null;
  }
  ring?.clear();
  ring = null;
}

function enviarStats(): void {
  if (!ring || !loop) return;
  const s = ring.stats();
  ctx.postMessage({
    type: 'stats',
    framesCaptured: loop.stats().framesCaptured,
    dropped: s.dropped,
    droppedOverflow: s.droppedOverflow,
    droppedStale: s.droppedStale,
    occupancy: s.occupancy,
    highWaterMark: s.highWaterMark,
  });
}

ctx.addEventListener('message', (ev: MessageEvent<InboundMessage>) => {
  const msg = ev.data;
  if (msg?.type === 'stop') {
    pararTudo();
    return;
  }
  if (msg?.type !== 'start') return;

  const Processor = (ctx as unknown as Record<string, unknown>).MediaStreamTrackProcessor as
    | (new (init: { track: unknown }) => { readable: ReadableStream<VideoFrame> })
    | undefined;
  if (!Processor) {
    // Não deveria acontecer: quem monta este worker já consultou
    // `planCaptureStrategy`. Mas se acontecer, o thread principal precisa saber
    // para voltar ao caminho de rVFC em vez de ficar esperando frames que nunca
    // chegam.
    ctx.postMessage({
      type: 'error',
      message: 'MediaStreamTrackProcessor indisponível dentro do worker',
    });
    return;
  }

  pararTudo();
  ring = new FrameRing<ImageBitmap>(RING_CAPACITY);
  const processor = new Processor({ track: msg.track });

  loop = createCaptureLoop<ImageBitmap>({
    source: framesDoProcessor(processor.readable),
    ring,
    onFrame: () => {
      // Política: sempre o mais recente. O `takeLatest` conta os anteriores
      // como obsoletos, então a estatística de descarte continua fechando.
      const f = ring?.takeLatest();
      if (!f) return;
      ctx.postMessage(
        { type: 'frame', bitmap: f.payload, tCaptureMs: f.tCaptureMs, seq: f.seq },
        [f.payload],
      );
    },
  });

  statsTimer = setInterval(enviarStats, STATS_INTERVAL_MS);
  void loop.run().then(() => {
    enviarStats();
    pararTudo();
  });
});
