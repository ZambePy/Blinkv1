// Recorte facial + pré-processamento para o L2CS.
//
// Entrada: vídeo/canvas + landmarks[478] normalizados [0..1] + isMirrored.
// Saída:   Float32Array[1 × 3 × N × N] (NCHW, RGB, normalizado ImageNet),
//          com N = lado do canvas de recorte (448 por default, 224 opcional).
//
// O fator de expansão da bbox é o parâmetro de maior risco silencioso: o L2CS
// foi treinado com uma convenção de recorte, e um crop mais apertado ou mais
// largo degrada a acurácia sem sintoma visível.

export const EXPAND_FACTOR = 1.4;

/** Tamanho de entrada default. O ONNX tem eixos espaciais dinâmicos e aceita
 *  também 224 (a rede termina em GlobalAveragePool). 448 é o tamanho do export
 *  original; 224 roda ~3,7× mais rápido com efeito na acurácia ainda não medido. */
export const INPUT_SIZE = 448;

/** Deduz o lado do crop a partir do comprimento do tensor NCHW: um buffer de
 *  3·N² floats admite um único N, então não há como divergir do canvas. */
export function tamanhoDoTensor(tensor: { length: number }): number {
  const n = tensor.length;
  if (n <= 0 || n % 3 !== 0) {
    throw new Error(`[l2cs] tensor com ${n} floats não é NCHW de 3 canais.`);
  }
  const px = n / 3;
  const lado = Math.round(Math.sqrt(px));
  if (lado * lado !== px) {
    throw new Error(`[l2cs] tensor de ${n} floats não corresponde a um crop quadrado (${px} px/canal).`);
  }
  return lado;
}

export const IMAGENET_MEAN: readonly [number, number, number] = [0.485, 0.456, 0.406];
export const IMAGENET_STD: readonly [number, number, number] = [0.229, 0.224, 0.225];

export interface Point2D { readonly x: number; readonly y: number }
export interface SquareBBox {
  readonly x: number;      // px, canto superior esquerdo (negativo se saiu do frame)
  readonly y: number;
  readonly side: number;   // px, lado do quadrado
}

export type CropSource = CanvasImageSource & { width: number; height: number };

/** BBox dos landmarks, expandido e quadrado (maior lado, para não distorcer no resize). */
export function computeSquareBBox(
  landmarks: readonly Point2D[],
  imageWidth: number,
  imageHeight: number,
  expandFactor: number = EXPAND_FACTOR,
): SquareBBox {
  if (landmarks.length === 0) {
    return { x: 0, y: 0, side: Math.min(imageWidth, imageHeight) };
  }

  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const lm of landmarks) {
    const px = lm.x * imageWidth;
    const py = lm.y * imageHeight;
    if (px < minX) minX = px;
    if (py < minY) minY = py;
    if (px > maxX) maxX = px;
    if (py > maxY) maxY = py;
  }

  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const side = Math.max(maxX - minX, maxY - minY) * expandFactor;

  return { x: cx - side / 2, y: cy - side / 2, side };
}

/** RGBA HWC → RGB CHW normalizado ImageNet. Puro, sem DOM. */
export function preprocessFromRGBA(
  rgba: Uint8Array | Uint8ClampedArray,
  size: number = INPUT_SIZE,
): Float32Array {
  const px = size * size;
  const expected = px * 4;
  if (rgba.length !== expected) {
    throw new Error(`preprocessFromRGBA: esperava ${expected} bytes RGBA, recebeu ${rgba.length}`);
  }
  const out = new Float32Array(3 * px);
  const [meanR, meanG, meanB] = IMAGENET_MEAN;
  const [stdR, stdG, stdB] = IMAGENET_STD;
  for (let i = 0; i < px; i++) {
    const j = i * 4;
    out[i]          = (rgba[j]     / 255 - meanR) / stdR;
    out[px + i]     = (rgba[j + 1] / 255 - meanG) / stdG;
    out[2 * px + i] = (rgba[j + 2] / 255 - meanB) / stdB;
  }
  return out;
}

// Canvas de scratch reusado entre chamadas (o loop chama até 10 Hz).
export interface CropContext {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

export function createCropContext(size: number = INPUT_SIZE): CropContext {
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(size, size)
      : Object.assign(document.createElement('canvas'), { width: size, height: size });
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error('createCropContext: 2D context indisponível');

  // Kernel de reamostragem fixo: o default do navegador varia por versão e
  // plataforma, e 448² costuma ser upscale enquanto 224² é downscale.
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  return { canvas, ctx };
}

export interface CropOptions {
  landmarks: readonly Point2D[];
  isMirrored: boolean;
  expandFactor?: number;
  context?: CropContext;
  /** Lado do crop. Ignorado quando `context` é passado — aí quem manda é o canvas. */
  inputSize?: number;
  /**
   * Roll da cabeça em RADIANOS, medido no referencial do vídeo (sprint S6).
   *
   * Quando presente, o recorte é rotacionado para cancelá-lo: é a parte da
   * *data normalization* da literatura que este pipeline não fazia. Repare que
   * o roll não é tratado em nenhum outro lugar — `poseCompensation` usa só yaw
   * e pitch —, então cada grau de cabeça inclinada entrava no L2CS como imagem
   * torta e saía como erro. Numa cadeira reclinável isso é o estado normal.
   *
   * Ausente ou não finito: nenhuma rotação, comportamento idêntico ao anterior.
   */
  rollRad?: number | null;
}

/** Transformação afim do recorte, na convenção de `setTransform`. */
export interface MatrizDoRecorte {
  a: number; b: number; c: number; d: number; e: number; f: number;
}

/**
 * Matriz que leva um ponto da imagem de origem para o canvas do recorte.
 *
 * Separada e pura porque a composição de espelhamento com rotação é
 * exatamente o tipo de coisa que se erra de sinal e degrada a acurácia sem
 * sintoma visível. Aqui ela pode ser verificada mapeando pontos conhecidos.
 *
 * A ordem, do ponto de origem para o canvas:
 *
 *   1. translada o centro da bbox para a origem;
 *   2. escala por `size / side`;
 *   3. rotaciona para cancelar o roll;
 *   4. espelha em X, quando o vídeo está espelhado;
 *   5. translada para o centro do canvas.
 *
 * **O sinal NÃO depende do espelhamento**, e isso é contraintuitivo o
 * bastante para merecer a conta. A tentação é raciocinar "espelhar inverte o
 * sentido de um ângulo, logo o sinal precisa mudar" — e um teste com a linha
 * dos olhos derruba isso na hora. O motivo é a ordem: a rotação acontece ANTES
 * do espelho, e espelhar leva reta horizontal em reta horizontal. Com a linha
 * dos olhos na direção `(cos r, sen r)`, a saída fica proporcional a
 * `(±cos(θ+r), sen(θ+r))` nos dois casos, e horizontal exige `θ = −r` nos dois.
 *
 * O que o espelho muda é só o sinal do determinante — a mão do referencial.
 */
export function matrizDoRecorte(
  bbox: SquareBBox,
  size: number,
  isMirrored: boolean,
  rollRad: number | null | undefined,
): MatrizDoRecorte {
  const k = size / bbox.side;
  const cx = bbox.x + bbox.side / 2;
  const cy = bbox.y + bbox.side / 2;
  const roll = typeof rollRad === 'number' && Number.isFinite(rollRad) ? rollRad : 0;
  const theta = -roll;

  const cos = Math.cos(theta);
  const sen = Math.sin(theta);
  const sx = isMirrored ? -1 : 1;

  // M = T(size/2) · S(sx,1) · R(theta) · S(k) · T(-c)
  const a = sx * k * cos;
  const b = k * sen;
  const c = sx * k * -sen;
  const d = k * cos;
  return {
    a, b, c, d,
    e: size / 2 - (a * cx + c * cy),
    f: size / 2 - (b * cx + d * cy),
  };
}

// `source.width` num HTMLVideoElement é o atributo HTML, que vale 0 quando só
// o CSS define o tamanho; a dimensão intrínseca é `videoWidth/videoHeight`.
function sourceDimensions(source: CropSource): { w: number; h: number } {
  const v = source as Partial<HTMLVideoElement>;
  if (typeof v.videoWidth === 'number' && v.videoWidth > 0 &&
      typeof v.videoHeight === 'number' && v.videoHeight > 0) {
    return { w: v.videoWidth, h: v.videoHeight };
  }
  return { w: source.width, h: source.height };
}

export function cropFaceToTensor(source: CropSource, opts: CropOptions): Float32Array {
  const { w, h } = sourceDimensions(source);
  if (!(w > 0) || !(h > 0)) {
    throw new Error(
      `[l2cs] fonte sem dimensões utilizáveis (w=${w}, h=${h}). ` +
      `Num <video>, use videoWidth/videoHeight — o atributo width vale 0 quando só o CSS define o tamanho.`,
    );
  }
  const bbox = computeSquareBBox(opts.landmarks, w, h, opts.expandFactor ?? EXPAND_FACTOR);
  if (!(bbox.side > 0)) {
    throw new Error('[l2cs] bbox degenerado (lado 0) — landmarks vazios ou coincidentes.');
  }
  const ctx = opts.context ?? createCropContext(opts.inputSize ?? INPUT_SIZE);
  const g = ctx.ctx;
  const size = ctx.canvas.width;

  // Preto para as regiões fora do frame.
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);

  // Uma matriz só para recorte, escala, desespelhamento e cancelamento de roll.
  // O caminho antigo (dois `drawImage` diferentes conforme o espelho) some:
  // com rotação no meio, manter dois ramos seria manter dois lugares para o
  // sinal estar errado.
  const m = matrizDoRecorte(bbox, size, opts.isMirrored, opts.rollRad);
  g.save();
  g.setTransform(m.a, m.b, m.c, m.d, m.e, m.f);
  (g as CanvasRenderingContext2D).drawImage(source, 0, 0, w, h);
  g.restore();
  g.setTransform(1, 0, 0, 1, 0, 0);

  const imgData = (g as CanvasRenderingContext2D).getImageData(0, 0, size, size);
  return preprocessFromRGBA(imgData.data, size);
}
