// Recorte facial + preprocessamento para o L2CS (E3 do L2CS-NET.md).
//
// Contrato:
//   entrada: video/canvas + landmarks[478] normalizados [0..1] + isMirrored
//   saída:   Float32Array[1 × 3 × 448 × 448]  (NCHW, RGB, ImageNet-normalizado)
//
// ⚠️ EXPAND_FACTOR é o parâmetro de maior risco silencioso do pipeline.
// O L2CS foi treinado com uma convenção específica de recorte; um crop mais
// apertado ou mais largo degrada a acurácia SEM sintoma visível.
// Valor inicial 1.4 escolhido como default razoável — determinar por varredura
// [1.0…2.0] medindo erro final (§E3).

export const EXPAND_FACTOR = 1.4;
export const INPUT_SIZE = 448;
export const IMAGENET_MEAN: readonly [number, number, number] = [0.485, 0.456, 0.406];
export const IMAGENET_STD: readonly [number, number, number] = [0.229, 0.224, 0.225];

export interface Point2D { readonly x: number; readonly y: number }
export interface SquareBBox {
  readonly x: number;      // px, canto superior esquerdo (pode ser negativo se saiu do frame)
  readonly y: number;
  readonly side: number;   // px, lado do quadrado
}

// Fonte de pixels aceita — video, canvas offscreen ou HTMLCanvasElement.
export type CropSource = CanvasImageSource & { width: number; height: number };

// ── Etapa 1+2: BBox dos landmarks, expandido e quadrado ───────────────────────
// Landmarks vêm em coordenadas normalizadas [0..1]. Multiplicamos por dims da
// imagem antes de calcular. O quadrado usa o maior lado (largura ou altura)
// para não distorcer no resize.
export function computeSquareBBox(
  landmarks: readonly Point2D[],
  imageWidth: number,
  imageHeight: number,
  expandFactor: number = EXPAND_FACTOR,
): SquareBBox {
  if (landmarks.length === 0) {
    // BBox degenerado — o caller deve tratar (E4 recebe tensor mas gaze fica invalid).
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
  const w = maxX - minX;
  const h = maxY - minY;
  const side = Math.max(w, h) * expandFactor;

  return {
    x: cx - side / 2,
    y: cy - side / 2,
    side,
  };
}

// ── Etapa 5+6+7: RGBA HWC → RGB CHW ImageNet-normalizado ─────────────────────
// Puro, sem DOM — testável em Node. Assume src já é 448×448.
export function preprocess448FromRGBA(
  rgba: Uint8Array | Uint8ClampedArray,
  size: number = INPUT_SIZE,
): Float32Array {
  const px = size * size;
  const expected = px * 4;
  if (rgba.length !== expected) {
    throw new Error(`preprocess448FromRGBA: esperava ${expected} bytes RGBA, recebeu ${rgba.length}`);
  }
  const out = new Float32Array(3 * px);
  const meanR = IMAGENET_MEAN[0], meanG = IMAGENET_MEAN[1], meanB = IMAGENET_MEAN[2];
  const stdR = IMAGENET_STD[0], stdG = IMAGENET_STD[1], stdB = IMAGENET_STD[2];
  for (let i = 0; i < px; i++) {
    const j = i * 4;
    out[i]          = (rgba[j]     / 255 - meanR) / stdR;
    out[px + i]     = (rgba[j + 1] / 255 - meanG) / stdG;
    out[2 * px + i] = (rgba[j + 2] / 255 - meanB) / stdB;
  }
  return out;
}

// ── Composição browser-side ───────────────────────────────────────────────────
// Recorta o rosto do vídeo, aplica flip se isMirrored, resize p/ 448 e
// devolve o tensor pronto para o worker L2CS.
//
// O canvas de scratch é reusado entre chamadas para evitar realoc (o loop
// chama isto até 10 Hz). O caller mantém a referência.
export interface CropContext {
  canvas: HTMLCanvasElement | OffscreenCanvas;
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
}

export function createCropContext(): CropContext {
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(INPUT_SIZE, INPUT_SIZE)
      : Object.assign(document.createElement('canvas'), { width: INPUT_SIZE, height: INPUT_SIZE });
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as
    | CanvasRenderingContext2D
    | OffscreenCanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error('createCropContext: 2D context indisponível');
  return { canvas, ctx };
}

export interface CropOptions {
  landmarks: readonly Point2D[];
  isMirrored: boolean;
  expandFactor?: number;
  context?: CropContext;
}

export function cropFaceToTensor(source: CropSource, opts: CropOptions): Float32Array {
  const w = source.width;
  const h = source.height;
  const bbox = computeSquareBBox(opts.landmarks, w, h, opts.expandFactor ?? EXPAND_FACTOR);
  const ctx = opts.context ?? createCropContext();
  const g = ctx.ctx;

  // Fill preto para regiões fora do frame (o L2CS foi treinado com crops que
  // não vazam do frame; padding preto é convenção comum quando ocorre).
  g.fillStyle = '#000';
  g.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);

  if (opts.isMirrored) {
    // §E1: L2CS foi treinado com a imagem "como a câmera vê". Se o vídeo do
    // usuário está espelhado (facingMode 'user' com CSS transform ou fluxo
    // já invertido), desespelhamos AQUI para não corromper os termos
    // cruzados de E5 (tan(yaw)·tan(pitch) é ímpar).
    g.save();
    g.translate(INPUT_SIZE, 0);
    g.scale(-1, 1);
    // A drawImage aceita ir além dos limites do source — a região que
    // extrapola vira transparente (aqui: preto por causa do fillRect prévio).
    (g as CanvasRenderingContext2D).drawImage(
      source,
      bbox.x, bbox.y, bbox.side, bbox.side,
      0, 0, INPUT_SIZE, INPUT_SIZE,
    );
    g.restore();
  } else {
    (g as CanvasRenderingContext2D).drawImage(
      source,
      bbox.x, bbox.y, bbox.side, bbox.side,
      0, 0, INPUT_SIZE, INPUT_SIZE,
    );
  }

  // getImageData é o gargalo; ~200k pixels a 10 Hz é folgado (< 2 ms típico).
  const imgData = (g as CanvasRenderingContext2D).getImageData(0, 0, INPUT_SIZE, INPUT_SIZE);
  return preprocess448FromRGBA(imgData.data, INPUT_SIZE);
}

// Helper para debug/validação: só a etapa BBox → 448 RGBA (sem normalização).
// Útil para inspecionar visualmente o crop no browser.
export function cropFaceToRGBA(source: CropSource, opts: CropOptions): Uint8ClampedArray {
  const w = source.width;
  const h = source.height;
  const bbox = computeSquareBBox(opts.landmarks, w, h, opts.expandFactor ?? EXPAND_FACTOR);
  const ctx = opts.context ?? createCropContext();
  const g = ctx.ctx;
  g.fillStyle = '#000';
  g.fillRect(0, 0, INPUT_SIZE, INPUT_SIZE);

  if (opts.isMirrored) {
    g.save();
    g.translate(INPUT_SIZE, 0);
    g.scale(-1, 1);
    (g as CanvasRenderingContext2D).drawImage(source, bbox.x, bbox.y, bbox.side, bbox.side, 0, 0, INPUT_SIZE, INPUT_SIZE);
    g.restore();
  } else {
    (g as CanvasRenderingContext2D).drawImage(source, bbox.x, bbox.y, bbox.side, bbox.side, 0, 0, INPUT_SIZE, INPUT_SIZE);
  }
  return (g as CanvasRenderingContext2D).getImageData(0, 0, INPUT_SIZE, INPUT_SIZE).data;
}
