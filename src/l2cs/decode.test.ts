import { describe, it, expect } from 'vitest';
import { softmax, decodeAngleDeg, decodeAngleCircularDeg, decodeAngleWithConfidence, degToRad } from './decode';

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

// confidence = 1 - H/H_max, onde H = -Σ p·log(p) da softmax.
// 0 = distribuição uniforme (incerteza total, sinal inutil), 1 = massa
// concentrada num único bin (certeza total).
describe('decodeAngleWithConfidence', () => {
  const binWidth = 4;
  const binOffset = -180;

  it('devolve o mesmo ângulo que decodeAngleCircularDeg', () => {
    // B3.1 — a paridade agora é com a decodificação CIRCULAR, não com a
    // linear. Antes deste bug as duas coincidiam por acidente (`decodeAngleDeg`
    // era a única implementação); a diferença aparece justamente quando a
    // distribuição tem massa perto do wrap, que é o caso do crop degenerado
    // que a média linear transformava num plausível ~−2°.
    const logits = [0, 1, 5, 2, 1, 0.5];
    const circular = decodeAngleCircularDeg(logits, binWidth, binOffset);
    const { deg } = decodeAngleWithConfidence(logits, binWidth, binOffset);
    expect(deg).toBeCloseTo(circular, 12);
  });

  it('a decodificação linear NÃO é mais o contrato de produção', () => {
    // Trava a fronteira: se alguém reverter `decodeAngleWithConfidence` para a
    // média linear, este teste falha. Numa distribuição concentrada longe do
    // wrap as duas quase coincidem, então é preciso um caso com massa nas
    // pontas para a diferença ser visível.
    const logits = new Array<number>(90).fill(0);
    logits[0] = 30;
    logits[89] = 30;
    const linear = decodeAngleDeg(logits, binWidth, binOffset);
    const { deg } = decodeAngleWithConfidence(logits, binWidth, binOffset);
    expect(Math.abs(linear)).toBeLessThan(10);      // ~−2°: o bug
    expect(Math.abs(deg)).toBeGreaterThan(170);     // ~178°: a verdade
  });

  it('distribuição uniforme (todos os logits iguais) → confidence = 0', () => {
    const logits = new Array(90).fill(0);
    const { confidence } = decodeAngleWithConfidence(logits, binWidth, binOffset);
    expect(confidence).toBeCloseTo(0, 12);
  });

  it('massa concentrada num único bin → confidence ≈ 1', () => {
    const logits = new Array(90).fill(0);
    logits[45] = 100; // softmax ~= delta em 45 → entropia ≈ 0
    const { confidence } = decodeAngleWithConfidence(logits, binWidth, binOffset);
    expect(confidence).toBeGreaterThan(0.999);
    expect(confidence).toBeLessThanOrEqual(1);
  });

  it('confidence ∈ [0, 1] para logits patológicos', () => {
    // Logits com valores muito grandes/negativos — softmax ainda deve produzir
    // uma distribuição bem definida e confidence dentro dos limites.
    const cases = [
      [1000, 1001, 999, 1002],
      [-1000, -1001, -999],
      new Array(90).fill(0).map((_, i) => (i === 30 ? 50 : 0)),
      new Array(90).fill(0).map((_, i) => (i === 60 ? -50 : 0)),
    ];
    for (const logits of cases) {
      const { confidence } = decodeAngleWithConfidence(logits, binWidth, binOffset);
      expect(confidence).toBeGreaterThanOrEqual(0);
      expect(confidence).toBeLessThanOrEqual(1);
      expect(Number.isFinite(confidence)).toBe(true);
    }
  });

  it('distribuição bimodal (dois bins fortes, resto ~0) → confidence intermediário', () => {
    // Dois bins bem ativados dão H = log(2), H_max = log(90),
    // confidence = 1 - log(2)/log(90) ≈ 1 - 0.154 = 0.846.
    const logits = new Array(90).fill(-1e6);
    logits[10] = 0;
    logits[80] = 0;
    const { confidence } = decodeAngleWithConfidence(logits, binWidth, binOffset);
    const expected = 1 - Math.log(2) / Math.log(90);
    expect(confidence).toBeCloseTo(expected, 6);
  });

  it('distribuição concentrada em k bins iguais → confidence = 1 - log(k)/log(N)', () => {
    // Generalização do caso bimodal. Serve para o consumidor calibrar
    // um limiar de "confiança suficiente" com base em quantos bins estão
    // efetivamente competindo.
    const N = 90;
    for (const k of [1, 3, 10, 45, 90]) {
      const logits = new Array(N).fill(-1e6);
      for (let i = 0; i < k; i++) logits[i] = 0;
      const { confidence } = decodeAngleWithConfidence(logits, binWidth, binOffset);
      const expected = k === 1 ? 1 : 1 - Math.log(k) / Math.log(N);
      expect(confidence).toBeCloseTo(expected, 6);
    }
  });

  it('N=1 (bin único no vetor) → confidence = 1 por convenção (não há incerteza a medir)', () => {
    const { confidence } = decodeAngleWithConfidence([0], 4, 0);
    expect(confidence).toBe(1);
  });
});
