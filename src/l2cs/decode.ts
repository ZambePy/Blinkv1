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

// D3.3 (ROADMAP §5) — confiança da predição derivada da entropia da softmax.
//
// Convenção: 0 = totalmente incerto (distribuição uniforme sobre os N bins,
// H = log(N)), 1 = totalmente certo (massa toda num único bin, H = 0).
// Formalmente: 1 - H/H_max, onde H = -Σ p·log(p).
//
// Por que expor isso agora (D3, ROADMAP §5): a softmax já é calculada aqui em
// cada frame — não custa nada devolver junto. Downstream (Ridge, filtro, etc.)
// NÃO consome ainda; o campo existe para poder observar em uso real primeiro
// (regra 4 do projeto — nunca ligar sintonia sem número). Se um dia entrar
// como peso/gate, este é o único lugar canônico onde a métrica é definida.
export function decodeAngleWithConfidence(
  logits: ArrayLike<number>,
  binWidth: number,
  binOffset: number,
): { deg: number; confidence: number } {
  const probs = softmax(logits);
  let deg = 0;
  let entropy = 0;
  for (let i = 0; i < probs.length; i++) {
    const p = probs[i];
    deg += p * (i * binWidth + binOffset);
    // p > 0 sempre (softmax numericamente estável nunca emite 0 exato desde
    // que os logits sejam finitos), mas guarda contra p ~ 0 por underflow —
    // p·log(p) → 0 no limite p → 0+, então tratar como 0 é a extensão correta.
    if (p > 0) entropy -= p * Math.log(p);
  }
  const maxEntropy = Math.log(probs.length);
  // Bins ≤ 1 → sem incerteza a medir; retorna 1 por convenção (não há distribuição).
  const confidence = maxEntropy > 0 ? 1 - entropy / maxEntropy : 1;
  // Clamp final por segurança contra ruído de ponto flutuante (0-ε ou 1+ε).
  const clamped = confidence < 0 ? 0 : confidence > 1 ? 1 : confidence;
  return { deg, confidence: clamped };
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
