// @vitest-environment node
/**
 * eyeCrop.pixel.test.ts
 *
 * Gate de paridade REAL: executa o código TypeScript de eyeCrop.ts com
 * uma implementação de Canvas verdadeira (node-canvas / Cairo), sobre a
 * imagem fixa p00/day01/0005.jpg, e compara os 4 tensores produzidos
 * contra os fixtures gerados por generate_crop_reference.py (Python/cv2).
 *
 * O OffscreenCanvas do browser é polyfillado com Canvas do node-canvas
 * (mesmo backend Cairo que o Chromium usa em modo headless).
 *
 * Pré-requisito: python generate_crop_reference.py já rodou e os fixtures
 * existem em python_ml/test_fixtures/.
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { Canvas, ImageData, createCanvas } from 'canvas';
import { readFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

// ── Polyfill OffscreenCanvas com node-canvas ANTES de chamar extractCrops ────
// new OffscreenCanvas(w, h) vira new Canvas(w, h) do node-canvas.
(globalThis as unknown as Record<string, unknown>).OffscreenCanvas = Canvas;

// Importado APÓS o polyfill — a função usa OffscreenCanvas só quando chamada,
// não em tempo de import, portanto a ordem aqui é segura.
import { extractCrops, getEyeCropFailureLog } from './eyeCrop';
import type { EncoderInput } from './irisflow-api';

// ── Paths ─────────────────────────────────────────────────────────────────────

const FX = resolve(process.cwd(), 'python_ml', 'test_fixtures');

// ── Helpers ───────────────────────────────────────────────────────────────────

function fixturesExist(): boolean {
  return [
    'raw_image_rgb.bin', 'image_dims.json', 'landmarks.json',
    'face_f32.bin', 'left_eye_f32.bin', 'right_eye_f32.bin', 'rect_ref.json',
  ].every(f => existsSync(join(FX, f)));
}

function loadF32Fixture(name: string, shape: [number, number, number]): Float32Array {
  const buf = readFileSync(join(FX, name));
  const expected = shape[0] * shape[1] * shape[2];
  if (buf.byteLength !== expected * 4) {
    throw new Error(`${name}: expected ${expected * 4} bytes, got ${buf.byteLength}`);
  }
  return new Float32Array(buf.buffer, buf.byteOffset, expected);
}

function maxAbsDiff(a: Float32Array, b: Float32Array): number {
  let max = 0;
  for (let i = 0; i < a.length; i++) {
    const d = Math.abs(a[i] - b[i]);
    if (d > max) max = d;
  }
  return max;
}

// ── Test suite ────────────────────────────────────────────────────────────────

describe('eyeCrop.ts real Canvas output vs Python reference', () => {
  let result: EncoderInput | null = null;
  let faceRef: Float32Array;
  let leRef:   Float32Array;
  let reRef:   Float32Array;
  let rectRef: number[];

  beforeAll(() => {
    if (!fixturesExist()) {
      throw new Error(
        'Fixtures ausentes. Execute: python python_ml/generate_crop_reference.py'
      );
    }

    // ── Carrega referências Python ───────────────────────────────────────────
    faceRef  = loadF32Fixture('face_f32.bin',      [224, 224, 3]);
    leRef    = loadF32Fixture('left_eye_f32.bin',  [112, 112, 3]);
    reRef    = loadF32Fixture('right_eye_f32.bin', [112, 112, 3]);
    rectRef  = JSON.parse(readFileSync(join(FX, 'rect_ref.json'), 'utf8')) as number[];

    // ── Carrega imagem e cria Canvas de origem (node-canvas) ─────────────────
    const dims  = JSON.parse(readFileSync(join(FX, 'image_dims.json'), 'utf8')) as { width: number; height: number };
    const imgW  = dims.width;
    const imgH  = dims.height;
    const rgb   = new Uint8Array(readFileSync(join(FX, 'raw_image_rgb.bin')));

    // Raw bytes são HxWx3 RGB. Canvas espera RGBA.
    const rgba = new Uint8ClampedArray(imgW * imgH * 4);
    for (let i = 0; i < imgW * imgH; i++) {
      rgba[i * 4]     = rgb[i * 3];
      rgba[i * 4 + 1] = rgb[i * 3 + 1];
      rgba[i * 4 + 2] = rgb[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    }

    const srcCanvas = createCanvas(imgW, imgH);
    srcCanvas.getContext('2d').putImageData(new ImageData(rgba, imgW, imgH), 0, 0);

    // ── Carrega landmarks e normaliza para 478 pontos ────────────────────────
    // FaceMesh (soluções legadas, refine_landmarks=False) entrega 468 pontos.
    // FaceLandmarker (tasks-vision, produção) entrega 478 (468 + 10 iris).
    // Os índices que usamos (33, 133, 145, 159, 263, 362, 374, 386) são todos
    // < 400, portanto os 10 pontos extras de iris (468-477) não afetam nada.
    // Pademos com (0.5, 0.5, 0) — dentro da face, não expande nenhum bbox.
    const landmarks = JSON.parse(readFileSync(join(FX, 'landmarks.json'), 'utf8')) as Array<{ x: number; y: number; z: number }>;
    while (landmarks.length < 478) {
      landmarks.push({ x: 0.5, y: 0.5, z: 0 });
    }

    // ── Executa o TypeScript real ─────────────────────────────────────────────
    const failureBefore = getEyeCropFailureLog().length;
    result = extractCrops(
      srcCanvas as unknown as CanvasImageSource,
      landmarks,
      imgW,
      imgH,
    );
    if (result === null) {
      const newEntries = getEyeCropFailureLog().slice(failureBefore);
      console.error('[debug] extractCrops retornou null. Falhas:', JSON.stringify(newEntries));
    }
  });

  // ── Sanity ────────────────────────────────────────────────────────────────

  it('extractCrops() não retorna null (face detectada via landmarks do fixture)', () => {
    expect(result).not.toBeNull();
  });

  it('face tem 224*224*3 = 150528 floats', () => {
    expect(result!.face.length).toBe(224 * 224 * 3);
  });

  it('leftEye tem 112*112*3 = 37632 floats', () => {
    expect(result!.leftEye.length).toBe(112 * 112 * 3);
  });

  it('rightEye tem 112*112*3 = 37632 floats (espelhado)', () => {
    expect(result!.rightEye.length).toBe(112 * 112 * 3);
  });

  it('rect tem 12 floats', () => {
    expect(result!.rect.length).toBe(12);
  });

  // ── Rect: deve ser exato (pura geometria, sem rendering) ─────────────────

  it('rect bate exatamente com referência Python (geometria pura)', () => {
    for (let i = 0; i < 12; i++) {
      expect(result!.rect[i]).toBeCloseTo(rectRef[i], 5);
    }
  });

  // ── Pixels: tolerância para diferença entre Cairo bilinear e cv2 INTER_LINEAR

  it('face_f32: max abs diff vs Python < 6/255 (Cairo vs cv2 bilinear)', () => {
    const diff = maxAbsDiff(result!.face, faceRef);
    console.log(`  face_f32 max diff: ${diff.toFixed(4)} = ${(diff * 255).toFixed(1)}/255`);
    expect(diff).toBeLessThan(6 / 255);
  });

  it('left_eye_f32: max abs diff vs Python < 6/255', () => {
    const diff = maxAbsDiff(result!.leftEye, leRef);
    console.log(`  left_eye_f32 max diff: ${diff.toFixed(4)} = ${(diff * 255).toFixed(1)}/255`);
    expect(diff).toBeLessThan(6 / 255);
  });

  it('right_eye_f32 (espelhado): max abs diff vs Python < 6/255', () => {
    const diff = maxAbsDiff(result!.rightEye, reRef);
    console.log(`  right_eye_f32 max diff: ${diff.toFixed(4)} = ${(diff * 255).toFixed(1)}/255`);
    expect(diff).toBeLessThan(6 / 255);
  });

  // ── Valores no range [0, 1] — verificação única (não 300k expects) ──────

  it('todos os valores de face estão em [0, 1]', () => {
    const face = result!.face;
    let minV = Infinity, maxV = -Infinity;
    for (let i = 0; i < face.length; i++) {
      if (face[i] < minV) minV = face[i];
      if (face[i] > maxV) maxV = face[i];
    }
    expect(minV).toBeGreaterThanOrEqual(0);
    expect(maxV).toBeLessThanOrEqual(1);
  });
});
