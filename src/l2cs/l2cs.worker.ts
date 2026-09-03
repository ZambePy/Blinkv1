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

import { decodeAngleWithConfidence, degToRad } from './decode';
import { tamanhoDoTensor } from './crop';
import type { L2CSModelMeta, L2CSWorkerRequest, L2CSWorkerResponse } from './types';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let session: any = null;
let meta: L2CSModelMeta | null = null;

function post(msg: L2CSWorkerResponse, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) ctx.postMessage(msg, transfer);
  else ctx.postMessage(msg);
}

/**
 * Importação memorizada do runtime do ORT (P5.5, passo 3).
 *
 * Guarda a PROMESSA, não o valor resolvido: assim duas inferências disparadas
 * antes da primeira resolver compartilham a mesma importação. Guardar só o
 * valor deixaria uma janela em que ambas importam.
 */
let ortApiPromise: Promise<any> | null = null;

function obterOrtApi(bundle = BUNDLES.wasm): Promise<any> {
  if (!ortApiPromise) {
    const ortUrl = location.origin + bundle;
    ortApiPromise = import(/* @vite-ignore */ ortUrl)
      .then((m: any) => m.default || m)
      .catch((e) => {
        // Não deixa a promessa rejeitada memorizada: uma falha transitória de
        // rede travaria o worker para o resto da sessão.
        ortApiPromise = null;
        throw e;
      });
  }
  return ortApiPromise;
}

/**
 * Bundle do ORT por execution provider (P5.5, passo 2).
 *
 * `wasm` usa o bundle wasm-only. O comentário do cabeçalho registra por quê: o
 * bundle "all" tenta carregar `ort-wasm-simd-threaded.jsep.mjs` por caminho
 * absoluto e o `import()` dinâmico falhava dentro de Worker sob o dev-server do
 * Vite, mesmo com o arquivo respondendo 200. O wasm-only evita esse caminho.
 *
 * `webgpu` PRECISA do bundle "all" — é ele que traz o JSEP. Ou seja, medir
 * WebGPU passa obrigatoriamente pelo caminho que já falhou uma vez. Se falhar
 * de novo, o erro tem que aparecer, não virar fallback silencioso.
 */
const BUNDLES: Record<string, string> = {
  wasm: '/ort/ort.wasm.bundle.min.mjs',
  webgpu: '/ort/ort.all.bundle.min.mjs',
};

async function init(
  modelUrl: string,
  metaUrl: string,
  executionProvider: 'wasm' | 'webgpu' = 'wasm',
): Promise<void> {
  // Usa o bundle WASM-only (sem JSEP/WebGPU). O bundle "all" (ort.bundle.min.mjs)
  // tenta carregar ort-wasm-simd-threaded.jsep.mjs mesmo quando só pedimos
  // executionProviders: ['wasm']; e o import() dinâmico daquele .jsep.mjs
  // por caminho absoluto ("/ort/…jsep.mjs") falha silenciosamente dentro de
  // Worker sob o dev-server do Vite ("Failed to fetch dynamically imported module"),
  // mesmo com o arquivo respondendo 200 OK via curl. O wasm-only carrega o
  // ort-wasm-simd-threaded.mjs simples (24 KB vs 46 KB) e resolve o problema.
  // P5.5 — mesma importação memorizada que `infer` usa. Ter duas chamadas de
  // `import()` para a mesma URL funcionava (o runtime cacheia), mas deixava
  // duas cópias da lógica de URL que podiam divergir.
  const ortApi = await obterOrtApi(BUNDLES[executionProvider] ?? BUNDLES.wasm);

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

  // ── Criação da sessão, com o provider pedido ────────────────────────────
  //
  // ⚠️ SEM FALLBACK SILENCIOSO. Se o WebGPU falhar, o erro sobe.
  //
  // O ORT aceita uma LISTA de providers e cai para o próximo sozinho quando o
  // primeiro não inicializa. Para uso normal isso é bom; para MEDIR é
  // desastroso: pedir `['webgpu', 'wasm']` e receber wasm em silêncio faria a
  // medição comparar wasm contra wasm, e o resultado — inevitavelmente "igual"
  // — seria lido como "a GPU não ajudou". A conclusão exatamente invertida,
  // com dado de aparência boa.
  //
  // Por isso pedimos UM provider só, e reportamos qual ficou ativo.
  const providers = executionProvider === 'webgpu' ? ['webgpu'] : ['wasm'];
  session = await ortApi.InferenceSession.create(modelBuf, {
    executionProviders: providers,
    graphOptimizationLevel: 'all',
  });
  meta = rawMeta;

  // O ORT não expõe de forma padronizada qual provider a sessão usou. O que dá
  // para afirmar com honestidade: a criação NÃO lançou com a lista de um
  // provider só, então foi ele. Se o ORT algum dia passar a cair para outro
  // silenciosamente mesmo com lista unitária, esta afirmação quebra — e o
  // campo `requested` no `ready` deixa a comparação possível do outro lado.
  const ativo = providers[0];
  console.log(`[L2CS] sessão criada com executionProvider='${ativo}' (pedido: '${executionProvider}')`);

  post({ type: 'ready', meta: rawMeta, executionProvider: ativo, requested: executionProvider });
}

async function infer(id: number, tensor: Float32Array): Promise<void> {
  if (!session || !meta) throw new Error('worker not initialized');

  // P5.5a — o lado vem DO TENSOR, não de `meta.inputSize`.
  //
  // Enquanto o modelo só aceitava 448 as duas fontes não podiam divergir. Com
  // eixos dinâmicos no ONNX, podem: se `crop.ts` produzir 224² e o meta disser
  // 448, este `Tensor` seria declarado `[1,3,448,448]` sobre um buffer de
  // 3·224² floats. Um buffer de 3·N² floats admite um único N — derivar daí
  // torna a divergência impossível em vez de exigir sincronia.
  const size = tamanhoDoTensor(tensor);
  if (meta.inputSize && meta.inputSize !== size) {
    // Não é erro: o meta declara o tamanho de referência, e a flag
    // `l2csInputSize` pode ter escolhido outro. Vale registrar uma vez porque,
    // se aparecer sem ninguém ter mexido na flag, alguma coisa está errada.
    console.info(`[l2cs.worker] crop em ${size}² (meta declara ${meta.inputSize}²).`);
  }

  // P5.5 (passo 3) — o `ortApi` é CACHEADO, não reimportado por inferência.
  //
  // O código anterior fazia `await import(ortUrl)` dentro de `infer`, ou seja,
  // a cada inferência. O módulo já está no cache do runtime, então não havia
  // download — mas havia resolução de URL e, principalmente, um `await` que
  // empurra a inferência para o próximo tick de microtask. Num caminho que roda
  // a 10 Hz isso é pequeno; num que se quer levar para 30 Hz, é gratuito de
  // remover.
  //
  // A promessa é memorizada (não o valor), então chamadas concorrentes de
  // `infer` compartilham a mesma importação em vez de dispararem várias.
  const ortApi = await obterOrtApi();

  const input = new ortApi.Tensor('float32', tensor, [1, 3, size, size]);
  const t0 = performance.now();
  const out = await session.run({ [meta.inputTensorName]: input });
  const dt = performance.now() - t0;

  const yawOut = out[meta.outputTensorNames.yaw];
  const pitchOut = out[meta.outputTensorNames.pitch];
  const yawDecoded = decodeAngleWithConfidence(yawOut.data as Float32Array, meta.binWidth, meta.binOffset);
  const pitchDecoded = decodeAngleWithConfidence(pitchOut.data as Float32Array, meta.binWidth, meta.binOffset);

  // Confiança agregada = min(yaw, pitch). Ver comentário em L2CSGaze.
  const confidence = Math.min(yawDecoded.confidence, pitchDecoded.confidence);

  post({
    type: 'result',
    id,
    yaw: degToRad(yawDecoded.deg),
    pitch: degToRad(pitchDecoded.deg),
    confidence,
    inferenceMs: dt,
  });
}

ctx.addEventListener('message', async (ev: MessageEvent<L2CSWorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      await init(msg.modelUrl, msg.metaUrl, msg.executionProvider ?? 'wasm');
    } else if (msg.type === 'infer') {
      await infer(msg.id, msg.tensor);
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (msg.type === 'init') post({ type: 'init_error', error });
    else if (msg.type === 'infer') post({ type: 'infer_error', id: msg.id, error });
  }
});
