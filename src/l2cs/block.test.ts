import { describe, it, expect } from 'vitest';
import { buildL2CSBlock, L2CS_BLOCK_DIM } from './block';

describe('buildL2CSBlock', () => {
  it('valid=false → 7 zeros independente dos outros inputs', () => {
    const b = buildL2CSBlock(0.5, -0.3, false, 5.0);
    expect(b).toHaveLength(L2CS_BLOCK_DIM);
    expect(b.every((v) => v === 0)).toBe(true);
  });

  it('valid=true com (yaw=0, pitch=0) → 7 zeros', () => {
    const b = buildL2CSBlock(0, 0, true, 42);
    // tan(0)=0 → todos os 7 termos = 0
    expect(b).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('layout: ordem exata dos 7 termos', () => {
    const yaw = Math.PI / 6;   // 30°
    const pitch = Math.PI / 8; // 22.5°
    const d = 3;
    const ty = Math.tan(yaw);
    const tp = Math.tan(pitch);
    const b = buildL2CSBlock(yaw, pitch, true, d);
    expect(b[0]).toBeCloseTo(ty, 12);            // tan(yaw)
    expect(b[1]).toBeCloseTo(tp, 12);            // tan(pitch)
    expect(b[2]).toBeCloseTo(ty * d, 12);         // tan(yaw) * d
    expect(b[3]).toBeCloseTo(tp * d, 12);         // tan(pitch) * d
    expect(b[4]).toBeCloseTo(ty * ty, 12);        // tan(yaw)²
    expect(b[5]).toBeCloseTo(tp * tp, 12);        // tan(pitch)²
    expect(b[6]).toBeCloseTo(ty * tp, 12);        // cross
  });

  it('clamp ±π/4: yaw extremo → tan clampeado a ±1', () => {
    const bPos = buildL2CSBlock(Math.PI, 0, true, 1); // clampeia p/ +π/4
    const bNeg = buildL2CSBlock(-Math.PI, 0, true, 1); // clampeia p/ -π/4
    expect(bPos[0]).toBeCloseTo(1, 12);   // tan(π/4) = 1
    expect(bNeg[0]).toBeCloseTo(-1, 12);  // tan(-π/4) = -1
    // Termos quadráticos ficam 1 nos dois casos (par)
    expect(bPos[4]).toBeCloseTo(1, 12);
    expect(bNeg[4]).toBeCloseTo(1, 12);
  });

  it('clamp ±π/4: pitch extremo → tan clampeado a ±1', () => {
    const b = buildL2CSBlock(0, -10, true, 1);
    expect(b[1]).toBeCloseTo(-1, 12); // tan(-π/4)
    expect(b[5]).toBeCloseTo(1, 12);  // (-1)² = 1
  });

  it('sem clamp para valores intermediários (yaw = π/6 dentro do range)', () => {
    const b = buildL2CSBlock(Math.PI / 6, 0, true, 1);
    // tan(π/6) = 1/√3 ≈ 0.5774
    expect(b[0]).toBeCloseTo(Math.tan(Math.PI / 6), 12);
  });

  it('dProxy escala linearmente termos 3 e 4', () => {
    const b1 = buildL2CSBlock(0.1, 0.2, true, 1);
    const b2 = buildL2CSBlock(0.1, 0.2, true, 3);
    expect(b2[2]).toBeCloseTo(b1[2] * 3, 12);
    expect(b2[3]).toBeCloseTo(b1[3] * 3, 12);
    // Termos independentes de d não devem mudar
    expect(b2[0]).toBeCloseTo(b1[0], 12);
    expect(b2[1]).toBeCloseTo(b1[1], 12);
    expect(b2[4]).toBeCloseTo(b1[4], 12);
    expect(b2[5]).toBeCloseTo(b1[5], 12);
    expect(b2[6]).toBeCloseTo(b1[6], 12);
  });

  it('termo cruzado (7) é ímpar sob inversão de yaw', () => {
    // Este é o teste que a doc destaca: tan(yaw)·tan(pitch) muda de sinal
    // com yaw (é o motivo de desespelhar antes de E4, não depois).
    const b1 = buildL2CSBlock(0.3, 0.2, true, 1);
    const b2 = buildL2CSBlock(-0.3, 0.2, true, 1);
    expect(b2[6]).toBeCloseTo(-b1[6], 12);
    // Termos quadráticos permanecem iguais (pares)
    expect(b2[4]).toBeCloseTo(b1[4], 12);
    expect(b2[5]).toBeCloseTo(b1[5], 12);
  });

  it('sempre retorna array de tamanho L2CS_BLOCK_DIM', () => {
    expect(buildL2CSBlock(0, 0, true, 0)).toHaveLength(L2CS_BLOCK_DIM);
    expect(buildL2CSBlock(0, 0, false, 0)).toHaveLength(L2CS_BLOCK_DIM);
    expect(buildL2CSBlock(1e6, 1e6, true, 1e6)).toHaveLength(L2CS_BLOCK_DIM);
  });

  it('sem NaN/Infinity mesmo com inputs patológicos', () => {
    // Inputs extremos que sem clamp iriam para infinity via tan
    const b = buildL2CSBlock(Math.PI / 2 - 1e-12, Math.PI / 2 - 1e-12, true, 1e6);
    for (const v of b) {
      expect(Number.isFinite(v)).toBe(true);
    }
  });
});
