// Web Worker do L2CS (E4 do L2CS-NET.md).
// Carrega o ONNX via onnxruntime-web e roda inferência assíncrona a pedido do
// client.ts. Nunca é chamado pelo loop rAF diretamente — o worker existe
// justamente para não bloquear o loop principal (ResNet-50 @ 448² ≈ 16 GFLOPs,
// ~100 ms em CPU/WASM; não cabe em 33 ms de um frame).
//
// Estratégia de carregamento:
// Os artefatos do ORT (ort.wasm.bundle.min.mjs + wasm) são copiados para
// frontend/public/ort/ e servidos como arquivos estáticos. Isso evita todos os
// problemas de resolução de módulo do Vite dentro de Web Workers (import.meta.url,
// optimizeDeps, etc). O dynamic import abaixo funciona em qualquer contexto de worker.
//
// Nota: usamos o bundle **wasm-only** (não o "all" bundle) porque o "all"
// tenta carregar ort-wasm-simd-threaded.jsep.mjs por caminho absoluto puro
// ("/ort/…jsep.mjs"), e esse import() dinâmico falha dentro de um Worker
// servido pelo Vite dev-server ("Failed to fetch dynamically imported module"),
// mesmo com o arquivo devolvendo 200 OK via HTTP. O wasm-only usa o
// ort-wasm-simd-threaded.mjs simples (24 KB) e resolve o problema.

/// <reference lib="webworker" />

import { decodeAngleDeg, degToRad } from './decode';
import type { L2CSModelMeta, L2CSWorkerRequest, L2CSWorkerResponse } from './types';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let session: any = null;
let meta: L2CSModelMeta | null = null;

function post(msg: L2CSWorkerResponse, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) ctx.postMessage(msg, transfer);
  else ctx.postMessage(msg);
}

async function init(modelUrl: string, metaUrl: string): Promise<void> {
  // Usa o bundle WASM-only (sem JSEP/WebGPU). O bundle "all" (ort.bundle.min.mjs)
  // tenta carregar ort-wasm-simd-threaded.jsep.mjs mesmo quando só pedimos
  // executionProviders: ['wasm']; e o import() dinâmico daquele .jsep.mjs
  // por caminho absoluto ("/ort/…jsep.mjs") falha silenciosamente dentro de
  // Worker sob o dev-server do Vite ("Failed to fetch dynamically imported module"),
  // mesmo com o arquivo respondendo 200 OK via curl. O wasm-only carrega o
  // ort-wasm-simd-threaded.mjs simples (24 KB vs 46 KB) e resolve o problema.
  const ortUrl = location.origin + '/ort/ort.wasm.bundle.min.mjs';
  const ort = await import(/* @vite-ignore */ ortUrl) as any;
  const ortApi = ort.default || ort;

  // wasmPaths precisa ser URL ABSOLUTA (com origin). Se passarmos só '/ort/',
  // a resolução interna do ORT (`new URL(name, '/ort/')`) lança porque '/ort/'
  // não é uma URL absoluta — o ORT então cai no fallback de concatenar strings
  // e devolve '/ort/…mjs', que o import() dinâmico no Worker rejeita.
  ortApi.env.wasm.wasmPaths = location.origin + '/ort/';
  // Uma thread — evita SharedArrayBuffer (que exige headers COOP/COEP que o
  // Vite dev não serve por default).
  ortApi.env.wasm.numThreads = 1;

  console.log('[L2CS] ort loaded, InferenceSession:', typeof ortApi.InferenceSession);

  const [metaResp, modelResp] = await Promise.all([
    fetch(metaUrl),
    fetch(modelUrl),
  ]);
  if (!metaResp.ok) throw new Error(`meta HTTP ${metaResp.status}`);
  if (!modelResp.ok) throw new Error(`model HTTP ${modelResp.status}`);

  const rawMeta = (await metaResp.json()) as L2CSModelMeta;
  const modelBuf = new Uint8Array(await modelResp.arrayBuffer());

  // WASM only — sem JSEP/WebGPU para evitar dependência de COOP/COEP.
  session = await ortApi.InferenceSession.create(modelBuf, {
    executionProviders: ['wasm'],
    graphOptimizationLevel: 'all',
  });
  meta = rawMeta;

  post({ type: 'ready', meta: rawMeta });
}

async function infer(id: number, tensor: Float32Array): Promise<void> {
  if (!session || !meta) throw new Error('worker not initialized');

  const size = meta.inputSize;

  // Importa Tensor do mesmo bundle que usamos no init (já em cache pelo runtime)
  const ortUrl = location.origin + '/ort/ort.wasm.bundle.min.mjs';
  const ort = await import(/* @vite-ignore */ ortUrl) as any;
  const ortApi = ort.default || ort;

  const input = new ortApi.Tensor('float32', tensor, [1, 3, size, size]);
  const t0 = performance.now();
  const out = await session.run({ [meta.inputTensorName]: input });
  const dt = performance.now() - t0;

  const yawOut = out[meta.outputTensorNames.yaw];
  const pitchOut = out[meta.outputTensorNames.pitch];
  const yawDeg = decodeAngleDeg(yawOut.data as Float32Array, meta.binWidth, meta.binOffset);
  const pitchDeg = decodeAngleDeg(pitchOut.data as Float32Array, meta.binWidth, meta.binOffset);

  post({
    type: 'result',
    id,
    yaw: degToRad(yawDeg),
    pitch: degToRad(pitchDeg),
    inferenceMs: dt,
  });
}

ctx.addEventListener('message', async (ev: MessageEvent<L2CSWorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      await init(msg.modelUrl, msg.metaUrl);
    } else if (msg.type === 'infer') {
      await infer(msg.id, msg.tensor);
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (msg.type === 'init') post({ type: 'init_error', error });
    else if (msg.type === 'infer') post({ type: 'infer_error', id: msg.id, error });
  }
});
