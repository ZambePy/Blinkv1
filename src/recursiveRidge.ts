// Recursive Least Squares Ridge.
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
  /** μ ∈ [0.98, 0.995] — mais alto = memória mais longa. */
  forgettingFactor: number;
  /**
   * λ de `P₀ = (1/λ) I` — B2.8.
   *
   * **Semântica (corrigida):** `P₀` é a COVARIÂNCIA de β₀, ou seja, a
   * incerteza sobre o modelo inicial.
   *
   *   λ **GRANDE** ⇒ P₀ pequeno ⇒ **confia** no β offline ⇒ adapta devagar.
   *   λ **pequeno** ⇒ P₀ grande  ⇒ **desconfia** do β offline ⇒ adapta rápido.
   *
   * O comentário original dizia exatamente o contrário ("valor pequeno =
   * confia mais no β inicial"), e o default de 0,01 produzia `P₀ = 100·I`.
   * Medido: com 27 dims e β₀ de bias 0,5 contra alvo 0,9, **uma única amostra
   * online** levava a predição de 0,5 para 0,8998 — anulando um Ridge treinado
   * com ~240 amostras. A rampa `ONLINE_RAMP_SAMPLES = 50` apenas atrasava o
   * efeito. É a explicação da degradação de 184 → 521 px registrada em
   * `calibration.ts`.
   */
  initialLambda: number;
  /**
   * Quanto o traço de P pode crescer em relação ao traço INICIAL, antes de ser
   * reescalado (B2.8 — covariance windup).
   *
   * `P ← (P − k φᵀP)/μ` divide por μ < 1 a cada update. Sem bound, o traço
   * cresce sem limite quando as amostras se repetem — medido: 2800 → 4,109e+5
   * em 500 updates (**×147**). Com P inflado, o ganho fica enorme e uma
   * amostra que difere 0,01 numa dimensão movia a predição 24% da tela.
   *
   * O regime patológico é o REAL: os dwell clicks caem em poucas posições de
   * botão, então as features se repetem quase exatamente.
   *
   * **Relativo, não absoluto.** `trace(P₀) = n/λ` depende de λ e da dimensão
   * do vetor, então um teto em unidades absolutas seria apertado demais para
   * uma configuração e frouxo demais para outra — exatamente o tipo de
   * constante que "funciona" no default e falha quando alguém mexe na flag.
   *
   * 10× permite ao filtro abrir a incerteza quando o modelo de fato precisa
   * se adaptar, e barra o crescimento de duas ordens de magnitude que o
   * windup produzia.
   */
  maxTraceGrowth: number;
  /** A cada quantos updates re-simetrizar P. Erro de ponto flutuante acumula
   *  e P deixa de ser covariância válida, o que dá ao ganho uma componente
   *  espúria. */
  resymmetrizeEvery: number;
}

export const DEFAULT_RECURSIVE_OPTIONS: RecursiveRidgeOptions = {
  forgettingFactor: 0.99,
  // B2.8 — era 0,01 (P₀ = 100·I, adaptação agressiva que anulava o offline).
  // 1000 dá P₀ = 0,001·I: o modelo offline governa, e o online corrige deriva
  // lenta ao longo de dezenas de amostras em vez de saltar na primeira.
  // Provisório — o valor definitivo sai do F8.4/C7 no Dia 7.
  initialLambda: 1000,
  maxTraceGrowth: 10,
  resymmetrizeEvery: 20,
};

export class RecursiveRidgeRegressor {
  private betaX: number[];         // coeficientes (incluindo bias em [0])
  private betaY: number[];
  private P: number[][];           // matriz de covariância
  private nFeatures: number;       // sem contar o bias
  private mu: number;
  private sampleCount = 0;
  private readonly resymmetrizeEvery: number;
  /** λ usado em `P₀ = (1/λ)I`. Guardado para poder reinicializar P se ela
   *  degenerar numericamente. */
  private readonly lambda0: number;
  /** Teto absoluto derivado de `trace(P₀) × maxTraceGrowth`. Calculado uma vez
   *  no construtor, quando a dimensão já é conhecida. */
  private readonly maxTrace: number;

  constructor(
    initialBetaX: number[],
    initialBetaY: number[],
    options: Partial<RecursiveRidgeOptions> = {},
  ) {
    const opts = { ...DEFAULT_RECURSIVE_OPTIONS, ...options };
    this.mu = opts.forgettingFactor;
    this.resymmetrizeEvery = opts.resymmetrizeEvery;
    this.lambda0 = opts.initialLambda;
    // βs vindos do Ridge offline já incluem bias em [0].
    this.betaX = [...initialBetaX];
    this.betaY = [...initialBetaY];
    this.nFeatures = initialBetaX.length - 1;

    // P₀ = (1/λ) I com dimensão (nFeatures + 1)
    const n = this.betaX.length;
    this.P = Array.from({ length: n }, (_, i) =>
      Array.from({ length: n }, (_, j) => (i === j ? 1 / opts.initialLambda : 0)),
    );
    // Teto do windup derivado do traço inicial: `n/λ × crescimento`. Ver o
    // comentário de `maxTraceGrowth` sobre por que é relativo.
    this.maxTrace = (n / opts.initialLambda) * opts.maxTraceGrowth;
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
    // B2.8 — alvo ou feature não-finita contamina β irreversivelmente: uma vez
    // que um NaN entra nos coeficientes, toda predição futura é NaN e o cursor
    // some sem explicação. Barrar na entrada é a única defesa barata.
    if (!Number.isFinite(targetX) || !Number.isFinite(targetY)) return;
    for (const v of features) if (!Number.isFinite(v)) return;
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

    // B2.8 — re-simetrização periódica.
    //
    // Analiticamente P é simétrica, mas a atualização acima acumula erro de
    // ponto flutuante assimétrico. Depois de centenas de updates P deixa de
    // ser uma covariância válida e o ganho ganha uma componente espúria que
    // não corresponde a incerteza nenhuma. A média com a transposta é a
    // projeção mais barata de volta ao espaço das simétricas.
    if (this.sampleCount % this.resymmetrizeEvery === 0) {
      for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
          const m = (this.P[i][j] + this.P[j][i]) / 2;
          this.P[i][j] = m;
          this.P[j][i] = m;
        }
      }
    }

    // B2.8 — bound de traço contra o windup.
    //
    // A divisão por μ < 1 a cada update infla P sem limite quando as amostras
    // se repetem — e é o que acontece de fato, porque os dwell clicks caem em
    // poucas posições de botão. Medido: trace 2800 → 4,109e+5 em 500 updates.
    // Depois disso, uma amostra que difere 0,01 numa dimensão movia a predição
    // 24% da tela.
    //
    // Reescalar preserva a DIREÇÃO da incerteza (os autovetores) e só corta a
    // magnitude — o que é a intenção do bound. Zerar ou reinicializar P
    // descartaria informação legítima.
    let trace = 0;
    for (let i = 0; i < n; i++) trace += this.P[i][i];
    if (!Number.isFinite(trace) || trace <= 0) {
      // P degenerou. Reinicia com a incerteza inicial em vez de propagar NaN.
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) this.P[i][j] = i === j ? 1 / this.lambda0 : 0;
      }
      return;
    }
    if (trace > this.maxTrace) {
      const escala = this.maxTrace / trace;
      for (let i = 0; i < n; i++) {
        for (let j = 0; j < n; j++) this.P[i][j] *= escala;
      }
    }
  }

  /** Traço de P. Exposto para o teste de windup e para o diagnóstico. */
  traceP(): number {
    let t = 0;
    for (let i = 0; i < this.P.length; i++) t += this.P[i][i];
    return t;
  }

  /** Cópia de P, para os testes verificarem simetria e positividade. */
  snapshotP(): number[][] {
    return this.P.map((linha) => [...linha]);
  }
}
