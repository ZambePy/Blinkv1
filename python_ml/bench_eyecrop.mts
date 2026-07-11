/**
 * bench_eyecrop.mts — micro-benchmark de extractCrops() via node-canvas.
 *
 * Mede o custo de CPU puro de extractCrops() (canvas crop + resize + RGBA→RGB)
 * em ~120 iterações: 30 warmup descartadas, 90 medidas.
 * Roda em Node.js com tsx (sem Electron), mas usa o mesmo código TypeScript real.
 *
 * No Electron/Chromium, drawImage é acelerado por GPU — este número é o
 * PIOR CASO (CPU puro, sem GPU). O número real em produção deve ser menor.
 *
 * Uso:
 *   npx tsx python_ml/bench_eyecrop.mts
 */

import { Canvas, ImageData, createCanvas } from 'canvas';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { performance } from 'perf_hooks';

// Polyfill antes de importar eyeCrop
(globalThis as unknown as Record<string, unknown>).OffscreenCanvas = Canvas;

// tsx resolve o import a partir da raiz do projeto
const { extractCrops } = await import('../src/eyeCrop.js');

const FX = resolve(import.meta.dirname, '..', 'python_ml', 'test_fixtures');

// ── Carrega imagem de referência ──────────────────────────────────────────────
const dims  = JSON.parse(readFileSync(`${FX}/image_dims.json`, 'utf8')) as { width: number; height: number };
const imgW  = dims.width;
const imgH  = dims.height;
const rgb   = new Uint8Array(readFileSync(`${FX}/raw_image_rgb.bin`));

const rgba = new Uint8ClampedArray(imgW * imgH * 4);
for (let i = 0; i < imgW * imgH; i++) {
  rgba[i * 4]     = rgb[i * 3];
  rgba[i * 4 + 1] = rgb[i * 3 + 1];
  rgba[i * 4 + 2] = rgb[i * 3 + 2];
  rgba[i * 4 + 3] = 255;
}

const srcCanvas = createCanvas(imgW, imgH);
srcCanvas.getContext('2d').putImageData(new ImageData(rgba, imgW, imgH), 0, 0);

const landmarks = JSON.parse(readFileSync(`${FX}/landmarks.json`, 'utf8')) as Array<{ x: number; y: number; z: number }>;
while (landmarks.length < 478) landmarks.push({ x: 0.5, y: 0.5, z: 0 });

// ── Benchmark ─────────────────────────────────────────────────────────────────
const WARMUP = 30;
const RUNS   = 90;
const times: number[] = [];

console.log(`Aquecendo (${WARMUP} iterações)...`);
for (let i = 0; i < WARMUP; i++) {
  extractCrops(srcCanvas as unknown as CanvasImageSource, landmarks, imgW, imgH);
}

console.log(`Medindo (${RUNS} iterações)...`);
for (let i = 0; i < RUNS; i++) {
  const t0 = performance.now();
  extractCrops(srcCanvas as unknown as CanvasImageSource, landmarks, imgW, imgH);
  times.push(performance.now() - t0);
}

times.sort((a, b) => a - b);
const sum  = times.reduce((a, b) => a + b, 0);
const avg  = sum / times.length;
const min  = times[0];
const max  = times[times.length - 1];
const p50  = times[Math.floor(times.length * 0.50)];
const p95  = times[Math.floor(times.length * 0.95)];
const p99  = times[Math.floor(times.length * 0.99)];

console.log('\n=== extractCrops() timing (node-canvas / Cairo, CPU puro) ===');
console.log(`  imagem:   ${imgW}x${imgH} -> face 224x224 + 2x eye 112x112`);
console.log(`  iterações: ${RUNS} (após ${WARMUP} warmup)`);
console.log(`  min  : ${min.toFixed(2)} ms`);
console.log(`  avg  : ${avg.toFixed(2)} ms`);
console.log(`  p50  : ${p50.toFixed(2)} ms`);
console.log(`  p95  : ${p95.toFixed(2)} ms`);
console.log(`  p99  : ${p99.toFixed(2)} ms`);
console.log(`  max  : ${max.toFixed(2)} ms`);
console.log('');
console.log('Nota: no Electron/Chromium com GPU, drawImage é acelerado — este');
console.log('número (Cairo CPU) é o limite superior do custo de rendering.');
