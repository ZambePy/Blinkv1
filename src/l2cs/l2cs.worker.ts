// Web Worker do L2CS-Net.
//
// Carrega o ONNX via onnxruntime-web e roda a inferência a pedido do client.
// Existe para a ResNet-50 nunca bloquear o loop principal.
//
// Os artefatos do ORT ficam em frontend/public/ort/ e são importados por URL,
// o que evita a resolução de módulos do Vite dentro de Workers. O bundle
// wasm-only serve o provider `wasm`; o bundle "all" traz o JSEP necessário
// para `webgpu`.

/// <reference lib="webworker" />

import { decodeAngleWithConfidence, degToRad } from './decode';
import { tamanhoDoTensor } from './crop';
import type { L2CSModelMeta, L2CSWorkerRequest, L2CSWorkerResponse } from './types';

const ctx = self as unknown as DedicatedWorkerGlobalScope;

let session: any = null;
let meta: L2CSModelMeta | null = null;
let ortApi: any = null;

function post(msg: L2CSWorkerResponse, transfer?: Transferable[]): void {
  if (transfer && transfer.length > 0) ctx.postMessage(msg, transfer);
  else ctx.postMessage(msg);
}

// Diretório dos artefatos do ORT. Vem do client, resolvido contra a PÁGINA:
// aqui dentro `location.href` é a URL do próprio script do worker (em
// `assets/` no build, em `/@fs/...` no dev-server), e `ort/` relativo a ela
// apontaria para um lugar onde não há nada. O fallback contra a origem cobre
// um client antigo que não mande o campo (só vale em http, não em file://).
let ortDir = new URL('/ort/', location.href).href;
const BUNDLES = {
  wasm: 'ort.wasm.bundle.min.mjs',
  webgpu: 'ort.all.bundle.min.mjs',
} as const;

async function carregarOrt(provider: 'wasm' | 'webgpu'): Promise<any> {
  const m = await import(/* @vite-ignore */ ortDir + BUNDLES[provider]);
  const api = m.default || m;
  api.env.wasm.wasmPaths = ortDir;
  // Uma thread: evita SharedArrayBuffer, que exige cabeçalhos COOP/COEP.
  api.env.wasm.numThreads = 1;
  return api;
}

async function webgpuDisponivel(): Promise<boolean> {
  const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return (await gpu.requestAdapter()) !== null;
  } catch {
    return false;
  }
}

async function criarSessao(modelBuf: Uint8Array, provider: 'wasm' | 'webgpu'): Promise<void> {
  ortApi = await carregarOrt(provider);
  // Um provider só na lista: o ORT cai para o próximo em silêncio quando o
  // primeiro falha, e aqui o fallback precisa ser explícito e registrado.
  session = await ortApi.InferenceSession.create(modelBuf, {
    executionProviders: [provider],
    graphOptimizationLevel: 'all',
  });
}

async function init(
  modelUrl: string,
  metaUrl: string,
  pedido: 'auto' | 'webgpu' | 'wasm',
): Promise<void> {
  const [metaResp, modelResp] = await Promise.all([fetch(metaUrl), fetch(modelUrl)]);
  if (!metaResp.ok) throw new Error(`meta HTTP ${metaResp.status}`);
  if (!modelResp.ok) throw new Error(`model HTTP ${modelResp.status}`);
  const rawMeta = (await metaResp.json()) as L2CSModelMeta;
  const modelBuf = new Uint8Array(await modelResp.arrayBuffer());

  let ativo: 'webgpu' | 'wasm';
  let fallback = false;
  if (pedido === 'auto') {
    if (await webgpuDisponivel()) {
      try {
        await criarSessao(modelBuf, 'webgpu');
        ativo = 'webgpu';
      } catch (e) {
        console.warn('[L2CS] sessão WebGPU falhou, caindo para WASM:', e);
        await criarSessao(modelBuf, 'wasm');
        ativo = 'wasm';
        fallback = true;
      }
    } else {
      await criarSessao(modelBuf, 'wasm');
      ativo = 'wasm';
      fallback = true;
    }
  } else {
    await criarSessao(modelBuf, pedido);
    ativo = pedido;
  }

  meta = rawMeta;
  console.log(`[L2CS] sessão criada com executionProvider='${ativo}' (pedido: '${pedido}')`);
  post({ type: 'ready', meta: rawMeta, executionProvider: ativo, requested: pedido, fallback });
}

async function infer(id: number, tensor: Float32Array): Promise<void> {
  if (!session || !meta || !ortApi) throw new Error('worker not initialized');

  // O lado vem do próprio tensor: um buffer de 3·N² floats admite um único N.
  const size = tamanhoDoTensor(tensor);
  const input = new ortApi.Tensor('float32', tensor, [1, 3, size, size]);
  const t0 = performance.now();
  const out = await session.run({ [meta.inputTensorName]: input });
  const dt = performance.now() - t0;

  const yawOut = out[meta.outputTensorNames.yaw];
  const pitchOut = out[meta.outputTensorNames.pitch];
  const yaw = decodeAngleWithConfidence(yawOut.data as Float32Array, meta.binWidth, meta.binOffset);
  const pitch = decodeAngleWithConfidence(pitchOut.data as Float32Array, meta.binWidth, meta.binOffset);

  post({
    type: 'result',
    id,
    yaw: degToRad(yaw.deg),
    pitch: degToRad(pitch.deg),
    // O eixo pior é o gargalo, por isso min e não média.
    confidence: Math.min(yaw.confidence, pitch.confidence),
    inferenceMs: dt,
  });
}

ctx.addEventListener('message', async (ev: MessageEvent<L2CSWorkerRequest>) => {
  const msg = ev.data;
  try {
    if (msg.type === 'init') {
      if (msg.ortBaseUrl) ortDir = msg.ortBaseUrl.endsWith('/') ? msg.ortBaseUrl : `${msg.ortBaseUrl}/`;
      await init(msg.modelUrl, msg.metaUrl, msg.provider);
    } else if (msg.type === 'infer') {
      await infer(msg.id, msg.tensor);
    }
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    if (msg.type === 'init') post({ type: 'init_error', error });
    else if (msg.type === 'infer') post({ type: 'infer_error', id: msg.id, error });
  }
});
