// Recorte facial + preprocessamento para o L2CS (E3 do L2CS-NET.md).
//
// Contrato:
//   entrada: video/canvas + landmarks[478] normalizados [0..1] + isMirrored
//   saída:   Float32Array[1 × 3 × N × N]  (NCHW, RGB, ImageNet-normalizado)
//            N = lado do crop: 448 por default, 224 sob a flag `l2csInputSize`.
//
// ⚠️ EXPAND_FACTOR é o parâmetro de maior risco silencioso do pipeline.
// O L2CS foi treinado com uma convenção específica de recorte; um crop mais
// apertado ou mais largo degrada a acurácia SEM sintoma visível.
// Valor inicial 1.4 escolhido como default razoável — determinar por varredura
// [1.0…2.0] medindo erro final (§E3).

export const EXPAND_FACTOR = 1.4;

/**
 * Tamanho de entrada default do L2CS. Continua 448 — o comportamento atual.
 *
 * ── O modelo passou a aceitar mais de um tamanho (P5.5a) ────────────────────
 *
 * O ONNX foi reexportado com eixos espaciais dinâmicos:
 *
 *     input: ['batch', 3, 'height', 'width']      (antes: [batch, 3, 448, 448])
 *
 * Isso é possível porque a rede termina em `GlobalAveragePool`, que colapsa
 * H×W para 1×1 seja qual for o tamanho — as camadas `fc_yaw_gaze` e
 * `fc_pitch_gaze` recebem 2048 features em qualquer resolução. Verificado no
 * grafo antes da troca, não presumido.
 *
 * Verificado também por inferência real: o binário novo aceita 224² e 448², o
 * antigo rejeita 224² com `InvalidArgument`, e a saída do novo em 448² é
 * **bit-idêntica** à do antigo (os 110 tensores de peso são iguais byte a byte
 * — é reexport do mesmo checkpoint, não retreino).
 *
 * ⚠️ Rodar em 224 NÃO é grátis, mas o motivo é mais incerto do que parece: a
 * resolução de TREINO da rede não está registrada em nenhum lugar do
 * repositório. O que se sabe é que o export original fixava 448² — evidência do
 * tamanho de inferência pretendido, não prova do de treino. Latência medida cai 3,66×
 * (78,3 ms → 21,4 ms, CPU); o efeito na ACURÁCIA é o que `F8.4` mede. Por isso
 * o default aqui continua 448 e quem troca é a flag `l2csInputSize`.
 */
export const INPUT_SIZE = 448;

/**
 * Tamanhos validados no grafo. Ambos múltiplos de 32, que é o fator de redução
 * da ResNet-50 — um tamanho que não seja múltiplo produz mapa final
 * fracionário e padding assimétrico que ninguém mediu.
 */
export const L2CS_INPUT_SIZES: readonly number[] = [224, 448];

/**
 * Deduz o lado do crop a partir do comprimento do tensor NCHW.
 *
 * ── Por que isto existe ─────────────────────────────────────────────────────
 *
 * Havia duas fontes de verdade para o tamanho: a constante daqui, que
 * dimensiona canvas e buffer, e `meta.inputSize`, que o worker usava para
 * declarar o shape. Enquanto o tamanho era fixo elas não podiam divergir; com
 * tamanho variável, divergir significa entregar um buffer de 3·224² floats
 * declarado como `[1,3,448,448]`.
 *
 * Um buffer de 3·N² floats admite um único N. Derivar daí elimina a
 * possibilidade da divergência em vez de tentar mantê-la sincronizada.
 */
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
  readonly x: number;      // px, canto superior esquerdo (pode ser negativo se saiu do frame)
  readonly y: number;
  readonly side: number;   // px, lado do quadrado
}

// Fonte de pixels aceita — video, canvas offscreen ou HTMLCanvasElement.
export type CropSource = CanvasImageSource & { width: number; height: number };

// ── BBox dos landmarks, expandido e quadrado ─────────────────────────────────
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

// ── Região dos olhos dentro do crop (P4.5) ───────────────────────────────────
//
// A especificação de `P4.5` pede CLAHE "apenas na região dos olhos, não no crop
// facial inteiro". Para isso é preciso levar a região ocular pela MESMA
// transformação que o crop aplica: bbox expandido → quadrado → resize para
// `INPUT_SIZE` → flip horizontal quando espelhado.
//
// Errar essa transformação não produz erro nenhum: produz uma equalização sobre
// pele e sobrancelha, com a íris de fora. Silencioso, como quase tudo por aqui.

/** Cantos oculares no Face Mesh: externo e interno de cada olho. */
const LM_CANTO_EXTERNO_ESQ = 33;
const LM_CANTO_INTERNO_ESQ = 133;
const LM_CANTO_INTERNO_DIR = 362;
const LM_CANTO_EXTERNO_DIR = 263;

/**
 * Folga vertical, em múltiplos da distância cantal.
 *
 * Os quatro cantos são praticamente colineares num rosto frontal, então a
 * altura derivada só deles seria ~zero. 0,22 × a distância cantal cobre
 * pálpebra superior, íris e sombra inferior — o gradiente que o landmark usa.
 */
const FOLGA_VERTICAL = 0.22;

/** Folga horizontal, em múltiplos da distância cantal. Pequena: os cantos já
 *  são os extremos horizontais do que interessa. */
const FOLGA_HORIZONTAL = 0.06;

export interface CropRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Região ocular em coordenadas do crop `INPUT_SIZE²`, ou `null` quando não dá
 * para determinar (landmarks ausentes, vídeo sem dimensão, bbox degenerado).
 *
 * `null` é resposta, não falha: o chamador aplica CLAHE no crop inteiro ou
 * pula o estágio, mas não age sobre um retângulo inventado.
 */
export function eyeRegionInCrop(
  landmarks: readonly Point2D[],
  imageWidth: number,
  imageHeight: number,
  expandFactor: number = EXPAND_FACTOR,
  isMirrored = false,
  inputSize: number = INPUT_SIZE,
): CropRegion | null {
  if (!(imageWidth > 0) || !(imageHeight > 0)) return null;
  const idx = [LM_CANTO_EXTERNO_ESQ, LM_CANTO_INTERNO_ESQ, LM_CANTO_INTERNO_DIR, LM_CANTO_EXTERNO_DIR];
  if (landmarks.length <= LM_CANTO_EXTERNO_DIR) return null;
  const pts = idx.map((i) => landmarks[i]);
  if (pts.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;

  const bbox = computeSquareBBox(landmarks, imageWidth, imageHeight, expandFactor);
  if (!(bbox.side > 0)) return null;

  const xsPx = pts.map((p) => p.x * imageWidth);
  const ysPx = pts.map((p) => p.y * imageHeight);
  const cantal = Math.hypot(
    (pts[3].x - pts[0].x) * imageWidth,
    (pts[3].y - pts[0].y) * imageHeight,
  );
  if (!(cantal > 0)) return null;

  const minXpx = Math.min(...xsPx) - cantal * FOLGA_HORIZONTAL;
  const maxXpx = Math.max(...xsPx) + cantal * FOLGA_HORIZONTAL;
  const minYpx = Math.min(...ysPx) - cantal * FOLGA_VERTICAL;
  const maxYpx = Math.max(...ysPx) + cantal * FOLGA_VERTICAL;

  const escala = inputSize / bbox.side;
  let x0 = (minXpx - bbox.x) * escala;
  let x1 = (maxXpx - bbox.x) * escala;
  const y0 = (minYpx - bbox.y) * escala;
  const y1 = (maxYpx - bbox.y) * escala;

  if (isMirrored) {
    // O crop reflete horizontalmente; a região tem que refletir junto, ou ela
    // aponta para o lado errado do rosto.
    const espelhado0 = inputSize - x1;
    const espelhado1 = inputSize - x0;
    x0 = espelhado0;
    x1 = espelhado1;
  }

  const x = Math.max(0, Math.floor(x0));
  const y = Math.max(0, Math.floor(y0));
  const width = Math.min(inputSize, Math.ceil(x1)) - x;
  const height = Math.min(inputSize, Math.ceil(y1)) - y;
  if (!(width > 0) || !(height > 0)) return null;
  return { x, y, width, height };
}

// ── RGBA HWC → RGB CHW ImageNet-normalizado ──────────────────────────────────
// Puro, sem DOM — testável em Node. Assume src já é 448×448.
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
  return { canvas, ctx };
}

export interface CropOptions {
  landmarks: readonly Point2D[];
  isMirrored: boolean;
  expandFactor?: number;
  context?: CropContext;
  /**
   * Pré-processamento opcional aplicado ao RGBA **antes** da normalização
   * ImageNet (`P4.7`).
   *
   * ⚠️ O contrato é bytes→bytes: recebe `Uint8ClampedArray` 0..255 e devolve
   * outro. A normalização acontece DEPOIS, uma única vez, em
   * `preprocessFromRGBA`. Quem quiser encaixar um estágio novo aqui não
   * pode normalizar — normalizar duas vezes leva 128 de +0,077 para −2,12 e o
   * L2CS responde com ângulos plausíveis sobre lixo, que é o modo de falha de
   * `B3.1`.
   *
   * O implementador em produção é `applyPreprocessRGBA`
   * (`src/preprocess/pipeline.ts`). O tipo é uma função e não o módulo em si
   * para manter `crop.ts` sem dependência do estágio novo quando ele está
   * desligado — que é o default.
   */
  preprocessRGBA?: (rgba: Uint8ClampedArray, size: number) => Uint8ClampedArray;
  /**
   * Lado do crop. Ignorado quando `context` é passado — lá quem manda é o
   * canvas, para não haver duas respostas para a mesma pergunta.
   */
  inputSize?: number;
}

// Dimensões REAIS da fonte de pixels.
//
// BUG histórico: `source.width` num HTMLVideoElement é o atributo HTML
// `width`, que vale 0 quando ninguém o define — e `GazeContext` cria o vídeo
// só com `style` (CSS), nunca com o atributo. Resultado: w = h = 0, todo
// landmark virava px 0, o bbox saía com lado 0, e `drawImage` com sw/sh = 0
// é um NO-OP silencioso. O canvas ficava com o `fillRect('#000')` e o L2CS
// recebia uma imagem 448×448 PRETA em todos os frames.
//
// A intrínseca de um vídeo é `videoWidth`/`videoHeight`; para canvas é
// `width`/`height`. Preferimos a primeira quando existe.
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
  // Falhar alto: um crop degenerado produzia um tensor preto e um gaze
  // constante que o regressor tratava como sinal. Melhor não submeter nada.
  if (!(w > 0) || !(h > 0)) {
    throw new Error(
      `[l2cs] fonte sem dimensões utilizáveis (w=${w}, h=${h}). ` +
      `Num <video>, use videoWidth/videoHeight — o atributo width vale 0 quando ` +
      `só o CSS define o tamanho.`,
    );
  }
  const bbox = computeSquareBBox(opts.landmarks, w, h, opts.expandFactor ?? EXPAND_FACTOR);
  if (!(bbox.side > 0)) {
    throw new Error('[l2cs] bbox degenerado (lado 0) — landmarks vazios ou coincidentes.');
  }
  const ctx = opts.context ?? createCropContext(opts.inputSize ?? INPUT_SIZE);
  const g = ctx.ctx;

  // ⚠️ O CANVAS define o tamanho, não o parâmetro.
  //
  // Quando um contexto é passado (o caso do caminho quente, que reusa o canvas
  // entre frames), o lado tem que ser o dele: desenhar 448 num canvas de 224
  // recortaria três quartos da imagem em silêncio, e `getImageData` devolveria
  // um buffer menor que o declarado. Uma fonte só de verdade, aqui e no worker.
  const size = ctx.canvas.width;

  // Fill preto para regiões fora do frame (o L2CS foi treinado com crops que
  // não vazam do frame; padding preto é convenção comum quando ocorre).
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);

  if (opts.isMirrored) {
    // §E1: L2CS foi treinado com a imagem "como a câmera vê". Se o vídeo do
    // usuário está espelhado (facingMode 'user' com CSS transform ou fluxo
    // já invertido), desespelhamos AQUI para não corromper os termos
    // cruzados de E5 (tan(yaw)·tan(pitch) é ímpar).
    g.save();
    g.translate(size, 0);
    g.scale(-1, 1);
    // A drawImage aceita ir além dos limites do source — a região que
    // extrapola vira transparente (aqui: preto por causa do fillRect prévio).
    (g as CanvasRenderingContext2D).drawImage(
      source,
      bbox.x, bbox.y, bbox.side, bbox.side,
      0, 0, size, size,
    );
    g.restore();
  } else {
    (g as CanvasRenderingContext2D).drawImage(
      source,
      bbox.x, bbox.y, bbox.side, bbox.side,
      0, 0, size, size,
    );
  }

  // getImageData é o gargalo; ~200k pixels a 10 Hz é folgado (< 2 ms típico).
  const imgData = (g as CanvasRenderingContext2D).getImageData(0, 0, size, size);
  // P4.7 — a ordem é CLAHE → gama → normalização, e ela é imposta aqui: o hook
  // recebe e devolve BYTES, e a normalização vem depois, uma vez só.
  const rgba = opts.preprocessRGBA
    ? opts.preprocessRGBA(imgData.data, size)
    : imgData.data;
  return preprocessFromRGBA(rgba, size);
}

// Helper para debug/validação: só a etapa BBox → RGBA (sem normalização).
// Útil para inspecionar visualmente o crop no browser.
export function cropFaceToRGBA(source: CropSource, opts: CropOptions): Uint8ClampedArray {
  const { w, h } = sourceDimensions(source);
  const bbox = computeSquareBBox(opts.landmarks, w, h, opts.expandFactor ?? EXPAND_FACTOR);
  const ctx = opts.context ?? createCropContext(opts.inputSize ?? INPUT_SIZE);
  const g = ctx.ctx;
  const size = ctx.canvas.width;
  g.fillStyle = '#000';
  g.fillRect(0, 0, size, size);

  if (opts.isMirrored) {
    g.save();
    g.translate(size, 0);
    g.scale(-1, 1);
    (g as CanvasRenderingContext2D).drawImage(source, bbox.x, bbox.y, bbox.side, bbox.side, 0, 0, size, size);
    g.restore();
  } else {
    (g as CanvasRenderingContext2D).drawImage(source, bbox.x, bbox.y, bbox.side, bbox.side, 0, 0, size, size);
  }
  return (g as CanvasRenderingContext2D).getImageData(0, 0, size, size).data;
}
