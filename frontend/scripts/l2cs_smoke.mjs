// Smoke test para o ONNX do L2CS.
// Requer onnxruntime-node (não é dep de runtime — instalar sob demanda):
//   npm install --no-save onnxruntime-node
//   node scripts/l2cs_smoke.mjs
import * as ort from 'onnxruntime-node';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelPath = path.resolve(__dirname, '../public/models/l2cs/l2cs_gaze360.onnx');

console.log(`[smoke] Loading: ${modelPath}`);
const buf = await readFile(modelPath);
console.log(`[smoke] File size: ${(buf.byteLength / 1024 / 1024).toFixed(2)} MB`);

const session = await ort.InferenceSession.create(buf);

console.log('\n[smoke] === MODEL METADATA ===');
console.log('Input names :', session.inputNames);
console.log('Output names:', session.outputNames);

for (const name of session.inputNames) {
  const meta = session.inputMetadata[name] ?? session.handler?.inputMetadata?.[name];
  console.log(`  input  "${name}"  meta:`, JSON.stringify(meta));
}
for (const name of session.outputNames) {
  const meta = session.outputMetadata[name] ?? session.handler?.outputMetadata?.[name];
  console.log(`  output "${name}"  meta:`, JSON.stringify(meta));
}

console.log('\n[smoke] === DUMMY INFERENCE (zeros @ 1x3x448x448) ===');
const dummy = new Float32Array(1 * 3 * 448 * 448);
const input = new ort.Tensor('float32', dummy, [1, 3, 448, 448]);

const t0 = performance.now();
const out = await session.run({ [session.inputNames[0]]: input });
const dt = performance.now() - t0;

for (const name of session.outputNames) {
  const t = out[name];
  const data = t.data;
  const sample = Array.from(data.slice(0, 5)).map((v) => Number(v).toFixed(3));
  console.log(`  "${name}" dims=${JSON.stringify(t.dims)} first5=[${sample.join(', ')}]`);
}
console.log(`\n[smoke] Inference latency: ${dt.toFixed(1)} ms`);
console.log('[smoke] OK');
