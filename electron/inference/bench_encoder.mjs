/**
 * bench_encoder.mjs - Sprint 3 gate: testa e mede o pipeline ONNX do encoder.
 *
 * Roda com Node.js diretamente (sem Electron):
 *   node electron/inference/bench_encoder.mjs
 *
 * Valida:
 *   - sessao ONNX carrega corretamente (mede tempo)
 *   - inferencia com tensores sinteticos retorna Float32Array de 256 valores
 *   - latencia de inferencia em regime "warm" (20 chamadas, relata min/max/media)
 */

import { createRequire } from 'node:module';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname  = path.dirname(__filename);
const require    = createRequire(import.meta.url);

// onnxruntime-node is CommonJS
const ort = require('onnxruntime-node');

const MODEL_PATH = path.join(__dirname, '..', '..', 'resources', 'models', 'gaze_encoder.onnx');
const WARM_CALLS = 20;

const FACE_LEN  = 224 * 224 * 3;
const EYE_LEN   = 112 * 112 * 3;
const RECT_LEN  = 12;

function syntheticInputs() {
  return {
    face:     new Float32Array(FACE_LEN).fill(0.5),
    leftEye:  new Float32Array(EYE_LEN).fill(0.5),
    rightEye: new Float32Array(EYE_LEN).fill(0.5),
    rect:     new Float32Array(RECT_LEN).fill(0.1),
  };
}

async function runInference(session, inputs) {
  const feeds = {
    face:      new ort.Tensor('float32', inputs.face,     [1, 224, 224, 3]),
    left_eye:  new ort.Tensor('float32', inputs.leftEye,  [1, 112, 112, 3]),
    right_eye: new ort.Tensor('float32', inputs.rightEye, [1, 112, 112, 3]),
    rect:      new ort.Tensor('float32', inputs.rect,     [1, 12]),
  };
  const result = await session.run(feeds);
  return result['embedding'].data;
}

async function main() {
  console.log('onnxruntime-node version:', ort.env.versions?.onnxruntime ?? '(unknown)');
  console.log('Modelo:', MODEL_PATH);
  console.log('Modelo existe:', existsSync(MODEL_PATH));
  console.log();

  if (!existsSync(MODEL_PATH)) {
    console.error('[FAIL] Modelo nao encontrado. Rode export_onnx.py e copie para resources/models/.');
    process.exit(1);
  }

  // --- Boot: carregamento da sessao ---
  console.log('[boot] Carregando sessao ONNX...');
  const bootStart = performance.now();
  const session = await ort.InferenceSession.create(MODEL_PATH, {
    executionProviders: ['cpu'],
  });
  const bootMs = performance.now() - bootStart;
  console.log('[boot] Sessao carregada em %.1f ms' .replace('%.1f', bootMs.toFixed(1)));
  console.log('[boot] Execution provider: cpu');
  console.log('[boot] Input names :', session.inputNames);
  console.log('[boot] Output names:', session.outputNames);
  console.log();

  // --- Inferencia inicial (pode ter overhead de compilacao JIT) ---
  const inputs = syntheticInputs();
  console.log('[warm-up] Rodando 1 chamada de aquecimento...');
  const warmupStart = performance.now();
  const warmupOut = await runInference(session, inputs);
  const warmupMs = performance.now() - warmupStart;
  console.log('[warm-up] %.1f ms, output length: %d'.replace('%.1f', warmupMs.toFixed(1)), warmupOut.length);

  if (warmupOut.length !== 256) {
    console.error('[FAIL] Esperado embedding de 256 valores, recebido:', warmupOut.length);
    process.exit(1);
  }
  console.log('[warm-up] [PASS] embedding tem 256 valores');
  console.log('[warm-up] primeiros 5 valores:', Array.from(warmupOut.slice(0, 5)).map(v => v.toFixed(6)));
  console.log();

  // --- Benchmark regime warm ---
  console.log('[bench] Rodando %d chamadas em regime warm...'.replace('%d', WARM_CALLS));
  const times = [];
  for (let i = 0; i < WARM_CALLS; i++) {
    const t0 = performance.now();
    await runInference(session, inputs);
    times.push(performance.now() - t0);
  }

  const avg = times.reduce((a, b) => a + b, 0) / times.length;
  const min = Math.min(...times);
  const max = Math.max(...times);

  console.log('[bench] Resultados (%d chamadas):'.replace('%d', WARM_CALLS));
  console.log('  media : %.1f ms'.replace('%.1f', avg.toFixed(1)));
  console.log('  min   : %.1f ms'.replace('%.1f', min.toFixed(1)));
  console.log('  max   : %.1f ms'.replace('%.1f', max.toFixed(1)));
  console.log();
  console.log('[done] Gate de validacao OK');
}

main().catch(err => {
  console.error('[ERROR]', err);
  process.exit(1);
});
