// Análise de qualidade do crop dos olhos (Sprint 1.1).
//
// Antes desta sprint, `extractor.ts` retornava QualityFeatures com valores
// hardcoded (brightness/contrast=0.5, blur=0, confidence=1.0). O filtro em
// `calibration.feedRawData` que testa `detectorConfidence < 0.5` nunca disparava
// — na prática nenhuma amostra ruim era rejeitada.
//
// Este módulo lê o frame de vídeo, define um bounding box em torno dos landmarks
// dos olhos e computa:
//   - brightnessEstimate → média de luminância (Rec. 709) no crop, em [0,1]
//   - contrastEstimate   → desvio padrão da luminância
//   - blurEstimate       → 1 - clamp(variância do Laplaciano) — alto = borrado
//   - detectorConfidence → estabilidade dos landmarks dos olhos entre frames
//
// O engine mescla estes valores com o `irisVisibilityPercentage` (EAR) que
// continua sendo calculado no extractor.

import type { Point3D, QualityFeatures } from './extractor';

// Landmarks do MediaPipe usados para definir o bounding box dos dois olhos.
// (cantos e topos/bases dos olhos esquerdo e direito)
const EYE_BBOX_INDICES = [33, 133, 159, 145, 362, 263, 386, 374];

// Referência empírica para converter variância do Laplaciano em "blur estimate".
// Frames nítidos de webcam a 640×480 costumam produzir variância > 0.001;
// abaixo disso, a imagem está borrada. Este valor precisa ser ajustado após
// observar valores reais durante a coleta de baseline (Sprint 0).
const BLUR_REFERENCE_VARIANCE = 0.001;

// Escala para converter deslocamento médio dos landmarks entre frames em
// "confiança" [0,1]. Um deslocamento típico em coordenadas normalizadas do
// MediaPipe fica ~0.003 quando o rosto está parado; ~0.03 durante movimento
// brusco. Multiplicador de 20 faz `confidence` cair para ~0.4 em movimento
// brusco e ~0.94 em rosto parado.
const LANDMARK_JITTER_SCALE = 20;

// A1-5 — limiar de luminância "quase-saturada". Pixels acima disso na região
// do olho são candidatos a reflexo especular (a tela refletindo na lente).
// Pele e esclera raramente ultrapassam 0.95 sob exposição correta; lente
// refletindo LCD frontal, sim. Valor conservador; pode subir para 0.97 se
// falsos positivos em pele muito clara aparecerem em campo.
const SPECULAR_LUMINANCE = 0.95;

export class EyeQualityAnalyzer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private lastLandmarks: Point3D[] | null = null;

  analyze(video: HTMLVideoElement, landmarks: Point3D[]): Partial<QualityFeatures> {
    const vw = video.videoWidth || 640;
    const vh = video.videoHeight || 480;

    if (!this.canvas) {
      this.canvas = document.createElement('canvas');
      this.ctx = this.canvas.getContext('2d', { willReadFrequently: true });
    }
    if (this.canvas.width !== vw) this.canvas.width = vw;
    if (this.canvas.height !== vh) this.canvas.height = vh;
    if (!this.ctx) {
      return { detectorConfidence: 1.0, brightnessEstimate: 0.5, contrastEstimate: 0.5, blurEstimate: 0.0 };
    }

    // Bounding box em coordenadas normalizadas [0,1]
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    for (const idx of EYE_BBOX_INDICES) {
      const p = landmarks[idx];
      if (!p) continue;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    // 20% de padding vertical e horizontal — garante que a pálpebra
    // e um pouco da região peri-ocular entrem no crop.
    const padX = (maxX - minX) * 0.2;
    const padY = (maxY - minY) * 0.2;
    minX = Math.max(0, minX - padX);
    minY = Math.max(0, minY - padY);
    maxX = Math.min(1, maxX + padX);
    maxY = Math.min(1, maxY + padY);

    const cropX = Math.floor(minX * vw);
    const cropY = Math.floor(minY * vh);
    const cropW = Math.max(1, Math.floor((maxX - minX) * vw));
    const cropH = Math.max(1, Math.floor((maxY - minY) * vh));

    // Confidence por estabilidade dos landmarks: sempre atualiza,
    // mesmo se o crop falhar por CORS/tainted canvas.
    let detectorConfidence = 1.0;
    if (this.lastLandmarks) {
      let dSum = 0;
      let dN = 0;
      for (const idx of EYE_BBOX_INDICES) {
        const p = landmarks[idx];
        const q = this.lastLandmarks[idx];
        if (!p || !q) continue;
        dSum += Math.hypot(p.x - q.x, p.y - q.y, (p.z ?? 0) - (q.z ?? 0));
        dN++;
      }
      if (dN > 0) {
        const meanDelta = dSum / dN;
        detectorConfidence = Math.max(0, Math.min(1, 1 - meanDelta * LANDMARK_JITTER_SCALE));
      }
    }
    this.lastLandmarks = landmarks;

    try {
      this.ctx.drawImage(video, 0, 0, vw, vh);
      const imageData = this.ctx.getImageData(cropX, cropY, cropW, cropH);
      const data = imageData.data;
      const N = cropW * cropH;
      if (N === 0) {
        return { detectorConfidence, brightnessEstimate: 0.5, contrastEstimate: 0.0, blurEstimate: 0.5 };
      }

      const lum = new Float32Array(N);
      let sum = 0;
      // A1-5 — contagem de pixels quase-saturados feita no mesmo loop
      // (custo zero). specularRatio = fração acima de SPECULAR_LUMINANCE.
      let specularCount = 0;
      for (let i = 0; i < N; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        // Rec. 709 luma
        const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        lum[i] = l;
        sum += l;
        if (l > SPECULAR_LUMINANCE) specularCount++;
      }
      const brightnessEstimate = sum / N;
      const specularRatio = specularCount / N;
      let varSum = 0;
      for (let i = 0; i < N; i++) {
        const d = lum[i] - brightnessEstimate;
        varSum += d * d;
      }
      const contrastEstimate = Math.sqrt(varSum / N);

      // Variância do Laplaciano — indicador clássico de foco.
      // Um Laplaciano 3×3 sobre `lum`: c*(-4) + top + bottom + left + right
      let lapSum = 0;
      let lapSumSq = 0;
      let lapN = 0;
      for (let y = 1; y < cropH - 1; y++) {
        const row0 = (y - 1) * cropW;
        const row1 = y * cropW;
        const row2 = (y + 1) * cropW;
        for (let x = 1; x < cropW - 1; x++) {
          const c = lum[row1 + x];
          const lap = lum[row0 + x] + lum[row2 + x] + lum[row1 + (x - 1)] + lum[row1 + (x + 1)] - 4 * c;
          lapSum += lap;
          lapSumSq += lap * lap;
          lapN++;
        }
      }
      let blurEstimate = 0.5;
      if (lapN > 0) {
        const lapMean = lapSum / lapN;
        const lapVar = lapSumSq / lapN - lapMean * lapMean;
        // Variância alta = borda bem definida = foco. Blur é o inverso.
        blurEstimate = Math.max(0, Math.min(1, 1 - lapVar / BLUR_REFERENCE_VARIANCE));
      }

      return { detectorConfidence, brightnessEstimate, contrastEstimate, blurEstimate, specularRatio };
    } catch (_) {
      // Canvas taint (raro, mas possível com camera stream cross-origin) — devolve confidence apenas.
      return { detectorConfidence };
    }
  }
}
