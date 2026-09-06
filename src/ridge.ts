// Regressão Ridge múltipla linear sobre o vetor de features por olho, com
// bias implícito no índice 0.
//
// ─── Regularização branqueada pelo ruído intra-fixação ──────────────────────
//
// Com dezenas de dims por olho e apenas 9 alvos distintos, sobram direções
// que NENHUM alvo restringe. Com `+λI` (penalidade isotrópica) o Ridge
// preenche essas direções com o jitter de fixação e a deriva lenta de
// pose/landmark, que ficam ALIASADOS com a identidade do alvo (cada alvo é
// uma janela contígua de ~2 s). Medido: amplificação de ruído de ~30×.
//
// A correção é a penalidade anisotrópica. Durante a janela de um alvo o olhar está
// PARADO por construção — logo toda variação intra-alvo é ruído, nunca sinal.
// Chamando Σ_W a covariância intra-alvo das features, o termo βᵀΣ_W β é
// exatamente a variância da predição sob esse ruído (o jitter do cursor em
// unidades normalizadas). Trocando `λI` por `λ·m·Σ_W` o problema passa a ser
//
//     min ‖Φβ − y‖²  +  λ·m·(jitter previsto do cursor)
//
// que penaliza forte as direções sem informação de olhar e deixa livres as
// direções que separam alvos. É o mesmo branqueamento por covariância de ruído
// da LDA regularizada. Custo: uma acumulação 45×45 por olho (~ms).
//
// O fator `m` (nº de amostras) escala λ junto com ΦᵀΦ: sem ele, λ significa
// coisas diferentes conforme quantos frames a coleta conseguiu reter (500
// frames → ΦᵀΦ ~ 500 na diagonal, e λ=1 vira regularização relativa de 0.002).
// Com o fator, λ é adimensional e o grid do CV cobre de "sem regularização"
// (1e-4) a "encolhimento total" (1e3).
//
// Sem `groups` a penalidade cai de volta para a identidade (comportamento
// isotrópico histórico), preservando os callers que não agrupam por alvo.
//
// A regularização não penaliza o termo de bias (linha/coluna 0 excluída), e λ
// é escolhido por CV leave-one-target-out em RidgeRegressor.train.
// predictRidge retorna coordenadas normalizadas [0,1]; a conversão para pixels
// é responsabilidade da camada de UI.

export interface RidgeModel {
  betaX: number[];  // coeficientes para predizer screenX
  betaY: number[];  // coeficientes para predizer screenY
  numFeatures: number;
  // Diagnóstico que sobrevive à serialização. `lambda` é o λ efetivamente
  // usado no treino (pode ser maior que o escolhido pelo CV se houve
  // escalonamento defensivo por matriz singular). `nearSingularCols` são as
  // colunas cujo pivô durante a eliminação gaussiana ficou abaixo de 1e-6
  // mas acima de 1e-12: resolve numericamente mas gera coeficientes grandes
  // que produzem predições instáveis.
  lambda: number;
  lambdaX?: number;
  lambdaY?: number;
  nearSingularCols: number[];
  /** Qual penalidade foi usada. `within-target` significa que o modelo foi
   *  branqueado pelo ruído intra-fixação; `isotropic` é o `λI` histórico
   *  (usado quando o caller não agrupa amostras por alvo). Só diagnóstico —
   *  não afeta `predictRidge`, então perfis serializados antigos continuam
   *  carregando (o campo chega `undefined` e é tratado como isotropic). */
  penalty?: 'isotropic' | 'within-target';
}

// Limiar de "quase-singular". Acima de 1e-12 solveLinear ainda resolve, mas
// abaixo de 1e-6 os coeficientes β ficam ordens de grandeza maiores que o
// razoável, gerando predições que "explodem" para pequenas variações da
// entrada. É a assinatura do bug de erro grande + jitter baixo observado em
// medidas com óculos (viés de 400 px).
const NEAR_SINGULAR_PIVOT = 1e-6;
const SINGULAR_PIVOT = 1e-12;

// Eliminação gaussiana com pivotação parcial para resolver Aβ = b.
// Popula `nearSingularCols` (out-param) com índices de colunas cujo pivô
// ficou abaixo de NEAR_SINGULAR_PIVOT — o chamador decide se avisa/rejeita.
export function solveLinear(
  A: number[][],
  b: number[],
  nearSingularCols?: number[],
): number[] {
  const n = A.length;
  const M: number[][] = A.map((row, i) => [...row, b[i]]);

  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(M[r][col]) > Math.abs(M[pivot][col])) pivot = r;
    }
    [M[col], M[pivot]] = [M[pivot], M[col]];

    const d = M[col][col];
    if (Math.abs(d) < SINGULAR_PIVOT) {
      throw new Error(`Matriz singular na coluna ${col}. O sistema não pode ser resolvido.`);
    }
    if (Math.abs(d) < NEAR_SINGULAR_PIVOT && nearSingularCols) {
      nearSingularCols.push(col);
    }
    for (let j = col; j <= n; j++) M[col][j] /= d;

    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r][col];
      for (let j = col; j <= n; j++) M[r][j] -= f * M[col][j];
    }
  }

  return M.map(row => row[n]);
}

/** Chave de agrupamento por alvo. Duas amostras do mesmo ponto de calibração
 *  compartilham a chave; é o mesmo critério que `selectLambdaCV` já usava para
 *  o leave-one-target-out. Exportado porque `trainRidgeModel` e o CV precisam
 *  concordar exatamente sobre o que é "o mesmo alvo". */
export function targetGroupKey(t: { screenX: number; screenY: number }): string {
  return `${t.screenX.toFixed(4)},${t.screenY.toFixed(4)}`;
}

/** Piso relativo da penalidade anisotrópica. Reduzido de 10% para 1% para não
 *  penalizar e encolher excessivamente direções de sinal primário (offsetX). */
const PENALTY_FLOOR = 0.01;

/**
 * Matriz de penalidade Σ_W (covariância intra-alvo) normalizada.
 *
 * Devolve `null` quando não há grupos utilizáveis (menos de 2 alvos, ou nenhum
 * alvo com ≥2 amostras): nesse caso o caller usa a identidade e o comportamento
 * isotrópico histórico é preservado.
 *
 * A normalização divide pela média da diagonal, de forma que trace(P)/d = 1 —
 * λ fica com a mesma ordem de grandeza que teria na penalidade isotrópica.
 */
export function withinTargetPenalty(
  features: number[][],
  groups: string[],
): number[][] | null {
  const m = features.length;
  if (m === 0 || groups.length !== m) return null;
  const d = features[0].length;

  const index = new Map<string, number[]>();
  for (let i = 0; i < m; i++) {
    const arr = index.get(groups[i]);
    if (arr) arr.push(i); else index.set(groups[i], [i]);
  }
  if (index.size < 2) return null;

  // Σ_W = média ponderada (por graus de liberdade) das covariâncias de cada alvo.
  const S: number[][] = Array.from({ length: d }, () => new Array<number>(d).fill(0));
  let dof = 0;
  for (const rows of index.values()) {
    if (rows.length < 2) continue;
    const mean = new Array<number>(d).fill(0);
    for (const r of rows) for (let j = 0; j < d; j++) mean[j] += features[r][j];
    for (let j = 0; j < d; j++) mean[j] /= rows.length;
    for (const r of rows) {
      const c = features[r];
      for (let a = 0; a < d; a++) {
        const da = c[a] - mean[a];
        if (da === 0) continue;
        for (let b = a; b < d; b++) S[a][b] += da * (c[b] - mean[b]);
      }
    }
    dof += rows.length - 1;
  }
  if (dof === 0) return null;

  let traceSum = 0;
  for (let a = 0; a < d; a++) {
    for (let b = a; b < d; b++) {
      const v = S[a][b] / dof;
      S[a][b] = v;
      S[b][a] = v;
    }
    traceSum += S[a][a];
  }
  const meanDiag = traceSum / d;
  if (!(meanDiag > 0) || !Number.isFinite(meanDiag)) return null;

  // Só o triângulo superior é percorrido, mas o inferior TEM de ser espelhado:
  // Σ_W é uma covariância e precisa sair simétrica daqui. Ela vira `P` em
  // A = ΦᵀΦ + reg·P, e `solveLinear` faz eliminação gaussiana sem checar
  // simetria — uma P assimétrica seria resolvida em silêncio, devolvendo um β
  // que não é o estimador ridge. Sem o espelho, P[b][a] = meanDiag · P[a][b].
  for (let a = 0; a < d; a++) {
    for (let b = a; b < d; b++) {
      S[a][b] /= meanDiag;
      if (b > a) S[b][a] = S[a][b];
    }
    S[a][a] += PENALTY_FLOOR;
  }
  return S;
}

export interface RidgeTrainOptions {
  /** Chave do alvo de cada amostra (mesmo comprimento de `features`). Quando
   *  presente e com ≥2 alvos, ativa a penalidade branqueada pelo ruído
   *  intra-fixação. Ausente → `λI` isotrópico. */
  groups?: string[];
  /** Σ_W já calculada. Σ_W não depende de λ, então o CV a computa UMA vez por
   *  fold e reusa nas 22 tentativas de λ — sem isto, o custo O(m·d²) dominaria
   *  o treino (22× desperdício). `null` força a penalidade isotrópica. */
  penaltyMatrix?: number[][] | null;
  /** Peso de cada amostra nas equacoes normais. Ausente = todas iguais.
   *  Ver o bloco em `trainRidgeModel`. */
  sampleWeights?: number[] | null;
}

export function trainRidgeModel(
  features: number[][],
  targets: { screenX: number; screenY: number }[],
  lambda: number | { x: number; y: number } = 1.0,
  options?: RidgeTrainOptions,
): RidgeModel {
  const m = features.length;
  const lamX = typeof lambda === 'number' ? lambda : lambda.x;
  const lamY = typeof lambda === 'number' ? lambda : lambda.y;

  if (m === 0) {
    return {
      betaX: [],
      betaY: [],
      numFeatures: 0,
      lambda: typeof lambda === 'number' ? lambda : (lamX + lamY) / 2,
      lambdaX: lamX,
      lambdaY: lamY,
      nearSingularCols: [],
      penalty: 'isotropic',
    };
  }

  const rawFeatures = features[0].length;
  const nf = rawFeatures + 1; // +1 para o Bias term

  // Prepara matriz Phi com Bias
  const Phi = features.map(f => [1.0, ...f]);

  // Penalidade Σ_W (branqueada) quando o caller agrupou por alvo. Se o
  // caller já a calculou (caminho do CV), reusa em vez de recomputar.
  const P = options?.penaltyMatrix !== undefined
    ? options.penaltyMatrix
    : options?.groups
      ? withinTargetPenalty(features, options.groups)
      : null;
  const penalty: 'isotropic' | 'within-target' = P ? 'within-target' : 'isotropic';

  const w = options?.sampleWeights ?? null;
  const somaW = w ? w.reduce((a, b) => a + b, 0) : m;
  const peso = (k: number) => (w ? (w[k] * m) / somaW : 1);

  // A_x e A_y com os respectivos lambdas de cada eixo
  const buildMatrixA = (lam: number) => {
    const reg = lam * m;
    return Array.from({ length: nf }, (_, i) =>
      Array.from({ length: nf }, (_, j) => {
        let s = 0;
        for (let k = 0; k < m; k++) s += peso(k) * Phi[k][i] * Phi[k][j];
        if (i === 0 || j === 0) return s;
        if (P) return s + reg * P[i - 1][j - 1];
        return s + (i === j ? reg : 0);
      })
    );
  };

  const AX = buildMatrixA(lamX);
  const AY = lamX === lamY ? AX : buildMatrixA(lamY);

  // b = Φᵀy  (para screenX e screenY separadamente)
  const bX = Array.from({ length: nf }, (_, i) => {
    let s = 0;
    for (let k = 0; k < m; k++) s += peso(k) * Phi[k][i] * targets[k].screenX;
    return s;
  });

  const bY = Array.from({ length: nf }, (_, i) => {
    let s = 0;
    for (let k = 0; k < m; k++) s += peso(k) * Phi[k][i] * targets[k].screenY;
    return s;
  });

  // Acumula colunas quase-singulares das duas solvidas.
  const nearSingularX: number[] = [];
  const nearSingularY: number[] = [];
  const betaX = solveLinear(AX, bX, nearSingularX);
  const betaY = solveLinear(AY, bY, nearSingularY);
  const nearSingularCols = Array.from(new Set([...nearSingularX, ...nearSingularY])).sort((a, b) => a - b);

  return {
    betaX,
    betaY,
    numFeatures: rawFeatures,
    lambda: typeof lambda === 'number' ? lambda : (lamX + lamY) / 2,
    lambdaX: lamX,
    lambdaY: lamY,
    nearSingularCols,
    penalty,
  };
}

export function predictRidge(
  model: RidgeModel,
  features: number[]
): { x: number; y: number } {
  if (features.length !== model.numFeatures) {
    throw new RangeError(
      `[ridge] dimensão incompatível: modelo treinado com ${model.numFeatures} features, ` +
      `recebeu ${features.length}. Causa provável: calibração feita com o bloco L2CS ` +
      `ativo (44 dims/olho) e inferência sem ele (37 dims), ou vice-versa. ` +
      `Recalibre com o worker L2CS em estado 'ready'.`
    );
  }
  const f = [1.0, ...features];

  let normX = 0;
  let normY = 0;
  for (let i = 0; i < f.length; i++) {
    normX += model.betaX[i] * f[i];
    normY += model.betaY[i] * f[i];
  }

  // Retorna coordenadas normalizadas SEM clamp.
  // O clamp é aplicado APÓS a média binocular em `mapGaze`. Fazer clamp aqui,
  // por olho, distorce a média binocular quando um olho satura na borda: se
  // o olho direito prevê x=1.05 e o esquerdo prevê x=0.9, a média correta
  // seria ~0.975; com clamp por olho vira (1.0+0.9)/2 = 0.95, puxando o
  // cursor para dentro da tela.
  return {
    x: normX,
    y: normY,
  };
}

/**
 * Padronizador de fold: média/desvio calculados só sobre as linhas passadas.
 * Usado dentro do CV para eliminar o vazamento do scaler global.
 */
function foldStandardizer(rows: number[][]): {
  apply: (r: number[]) => number[];
  means: number[];
  stds: number[];
} {
  const n = rows.length;
  const d = n > 0 ? rows[0].length : 0;
  const mean = new Array<number>(d).fill(0);
  // O acumulador de soma de quadrados começa em ZERO — começar em 1 somaria
  // uma unidade de variância a toda feature e desativaria a guarda abaixo.
  const std = new Array<number>(d).fill(0);
  if (n === 0) return { apply: (r) => r, means: mean, stds: std };
  for (const r of rows) for (let j = 0; j < d; j++) mean[j] += r[j];
  for (let j = 0; j < d; j++) mean[j] /= n;
  for (const r of rows) for (let j = 0; j < d; j++) std[j] += (r[j] - mean[j]) ** 2;
  for (let j = 0; j < d; j++) {
    const v = Math.sqrt(std[j] / Math.max(1, n - 1));
    // Feature constante produz v = 0 e cai no piso de 1.
    std[j] = Number.isFinite(v) && v > 1e-8 ? v : 1;
  }
  return {
    apply: (r) => r.map((v, j) => (v - mean[j]) / std[j]),
    means: mean,
    stds: std,
  };
}

/** Exposto para o teste verificar os números do padronizador diretamente. */
export const __testingFoldStandardizer = foldStandardizer;

/** Grid de λ varrido pela validação cruzada, de "sem regularização" (1e-5)
 *  a "encolhimento total" (1e3). */
export const LAMBDA_GRID: readonly number[] = [
  1e-5, 2.15e-5, 4.64e-5,
  1e-4, 2.15e-4, 4.64e-4,
  1e-3, 2.15e-3, 4.64e-3,
  1e-2, 2.15e-2, 4.64e-2,
  1e-1, 2.15e-1, 4.64e-1,
  1, 2.15, 4.64,
  10, 21.5, 46.4,
  100, 215, 464,
  1000,
];

/** Tolerância relativa para considerar dois erros de CV empatados.
 *  Sem ela, uma diferença na 15ª casa decimal — ruído de ponto flutuante —
 *  decide o desempate por acidente. */
const LAMBDA_TIE_REL_TOL = 1e-9;

export interface EscolhaDeLambda {
  /** `false` quando NENHUM λ do grid produziu erro finito. */
  ok: boolean;
  /** λ escolhido. Só significa alguma coisa quando `ok` é `true`. */
  lambda: number;
  /** Erro de CV do λ escolhido. `Infinity` quando `ok` é `false`. */
  erro: number;
}

/**
 * Escolhe o λ de menor erro de validação cruzada.
 *
 * Empates ficam com o MAIOR λ: num platô de erro, entre modelos que erram
 * igual, o certo é o mais regularizado. Falha total (nenhum λ com erro
 * finito) é sinalizada em `ok`, em vez de devolver o menor λ do grid como se
 * tivesse sido validado. `avaliar` pode lançar — exceção conta como falha
 * daquele λ, não da varredura.
 */
export function escolherMelhorLambda(
  lambdas: readonly number[],
  avaliar: (lambda: number) => number,
): EscolhaDeLambda {
  let melhor = Number.NaN;
  let menorErro = Infinity;

  for (const lambda of lambdas) {
    let erro: number;
    try {
      erro = avaliar(lambda);
    } catch {
      continue;
    }
    if (!Number.isFinite(erro)) continue;

    if (!Number.isFinite(menorErro)) {
      menorErro = erro;
      melhor = lambda;
      continue;
    }
    const empate = Math.abs(erro - menorErro) <= LAMBDA_TIE_REL_TOL * Math.max(1, Math.abs(menorErro));
    if (erro < menorErro && !empate) {
      menorErro = erro;
      melhor = lambda;
    } else if (empate && lambda > melhor) {
      // Desempate pelo MAIOR λ — mais regularização entre erros iguais.
      melhor = lambda;
    }
  }

  if (!Number.isFinite(menorErro)) {
    return { ok: false, lambda: Number.NaN, erro: Infinity };
  }
  return { ok: true, lambda: melhor, erro: menorErro };
}

export class RidgeRegressor {
  private model: RidgeModel | null;

  constructor(model?: RidgeModel) {
    this.model = model ?? null;
  }

  /** Quando não é `null`, substitui o λ escolhido por validação cruzada.
   *  Só o harness escreve aqui; o app nunca toca. Existe porque comparar duas
   *  variantes com λ diferentes mistura duas mudanças numa medição só. */
  static lambdaOverride: number | null = null;

  /**
   * Equilibra os alvos no ajuste, dando a cada um o mesmo peso total
   * independente de quantos quadros ele reteve.
   *
   * Default false: os efeitos medidos foram inconsistentes entre sessões
   * (melhora numa, piora noutra), e o desequilíbrio grande costuma vir junto
   * com deriva de pose — o aviso de deriva na tela de calibração ataca a
   * causa; equilibrar peso trataria o sintoma.
   */
  static balanceTargets = false;

  /** Peso por amostra que iguala os alvos: 1/contagem do grupo, normalizado. */
  private static pesosPorAlvo(groups: string[]): number[] {
    const conta = new Map<string, number>();
    for (const g of groups) conta.set(g, (conta.get(g) ?? 0) + 1);
    return groups.map((g) => 1 / (conta.get(g) ?? 1));
  }

  train(features: number[][], targetsX: number[], targetsY: number[]): void {
    const targets = targetsX.map((x, i) => ({ screenX: x, screenY: targetsY[i] }));
    const groups = targets.map(targetGroupKey);
    const bestLambdas = RidgeRegressor.lambdaOverride != null
      ? { x: RidgeRegressor.lambdaOverride, y: RidgeRegressor.lambdaOverride }
      : this.selectLambdaCV(features, targets, LAMBDA_GRID, groups);
    const pesos = RidgeRegressor.balanceTargets ? RidgeRegressor.pesosPorAlvo(groups) : null;

    const MAX_ESCALATIONS = 3;
    let lambdaX = bestLambdas.x;
    let lambdaY = bestLambdas.y;
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= MAX_ESCALATIONS; attempt++) {
      try {
        this.model = trainRidgeModel(features, targets, { x: lambdaX, y: lambdaY }, { groups, sampleWeights: pesos });
        if (attempt > 0) {
          console.warn(`[ridge] λ escalonado ${attempt}× até (${lambdaX}, ${lambdaY}) — dado provavelmente ruim`);
        }
        if (this.model.nearSingularCols.length > 0) {
          console.warn(`[ridge] pivô quase-singular em ${this.model.nearSingularCols.length} coluna(s): ${this.model.nearSingularCols.slice(0, 10).join(',')}${this.model.nearSingularCols.length > 10 ? '…' : ''}. β pode gerar predições instáveis.`);
        }
        return;
      } catch (e) {
        lastError = e;
        lambdaX *= 10;
        lambdaY *= 10;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('[ridge] treino falhou após 3 escalonamentos de λ');
  }

  /**
   * λ por eixo, escolhido por validação cruzada leave-one-TARGET-out (um
   * alvo inteiro fora por fold). Deixar de fora uma AMOSTRA só seria fácil
   * demais: quadros da mesma fixação são quase idênticos, e o λ sairia
   * otimista — medido, 22 px contra 140 px de erro de validação.
   *
   * X e Y têm λ independentes, para o ruído vertical de pálpebra não
   * comprimir o ganho horizontal.
   */
  private selectLambdaCV(
    features: number[][],
    targets: { screenX: number; screenY: number }[],
    lambdas: readonly number[],
    groupKeys?: string[],
  ): { x: number; y: number } {
    const keys = groupKeys ?? targets.map(targetGroupKey);
    const targetsUnique: string[] = [];
    const groups: { [key: string]: number[] } = {};

    for (let i = 0; i < targets.length; i++) {
      const key = keys[i];
      if (!groups[key]) {
        groups[key] = [];
        targetsUnique.push(key);
      }
      groups[key].push(i);
    }

    if (targetsUnique.length < 2) return { x: 1.0, y: 1.0 };

    // Erro de CV por λ; a escolha (com desempate e detecção de falha total)
    // fica em `escolherMelhorLambda`, que é pura e testável.
    const errosPorLambdaX = new Map<number, number>();
    const errosPorLambdaY = new Map<number, number>();

    const foldCache = new Map<string, {
      stats: { apply: (r: number[]) => number[] };
      zTrain: number[][];
      zTest: number[][];
      trainTargets: { screenX: number; screenY: number }[];
      penaltyMatrix: number[][] | null;
      pesos: number[] | null;
    }>();

    for (const lambda of lambdas) {
      let foldErrorSumX = 0;
      let foldErrorSumY = 0;
      let foldsCounted = 0;
      let failed = false;

      for (const key of targetsUnique) {
        const trainFeatures: number[][] = [];
        const trainTargets: { screenX: number; screenY: number }[] = [];
        const trainGroups: string[] = [];
        const testFeatures: number[][] = [];
        const testTargets: { screenX: number; screenY: number }[] = [];

        const alreadyCached = foldCache.has(key);
        for (let i = 0; i < features.length; i++) {
          if (keys[i] === key) {
            if (!alreadyCached) testFeatures.push(features[i]);
            testTargets.push(targets[i]);
          } else if (!alreadyCached) {
            trainFeatures.push(features[i]);
            trainTargets.push(targets[i]);
            trainGroups.push(keys[i]);
          }
        }

        const cached = foldCache.get(key);
        const stats = cached ? cached.stats : foldStandardizer(trainFeatures);
        const zTrain = cached ? cached.zTrain : trainFeatures.map(stats.apply);
        const zTest = cached ? cached.zTest : testFeatures.map(stats.apply);
        const penaltyMatrix = cached
          ? cached.penaltyMatrix
          : withinTargetPenalty(zTrain, trainGroups);
        const pesosFold = cached
          ? cached.pesos
          : (RidgeRegressor.balanceTargets ? RidgeRegressor.pesosPorAlvo(trainGroups) : null);
        if (!cached) {
          foldCache.set(key, { stats, zTrain, zTest, trainTargets, penaltyMatrix, pesos: pesosFold });
        }
        const foldTargets = cached ? cached.trainTargets : trainTargets;

        try {
          const model = trainRidgeModel(zTrain, foldTargets, lambda, { penaltyMatrix, sampleWeights: pesosFold });
          let sqX = 0;
          let sqY = 0;
          for (let i = 0; i < zTest.length; i++) {
            const pred = predictRidge(model, zTest[i]);
            const dx = pred.x - testTargets[i].screenX;
            const dy = pred.y - testTargets[i].screenY;
            sqX += dx * dx;
            sqY += dy * dy;
          }
          foldErrorSumX += zTest.length > 0 ? sqX / zTest.length : 0;
          foldErrorSumY += zTest.length > 0 ? sqY / zTest.length : 0;
          foldsCounted++;
        } catch {
          failed = true;
          break;
        }
      }

      if (failed || foldsCounted === 0) continue;
      errosPorLambdaX.set(lambda, foldErrorSumX / foldsCounted);
      errosPorLambdaY.set(lambda, foldErrorSumY / foldsCounted);
    }

    const avaliarX = (l: number) => errosPorLambdaX.get(l) ?? Infinity;
    const avaliarY = (l: number) => errosPorLambdaY.get(l) ?? Infinity;

    // Recuo EXPLÍCITO quando nenhum λ do grid é validável: o mais regularizado
    // do grid, porque sem evidência o menos arriscado é o que menos memoriza.
    const recuo = lambdas[lambdas.length - 1];
    const aplicar = (r: ReturnType<typeof escolherMelhorLambda>, eixo: string): number => {
      if (r.ok) return r.lambda;
      console.warn(
        `[ridge] ⚠ NENHUM λ do grid produziu erro finito no eixo ${eixo} — a validação ` +
        `cruzada falhou em todos os folds (matriz singular é a causa típica: features ` +
        `constantes ou colineares). Recuando para o λ mais regularizado do grid ` +
        `(${recuo}). O modelo resultante NÃO foi validado; trate a calibração como suspeita.`,
      );
      return recuo;
    };

    const rx = escolherMelhorLambda(lambdas, avaliarX);
    const ry = escolherMelhorLambda(lambdas, avaliarY);
    const lx = aplicar(rx, 'X');
    const ly = aplicar(ry, 'Y');
    if (rx.ok && ry.ok) {
      console.log(
        `[ridge] CV Lambda selecionado: X=${lx} (erro: ${rx.erro.toFixed(4)}), ` +
        `Y=${ly} (erro: ${ry.erro.toFixed(4)})`,
      );
    }
    return { x: lx, y: ly };
  }

  predict(features: number[]): { x: number; y: number } {
    if (!this.model) return { x: 0, y: 0 };
    return predictRidge(this.model, features);
  }

  getModel(): RidgeModel | null {
    return this.model;
  }
}

