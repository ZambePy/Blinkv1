/**
 * eyeCrop.geometry.test.ts
 *
 * Valida as funções de geometria pura de eyeCrop.ts contra os valores
 * de referência computados pelo preprocess.py Python. Esses valores devem
 * ser EXATAMENTE iguais (sem tolerância) porque determinam qual região da
 * imagem é recortada — qualquer divergência aqui causa train/serve skew.
 *
 * Não usa Canvas nem DOM de imagem — roda em jsdom puro (Node.js).
 */

import { describe, it, expect } from 'vitest';
import {
  lmBbox,
  eyeBboxWithMargin,
  faceBbox,
  buildRect,
  LEFT_EYE_IDX,
  RIGHT_EYE_IDX,
  EYE_MARGIN,
} from './eyeCrop';

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Cria array de 478 landmarks todos em (0.5, 0.5, 0), depois sobrescreve posições. */
function makeLandmarks(overrides: Record<number, { x: number; y: number }>): Array<{ x: number; y: number; z: number }> {
  const lm = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  for (const [idx, pt] of Object.entries(overrides)) {
    lm[Number(idx)] = { x: pt.x, y: pt.y, z: 0 };
  }
  return lm;
}

// ─── lmBbox ───────────────────────────────────────────────────────────────────

describe('lmBbox', () => {
  it('retorna o bbox correto dos landmarks do olho esquerdo', () => {
    // Simula landmarks num frame 1000×1000:
    //   33: outer-corner (0.3, 0.4) → pixel (300, 400)
    //  133: inner-corner (0.4, 0.4) → pixel (400, 400)
    //  159: top          (0.35, 0.38) → pixel (350, 380)
    //  145: bottom       (0.35, 0.42) → pixel (350, 420)
    const lm = makeLandmarks({
      33:  { x: 0.3,  y: 0.4  },
      133: { x: 0.4,  y: 0.4  },
      159: { x: 0.35, y: 0.38 },
      145: { x: 0.35, y: 0.42 },
    });

    const [x1, y1, x2, y2] = lmBbox(lm, LEFT_EYE_IDX, 1000, 1000);
    expect(x1).toBe(300);
    expect(y1).toBe(380);
    expect(x2).toBe(400);
    expect(y2).toBe(420);
  });

  it('retorna o bbox correto dos landmarks do olho direito', () => {
    // 362: inner-corner, 263: outer-corner, 386: top, 374: bottom
    const lm = makeLandmarks({
      362: { x: 0.55, y: 0.4  },
      263: { x: 0.65, y: 0.4  },
      386: { x: 0.60, y: 0.38 },
      374: { x: 0.60, y: 0.42 },
    });

    const [x1, y1, x2, y2] = lmBbox(lm, RIGHT_EYE_IDX, 1000, 1000);
    expect(x1).toBe(550);
    expect(y1).toBe(380);
    expect(x2).toBe(650);
    expect(y2).toBe(420);
  });
});

// ─── eyeBboxWithMargin ────────────────────────────────────────────────────────

describe('eyeBboxWithMargin', () => {
  // Caso base: olho esquerdo do teste lmBbox acima.
  // x1=300, y1=380, x2=400, y2=420, margin=0.4, img=1000×1000
  //   cx=350, cy=400
  //   hw = (400-300)/2 * 1.4 = 50 * 1.4 = 70
  //   hh = (420-380)/2 * 1.4 = 20 * 1.4 = 28
  //   bx  = max(0, trunc(350-70)) = 280
  //   by  = max(0, trunc(400-28)) = 372
  //   bx2 = min(1000, trunc(350+70)) = 420
  //   by2 = min(1000, trunc(400+28)) = 428
  //   w=140, h=56
  it('calcula bbox com margem identicamente ao Python _crop_eye()', () => {
    const box = eyeBboxWithMargin(300, 380, 400, 420, EYE_MARGIN, 1000, 1000);
    expect(box).not.toBeNull();
    expect(box!.x1).toBe(280);
    expect(box!.y1).toBe(372);
    expect(box!.x2).toBe(420);
    expect(box!.y2).toBe(428);
    expect(box!.w).toBe(140);
    expect(box!.h).toBe(56);
  });

  it('usa Math.trunc (Python int()) — não Math.floor', () => {
    // x1=300.5, x2=401.3, y1=379.2, y2=421.6, margin=0.4, img=1000×1000
    //   cx = (300.5+401.3)/2 = 350.9    cy = (379.2+421.6)/2 = 400.4
    //   hw = (401.3-300.5)/2 * 1.4 = 50.4 * 1.4 = 70.56
    //   hh = (421.6-379.2)/2 * 1.4 = 21.2 * 1.4 = 29.68
    //   bx  = trunc(350.9 - 70.56) = trunc(280.34) = 280
    //   by  = trunc(400.4 - 29.68) = trunc(370.72) = 370
    //   bx2 = trunc(350.9 + 70.56) = trunc(421.46) = 421
    //   by2 = trunc(400.4 + 29.68) = trunc(430.08) = 430
    const box = eyeBboxWithMargin(300.5, 379.2, 401.3, 421.6, EYE_MARGIN, 1000, 1000);
    expect(box).not.toBeNull();
    expect(box!.x1).toBe(280);
    expect(box!.y1).toBe(370);
    expect(box!.x2).toBe(421);
    expect(box!.y2).toBe(430);
  });

  it('clamp ao limite da imagem (borda direita/inferior)', () => {
    // Olho próximo ao canto: sem clamp bx2=900+70=970 > img_w=800 → clamp para 800
    // x1=800, y1=700, x2=900 — img 800×800
    // cx=850, cy=750, hw=50*1.4=70, hh=20*1.4=28 (sem margem seria 50x20)
    // Se x2 > imgW → x2 = 800 → w = 800 - max(0,trunc(780)) = 800 - 780 = 20
    // bx = trunc(850-70) = 780, bx2 = min(800, trunc(920)) = 800
    const box = eyeBboxWithMargin(800, 700, 900, 740, EYE_MARGIN, 800, 800);
    expect(box).not.toBeNull();
    expect(box!.x1).toBe(780);
    expect(box!.x2).toBe(800);
    expect(box!.w).toBe(20);
  });

  it('retorna null se bbox degenera (w ou h = 0)', () => {
    // Todos landmarks no mesmo ponto → w=0
    const box = eyeBboxWithMargin(500, 500, 500, 500, EYE_MARGIN, 1000, 1000);
    expect(box).toBeNull();
  });
});

// ─── faceBbox ─────────────────────────────────────────────────────────────────

describe('faceBbox', () => {
  it('usa TODOS os landmarks (convex hull min/max) como o Python', () => {
    // Todos em (0.5, 0.5) exceto landmarks externos que definem o bbox
    const lm = makeLandmarks({
      0:   { x: 0.05, y: 0.1  },   // min-x não é min-y
      100: { x: 0.5,  y: 0.02 },   // min-y
      200: { x: 0.95, y: 0.6  },   // max-x
      300: { x: 0.5,  y: 0.98 },   // max-y
    });
    // Para img 1280×720:
    //   minX = 0.05*1280 = 64     → trunc = 64
    //   minY = 0.02*720  = 14.4   → trunc = 14
    //   maxX = 0.95*1280 = 1216   → trunc = 1216
    //   maxY = 0.98*720  = 705.6  → trunc = 705
    const box = faceBbox(lm, 1280, 720);
    expect(box).not.toBeNull();
    expect(box!.x1).toBe(64);
    expect(box!.y1).toBe(14);
    expect(box!.x2).toBe(1216);
    expect(box!.y2).toBe(705);
    expect(box!.w).toBe(1152);
    expect(box!.h).toBe(691);
  });

  it('clamp a zero (landmarks negativos são impossíveis, mas clamp protege)', () => {
    const lm = makeLandmarks({ 0: { x: 0.0, y: 0.0 }, 1: { x: 1.0, y: 1.0 } });
    const box = faceBbox(lm, 640, 480);
    expect(box).not.toBeNull();
    expect(box!.x1).toBe(0);
    expect(box!.y1).toBe(0);
    expect(box!.x2).toBe(640);
    expect(box!.y2).toBe(480);
  });

  it('retorna null com array de landmarks vazio', () => {
    expect(faceBbox([], 640, 480)).toBeNull();
  });
});

// ─── buildRect ────────────────────────────────────────────────────────────────

describe('buildRect', () => {
  it('produz 12 valores normalizados na mesma ordem do Python', () => {
    // Python rect layout:
    //   [fw/W, fh/H, fx1/W, fy1/H,
    //    le_w/W, le_h/H, le_x1/W, le_y1/H,
    //    re_w/W, re_h/H, re_x1/W, re_y1/H]
    const face: import('./eyeCrop').PixelBox = { x1: 100, y1:  50, x2: 900, y2: 700, w: 800, h: 650 };
    const le:   import('./eyeCrop').PixelBox = { x1: 200, y1: 200, x2: 380, y2: 280, w: 180, h:  80 };
    const re:   import('./eyeCrop').PixelBox = { x1: 600, y1: 200, x2: 800, y2: 280, w: 200, h:  80 };
    const imgW = 1280, imgH = 720;

    const rect = buildRect(face, le, re, imgW, imgH);
    expect(rect.length).toBe(12);

    // face
    expect(rect[0]).toBeCloseTo(800 / 1280);   // fw/W
    expect(rect[1]).toBeCloseTo(650 / 720);    // fh/H
    expect(rect[2]).toBeCloseTo(100 / 1280);   // fx1/W
    expect(rect[3]).toBeCloseTo(50  / 720);    // fy1/H
    // left eye
    expect(rect[4]).toBeCloseTo(180 / 1280);   // le_w/W
    expect(rect[5]).toBeCloseTo(80  / 720);    // le_h/H
    expect(rect[6]).toBeCloseTo(200 / 1280);   // le_x1/W
    expect(rect[7]).toBeCloseTo(200 / 720);    // le_y1/H
    // right eye
    expect(rect[8]).toBeCloseTo(200 / 1280);   // re_w/W
    expect(rect[9]).toBeCloseTo(80  / 720);    // re_h/H
    expect(rect[10]).toBeCloseTo(600 / 1280);  // re_x1/W
    expect(rect[11]).toBeCloseTo(200 / 720);   // re_y1/H
  });

  it('todos os valores estão em [0, 1] para coordenadas válidas', () => {
    const face: import('./eyeCrop').PixelBox = { x1: 0, y1: 0, x2: 640, y2: 480, w: 640, h: 480 };
    const le:   import('./eyeCrop').PixelBox = { x1: 0, y1: 0, x2: 640, y2: 480, w: 640, h: 480 };
    const re:   import('./eyeCrop').PixelBox = { x1: 0, y1: 0, x2: 640, y2: 480, w: 640, h: 480 };
    const rect = buildRect(face, le, re, 640, 480);
    for (let i = 0; i < 12; i++) {
      expect(rect[i]).toBeGreaterThanOrEqual(0);
      expect(rect[i]).toBeLessThanOrEqual(1);
    }
  });
});

// ─── Constantes ───────────────────────────────────────────────────────────────

describe('constantes', () => {
  it('EYE_MARGIN é 0.4 (igual ao Python)', () => {
    expect(EYE_MARGIN).toBe(0.4);
  });

  it('LEFT_EYE_IDX são [33, 133, 159, 145] (igual ao Python _LEFT_EYE_IDX)', () => {
    expect(Array.from(LEFT_EYE_IDX)).toEqual([33, 133, 159, 145]);
  });

  it('RIGHT_EYE_IDX são [362, 263, 386, 374] (igual ao Python _RIGHT_EYE_IDX)', () => {
    expect(Array.from(RIGHT_EYE_IDX)).toEqual([362, 263, 386, 374]);
  });
});
