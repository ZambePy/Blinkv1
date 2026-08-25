// D5.2 (ROADMAP §5) — correção geométrica de distância câmera-rosto.
//
// POR QUE EXISTE
// O extractor produz features de iris em espaço de OLHO rotacionado, dividindo
// coordenadas por `interEyeDistRaw` (extractor.ts:509) — em teoria isso já
// normaliza contra distância câmera-rosto (rosto longe → interEyeDist menor
// → offset dividido por número menor → offset normalizado invariante).
//
// Na prática, três coisas quebram a invariância:
//   1. Distorção não-linear da webcam (fish-eye leve) que não é modelada;
//   2. `pose.scale` (∝ 1/distância) entra em vários termos de interação
//      (`offsetX·pose.scale`, `pose.yaw·pose.scale`, etc — extractor.ts:544-557),
//      então se o usuário se afastou/aproximou após calibrar, esses termos
//      MUDAM sem que a direção do olhar tenha mudado, e o Ridge (treinado
//      com valores de uma distância) prevê errado;
//   3. Ruído de landmarks tem magnitude fixa em pixels; após dividir por
//      `interEyeDistRaw` menor (mais longe), o ruído normalizado cresce.
//
// A correção aqui multiplica as dims dependentes de "quanto o iris se moveu"
// por `(currentDistance / calibrationRefDistance)`. Se o usuário está mais
// LONGE agora do que quando calibrou, `ratio > 1` amplifica offsets pra
// compensar a normalização excessiva. Se está mais PERTO, `ratio < 1`
// reduz. Ratio = 1 (mesma distância) → identidade, correção some.
//
// IMPORTANTE: esta é uma correção HEURÍSTICA de 1ª ordem. A solução
// completa exige Structure-from-Motion (ver §8 do ROADMAP como backlog não
// escondido). Aqui é um passo pequeno e reversível, gated por flag off.
//
// LAYOUT ESPERADO — o vetor deve ser o produzido por `extractCompactFeatures`.
// Se a ordem lá mudar sem atualizar `IRIS_OFFSET_DIMS` / `OFFSET_INTERACTION_DIMS`
// abaixo, esta correção passa a corromper features silenciosamente.
// Documentar no PR de qualquer mudança do extractor.

/** Índices no vetor por olho cujos valores são "quanto a íris se moveu do
 *  centro do olho" — os que a correção geométrica de distância escala.
 *  Ver comentário em `extractCompactFeatures` (src/extractor.ts:559-567). */
export const IRIS_OFFSET_DIMS: readonly number[] = [
  0, // offsetX (absoluto, unidades de largura de olho)
  1, // offsetY (absoluto)
  2, // relX (offsetX / width — mesmo sinal, dividido)
  3, // relY (offsetY / height)
];

/** Índices dos termos de interação que MULTIPLICAM offset — quando offset é
 *  escalado, esses termos precisam ser escalados no MESMO fator para o Ridge
 *  ver os produtos coerentes. Layout de `interactions` (extractor.ts:544-557):
 *  os primeiros 10 termos multiplicam offset por yaw/pitch/scale/roll (1ª e
 *  2ª ordem); os últimos 2 (pose.yaw·pose.scale, pose.pitch·pose.scale) NÃO
 *  envolvem offset e ficam intactos. */
export const OFFSET_INTERACTION_DIMS: readonly number[] = [
  25, 26, 27, 28, 29, 30, // offset × pose 1ª ordem (6)
  31, 32, 33, 34,         // offset × pose 2ª ordem (4) — [35]/[36] são pose·pose, sem offset
];

/** Piso de distância válido. Abaixo disso a proxy `1/scale3D` fica com ruído
 *  numérico (rosto tão pequeno na imagem que scale3D vira ~0 e a divisão
 *  explode). Cai no comportamento de `ratio = 1` (sem correção). */
export const MIN_VALID_DISTANCE = 1e-3;

/** Extremos do ratio para não corromper features quando algo dá errado. Um
 *  usuário que se afastou 3× já é caso extremo; 1/3 idem. Além disso, o
 *  Ridge nunca viu esses regimes na calibração. */
export const MIN_DISTANCE_RATIO = 1 / 3;
export const MAX_DISTANCE_RATIO = 3;

/** Retorna a razão de correção segura, ou `1` (identidade) quando qualquer
 *  entrada não faz sentido. Nunca lança — o caller pode chamar em loop
 *  quente sem try/catch. */
export function computeDistanceCorrectionRatio(
  currentDistance: number | null | undefined,
  calibrationRefDistance: number | null | undefined,
): number {
  if (currentDistance == null || calibrationRefDistance == null) return 1;
  if (!Number.isFinite(currentDistance) || !Number.isFinite(calibrationRefDistance)) return 1;
  if (currentDistance < MIN_VALID_DISTANCE || calibrationRefDistance < MIN_VALID_DISTANCE) return 1;
  const ratio = currentDistance / calibrationRefDistance;
  if (!Number.isFinite(ratio) || ratio <= 0) return 1;
  return Math.min(MAX_DISTANCE_RATIO, Math.max(MIN_DISTANCE_RATIO, ratio));
}

/** Aplica a correção geométrica escalando as dims de offset e interações que
 *  multiplicam offset pelo `ratio` dado. Ratio = 1 → cópia idêntica. Não
 *  muta o array de entrada.
 *
 *  Se o vetor é mais curto que os índices esperados (ex.: extractor legado
 *  sem bloco L2CS, mas com os 37 dims base), as posições ausentes são
 *  simplesmente ignoradas — a correção continua bem definida. */
export function applyDistanceCorrectionToFeatures(
  features: readonly number[],
  ratio: number,
): number[] {
  const out = features.slice();
  if (ratio === 1) return out;
  if (!Number.isFinite(ratio)) return out;
  for (const idx of IRIS_OFFSET_DIMS) {
    if (idx < out.length) out[idx] = out[idx] * ratio;
  }
  for (const idx of OFFSET_INTERACTION_DIMS) {
    if (idx < out.length) out[idx] = out[idx] * ratio;
  }
  return out;
}
