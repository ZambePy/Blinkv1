// Bloco de features L2CS (E5 do L2CS-NET.md).
//
// 7 termos derivados de (yaw, pitch, dProxy) que entram como features
// adicionais no vetor por olho antes do Ridge.
//
// Por que a tangente antes do polinômio:
//   x_tela ≈ x_olho + d · tan(yaw)         (geometria de projeção)
//   tan(x) = x + x³/3 + 2x⁵/15 + …          (Taylor — expansão ímpar)
// Um PolynomialFeatures(degree=2) sobre o ângulo gera x², que não aparece
// nessa expansão. Aplicando tan primeiro, o termo de 1ª ordem já é exato e
// o grau 2 captura resíduo (tela plana, câmera não centrada).
//
// ⚠️ CLAMP obrigatório em ±π/4. tan() explode perto de ±π/2; um único frame
// de pose extrema envenena o StandardScaler.fit em cascata — média/desvio
// vão a infinito e o regressor inteiro degenera. Mesmo padrão do comentário
// anti-NaN de asin() no extractor.ts.

export const L2CS_BLOCK_DIM = 7;

// ±45°. Escolhido conservador: usos normais de gaze ficam bem dentro disto;
// valores fora são artefatos de pose extrema ou má detecção.
const CLAMP_RAD = Math.PI / 4;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Layout FIXO — a Ridge depende da ordem estável.
//   [0] tan(yaw)              1ª ordem, X
//   [1] tan(pitch)             1ª ordem, Y
//   [2] tan(yaw) · dProxy      paralaxe X
//   [3] tan(pitch) · dProxy    paralaxe Y
//   [4] tan(yaw)²              curvatura residual X
//   [5] tan(pitch)²            curvatura residual Y
//   [6] tan(yaw) · tan(pitch)  cruzado (rotação/skew da tela)
export function buildL2CSBlock(
  yaw: number,
  pitch: number,
  valid: boolean,
  dProxy: number,
): number[] {
  // Degradação graciosa — quando o L2CS ainda não emitiu resultado, ou o cache
  // está stale, o Ridge continua operando com o comportamento pré-L2CS (as
  // dimensões novas ficam constantes em zero, não contribuem para a predição).
  if (!valid) {
    return [0, 0, 0, 0, 0, 0, 0];
  }

  const y = clamp(yaw, -CLAMP_RAD, CLAMP_RAD);
  const p = clamp(pitch, -CLAMP_RAD, CLAMP_RAD);
  const ty = Math.tan(y);
  const tp = Math.tan(p);

  return [
    ty,
    tp,
    ty * dProxy,
    tp * dProxy,
    ty * ty,
    tp * tp,
    ty * tp,
  ];
}
