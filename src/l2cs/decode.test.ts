import { describe, it, expect } from 'vitest';
import { softmax, decodeAngleDeg, degToRad } from './decode';

describe('softmax', () => {
  it('normaliza para soma 1', () => {
    const p = softmax([1, 2, 3, 4]);
    const s = p.reduce((a, b) => a + b, 0);
    expect(s).toBeCloseTo(1, 12);
  });

  it('é numericamente estável para logits grandes', () => {
    const p = softmax([1000, 1001, 1002]);
    const s = p.reduce((a, b) => a + b, 0);
    expect(Number.isFinite(s)).toBe(true);
    expect(s).toBeCloseTo(1, 12);
    // maior peso deve estar no maior logit
    expect(p[2]).toBeGreaterThan(p[1]);
    expect(p[1]).toBeGreaterThan(p[0]);
  });

  it('logits uniformes → distribuição uniforme', () => {
    const p = softmax(new Array(90).fill(0));
    for (const v of p) expect(v).toBeCloseTo(1 / 90, 10);
  });
});

describe('decodeAngleDeg (Gaze360: 90 bins × 4°, offset -180°)', () => {
  const binWidth = 4;
  const binOffset = -180;

  it('distribuição uniforme → média dos centros dos bins', () => {
    // centros dos bins: -180, -176, -172, ..., 176. Média = -2 (não -178,
    // porque os bins cobrem [-180, 180[ deslocados por i*4-180).
    const logits = new Array(90).fill(0);
    const deg = decodeAngleDeg(logits, binWidth, binOffset);
    // Σ(i*4-180)/90 para i=0..89 = 4*(0+..+89)/90 - 180 = 4*4005/90 - 180 = 178 - 180 = -2
    expect(deg).toBeCloseTo(-2, 6);
  });

  it('bin único ativado → ângulo desse bin', () => {
    // logits com um único bin fortemente ativado (softmax concentra ~100%)
    const logits = new Array(90).fill(0);
    logits[45] = 100; // bin i=45 → 45*4 - 180 = 0°
    const deg = decodeAngleDeg(logits, binWidth, binOffset);
    expect(deg).toBeCloseTo(0, 3);
  });

  it('primeiro bin ativado → -180°', () => {
    const logits = new Array(90).fill(0);
    logits[0] = 100;
    const deg = decodeAngleDeg(logits, binWidth, binOffset);
    expect(deg).toBeCloseTo(-180, 3);
  });

  it('último bin ativado → 176°', () => {
    const logits = new Array(90).fill(0);
    logits[89] = 100;
    const deg = decodeAngleDeg(logits, binWidth, binOffset);
    expect(deg).toBeCloseTo(176, 3);
  });
});

describe('degToRad', () => {
  it('0° = 0 rad', () => expect(degToRad(0)).toBe(0));
  it('180° = π rad', () => expect(degToRad(180)).toBeCloseTo(Math.PI, 12));
  it('-90° = -π/2 rad', () => expect(degToRad(-90)).toBeCloseTo(-Math.PI / 2, 12));
});
