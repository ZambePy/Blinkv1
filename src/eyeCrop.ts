/**
 * eyeCrop.ts — extração em tempo real dos 4 tensores que alimentam o encoder CNN.
 *
 * Replica EXATAMENTE a geometria de preprocess.py:
 *   - Índices de landmarks: LEFT_EYE_IDX / RIGHT_EYE_IDX (mesmos do Python)
 *   - Face bbox: convex hull de todos os 478 landmarks (min/max x,y)
 *   - Eye bbox com margem EYE_MARGIN = 0.4 + truncamento int() via Math.trunc
 *   - Right eye espelhado horizontalmente (flipH = true)
 *   - Rect: 12 valores normalizados por imgW/imgH (mesma ordem do Python)
 *   - Normalização [0,1] float32 por canal
 *
 * Aceita CanvasImageSource (HTMLVideoElement em produção, HTMLImageElement em testes).
 * Retorna null sem lançar em qualquer frame inválido.
 */

import type { EncoderInput } from './irisflow-api';

// ─── Constantes replicadas de preprocess.py ───────────────────────────────────

/** outer-corner, inner-corner, top, bottom (mesmos que _LEFT_EYE_IDX em preprocess.py). */
export const LEFT_EYE_IDX  = [33, 133, 159, 145] as const;
/** inner-corner, outer-corner, top, bottom (mesmos que _RIGHT_EYE_IDX em preprocess.py). */
export const RIGHT_EYE_IDX = [362, 263, 386, 374] as const;
/** Fração de meia-largura adicionada como padding em cada lado (EYE_MARGIN = 0.4). */
export const EYE_MARGIN = 0.4;

// ─── Tipos ────────────────────────────────────────────────────────────────────

/** Bounding box em pixels inteiros (x2/y2 exclusivo, w/h = x2-x1). */
export interface PixelBox {
  x1: number; y1: number;
  x2: number; y2: number;
  w:  number; h:  number;
}

// ─── Funções de geometria pura (exportadas para testes unitários) ─────────────

/**
 * Bounding box de landmarks selecionados em espaço de pixel.
 * Coordenadas normalizadas [0,1] são multiplicadas por imgW/imgH.
 */
export function lmBbox(
  landmarks: ReadonlyArray<{ x: number; y: number }>,
  indices: ReadonlyArray<number>,
  imgW: number,
  imgH: number,
): [number, number, number, number] {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const i of indices) {
    const x = landmarks[i].x * imgW;
    const y = landmarks[i].y * imgH;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return [minX, minY, maxX, maxY];
}

/**
 * Aplica margem ao bbox do olho e clamp nos limites da imagem.
 *
 * Replica _crop_eye() de preprocess.py incluindo truncamento via Math.trunc
 * (equivalente a int() do Python para valores que passam pelo max(0,...)):
 *   cx, cy = centro; hw = half_width*(1+margin); hh = half_height*(1+margin)
 *   bx  = max(0,    trunc(cx - hw))
 *   by  = max(0,    trunc(cy - hh))
 *   bx2 = min(imgW, trunc(cx + hw))
 *   by2 = min(imgH, trunc(cy + hh))
 */
export function eyeBboxWithMargin(
  x1: number, y1: number, x2: number, y2: number,
  margin: number,
  imgW: number, imgH: number,
): PixelBox | null {
  const cx = (x1 + x2) * 0.5;
  const cy = (y1 + y2) * 0.5;
  const hw = (x2 - x1) * 0.5 * (1.0 + margin);
  const hh = (y2 - y1) * 0.5 * (1.0 + margin);
  const bx  = Math.max(0,    Math.trunc(cx - hw));
  const by  = Math.max(0,    Math.trunc(cy - hh));
  const bx2 = Math.min(imgW, Math.trunc(cx + hw));
  const by2 = Math.min(imgH, Math.trunc(cy + hh));
  const w = bx2 - bx, h = by2 - by;
  if (w <= 0 || h <= 0) return null;
  return { x1: bx, y1: by, x2: bx2, y2: by2, w, h };
}

/**
 * Face bbox = convex hull de todos os 478 landmarks (min/max x,y).
 * Replica o bloco "face bbox from full mesh convex hull" de preprocess.py.
 */
export function faceBbox(
  landmarks: ReadonlyArray<{ x: number; y: number }>,
  imgW: number,
  imgH: number,
): PixelBox | null {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const lm of landmarks) {
    const x = lm.x * imgW;
    const y = lm.y * imgH;
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  const x1 = Math.max(0,    Math.trunc(minX));
  const y1 = Math.max(0,    Math.trunc(minY));
  const x2 = Math.min(imgW, Math.trunc(maxX));
  const y2 = Math.min(imgH, Math.trunc(maxY));
  const w = x2 - x1, h = y2 - y1;
  if (w <= 0 || h <= 0) return null;
  return { x1, y1, x2, y2, w, h };
}

/**
 * Constrói o vetor rect de 12 valores normalizados.
 * Ordem idêntica à de preprocess.py:
 *   [fw/W, fh/H, fx1/W, fy1/H,
 *    le_w/W, le_h/H, le_x1/W, le_y1/H,
 *    re_w/W, re_h/H, re_x1/W, re_y1/H]
 */
export function buildRect(
  face: PixelBox, le: PixelBox, re: PixelBox,
  imgW: number, imgH: number,
): Float32Array {
  return new Float32Array([
    face.w / imgW, face.h / imgH, face.x1 / imgW, face.y1 / imgH,
    le.w   / imgW, le.h   / imgH, le.x1   / imgW, le.y1   / imgH,
    re.w   / imgW, re.h   / imgH, re.x1   / imgW, re.y1   / imgH,
  ]);
}

// ─── Utilitários de Canvas ────────────────────────────────────────────────────

function rgbaToRgbF32(data: Uint8ClampedArray, nPx: number): Float32Array {
  const out = new Float32Array(nPx * 3);
  for (let i = 0, j = 0; i < nPx * 4; i += 4, j += 3) {
    out[j]     = data[i]     / 255.0;
    out[j + 1] = data[i + 1] / 255.0;
    out[j + 2] = data[i + 2] / 255.0;
  }
  return out;
}

function drawCrop(
  ctx: OffscreenCanvasRenderingContext2D,
  source: CanvasImageSource,
  box: PixelBox,
  outW: number, outH: number,
  flipH: boolean,
): Float32Array {
  if (flipH) {
    ctx.save();
    ctx.translate(outW, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(source, box.x1, box.y1, box.w, box.h, 0, 0, outW, outH);
    ctx.restore();
  } else {
    ctx.drawImage(source, box.x1, box.y1, box.w, box.h, 0, 0, outW, outH);
  }
  return rgbaToRgbF32(ctx.getImageData(0, 0, outW, outH).data, outW * outH);
}

// ─── Cache de OffscreenCanvas (reutilizados entre frames) ────────────────────

let _faceCanvas: OffscreenCanvas | null = null;
let _leCanvas:   OffscreenCanvas | null = null;
let _reCanvas:   OffscreenCanvas | null = null;

function _ensureCanvas(cur: OffscreenCanvas | null, w: number, h: number): OffscreenCanvas {
  if (cur && cur.width === w && cur.height === h) return cur;
  return new OffscreenCanvas(w, h);
}

// ─── Log de falhas para diagnóstico de campo ─────────────────────────────────

interface FailEntry { ts: number; reason: string; consecutive: number }

const _failLog: FailEntry[] = [];
const _FAIL_LOG_MAX  = 200;
const _STREAK_WARN   = 30;  // ~1 s a 30 fps
let   _streak        = 0;

function _onFail(reason: string): null {
  _streak++;
  // Log primeira ocorrência de cada série e a cada _STREAK_WARN frames
  if (_streak === 1 || _streak % _STREAK_WARN === 0) {
    const entry: FailEntry = { ts: Date.now(), reason, consecutive: _streak };
    _failLog.push(entry);
    if (_failLog.length > _FAIL_LOG_MAX) _failLog.shift();
  }
  if (_streak >= _STREAK_WARN && _streak % _STREAK_WARN === 0) {
    console.warn(`[eyeCrop] ${_streak} frames consecutivos sem crop: ${reason}`);
  }
  return null;
}

function _onSuccess(): void { _streak = 0; }

/** Retorna cópia do log de falhas em memória. */
export function getEyeCropFailureLog(): FailEntry[] { return [..._failLog]; }

/**
 * Dispara download do log de falhas como JSON.
 * Equivalente ao exportGazeDistanceLog() de calibration.ts.
 */
export function exportEyeCropLog(): void {
  const blob = new Blob([JSON.stringify(_failLog, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href     = url;
  a.download = `eyecrop_log_${Date.now()}.json`;
  a.click();
  URL.revokeObjectURL(url);
}

// ─── Função principal ─────────────────────────────────────────────────────────

/**
 * Extrai os 4 tensores do encoder CNN a partir de um frame ao vivo.
 *
 * @param source   Fonte de imagem (HTMLVideoElement em produção, HTMLImageElement em testes).
 * @param landmarks Array de 478 pontos normalizados [0,1] do MediaPipe FaceLandmarker.
 * @param imgW     Largura do frame em pixels (video.videoWidth).
 * @param imgH     Altura do frame em pixels (video.videoHeight).
 * @returns EncoderInput pronto para runEncoderInference(), ou null se o frame for inválido.
 */
export function extractCrops(
  source: CanvasImageSource,
  landmarks: ReadonlyArray<{ x: number; y: number }>,
  imgW: number,
  imgH: number,
): EncoderInput | null {
  if (landmarks.length < 478) return _onFail('insufficient landmarks');
  if (imgW <= 0 || imgH <= 0)  return _onFail('invalid dimensions');

  const face = faceBbox(landmarks, imgW, imgH);
  if (!face) return _onFail('empty face bbox');

  const [leX1, leY1, leX2, leY2] = lmBbox(landmarks, LEFT_EYE_IDX, imgW, imgH);
  const le = eyeBboxWithMargin(leX1, leY1, leX2, leY2, EYE_MARGIN, imgW, imgH);
  if (!le) return _onFail('empty left-eye bbox');

  const [reX1, reY1, reX2, reY2] = lmBbox(landmarks, RIGHT_EYE_IDX, imgW, imgH);
  const re = eyeBboxWithMargin(reX1, reY1, reX2, reY2, EYE_MARGIN, imgW, imgH);
  if (!re) return _onFail('empty right-eye bbox');

  _faceCanvas = _ensureCanvas(_faceCanvas, 224, 224);
  _leCanvas   = _ensureCanvas(_leCanvas,   112, 112);
  _reCanvas   = _ensureCanvas(_reCanvas,   112, 112);

  const faceCtx = _faceCanvas.getContext('2d');
  const leCtx   = _leCanvas.getContext('2d');
  const reCtx   = _reCanvas.getContext('2d');
  if (!faceCtx || !leCtx || !reCtx) return _onFail('canvas context unavailable');

  const result: EncoderInput = {
    face:     drawCrop(faceCtx, source, face, 224, 224, false),
    leftEye:  drawCrop(leCtx,   source, le,   112, 112, false),
    rightEye: drawCrop(reCtx,   source, re,   112, 112, true),   // espelhado
    rect:     buildRect(face, le, re, imgW, imgH),
  };

  _onSuccess();
  return result;
}
