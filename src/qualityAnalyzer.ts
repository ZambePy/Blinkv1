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
 * 640×480**: frames nítidos de webcam nessa resolução produzem > 0,001.
 *
 * O número é específico da resolução. A variância do Laplaciano escala com o
 * quadrado do gradiente inter-pixel, que cai proporcionalmente à resolução (a
 * mesma borda física se espalha por mais pixels a 1080p). Usada como absoluta,
 * trocar uma webcam 480p por 1080p reprovava frames nítidos.
 */
export const BLUR_REFERENCE_AT_640x480 = 0.001;

/** Largura da resolução em que a referência acima foi medida. */
const BLUR_REFERENCE_WIDTH = 640;

/**
 * Converte variância do Laplaciano em estimativa de borrão [0,1], normalizando
 * pela resolução.
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

/**
 * Quanto a mancha de brilho FICA PARADA entre dois quadros — a medida que
 * separa assinatura de óculos de reflexo que atrapalha.
 *
 * ## Por que `specularPersistence` não servia
 *
 * A persistência (fração de quadros com brilho alto) foi criada para separar
 * reflexo de ruído passageiro, e faz isso bem. Para separar óculos de reflexo
 * nocivo, porém, ela está **invertida**: um brilho fixo na armação ou na lente
 * aparece em TODOS os quadros, marca persistência ≈ 1,0 e dispara o aviso
 * sempre. Era o falso positivo relatado — o sistema acusava reflexo, a
 * calibração era feita assim mesmo, e o erro saía normal.
 *
 * ## O que de fato distingue
 *
 * Uma mancha **parada** é o próprio óculos: o detector aprende a enxergar em
 * volta dela e o landmark não escorrega. Uma mancha que **se move** é algo
 * entrando e saindo do olho — janela, luminária, tela refletida — e é isso que
 * estraga a borda da íris.
 *
 * Devolve a razão de Jaccard entre as duas máscaras: 1 = imóvel, 0 = não se
 * sobrepõem.
 *
 * Sem brilho nenhum devolve 1 (não há mancha, logo nada instável) e sem quadro
 * anterior devolve 1 (um quadro só não mostra movimento). Os dois defaults
 * apontam para "não avisar": um falso positivo no primeiro quadro reapareceria
 * a cada boot.
 */
export const ESPECULAR_ESTAVEL_MIN = 0.6;

export function estabilidadeEspecular(
  atual: Uint8Array,
  anterior: Uint8Array | null,
): number {
  // O crop periocular muda de tamanho conforme a bbox do rosto; comparar
  // tamanhos diferentes não diz nada sobre movimento.
  if (!anterior || anterior.length !== atual.length) return 1;

  let intersecao = 0;
  let uniao = 0;
  for (let i = 0; i < atual.length; i++) {
    const a = atual[i] !== 0;
    const b = anterior[i] !== 0;
    if (a && b) intersecao++;
    if (a || b) uniao++;
  }

  // Nenhum pixel saturado nos dois quadros: não há mancha para chamar de
  // instável.
  return uniao === 0 ? 1 : intersecao / uniao;
}

export class EyeQualityAnalyzer {
  private canvas: HTMLCanvasElement | null = null;
  private ctx: CanvasRenderingContext2D | null = null;
  private lastLandmarks: Point3D[] | null = null;
  /** Máscara de brilho do quadro corrente. Reusada; só cresce. */
  private specularMask: Uint8Array | null = null;
  /** Máscara do quadro anterior, para medir se a mancha se move. */
  private specularMaskAnterior: Uint8Array | null = null;

  /**
   * Solta o canvas em resolução plena de vídeo.
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
   * bbox é degenerada ou o canvas está tainted. É uma medição de fato,
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
    if (!this.ctx) {
      // Sem contexto 2d nada foi medido. Devolver constantes plausíveis
      // afirmaria confiança máxima e passaria nos critérios do gate de
      // calibração, tornando a falha invisível. Objeto vazio é a verdade.
      return {};
    }

    // Bounding box em coordenadas normalizadas [0,1]
    let minX = 1, minY = 1, maxX = 0, maxY = 0;
    // Conta quantos landmarks de olho realmente entraram: sem isso, um
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

    // A bbox precisa ser bem-formada ANTES de qualquer leitura de pixel: com
    // bbox invertida, `getImageData` lê fora do canvas — o que NÃO lança,
    // devolve preto transparente — e publicaria `{brightness: 0, blur: 1}`
    // como se tivesse sido medido. `detectorConfidence` continua sendo
    // devolvido porque ele FOI medido (deslocamento de landmarks, não crop).
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
      // Desenha SÓ a região periocular, não o quadro inteiro.
      //
      // O código anterior copiava 1920×1080 (~2 M pixels) para o canvas a cada
      // quadro e depois lia um retângulo de ~200×80. A cópia era ~100× maior
      // que o dado usado, e acontecia 30 vezes por segundo no thread
      // principal — parte do custo que aparecia como `quality ~10-12 ms` no
      // HUD e derrubava o fps quando algo mais disputava a CPU.
      //
      // O mapeamento é 1:1 (mesmo tamanho na origem e no destino), então não
      // há reamostragem: os pixels lidos são os mesmos de antes.
      //
      // O canvas só CRESCE. Reatribuir width/height realoca o buffer e limpa o
      // conteúdo; com a bbox variando alguns pixels por quadro, redimensionar
      // sempre traria de volta parte do custo que estamos removendo.
      if (this.canvas.width < cropW) this.canvas.width = cropW;
      if (this.canvas.height < cropH) this.canvas.height = cropH;
      this.ctx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);
      const imageData = this.ctx.getImageData(0, 0, cropW, cropH);
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
      // Máscara de brilho do quadro, para comparar com a do quadro anterior.
      // Sai de graça: o `if` que conta já existe, e o buffer só cresce — pelo
      // mesmo motivo do canvas, realocar a cada quadro traria de volta o custo
      // que a otimização do crop removeu.
      if (!this.specularMask || this.specularMask.length < N) {
        this.specularMask = new Uint8Array(N);
      }
      const mask = this.specularMask;
      mask.fill(0, 0, N);

      for (let i = 0; i < N; i++) {
        const r = data[i * 4];
        const g = data[i * 4 + 1];
        const b = data[i * 4 + 2];
        // Rec. 709 luma
        const l = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
        lum[i] = l;
        sum += l;
        if (l > SPECULAR_LUMINANCE) {
          specularCount++;
          mask[i] = 1;
        }
      }
      const brightnessEstimate = sum / N;
      const specularRatio = specularCount / N;

      // Estabilidade: mancha parada = assinatura do próprio óculos (o detector
      // enxerga em volta dela); mancha que se move = reflexo entrando e saindo
      // do olho, que é o que estraga a borda da íris.
      const atual = mask.subarray(0, N);
      const specularStability = estabilidadeEspecular(atual, this.specularMaskAnterior);
      // Cópia, e não referência: `mask` é reusada no próximo quadro.
      if (!this.specularMaskAnterior || this.specularMaskAnterior.length !== N) {
        this.specularMaskAnterior = new Uint8Array(N);
      }
      this.specularMaskAnterior.set(atual);
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
        // Normalizado pela resolução; ver `blurFromVariance`.
        blurEstimate = blurFromVariance(lapVar, vw, vh);
      }

      return {
        detectorConfidence,
        brightnessEstimate,
        contrastEstimate,
        blurEstimate,
        specularRatio,
        specularStability,
      };
    } catch (_) {
      // Canvas taint (raro, mas possível com camera stream cross-origin) — devolve confidence apenas.
      return { detectorConfidence };
    }
  }
}
