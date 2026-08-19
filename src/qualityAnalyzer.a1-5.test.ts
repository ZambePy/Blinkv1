import { describe, it, expect, beforeAll } from 'vitest';
import { EyeQualityAnalyzer } from './qualityAnalyzer';
import type { Point3D } from './extractor';

// A1-5 — specularRatio é a fração de pixels com luminância > 0.95 no crop
// ocular. Teste com um vídeo mock (canvas 2D) para exercitar o pipeline real
// end-to-end sem depender de webcam.

// Landmarks mínimos para o bbox — só os índices em EYE_BBOX_INDICES.
// (33, 133, 159, 145, 362, 263, 386, 374)
function landmarksForBbox(minX: number, minY: number, maxX: number, maxY: number): Point3D[] {
  const arr: Point3D[] = new Array(500).fill({ x: 0, y: 0, z: 0 });
  const setPt = (i: number, x: number, y: number) => { arr[i] = { x, y, z: 0 }; };
  // Distribui os 8 pontos nos cantos do bbox
  setPt(33,  minX, minY);
  setPt(133, maxX, minY);
  setPt(159, minX + (maxX - minX) * 0.5, minY);
  setPt(145, minX, maxY);
  setPt(362, minX, minY);
  setPt(263, maxX, maxY);
  setPt(386, maxX, minY + (maxY - minY) * 0.5);
  setPt(374, maxX, maxY);
  return arr;
}

// HTMLVideoElement mock via canvas: desenha um retângulo com cor específica,
// depois a analyze() lê via drawImage.
function makeFakeVideo(fillRGB: [number, number, number], w = 128, h = 128): HTMLVideoElement {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = `rgb(${fillRGB[0]},${fillRGB[1]},${fillRGB[2]})`;
  ctx.fillRect(0, 0, w, h);
  // O analyzer usa .videoWidth / .videoHeight — expor via Object.defineProperty.
  const fake = canvas as unknown as HTMLVideoElement;
  Object.defineProperty(fake, 'videoWidth',  { value: w, configurable: true });
  Object.defineProperty(fake, 'videoHeight', { value: h, configurable: true });
  return fake;
}

beforeAll(() => {
  Object.defineProperty(document.documentElement, 'clientWidth',  { value: 1280, configurable: true });
  Object.defineProperty(document.documentElement, 'clientHeight', { value: 720, configurable: true });
});

describe('A1-5: specularRatio em qualityAnalyzer', () => {
  it('crop uniformemente cinza (mid-luma) devolve specularRatio ≈ 0', () => {
    const video = makeFakeVideo([128, 128, 128]); // luma = 0.5
    const analyzer = new EyeQualityAnalyzer();
    const landmarks = landmarksForBbox(0.2, 0.2, 0.8, 0.8);
    const q = analyzer.analyze(video, landmarks);
    expect(q.specularRatio).toBeDefined();
    expect(q.specularRatio!).toBeCloseTo(0, 6);
  });

  it('crop totalmente branco devolve specularRatio ≈ 1', () => {
    const video = makeFakeVideo([255, 255, 255]);
    const analyzer = new EyeQualityAnalyzer();
    const landmarks = landmarksForBbox(0.2, 0.2, 0.8, 0.8);
    const q = analyzer.analyze(video, landmarks);
    expect(q.specularRatio).toBeCloseTo(1, 3);
  });

  it('crop preto devolve specularRatio = 0', () => {
    const video = makeFakeVideo([0, 0, 0]);
    const analyzer = new EyeQualityAnalyzer();
    const landmarks = landmarksForBbox(0.2, 0.2, 0.8, 0.8);
    const q = analyzer.analyze(video, landmarks);
    expect(q.specularRatio).toBe(0);
  });

  it('crop com região saturada parcial reflete no ratio', () => {
    // Metade branco, metade cinza. specularRatio ≈ 0.5 (metade dos pixels
    // acima do limiar 0.95).
    const canvas = document.createElement('canvas');
    canvas.width = 200;
    canvas.height = 200;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'rgb(128,128,128)';
    ctx.fillRect(0, 0, 200, 200);
    ctx.fillStyle = 'rgb(255,255,255)';
    ctx.fillRect(0, 0, 200, 100); // metade superior branca
    const fake = canvas as unknown as HTMLVideoElement;
    Object.defineProperty(fake, 'videoWidth',  { value: 200, configurable: true });
    Object.defineProperty(fake, 'videoHeight', { value: 200, configurable: true });

    const analyzer = new EyeQualityAnalyzer();
    // bbox cobre a imagem inteira
    const landmarks = landmarksForBbox(0.0, 0.0, 1.0, 1.0);
    const q = analyzer.analyze(fake, landmarks);
    expect(q.specularRatio).toBeGreaterThan(0.4);
    expect(q.specularRatio).toBeLessThan(0.6);
  });

  it('QualityFeatures.specularRatio é opcional (compat com fallback)', () => {
    // O analyzer devolve { detectorConfidence } apenas quando o canvas falha.
    // Confirmamos que o tipo aceita ausência sem quebrar downstream.
    const partial: import('./extractor').QualityFeatures = {
      detectorConfidence: 1,
      brightnessEstimate: 0.5,
      contrastEstimate: 0.1,
      blurEstimate: 0.2,
      occlusionEstimate: 0,
      irisVisibilityPercentage: 1,
    };
    // Não deve ser required no tipo — atribuição compila.
    expect(partial.specularRatio).toBeUndefined();
  });
});
