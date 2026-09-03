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

/**
 * Expectativa LINEAR sobre os bins.
 *
 * ⚠️ **Preservada apenas para comparação e para os testes de regressão de
 * B3.1.** O caminho de produção usa `decodeAngleCircularDeg` — ver o
 * comentário lá sobre por que a média linear produz um ângulo perfeitamente
 * plausível a partir de lixo.
 */
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

/**
 * Expectativa CIRCULAR sobre os bins (B3.1).
 *
 * Os bins do Gaze360 cobrem −180°…+176°. Isso é um espaço **circular**: o bin
 * 0 (−180°) e o bin 89 (+176°) são VIZINHOS, separados por 4°, não por 356°.
 *
 * A média linear ignorava isso. Um crop degenerado — preto, congelado — produz
 * distribuição difusa; com massa nas duas pontas, `(−180 + 176)/2 = −2°`. Esse
 * ângulo passa em `isGazePlausible` como "olhando bem para o centro da tela".
 * **Lixo virava feature plausível**, e nada a jusante conseguia distinguir.
 *
 * A média circular soma os vetores unitários `(cos θ, sin θ)` ponderados pela
 * probabilidade e devolve `atan2` da resultante. Com massa em pontas opostas
 * do wrap, os vetores se somam (são quase o mesmo vetor) em vez de se
 * cancelarem — e o resultado fica onde a massa de fato está.
 *
 * Quando a distribuição é genuinamente uniforme, a resultante tem norma ~0 e o
 * ângulo é arbitrário. Isso não é problema DESTA função: é o gate de confiança
 * em `buildL2CSBlock` que rejeita esse caso.
 */
export function decodeAngleCircularDeg(
  logits: ArrayLike<number>,
  binWidth: number,
  binOffset: number,
): number {
  const probs = softmax(logits);
  let sx = 0;
  let sy = 0;
  for (let i = 0; i < probs.length; i++) {
    const rad = ((i * binWidth + binOffset) * Math.PI) / 180;
    sx += probs[i] * Math.cos(rad);
    sy += probs[i] * Math.sin(rad);
  }
  return (Math.atan2(sy, sx) * 180) / Math.PI;
}

// Confiança da predição derivada da entropia da softmax.
//
// Convenção: 0 = totalmente incerto (distribuição uniforme sobre os N bins,
// H = log(N)), 1 = totalmente certo (massa toda num único bin, H = 0).
// Formalmente: 1 - H/H_max, onde H = -Σ p·log(p).
//
// A softmax já é calculada aqui em cada frame — não custa nada devolver junto.
// Downstream (Ridge, filtro, etc.) NÃO consome ainda; o campo existe para poder
// observar em uso real primeiro. Se um dia entrar como peso/gate, este é o
// único lugar canônico onde a métrica é definida.
export function decodeAngleWithConfidence(
  logits: ArrayLike<number>,
  binWidth: number,
  binOffset: number,
): { deg: number; confidence: number } {
  const probs = softmax(logits);
  // B3.1 — o ângulo vem da média CIRCULAR. Ver `decodeAngleCircularDeg`.
  let sx = 0;
  let sy = 0;
  let entropy = 0;
  for (let i = 0; i < probs.length; i++) {
    const p = probs[i];
    const rad = ((i * binWidth + binOffset) * Math.PI) / 180;
    sx += p * Math.cos(rad);
    sy += p * Math.sin(rad);
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
  const deg = (Math.atan2(sy, sx) * 180) / Math.PI;
  return { deg, confidence: clamped };
}

export function degToRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
