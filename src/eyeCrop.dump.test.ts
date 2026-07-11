// @vitest-environment node
/**
 * eyeCrop.dump.test.ts
 *
 * Utilitário de geração: executa eyeCrop.ts com node-canvas e salva os 3
 * tensores de pixel em python_ml/test_fixtures/ts_*.bin para que
 * validate_embedding_parity.py possa compará-los passando ambos pelo ONNX.
 *
 * Não é um teste de pass/fail — só falha se o setup estiver quebrado.
 * Rode sob demanda:
 *   npx vitest run src/eyeCrop.dump.test.ts
 */

import { beforeAll, describe, expect, it } from 'vitest';
import { Canvas, ImageData, createCanvas } from 'canvas';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, resolve } from 'path';

(globalThis as unknown as Record<string, unknown>).OffscreenCanvas = Canvas;

import { extractCrops } from './eyeCrop';
import type { EncoderInput } from './irisflow-api';

const FX = resolve(process.cwd(), 'python_ml', 'test_fixtures');

function f32ToBuffer(arr: Float32Array): Buffer {
  return Buffer.from(arr.buffer, arr.byteOffset, arr.byteLength);
}

describe('eyeCrop.ts tensor dump (para validate_embedding_parity.py)', () => {
  let result: EncoderInput | null = null;

  beforeAll(() => {
    if (!existsSync(join(FX, 'raw_image_rgb.bin'))) {
      throw new Error('Fixtures ausentes. Execute: python python_ml/generate_crop_reference.py');
    }

    const dims     = JSON.parse(readFileSync(join(FX, 'image_dims.json'), 'utf8')) as { width: number; height: number };
    const imgW     = dims.width;
    const imgH     = dims.height;
    const rgb      = new Uint8Array(readFileSync(join(FX, 'raw_image_rgb.bin')));
    const landmarks = JSON.parse(readFileSync(join(FX, 'landmarks.json'), 'utf8')) as Array<{ x: number; y: number; z: number }>;

    while (landmarks.length < 478) landmarks.push({ x: 0.5, y: 0.5, z: 0 });

    const rgba = new Uint8ClampedArray(imgW * imgH * 4);
    for (let i = 0; i < imgW * imgH; i++) {
      rgba[i * 4]     = rgb[i * 3];
      rgba[i * 4 + 1] = rgb[i * 3 + 1];
      rgba[i * 4 + 2] = rgb[i * 3 + 2];
      rgba[i * 4 + 3] = 255;
    }

    const srcCanvas = createCanvas(imgW, imgH);
    srcCanvas.getContext('2d').putImageData(new ImageData(rgba, imgW, imgH), 0, 0);

    result = extractCrops(srcCanvas as unknown as CanvasImageSource, landmarks, imgW, imgH);

    if (result) {
      writeFileSync(join(FX, 'ts_face_f32.bin'),      f32ToBuffer(result.face));
      writeFileSync(join(FX, 'ts_left_eye_f32.bin'),  f32ToBuffer(result.leftEye));
      writeFileSync(join(FX, 'ts_right_eye_f32.bin'), f32ToBuffer(result.rightEye));
      writeFileSync(join(FX, 'ts_rect.json'),          JSON.stringify(Array.from(result.rect)));
      console.log('[dump] Salvou ts_face_f32.bin, ts_left_eye_f32.bin, ts_right_eye_f32.bin, ts_rect.json');
    }
  });

  it('extractCrops() produziu tensores e salvou os arquivos', () => {
    expect(result).not.toBeNull();
    expect(existsSync(join(FX, 'ts_face_f32.bin'))).toBe(true);
    expect(existsSync(join(FX, 'ts_left_eye_f32.bin'))).toBe(true);
    expect(existsSync(join(FX, 'ts_right_eye_f32.bin'))).toBe(true);
  });
});
