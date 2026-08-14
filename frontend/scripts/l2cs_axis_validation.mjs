// Validação empírica de eixos do L2CS.
// Roda o modelo nas 3 fotos e verifica:
//   1. look_center → yaw ≈ 0, pitch ≈ 0
//   2. look_up     → pitch muda significativamente, yaw ≈ 0
//   3. look_right  → yaw muda significativamente, pitch ≈ 0
// E confirma qual sinal (positivo/negativo) corresponde a cada direção.
//
// Requer (instalar sob demanda):
//   npm install --no-save onnxruntime-node sharp
//   node scripts/l2cs_axis_validation.mjs

import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = path.resolve(__dirname, '../public/models/l2cs/l2cs_gaze360.onnx');
const META_PATH = path.resolve(__dirname, '../public/models/l2cs/l2cs.meta.json');
const PHOTO_DIR = path.resolve(__dirname, '../python_scripts/l2cs_validation');
const REPORT_PATH = path.resolve(PHOTO_DIR, 'axis_validation_report.json');

// ⚠️ CANONICAL: as constantes e a fórmula de normalização abaixo DEVEM bater
// com src/l2cs/crop.ts (INPUT_SIZE, IMAGENET_MEAN, IMAGENET_STD, layout NCHW,
// canal RGB). Este script é um "shadow implementation" em Node que serve
// só para validação empírica do modelo com sharp — o pipeline real do browser
// usa crop.ts. Se um mudar, o outro precisa mudar junto (unit tests de
// crop.test.ts pegariam divergência silenciosa da parte pura).
const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

// Crop central quadrado (~60% da menor dimensão) para pegar o rosto sem MediaPipe
// no Node. Nas fotos de validação o rosto está centralizado por design (guide
// oval no capture.html). No browser, o crop.ts calcula a bbox a partir dos 478
// landmarks do MediaPipe — mas o resultado após resize p/ 448 é equivalente
// para fotos onde o rosto ocupa ~60% e está centralizado.
const CENTER_CROP_RATIO = 0.6;

async function preprocess(filepath) {
  const meta = await sharp(filepath).metadata();
  const w = meta.width;
  const h = meta.height;
  const side = Math.floor(Math.min(w, h) * CENTER_CROP_RATIO);
  const left = Math.floor((w - side) / 2);
  const top = Math.floor((h - side) / 2);

  const { data } = await sharp(filepath)
    .extract({ left, top, width: side, height: side })
    .resize(448, 448, { fit: 'fill' })
    .removeAlpha()
    .raw() // RGBRGBRGB… HWC
    .toBuffer({ resolveWithObject: true });

  const px = 448 * 448;
  const chw = new Float32Array(3 * px);
  for (let i = 0; i < px; i++) {
    const r = data[i * 3] / 255;
    const g = data[i * 3 + 1] / 255;
    const b = data[i * 3 + 2] / 255;
    chw[i] = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    chw[px + i] = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
    chw[2 * px + i] = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
  }
  return { chw, srcW: w, srcH: h, cropSide: side };
}

function decodeAngleDeg(logits, binWidth, binOffset) {
  // softmax numericamente estável
  let maxV = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > maxV) maxV = logits[i];
  let sumExp = 0;
  const exps = new Float64Array(logits.length);
  for (let i = 0; i < logits.length; i++) {
    exps[i] = Math.exp(logits[i] - maxV);
    sumExp += exps[i];
  }
  let deg = 0;
  for (let i = 0; i < logits.length; i++) {
    const p = exps[i] / sumExp;
    deg += p * (i * binWidth + binOffset);
  }
  return deg;
}

const meta = JSON.parse(await readFile(META_PATH, 'utf-8'));
const binWidth = meta.binWidth;
// meta.binOffset = -180 significa o CENTRO do primeiro bin.
// A fórmula do doc é sum(p_i * i * binWidth + binOffset) — o offset já é ± binWidth/2 embutido.
// Para Gaze360 90×4 = 360°, faixa [-180, +180[.
const binOffset = meta.binOffset;

console.log(`[axis] Model: ${path.basename(MODEL_PATH)}`);
console.log(`[axis] Dataset: ${meta.dataset}  bins=${meta.outputBins} binWidth=${binWidth} offset=${binOffset}`);

const session = await ort.InferenceSession.create(await readFile(MODEL_PATH));

const shots = ['look_center', 'look_up', 'look_right'];
const results = {};

for (const shot of shots) {
  const filepath = path.join(PHOTO_DIR, shot + '.jpg');
  const { chw, srcW, srcH, cropSide } = await preprocess(filepath);
  const input = new ort.Tensor('float32', chw, [1, 3, 448, 448]);

  const t0 = performance.now();
  const out = await session.run({ [session.inputNames[0]]: input });
  const dt = performance.now() - t0;

  const yawDeg = decodeAngleDeg(out.yaw.data, binWidth, binOffset);
  const pitchDeg = decodeAngleDeg(out.pitch.data, binWidth, binOffset);

  results[shot] = {
    yawDeg: Number(yawDeg.toFixed(2)),
    pitchDeg: Number(pitchDeg.toFixed(2)),
    yawRad: Number((yawDeg * Math.PI / 180).toFixed(4)),
    pitchRad: Number((pitchDeg * Math.PI / 180).toFixed(4)),
    inferenceMs: Number(dt.toFixed(1)),
    src: { w: srcW, h: srcH, cropSide },
  };

  console.log(`\n[axis] ${shot}  (src ${srcW}×${srcH}, crop ${cropSide}²)`);
  console.log(`       yaw   = ${yawDeg.toFixed(2)}°`);
  console.log(`       pitch = ${pitchDeg.toFixed(2)}°`);
  console.log(`       latência = ${dt.toFixed(1)} ms`);
}

// Verdicts
console.log('\n[axis] === VEREDICTOS ===');

const center = results.look_center;
const up = results.look_up;
const right = results.look_right;

const CENTER_TOL_DEG = 10;
const MIN_DELTA_DEG = 5;

// Test 1: center should be ~0 on both axes
const centerOK = Math.abs(center.yawDeg) < CENTER_TOL_DEG && Math.abs(center.pitchDeg) < CENTER_TOL_DEG;
console.log(`[T1] center próximo de (0,0)?  ${centerOK ? 'OK' : 'FALHOU'}  (yaw=${center.yawDeg}°, pitch=${center.pitchDeg}°, tol=±${CENTER_TOL_DEG}°)`);

// Test 2: look_up moves pitch significantly, yaw stays near center
const upPitchDelta = up.pitchDeg - center.pitchDeg;
const upYawDelta = up.yawDeg - center.yawDeg;
const upAxisCorrect = Math.abs(upPitchDelta) > Math.abs(upYawDelta) && Math.abs(upPitchDelta) > MIN_DELTA_DEG;
console.log(`[T2] look_up mexe PITCH mais que YAW?  ${upAxisCorrect ? 'OK' : 'FALHOU'}  (Δpitch=${upPitchDelta.toFixed(2)}°, Δyaw=${upYawDelta.toFixed(2)}°)`);
const upPitchSign = upPitchDelta > 0 ? '+' : '−';
console.log(`     ➜ sinal de "olhar p/ cima" no pitch = ${upPitchSign}  (pitch>0 significa ${upPitchSign === '+' ? 'CIMA' : 'BAIXO'})`);

// Test 3: look_right moves yaw significantly, pitch stays near center
const rightYawDelta = right.yawDeg - center.yawDeg;
const rightPitchDelta = right.pitchDeg - center.pitchDeg;
const rightAxisCorrect = Math.abs(rightYawDelta) > Math.abs(rightPitchDelta) && Math.abs(rightYawDelta) > MIN_DELTA_DEG;
console.log(`[T3] look_right mexe YAW mais que PITCH?  ${rightAxisCorrect ? 'OK' : 'FALHOU'}  (Δyaw=${rightYawDelta.toFixed(2)}°, Δpitch=${rightPitchDelta.toFixed(2)}°)`);
const rightYawSign = rightYawDelta > 0 ? '+' : '−';
console.log(`     ➜ sinal de "olhar p/ direita" no yaw = ${rightYawSign}  (yaw>0 significa ${rightYawSign === '+' ? 'DIREITA' : 'ESQUERDA'})`);

const allOK = centerOK && upAxisCorrect && rightAxisCorrect;
console.log(`\n[axis] ${allOK ? '✅ TODOS OS TESTES PASSARAM' : '❌ ALGO FALHOU — revisar decoding/nomes de output/orientação da imagem'}`);

const report = {
  timestamp: new Date().toISOString(),
  model: path.basename(MODEL_PATH),
  meta: { dataset: meta.dataset, bins: meta.outputBins, binWidth, binOffset },
  results,
  verdicts: {
    centerOK,
    upAxisCorrect,
    rightAxisCorrect,
    upPitchDeltaDeg: Number(upPitchDelta.toFixed(2)),
    rightYawDeltaDeg: Number(rightYawDelta.toFixed(2)),
    upSignConvention: upPitchSign === '+' ? 'up_is_positive' : 'up_is_negative',
    rightSignConvention: rightYawSign === '+' ? 'right_is_positive' : 'right_is_negative',
  },
  allOK,
};
await writeFile(REPORT_PATH, JSON.stringify(report, null, 2));
console.log(`\n[axis] Relatório salvo em: ${REPORT_PATH}`);

process.exit(allOK ? 0 : 1);
