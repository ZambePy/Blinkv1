// Decodificação de logits → ângulo em graus/radianos.
// Isolado do worker para permitir teste unitário em Node (sem WebGL/WASM).
// Convenção Gaze360 confirmada no smoke test: 90 bins, binWidth 4°, offset -180°.

export function softmax(logits: ArrayLike<number>): Float64Array {
  const n = logits.length;
  let maxV = -Infinity;
  for (let i = 0; i < n; i++) if (logits[i] > maxV) maxV = logits[i];
  const out = new Float64Array(n);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const e = Math.exp(logits[i] - maxV);
    out[i] = e;
    sum += e;
  }
  const inv = 1 / sum;
  for (let i = 0; i < n; i++) out[i] *= inv;
  return out;
}

export function decodeAngleDeg(
  logits: ArrayLike<number>,
  binWidth: number,
  binOffset: number,
): number {
  const probs = softmax(logits);
  let deg = 0;
  for (let i = 0; i < probs.length; i++) {
    deg += probs[i] * (i * binWidth + binOffset);
  }
  return deg;
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
