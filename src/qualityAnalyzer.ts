// Análise de qualidade do crop dos olhos.
//
// Este módulo lê o frame de vídeo, define um bounding box em torno dos
// landmarks dos olhos e computa:
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

/**
 * Referência empírica de variância do Laplaciano para foco, **medida a
 * 640×480** (B3.21).
 *
 * Frames nítidos de webcam nessa resolução produzem variância > 0,001.
 *
 * O número é específico da resolução, e antes de B3.21 era usado como se fosse
 * absoluto. A variância do Laplaciano escala com o quadrado do gradiente
 * inter-pixel, e esse gradiente cai proporcionalmente à resolução: a mesma
 * borda física se espalha por mais pixels a 1080p, então cada passo é menor.
 *
 * A consequência era perversa: **trocar uma webcam 480p por uma 1080p
 * aumentava o `blurEstimate` e reprovava frames nítidos.** A métrica não era
 * comparável entre setups — e é exatamente entre setups que o gate de
 * calibração precisa decidir.
 */
export const BLUR_REFERENCE_AT_640x480 = 0.001;

/** Largura da resolução em que a referência acima foi medida. */
const BLUR_REFERENCE_WIDTH = 640;

/**
 * Converte variância do Laplaciano em estimativa de borrão [0,1], normalizando
 * pela resolução (B3.21).
 *
 * `1` = totalmente borrado, `0` = nítido.
 *
 * A referência é reescalada por `(640/largura)²`, que é como a variância do
 * Laplaciano se comporta com a densidade de amostragem. Assim a mesma cena
 * física produz o mesmo número em 480p, 720p e 1080p.
 *
 * Dimensões inválidas caem na referência de 640×480 — o comportamento
 * anterior, que é melhor que devolver `NaN` para o gate.
 */
export function blurFromVariance(
  lapVar: number,
  videoWidth: number,
  videoHeight: number,
): number {
  const larguraOk =
    Number.isFinite(videoWidth) && videoWidth > 0 &&
    Number.isFinite(videoHeight) && videoHeight > 0;
  const escala = larguraOk ? (BLUR_REFERENCE_WIDTH / videoWidth) ** 2 : 1;
  const referencia = BLUR_REFERENCE_AT_640x480 * escala;
  if (!(referencia > 0) || !Number.isFinite(lapVar)) return 0.5;
  return Math.max(0, Math.min(1, 1 - lapVar / referencia));
}

// Escala para converter deslocamento médio dos landmarks entre frames em
// "confiança" [0,1]. Um deslocamento típico em coordenadas normalizadas do
// MediaPipe fica ~0.003 quando o rosto está parado; ~0.03 durante movimento
// brusco. Multiplicador de 20 faz `confidence` cair para ~0.4 em movimento
// brusco e ~0.94 em rosto parado.
const LANDMARK_JITTER_SCALE = 20;

// Limiar de luminância "quase-saturada". Pixels acima disso na região do olho
// são candidatos a reflexo especular (a tela refletindo na lente). Pele e
// esclera raramente ultrapassam 0.95 sob exposição correta; lente refletindo
// LCD frontal, sim. Valor conservador; pode subir para 0.97 se falsos
// positivos em pele muito clara aparecerem em campo.
const SPECULAR_LUMINANCE = 0.95;

export class EyeQualityAnalyzer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private lastLandmarks: Point3D[] | null = null;

  /**
   * Solta o canvas em resolução plena de vídeo (B1.7).
   *
   * O canvas é dimensionado para `videoWidth × videoHeight` — a 1080p são
   * ~8,3 MB de backing store, mais o contexto 2D com `willReadFrequently`.
   * Sem soltá-lo, cada engine descartado mantinha o seu. A próxima chamada a
   * `analyze()` recria tudo sob demanda, então descartar é seguro.
   */
  /**
   * Confiança pela estabilidade dos landmarks entre quadros.
   *
   * Independe do crop — é por isso que continua sendo reportada mesmo quando a
   * bbox é degenerada (B3.2) ou o canvas está tainted. É uma medição de fato,
   * e suprimi-la junto com as outras seria descartar informação boa.
   */
  private medirEstabilidade(landmarks: Point3D[]): number {
    if (!this.lastLandmarks) return 1.0;
    let dSum = 0;
    let dN = 0;
    for (const idx of EYE_BBOX_INDICES) {
      const p = landmarks[idx];
      const q = this.lastLandmarks[idx];
      if (!p || !q) continue;
      dSum += Math.hypot(p.x - q.x, p.y - q.y, (p.z ?? 0) - (q.z ?? 0));
      dN++;
    }
    if (dN === 0) return 1.0;
    const meanDelta = dSum / dN;
    return Math.max(0, Math.min(1, 1 - meanDelta * LANDMARK_JITTER_SCALE));
  }

  dispose(): void {
    if (this.canvas) {
      // Zerar as dimensões libera o backing store imediatamente na maioria
      // dos engines, em vez de esperar o GC coletar o elemento.
      this.canvas.width = 0;
      this.canvas.height = 0;
    }
    this.canvas = null;
    this.ctx = null;
    this.lastLandmarks = null;
  }

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
      // Sem contexto 2d nada foi medido. Devolver constantes plausíveis
      // afirmaria confiança máxima e passaria nos critérios do gate de
      // calibração, tornando a falha invisível. Objeto vazio é a verdade.
      return {};
    }

    // Bounding box em coordenadas normalizadas [0,1]
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    // B3.2 — conta quantos landmarks de olho realmente entraram. Sem isso, um
    // detector que não devolveu nenhum deles deixava os valores INICIAIS
    // sobreviverem (`minX = 1, maxX = 0`), e a bbox saía invertida.
    let pontosValidos = 0;
    for (const idx of EYE_BBOX_INDICES) {
      const p = landmarks[idx];
      if (!p || !Number.isFinite(p.x) || !Number.isFinite(p.y)) continue;
      // Coordenada fora de [0,1] é detector com defeito, não olho na borda do
      // quadro. Aceitá-la e clampar produziria uma bbox "válida" por acidente.
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) continue;
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
      pontosValidos++;
    }

    // B3.2 — a bbox precisa ser bem-formada ANTES de qualquer leitura de pixel.
    //
    // O guard antigo (`if (N === 0)`) era código morto: `cropW`/`cropH` usam
    // `Math.max(1, ...)`, então N nunca é zero. Com landmarks degenerados a
    // bbox virava `minX = 1.2, maxX = -0.2` depois do padding, `getImageData`
    // lia fora do canvas — o que NÃO lança, devolve preto transparente — e o
    // resultado publicado era `{brightness: 0, contrast: 0, blur: 1,
    // specular: 0}`: preto absoluto, sem reflexo e borrado ao mesmo tempo.
    // Um estado fisicamente impossível, exibido ao cuidador na pré-calibração
    // como se tivesse sido medido.
    //
    // `detectorConfidence` continua sendo devolvido porque ele FOI medido —
    // vem do deslocamento de landmarks entre quadros, não do crop.
    const bboxValida = pontosValidos >= 2 && maxX > minX && maxY > minY;
    if (!bboxValida) {
      const confiancaSemCrop = this.medirEstabilidade(landmarks);
      this.lastLandmarks = landmarks;
      return { detectorConfidence: confiancaSemCrop };
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
    const detectorConfidence = this.medirEstabilidade(landmarks);
    this.lastLandmarks = landmarks;

    try {
      this.ctx.drawImage(video, 0, 0, vw, vh);
      const imageData = this.ctx.getImageData(cropX, cropY, cropW, cropH);
      const data = imageData.data;
      const N = cropW * cropH;
      if (N === 0) {
        // Crop degenerado: `detectorConfidence` foi medido de verdade
        // (vem do deslocamento de landmarks entre quadros) e vale reportar; o
        // resto não foi.
        return { detectorConfidence };
      }

      const lum = new Float32Array(N);
      let sum = 0;
      // Contagem de pixels quase-saturados feita no mesmo loop (custo zero).
      // specularRatio = fração acima de SPECULAR_LUMINANCE.
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
        // B3.21 — normalizado pela resolução; ver `blurFromVariance`.
        blurEstimate = blurFromVariance(lapVar, vw, vh);
      }

      return { detectorConfidence, brightnessEstimate, contrastEstimate, blurEstimate, specularRatio };
    } catch (_) {
      // Canvas taint (raro, mas possível com camera stream cross-origin) — devolve confidence apenas.
      return { detectorConfidence };
    }
  }
}
