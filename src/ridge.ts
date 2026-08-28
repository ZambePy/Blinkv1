// Regressão Ridge Múltipla Linear (sem expansão polinomial)
// Recebe o vetor de features por olho (~31 dims com USE_COMPACT_FEATURES=true,
// ou 260 dims com o extractor completo) + Bias implícito no índice 0.
//
// ─── D9: regularização branqueada pelo ruído intra-fixação ──────────────────
//
// PROBLEMA (medido no relatório 1787682565489): o vetor compacto tem 44 dims/olho
// (45 parâmetros com o bias) e a calibração fornece apenas 9 alvos distintos.
// Sobram ~36 direções que NENHUM alvo restringe. Com `+λI` (penalidade
// isotrópica) o Ridge preenche essas direções com o que estiver disponível —
// o jitter de fixação e a deriva lenta de pose/landmark que ficam ALIASADOS
// com a identidade do alvo, já que cada alvo é uma janela contígua de ~2 s.
// Consequência medida: jitter RMS de 50 px a partir de ruído de landmark da
// ordem de 10⁻³, isto é, amplificação de ruído de ~30×.
//
// CORREÇÃO: penalidade anisotrópica. Durante a janela de um alvo o olhar está
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
  // A1-3 — diagnóstico que sobrevive à serialização. `lambda` é o λ
  // efetivamente usado no treino (pode ser maior que o escolhido pelo CV
  // se houve escalonamento defensivo por matriz singular). `nearSingularCols`
  // são as colunas cujo pivô durante a eliminação gaussiana ficou abaixo
  // de 1e-6 mas acima de 1e-12: resolve numericamente mas gera coeficientes
  // grandes que produzem predições instáveis.
  lambda: number;
  nearSingularCols: number[];
  /** D9 — qual penalidade foi usada. `within-target` significa que o modelo
   *  foi branqueado pelo ruído intra-fixação; `isotropic` é o `λI` histórico
   *  (usado quando o caller não agrupa amostras por alvo). Só diagnóstico —
   *  não afeta `predictRidge`, então perfis serializados antigos continuam
   *  carregando (o campo chega `undefined` e é tratado como isotropic). */
  penalty?: 'isotropic' | 'within-target';
}

// A1-3 — limiar de "quase-singular". Acima de 1e-12 solveLinear ainda
// resolve, mas abaixo de 1e-6 os coeficientes β ficam ordens de grandeza
// maiores que o razoável, gerando predições que "explodem" para pequenas
// variações da entrada. É a assinatura do bug de erro grande + jitter
// baixo observado em A0-5 com óculos (viés de 400 px).
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

/** Piso relativo da penalidade anisotrópica. Uma dimensão com variância
 *  intra-alvo ~0 (feature literalmente congelada) receberia penalidade zero e
 *  deixaria o sistema singular naquela direção. O piso garante que toda
 *  direção continua penalizada em pelo menos 10% da penalidade média. */
const PENALTY_FLOOR = 0.10;

/**
 * D9 — matriz de penalidade Σ_W (covariância intra-alvo) normalizada.
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

  for (let a = 0; a < d; a++) {
    for (let b = 0; b < d; b++) S[a][b] /= meanDiag;
    S[a][a] += PENALTY_FLOOR;
  }
  return S;
}

export interface RidgeTrainOptions {
  /** Chave do alvo de cada amostra (mesmo comprimento de `features`). Quando
   *  presente e com ≥2 alvos, ativa a penalidade branqueada pelo ruído
   *  intra-fixação (D9). Ausente → `λI` isotrópico. */
  groups?: string[];
  /** Σ_W já calculada. Σ_W não depende de λ, então o CV a computa UMA vez por
   *  fold e reusa nas 22 tentativas de λ — sem isto, o custo O(m·d²) dominaria
   *  o treino (22× desperdício). `null` força a penalidade isotrópica. */
  penaltyMatrix?: number[][] | null;
}

export function trainRidgeModel(
  features: number[][],
  targets: { screenX: number; screenY: number }[],
  lambda = 1.0,
  options?: RidgeTrainOptions,
): RidgeModel {
  const m = features.length;
  if (m === 0) {
    return { betaX: [], betaY: [], numFeatures: 0, lambda, nearSingularCols: [], penalty: 'isotropic' };
  }

  const rawFeatures = features[0].length;
  const nf = rawFeatures + 1; // +1 para o Bias term

  // Prepara matriz Phi com Bias
  const Phi = features.map(f => [1.0, ...f]);

  // D9 — penalidade Σ_W (branqueada) quando o caller agrupou por alvo. Se o
  // caller já a calculou (caminho do CV), reusa em vez de recomputar.
  const P = options?.penaltyMatrix !== undefined
    ? options.penaltyMatrix
    : options?.groups
      ? withinTargetPenalty(features, options.groups)
      : null;
  const penalty: 'isotropic' | 'within-target' = P ? 'within-target' : 'isotropic';

  // A = ΦᵀΦ + λ·m·P   (P = I no caso isotrópico)
  //
  // O fator `m` deixa λ adimensional: ΦᵀΦ cresce com o número de amostras, e
  // sem ele o mesmo λ regulariza 3× mais fraco numa coleta que reteve 3× mais
  // frames. Multiplicar λ (em vez de dividir A) preserva a escala numérica da
  // matriz — os limiares absolutos de pivô em `solveLinear` continuam válidos.
  const reg = lambda * m;
  const A: number[][] = Array.from({ length: nf }, (_, i) =>
    Array.from({ length: nf }, (_, j) => {
      let s = 0;
      for (let k = 0; k < m; k++) s += Phi[k][i] * Phi[k][j];
      // O bias (índice 0) nunca é penalizado.
      if (i === 0 || j === 0) return s;
      if (P) return s + reg * P[i - 1][j - 1];
      return s + (i === j ? reg : 0);
    })
  );

  // b = Φᵀy  (para screenX e screenY separadamente)
  const bX = Array.from({ length: nf }, (_, i) => {
    let s = 0;
    for (let k = 0; k < m; k++) s += Phi[k][i] * targets[k].screenX;
    return s;
  });

  const bY = Array.from({ length: nf }, (_, i) => {
    let s = 0;
    for (let k = 0; k < m; k++) s += Phi[k][i] * targets[k].screenY;
    return s;
  });

  // A1-3 — acumula colunas quase-singulares das duas solvidas. A união
  // (não a interseção) porque uma coluna instável em X é sinal de β_x
  // ruim, mesmo que β_y esteja ok.
  const nearSingularX: number[] = [];
  const nearSingularY: number[] = [];
  const betaX = solveLinear(A, bX, nearSingularX);
  const betaY = solveLinear(A, bY, nearSingularY);
  const nearSingularCols = Array.from(new Set([...nearSingularX, ...nearSingularY])).sort((a, b) => a - b);

  return { betaX, betaY, numFeatures: rawFeatures, lambda, nearSingularCols, penalty };
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
  // O clamp é aplicado APÓS a média binocular em `mapGaze` (Sprint 1.2). Fazer
  // clamp aqui, por olho, distorce a média binocular quando um olho satura na
  // borda: se o olho direito prevê x=1.05 e o esquerdo prevê x=0.9, a média
  // correta seria ~0.975; com clamp por olho vira (1.0+0.9)/2 = 0.95, puxando
  // o cursor para dentro da tela.
  return {
    x: normX,
    y: normY,
  };
}

/** Padronizador de fold: média/desvio calculados só sobre as linhas passadas.
 *  Usado dentro do CV para eliminar o vazamento do scaler global. */
function foldStandardizer(rows: number[][]): { apply: (r: number[]) => number[] } {
  const n = rows.length;
  const d = n > 0 ? rows[0].length : 0;
  const mean = new Array<number>(d).fill(0);
  const std = new Array<number>(d).fill(1);
  if (n === 0) return { apply: (r) => r };
  for (const r of rows) for (let j = 0; j < d; j++) mean[j] += r[j];
  for (let j = 0; j < d; j++) mean[j] /= n;
  for (const r of rows) for (let j = 0; j < d; j++) std[j] += (r[j] - mean[j]) ** 2;
  for (let j = 0; j < d; j++) {
    const v = Math.sqrt(std[j] / Math.max(1, n - 1));
    std[j] = Number.isFinite(v) && v > 1e-8 ? v : 1;
  }
  return { apply: (r) => r.map((v, j) => (v - mean[j]) / std[j]) };
}

export class RidgeRegressor {
  private model: RidgeModel | null;

  constructor(model?: RidgeModel) {
    this.model = model ?? null;
  }

  /** 3.1 — quando não é `null`, substitui o λ escolhido por validação cruzada.
   *  Só o harness escreve aqui; o app nunca toca. Existe porque comparar duas
   *  variantes com λ diferentes mistura duas mudanças numa medição só. */
  static lambdaOverride: number | null = null;

  /**
   * 3.1 — pesos por eixo na escolha de λ, em pixels de tela.
   *
   * O default `{1, 1}` reproduz o comportamento histórico (fração de tela
   * tratada como grandeza única). O caller que conhece a geometria passa a
   * largura e a altura reais, e aí o λ é escolhido pelo erro que o usuário de
   * fato vê.
   */
  static axisScale: { x: number; y: number } = { x: 1, y: 1 };

  train(features: number[][], targetsX: number[], targetsY: number[]): void {
    const targets = targetsX.map((x, i) => ({ screenX: x, screenY: targetsY[i] }));
    // D9 — agrupamento por alvo. Habilita a penalidade branqueada e é o mesmo
    // critério do leave-one-target-out abaixo.
    const groups = targets.map(targetGroupKey);
    // BUG-5: Grid original (8 lambdas, salto 10×) era muito esparso — o CV
    // podia escolher λ=1 quando o ótimo era λ=3.2 ou λ=0.3. Com 16 lambdas
    // em log-space o salto médio é ~3×, bem mais fino. Custo extra: ~2× o
    // tempo do CV (~20ms vs ~10ms), ainda negligenciável vs. a calibração total.
    const lambdas = [
      1e-4, 2.15e-4, 4.64e-4,
      1e-3, 2.15e-3, 4.64e-3,
      1e-2, 2.15e-2, 4.64e-2,
      1e-1, 2.15e-1, 4.64e-1,
      1, 2.15, 4.64,
      10, 21.5, 46.4,
      100, 215, 464,
      1000,
    ];
    // 3.1 — override de λ para o harness poder isolar o efeito de uma variante
    // do efeito de o CV ter escolhido outro λ. `null` (default) mantém o CV.
    const bestLambda = RidgeRegressor.lambdaOverride ?? this.selectLambdaCV(features, targets, lambdas, groups);

    // A1-3 — escalonamento defensivo. O CV pode escolher λ ótimo sobre
    // folds parciais, mas o treino final (com TODAS as amostras) pode ter
    // colunas ativas adicionais que tornam ΦᵀΦ singular. Escalona λ × 10
    // até 3 tentativas antes de desistir. O λ efetivamente usado fica em
    // model.lambda — comparar com bestLambda revela se houve socorro.
    const MAX_ESCALATIONS = 3;
    let lambda = bestLambda;
    let lastError: unknown = null;
    for (let attempt = 0; attempt <= MAX_ESCALATIONS; attempt++) {
      try {
        this.model = trainRidgeModel(features, targets, lambda, { groups });
        if (attempt > 0) {
          console.warn(`[ridge] λ escalonado ${attempt}× até ${lambda} (CV escolheu ${bestLambda}) — dado provavelmente ruim`);
        }
        if (this.model.nearSingularCols.length > 0) {
          console.warn(`[ridge] pivô quase-singular em ${this.model.nearSingularCols.length} coluna(s): ${this.model.nearSingularCols.slice(0, 10).join(',')}${this.model.nearSingularCols.length > 10 ? '…' : ''}. β pode gerar predições instáveis.`);
        }
        return;
      } catch (e) {
        lastError = e;
        lambda *= 10;
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new Error('[ridge] treino falhou após 3 escalonamentos de λ');
  }

  private selectLambdaCV(
    features: number[][],
    targets: { screenX: number; screenY: number }[],
    lambdas: number[],
    groupKeys?: string[],
  ): number {
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

    if (targetsUnique.length < 2) return 1.0;

    let bestLambda = lambdas[0];
    let minError = Infinity;

    // Tudo que depende só do FOLD (padronização, features escaladas, Σ_W) é
    // calculado uma vez e reusado pelos 22 λ. Sem isto, `withinTargetPenalty`
    // (O(m·d²)) rodaria 22× por fold.
    const foldCache = new Map<string, {
      stats: { apply: (r: number[]) => number[] };
      zTrain: number[][];
      zTest: number[][];
      trainTargets: { screenX: number; screenY: number }[];
      penaltyMatrix: number[][] | null;
    }>();

    for (const lambda of lambdas) {
      // D9 — média dos erros POR ALVO, não soma sobre amostras. Antes, um alvo
      // que reteve 90 frames pesava 3× mais na escolha de λ que um alvo que
      // reteve 30 — e alvos com mais frames retidos são justamente os fáceis
      // (rosto estável, sem rejeição por qualidade), enviesando λ para baixo.
      let foldErrorSum = 0;
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

        // D9 — re-padroniza usando APENAS o fold de treino. As features chegam
        // já escaladas por um StandardScaler ajustado sobre TODOS os alvos,
        // inclusive o que está sendo deixado de fora: vazamento que faz o CV
        // subestimar o erro de λ pequeno e escolher regularização insuficiente.
        // Padronizar de novo sobre o subconjunto é equivalente a ter escalado
        // o dado bruto só com o fold de treino (composição de mapas afins).
        const cached = foldCache.get(key);
        const stats = cached ? cached.stats : foldStandardizer(trainFeatures);
        const zTrain = cached ? cached.zTrain : trainFeatures.map(stats.apply);
        const zTest = cached ? cached.zTest : testFeatures.map(stats.apply);
        const penaltyMatrix = cached
          ? cached.penaltyMatrix
          : withinTargetPenalty(zTrain, trainGroups);
        if (!cached) {
          foldCache.set(key, { stats, zTrain, zTest, trainTargets, penaltyMatrix });
        }
        const foldTargets = cached ? cached.trainTargets : trainTargets;

        try {
          const model = trainRidgeModel(zTrain, foldTargets, lambda, { penaltyMatrix });
          let sq = 0;
          for (let i = 0; i < zTest.length; i++) {
            const pred = predictRidge(model, zTest[i]);
            // 3.1 — cada eixo pesa pela SUA dimensão em pixels.
            //
            // `screenX/screenY` são frações de tela, e fração de tela não é uma
            // grandeza única: numa tela 16:9 uma unidade de x vale 1920 px e uma
            // de y vale 1080. Somar `dx² + dy²` cru subponderava o erro em X por
            // (1920/1080)² = 3,16×, então o λ era escolhido quase só pelo eixo Y
            // — que é justamente o eixo com sinal 6× atenuado (ver 2.1). O
            // resultado era regularização excessiva.
            const dx = (pred.x - testTargets[i].screenX) * RidgeRegressor.axisScale.x;
            const dy = (pred.y - testTargets[i].screenY) * RidgeRegressor.axisScale.y;
            sq += dx * dx + dy * dy;
          }
          foldErrorSum += zTest.length > 0 ? sq / zTest.length : 0;
          foldsCounted++;
        } catch {
          failed = true;
          break;
        }
      }

      if (failed || foldsCounted === 0) continue;
      const meanFoldError = foldErrorSum / foldsCounted;
      if (meanFoldError < minError) {
        minError = meanFoldError;
        bestLambda = lambda;
      }
    }

    console.log(`[ridge] CV Lambda selecionado: ${bestLambda} (erro médio por alvo: ${minError.toFixed(6)})`);
    return bestLambda;
  }

  predict(features: number[]): { x: number; y: number } {
    if (!this.model) return { x: 0, y: 0 };
    return predictRidge(this.model, features);
  }

  getModel(): RidgeModel | null {
    return this.model;
  }
}

