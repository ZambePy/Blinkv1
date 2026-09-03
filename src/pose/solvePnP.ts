// P5.2 — head pose por PnP, como ALTERNATIVA medida.
//
// ── O que esta tarefa NÃO é ─────────────────────────────────────────────────
//
// Não é substituição da `facialTransformationMatrix` do MediaPipe. Aquela é
// ajustada sobre os 478 landmarks e é mais robusta a oclusão parcial: perder a
// boca atrás de uma máscara ou de um suporte de cabeça degrada a matriz um
// pouco, mas derruba um PnP de 6 pontos inteiro (33% dos pontos somem).
//
// O PnP entra atrás de `headPoseSource: 'matrix' | 'pnp'` como candidato a ser
// MEDIDO no Dia 7. O default continua `'matrix'`.
//
// ── Por que ter a alternativa ───────────────────────────────────────────────
//
// A matriz do MediaPipe é uma caixa-preta: não há como auditar de onde vem o
// yaw. O PnP é geometria explícita sobre pontos nomeados, então quando os dois
// discordam dá para dizer QUAL está errado — e essa discordância, registrada no
// diagnóstico, é informação que hoje não existe.
//
// ── O método ────────────────────────────────────────────────────────────────
//
// `SOLVEPNP_ITERATIVE`: estimativa inicial por POSIT/DLT fraco, refinada por
// Gauss-Newton minimizando o erro de reprojeção. Implementado à mão porque a
// alternativa é OpenCV.js (~8–10 MB de WASM) para uma função de 200 linhas —
// a mesma conta do ADR P4.4, e com a mesma resposta.

import { PONTOS_PNP } from '../faceLandmarks';

export interface Ponto2D { x: number; y: number }
export interface Ponto3D { x: number; y: number; z: number }

/**
 * Modelo 3D canônico de rosto, em MILÍMETROS, na ordem de {@link PONTOS_PNP}.
 *
 * Origem na ponta do nariz. Eixos: +X para a direita da PESSOA, +Y para cima,
 * +Z para trás (afastando-se da câmera). É o modelo clássico usado na
 * literatura de head pose, com as coordenadas do rosto médio.
 *
 * ⚠️ A ordem tem que casar item a item com `PONTOS_PNP`. Trocar dois pontos
 * aqui produz uma pose que CONVERGE para um valor errado — sem erro, sem
 * resíduo alto, sem sintoma. Por isso os dois arrays têm teste de ordem.
 */
export const MODELO_FACIAL_MM: readonly Ponto3D[] = [
  { x:    0.0, y:    0.0, z:    0.0 },   // ponta do nariz
  { x:    0.0, y: -330.0, z:  -65.0 },   // queixo
  { x: -225.0, y:  170.0, z: -135.0 },   // canto externo do olho esquerdo
  { x:  225.0, y:  170.0, z: -135.0 },   // canto externo do olho direito
  { x: -150.0, y: -150.0, z: -125.0 },   // canto esquerdo da boca
  { x:  150.0, y: -150.0, z: -125.0 },   // canto direito da boca
];

export interface PosePnP {
  /** Radianos, convenção do projeto: +yaw olha para a direita da pessoa. */
  yaw: number;
  pitch: number;
  roll: number;
  /** Erro médio de reprojeção em pixels. Alto = ajuste ruim, e o consumidor
   *  deve preferir a matriz. É a métrica que torna o PnP auditável. */
  reprojectionErrorPx: number;
  /** Iterações gastas no refinamento. Bater o teto significa não convergido. */
  iteracoes: number;
}

export interface OpcoesPnP {
  /** Distância focal em pixels. Sem calibração de câmera, a aproximação usual
   *  é `focal ≈ largura da imagem`, que corresponde a ~2·atan(0,5) = 53° de
   *  FOV horizontal. O erro daí é sistemático e some na DIFERENÇA de pose
   *  contra a referência — que é como o pipeline usa a pose. */
  focalPx?: number;
  /** Centro óptico. Default: centro da imagem. */
  centro?: Ponto2D;
  maxIteracoes?: number;
  /** Critério de parada: melhora relativa do erro abaixo disto encerra. */
  tolerancia?: number;
}

const MAX_ITERACOES_DEFAULT = 30;
const TOLERANCIA_DEFAULT = 1e-6;

/**
 * Resolve a pose da cabeça a partir de 6 correspondências 2D↔3D.
 *
 * `pontosImagem` em PIXELS, na mesma ordem de {@link MODELO_FACIAL_MM}.
 * Devolve `null` quando não há pontos suficientes ou o ajuste diverge — nunca
 * uma pose inventada, porque uma pose plausível e errada é pior que ausência.
 */
export function solvePnP(
  pontosImagem: readonly Ponto2D[],
  larguraImagem: number,
  alturaImagem: number,
  opts: OpcoesPnP = {},
): PosePnP | null {
  if (pontosImagem.length !== MODELO_FACIAL_MM.length) return null;
  if (!(larguraImagem > 0) || !(alturaImagem > 0)) return null;
  if (pontosImagem.some((p) => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) return null;

  const focal = opts.focalPx ?? larguraImagem;
  const cx = opts.centro?.x ?? larguraImagem / 2;
  const cy = opts.centro?.y ?? alturaImagem / 2;
  const maxIter = opts.maxIteracoes ?? MAX_ITERACOES_DEFAULT;
  const tol = opts.tolerancia ?? TOLERANCIA_DEFAULT;

  // Estado: rotação como ângulos de Euler (yaw, pitch, roll) e translação.
  // Euler em vez de Rodrigues porque a saída do projeto é em Euler de qualquer
  // forma, e a faixa de pose aqui (cabeça humana em frente à tela) fica longe
  // do gimbal lock de ±90° de pitch.
  let [yaw, pitch, roll] = [0, 0, 0];
  // Translação inicial: o rosto está adiante da câmera. A escala vem da razão
  // entre a largura interocular do modelo (450 mm) e a medida na imagem.
  const larguraModeloPx = Math.hypot(
    pontosImagem[3].x - pontosImagem[2].x,
    pontosImagem[3].y - pontosImagem[2].y,
  );
  if (!(larguraModeloPx > 1e-6)) return null;
  let tz = (450 * focal) / larguraModeloPx;
  let tx = ((pontosImagem[0].x - cx) * tz) / focal;
  let ty = ((pontosImagem[0].y - cy) * tz) / focal;

  let params = [yaw, pitch, roll, tx, ty, tz];
  let erroAnterior = Infinity;
  let iteracoes = 0;

  for (; iteracoes < maxIter; iteracoes++) {
    const { residuos, erro } = reprojetar(params, pontosImagem, focal, cx, cy);
    if (!Number.isFinite(erro)) return null;
    if (Math.abs(erroAnterior - erro) < tol) break;
    erroAnterior = erro;

    // Jacobiano numérico. Diferenças finitas em vez de derivada analítica: são
    // 6 parâmetros × 12 resíduos, o custo é irrelevante (isto não roda no
    // caminho quente — a pose sai da matriz por default), e a versão analítica
    // é uma fonte clássica de erro de sinal que não aparece em teste sintético.
    const J = jacobiano(params, pontosImagem, focal, cx, cy);
    const delta = resolverNormalEquations(J, residuos);
    if (!delta) break;

    // Passo amortecido: PnP com estimativa inicial grosseira pode dar um passo
    // grande demais e sair da bacia de convergência.
    const proximo = params.map((p, i) => p - 0.7 * delta[i]);
    if (proximo.some((v) => !Number.isFinite(v))) break;
    params = proximo;
  }

  [yaw, pitch, roll] = [params[0], params[1], params[2]];
  const { erro } = reprojetar(params, pontosImagem, focal, cx, cy);
  const n = pontosImagem.length;
  const reprojectionErrorPx = Math.sqrt(erro / n);
  if (!Number.isFinite(reprojectionErrorPx)) return null;

  return {
    yaw: normalizarAngulo(yaw),
    pitch: normalizarAngulo(pitch),
    roll: normalizarAngulo(roll),
    reprojectionErrorPx,
    iteracoes,
  };
}

/** Extrai os 6 pontos de imagem a partir dos landmarks normalizados. */
export function pontosPnPDeLandmarks(
  landmarks: readonly { x: number; y: number }[],
  larguraImagem: number,
  alturaImagem: number,
): Ponto2D[] | null {
  if (landmarks.length <= Math.max(...PONTOS_PNP)) return null;
  const out: Ponto2D[] = [];
  for (const idx of PONTOS_PNP) {
    const lm = landmarks[idx];
    if (!lm || !Number.isFinite(lm.x) || !Number.isFinite(lm.y)) return null;
    out.push({ x: lm.x * larguraImagem, y: lm.y * alturaImagem });
  }
  return out;
}

// -----------------------------------------------------------------------------
// Internos
// -----------------------------------------------------------------------------

/** Matriz de rotação a partir de Euler (ordem Y·X·Z: yaw, depois pitch, roll). */
export function matrizDeRotacao(yaw: number, pitch: number, roll: number): number[][] {
  const cy = Math.cos(yaw), sy = Math.sin(yaw);
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const cr = Math.cos(roll), sr = Math.sin(roll);
  return [
    [cy * cr + sy * sp * sr, -cy * sr + sy * sp * cr, sy * cp],
    [cp * sr,                 cp * cr,               -sp],
    [-sy * cr + cy * sp * sr, sy * sr + cy * sp * cr, cy * cp],
  ];
}

function projetar(
  params: number[], indice: number, focal: number, cx: number, cy: number,
): Ponto2D {
  const [yaw, pitch, roll, tx, ty, tz] = params;
  const R = matrizDeRotacao(yaw, pitch, roll);
  const P = MODELO_FACIAL_MM[indice];
  const X = R[0][0] * P.x + R[0][1] * P.y + R[0][2] * P.z + tx;
  const Y = R[1][0] * P.x + R[1][1] * P.y + R[1][2] * P.z + ty;
  const Z = R[2][0] * P.x + R[2][1] * P.y + R[2][2] * P.z + tz;
  const zSeguro = Math.abs(Z) < 1e-6 ? 1e-6 : Z;
  return { x: (focal * X) / zSeguro + cx, y: (focal * Y) / zSeguro + cy };
}

function reprojetar(
  params: number[], pontos: readonly Ponto2D[], focal: number, cx: number, cy: number,
): { residuos: number[]; erro: number } {
  const residuos: number[] = [];
  let erro = 0;
  for (let i = 0; i < pontos.length; i++) {
    const p = projetar(params, i, focal, cx, cy);
    const dx = p.x - pontos[i].x;
    const dy = p.y - pontos[i].y;
    residuos.push(dx, dy);
    erro += dx * dx + dy * dy;
  }
  return { residuos, erro };
}

function jacobiano(
  params: number[], pontos: readonly Ponto2D[], focal: number, cx: number, cy: number,
): number[][] {
  const J: number[][] = [];
  const h = 1e-5;
  const base = reprojetar(params, pontos, focal, cx, cy).residuos;
  for (let i = 0; i < base.length; i++) J.push(new Array(params.length).fill(0));
  for (let j = 0; j < params.length; j++) {
    // Passo relativo nos parâmetros de translação, que são da ordem de
    // centenas de mm — um `h` absoluto de 1e-5 ali seria ruído numérico.
    const passo = j < 3 ? h : Math.max(h, Math.abs(params[j]) * h);
    const pMais = params.slice();
    pMais[j] += passo;
    const rMais = reprojetar(pMais, pontos, focal, cx, cy).residuos;
    for (let i = 0; i < base.length; i++) J[i][j] = (rMais[i] - base[i]) / passo;
  }
  return J;
}

/** Resolve `(JᵀJ + λI)·δ = Jᵀr` por eliminação de Gauss. */
function resolverNormalEquations(J: number[][], r: number[]): number[] | null {
  const n = J[0].length;
  const A: number[][] = Array.from({ length: n }, () => new Array(n).fill(0));
  const b: number[] = new Array(n).fill(0);

  for (let i = 0; i < J.length; i++) {
    for (let a = 0; a < n; a++) {
      b[a] += J[i][a] * r[i];
      for (let c = 0; c < n; c++) A[a][c] += J[i][a] * J[i][c];
    }
  }
  // Regularização de Levenberg: JᵀJ fica singular quando um parâmetro não tem
  // efeito observável na projeção (rosto de frente e roll, por exemplo).
  for (let a = 0; a < n; a++) A[a][a] += 1e-6 * (A[a][a] || 1);

  // Eliminação com pivotamento parcial.
  const M = A.map((linha, i) => [...linha, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivo = col;
    for (let l = col + 1; l < n; l++) if (Math.abs(M[l][col]) > Math.abs(M[pivo][col])) pivo = l;
    if (Math.abs(M[pivo][col]) < 1e-12) return null;
    [M[col], M[pivo]] = [M[pivo], M[col]];
    for (let l = 0; l < n; l++) {
      if (l === col) continue;
      const f = M[l][col] / M[col][col];
      for (let c = col; c <= n; c++) M[l][c] -= f * M[col][c];
    }
  }
  const x = new Array(n).fill(0);
  for (let i = 0; i < n; i++) {
    if (Math.abs(M[i][i]) < 1e-12) return null;
    x[i] = M[i][n] / M[i][i];
  }
  return x.every(Number.isFinite) ? x : null;
}

/** Traz o ângulo para (−π, π]. */
function normalizarAngulo(a: number): number {
  let r = a;
  while (r > Math.PI) r -= 2 * Math.PI;
  while (r <= -Math.PI) r += 2 * Math.PI;
  return r;
}
