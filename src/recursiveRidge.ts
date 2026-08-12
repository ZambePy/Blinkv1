// Recursive Least Squares Ridge (Sprint 4).
//
// Atualiza incrementalmente os coeficientes β do Ridge a partir de amostras
// supervisionadas chegadas online (dwell clicks confirmados), com fator de
// esquecimento μ que descarta o peso de amostras antigas.
//
//   P₀ = (1/λ) I                          matriz de covariância inicial
//   para cada (φ, y):
//     k = P φ / (μ + φᵀ P φ)              ganho
//     β ← β + k (y − φᵀβ)                 atualização dos coeficientes
//     P ← (P − k φᵀ P) / μ                atualização da covariância
//
// Aqui `y` é vetorial (screenX, screenY) — usamos o mesmo P para ambos os eixos
// (as features são comuns) e mantemos βx e βy separados.
//
// Uso típico: inicializar β com o modelo do Ridge treinado offline e depois
// chamar `update()` toda vez que o dwell confirmar um alvo. O consumidor mescla
// a predição desta classe com a do modelo base via rampa em `nSamples`.

export interface RecursiveRidgeOptions {
  forgettingFactor: number; // μ ∈ [0.98, 0.995] — mais alto = memória mais longa
  initialLambda: number;    // λ para P₀ = (1/λ) I. Valor pequeno = confia mais no β inicial.
}

export const DEFAULT_RECURSIVE_OPTIONS: RecursiveRidgeOptions = {
  forgettingFactor: 0.99,
  initialLambda: 0.01,
};

export class RecursiveRidgeRegressor {
  private betaX: number[];         // coeficientes (incluindo bias em [0])
  private betaY: number[];
  private P: number[][];           // matriz de covariância
  private nFeatures: number;       // sem contar o bias
  private mu: number;
  private sampleCount = 0;

  constructor(
    initialBetaX: number[],
    initialBetaY: number[],
    options: Partial<RecursiveRidgeOptions> = {},
  ) {
    const opts = { ...DEFAULT_RECURSIVE_OPTIONS, ...options };
    this.mu = opts.forgettingFactor;
    // βs vindos do Ridge offline já incluem bias em [0].
    this.betaX = [...initialBetaX];
    this.betaY = [...initialBetaY];
    this.nFeatures = initialBetaX.length - 1;

    // P₀ = (1/λ) I com dimensão (nFeatures + 1)
    const n = this.betaX.length;
    this.P = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 1 / opts.initialLambda : 0)),
    );
  }

  get n(): number {
    return this.sampleCount;
  }

  predict(features: number[]): { x: number; y: number } {
    if (features.length !== this.nFeatures) return { x: 0, y: 0 };
    const f = [1.0, ...features];
    let x = 0, y = 0;
    for (let i = 0; i < f.length; i++) {
      x += this.betaX[i] * f[i];
      y += this.betaY[i] * f[i];
    }
    return { x, y };
  }

  // Uma amostra supervisionada (features, targetX, targetY) em unidades
  // normalizadas [0,1]. Chame após o dwell click; alvos em pixels devem ser
  // convertidos pelo caller.
  update(features: number[], targetX: number, targetY: number): void {
    if (features.length !== this.nFeatures) return;
    const f = [1.0, ...features];
    const n = f.length;

    // Pφ (vetor coluna) e denominador escalar μ + φᵀPφ
    const Pf = new Array<number>(n).fill(0);
    for (let i = 0; i < n; i++) {
      let s = 0;
      for (let j = 0; j < n; j++) s += this.P[i][j] * f[j];
      Pf[i] = s;
    }
    let denom = this.mu;
    for (let i = 0; i < n; i++) denom += f[i] * Pf[i];
    if (denom <= 0 || !Number.isFinite(denom)) return; // segurança numérica

    const kGain = Pf.map(v => v / denom);

    // Resíduo e atualização de β para ambos eixos
    let predX = 0, predY = 0;
    for (let i = 0; i < n; i++) {
      predX += this.betaX[i] * f[i];
      predY += this.betaY[i] * f[i];
    }
    const eX = targetX - predX;
    const eY = targetY - predY;
    for (let i = 0; i < n; i++) {
      this.betaX[i] += kGain[i] * eX;
      this.betaY[i] += kGain[i] * eY;
    }

    // P ← (P − k φᵀ P) / μ. `k φᵀ P` é o produto externo do ganho pela linha
    // (φᵀ P) — que é o mesmo vetor Pf transposto pela simetria de P.
    // ⇒ (k φᵀ P)_{i,j} = kGain[i] * Pf[j]
    for (let i = 0; i < n; i++) {
      for (let j = 0; j < n; j++) {
        this.P[i][j] = (this.P[i][j] - kGain[i] * Pf[j]) / this.mu;
      }
    }

    this.sampleCount++;
  }
}
