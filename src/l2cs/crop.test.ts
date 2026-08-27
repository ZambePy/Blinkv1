import { describe, it, expect } from 'vitest';
import {
  computeSquareBBox,
  cropFaceToTensor,
  preprocess448FromRGBA,
  EXPAND_FACTOR,
  IMAGENET_MEAN,
  IMAGENET_STD,
  INPUT_SIZE,
} from './crop';

describe('computeSquareBBox', () => {
  it('landmarks vazios → bbox degenerado usando menor dim', () => {
    const b = computeSquareBBox([], 1280, 720);
    expect(b.side).toBe(720);
  });

  it('rosto centralizado quadrado (400×400) em 1280×720 com expand=1.0', () => {
    // Landmarks nas 4 quinas de um quadrado normalizado
    const cx = 0.5, cy = 0.5;
    const half = 200 / 1280;
    const lms = [
      { x: cx - half, y: cy - 200 / 720 },
      { x: cx + half, y: cy - 200 / 720 },
      { x: cx - half, y: cy + 200 / 720 },
      { x: cx + half, y: cy + 200 / 720 },
    ];
    const b = computeSquareBBox(lms, 1280, 720, 1.0);
    // maior dim = 400 (vertical) → side = 400
    expect(b.side).toBeCloseTo(400, 4);
    // centrado em (640, 360)
    expect(b.x + b.side / 2).toBeCloseTo(640, 4);
    expect(b.y + b.side / 2).toBeCloseTo(360, 4);
  });

  it('expandFactor multiplica o lado', () => {
    const lms = [
      { x: 0.4, y: 0.4 },
      { x: 0.6, y: 0.6 },
    ];
    const b1 = computeSquareBBox(lms, 1000, 1000, 1.0);
    const b2 = computeSquareBBox(lms, 1000, 1000, 2.0);
    expect(b2.side).toBeCloseTo(b1.side * 2, 4);
    // Centro deve permanecer o mesmo
    expect(b2.x + b2.side / 2).toBeCloseTo(b1.x + b1.side / 2, 4);
    expect(b2.y + b2.side / 2).toBeCloseTo(b1.y + b1.side / 2, 4);
  });

  it('resulta em quadrado mesmo quando bbox de landmarks é retangular', () => {
    // Retângulo largo (200 x 100)
    const lms = [
      { x: 0.4, y: 0.45 },
      { x: 0.6, y: 0.55 },
    ];
    const b = computeSquareBBox(lms, 1000, 1000, 1.0);
    // maior lado = 200 (largura) → quadrado 200
    expect(b.side).toBeCloseTo(200, 4);
  });

  it('default EXPAND_FACTOR = 1.4', () => {
    expect(EXPAND_FACTOR).toBe(1.4);
    const lms = [{ x: 0.4, y: 0.4 }, { x: 0.6, y: 0.6 }];
    const bDefault = computeSquareBBox(lms, 1000, 1000);
    const bManual = computeSquareBBox(lms, 1000, 1000, 1.4);
    expect(bDefault.side).toBe(bManual.side);
  });
});

describe('preprocess448FromRGBA', () => {
  it('rejeita tamanho errado', () => {
    expect(() => preprocess448FromRGBA(new Uint8Array(100))).toThrow();
  });

  it('pixel preto (0,0,0) → -mean/std por canal', () => {
    const rgba = new Uint8Array(INPUT_SIZE * INPUT_SIZE * 4); // tudo 0
    const t = preprocess448FromRGBA(rgba);
    const px = INPUT_SIZE * INPUT_SIZE;
    expect(t[0]).toBeCloseTo((0 - IMAGENET_MEAN[0]) / IMAGENET_STD[0], 6);
    expect(t[px]).toBeCloseTo((0 - IMAGENET_MEAN[1]) / IMAGENET_STD[1], 6);
    expect(t[2 * px]).toBeCloseTo((0 - IMAGENET_MEAN[2]) / IMAGENET_STD[2], 6);
  });

  it('pixel branco (255,255,255) → (1-mean)/std por canal', () => {
    const rgba = new Uint8Array(INPUT_SIZE * INPUT_SIZE * 4).fill(255);
    const t = preprocess448FromRGBA(rgba);
    const px = INPUT_SIZE * INPUT_SIZE;
    expect(t[0]).toBeCloseTo((1 - IMAGENET_MEAN[0]) / IMAGENET_STD[0], 6);
    expect(t[px]).toBeCloseTo((1 - IMAGENET_MEAN[1]) / IMAGENET_STD[1], 6);
    expect(t[2 * px]).toBeCloseTo((1 - IMAGENET_MEAN[2]) / IMAGENET_STD[2], 6);
  });

  it('layout NCHW: canal R aparece antes de G antes de B', () => {
    // Pixel único puramente vermelho em (0,0)
    const rgba = new Uint8Array(INPUT_SIZE * INPUT_SIZE * 4);
    rgba[0] = 255; rgba[1] = 0; rgba[2] = 0; rgba[3] = 255;
    const t = preprocess448FromRGBA(rgba);
    const px = INPUT_SIZE * INPUT_SIZE;
    // Posição (0,0) — R canal: valor de branco; G canal: valor de preto; B canal: valor de preto.
    expect(t[0]).toBeCloseTo((1 - IMAGENET_MEAN[0]) / IMAGENET_STD[0], 6);
    expect(t[px]).toBeCloseTo((0 - IMAGENET_MEAN[1]) / IMAGENET_STD[1], 6);
    expect(t[2 * px]).toBeCloseTo((0 - IMAGENET_MEAN[2]) / IMAGENET_STD[2], 6);
  });

  it('tamanho total = 3 × 448 × 448', () => {
    const rgba = new Uint8Array(INPUT_SIZE * INPUT_SIZE * 4);
    const t = preprocess448FromRGBA(rgba);
    expect(t.length).toBe(3 * INPUT_SIZE * INPUT_SIZE);
  });

  it('ignora canal alpha', () => {
    // Todos os pixels R=100, G=100, B=100, A varia — resultado deve ser idêntico
    const a = new Uint8Array(INPUT_SIZE * INPUT_SIZE * 4);
    const b = new Uint8Array(INPUT_SIZE * INPUT_SIZE * 4);
    for (let i = 0; i < INPUT_SIZE * INPUT_SIZE; i++) {
      const j = i * 4;
      a[j] = b[j] = 100;
      a[j+1] = b[j+1] = 100;
      a[j+2] = b[j+2] = 100;
      a[j+3] = 255;
      b[j+3] = 0;
    }
    const ta = preprocess448FromRGBA(a);
    const tb = preprocess448FromRGBA(b);
    // Comparação byte-a-byte via Buffer é O(n) mas evita 600k invocações de expect
    let identical = true;
    for (let i = 0; i < ta.length; i++) {
      if (ta[i] !== tb[i]) { identical = false; break; }
    }
    expect(identical).toBe(true);
  });
});

// ── D10 — regressão do crop preto ───────────────────────────────────────────
//
// Entre D3 e D10 o L2CS recebeu uma imagem 448×448 inteiramente PRETA em todos
// os frames. Causa: `cropFaceToTensor` lia `source.width`, que num
// HTMLVideoElement é o ATRIBUTO HTML `width` (0 quando só o CSS define o
// tamanho — que é exatamente como `GazeContext` cria o vídeo). Com w=h=0 todo
// landmark virava px 0, o bbox saía com lado 0, e `drawImage` com sw/sh=0 é um
// no-op silencioso: sobrava o `fillRect('#000')`.
//
// Sintoma medido em fixtures/replay/*.jsonl: yaw e pitch CONSTANTES em -82,0°
// e -50,6° ao longo de 780 frames válidos (min = mediana = máx).
//
// Estes testes travam as duas metades do conserto: a fonte é medida pela
// dimensão intrínseca, e uma fonte sem dimensão falha alto em vez de produzir
// um tensor preto.
describe('D10 — dimensões da fonte de pixels', () => {
  // Stub mínimo: só o que `cropFaceToTensor` lê antes de tocar no canvas.
  const fakeVideo = (attrW: number, attrH: number, vidW: number, vidH: number) =>
    ({ width: attrW, height: attrH, videoWidth: vidW, videoHeight: vidH }) as unknown as Parameters<typeof cropFaceToTensor>[0];

  const landmarks = [
    { x: 0.4, y: 0.4 }, { x: 0.6, y: 0.4 },
    { x: 0.4, y: 0.6 }, { x: 0.6, y: 0.6 },
  ];

  it('vídeo com atributos width/height zerados falha alto (não devolve tensor preto)', () => {
    // O caso real: CSS define o tamanho, o atributo HTML fica 0, e videoWidth
    // ainda não chegou (metadata não carregada).
    expect(() => cropFaceToTensor(fakeVideo(0, 0, 0, 0), { landmarks, isMirrored: false }))
      .toThrow(/dimensões utilizáveis/);
  });

  it('bbox degenerado (landmarks coincidentes) falha alto', () => {
    const same = [{ x: 0.5, y: 0.5 }, { x: 0.5, y: 0.5 }];
    expect(() => cropFaceToTensor(fakeVideo(0, 0, 1280, 720), { landmarks: same, isMirrored: false }))
      .toThrow(/bbox degenerado/);
  });

  it('computeSquareBBox com dimensões 0 produz lado 0 — a origem do bug', () => {
    // Documenta POR QUE o guarda acima é necessário: sem ele, este bbox seguia
    // para drawImage e virava no-op.
    const bbox = computeSquareBBox(landmarks, 0, 0, EXPAND_FACTOR);
    expect(bbox.side).toBe(0);
  });

  it('com videoWidth/videoHeight reais o bbox tem lado plausível', () => {
    // 1280×720, rosto ocupando 20% da largura → 256 px, × 1.4 = 358.4
    const bbox = computeSquareBBox(landmarks, 1280, 720, EXPAND_FACTOR);
    expect(bbox.side).toBeCloseTo(0.2 * 1280 * EXPAND_FACTOR, 6);
    expect(bbox.side).toBeGreaterThan(0);
  });
});
