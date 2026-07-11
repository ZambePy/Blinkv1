/**
 * fusion.ts — Concatena o embedding da CNN (256 dims, reduzido via PCA)
 * com as features geométricas existentes num vetor único para o regressor.
 *
 * Pipeline de redução de dimensionalidade:
 *   embedding (256) -[PCA]-> componentes principais (n_components=18)
 *   concat com geometryFeatures (N dims)
 *   -> vetor fundido (18 + N dims)
 *
 * A matriz de PCA é carregada UMA vez via loadPCA() na inicialização.
 * Por frame, buildFusedFeatureVector() faz apenas uma multiplicação de
 * matriz (18×256), O(4608 ops) — custo negligível no frame loop.
 *
 * TRATAMENTO DE NULL:
 *   Se o embedding for null (encoder não carregado, eyeCrop.ts retornou null,
 *   ou inferência falhou), buildFusedFeatureVector retorna null.
 *   O chamador decide: usar modo fallback só-geometria ou pular o frame.
 *   Esta função NUNCA preenche com zeros silenciosamente.
 *
 * TODO (próxima tarefa — troca de regressor):
 *   O StandardScaler em scaler.ts foi ajustado (fit) sobre o vetor geométrico
 *   puro (~258 dims por olho). Ele NÃO deve ser aplicado ao vetor fundido
 *   (~276 dims) sem re-fit. Antes de ativar FEATURE_MODE='fused' em produção,
 *   é necessário re-treinar o scaler sobre o vetor fundido.
 */

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface PCAModel {
  n_components: number;
  mean_:        number[];  // length 256
  components_:  number[];  // length n_components * 256, row-major
}

// ─── Estado do módulo ─────────────────────────────────────────────────────────

let _pca: PCAModel | null = null;

// ─── Init ─────────────────────────────────────────────────────────────────────

/**
 * Injeta o modelo de PCA diretamente (usado em testes ou quando o JSON já foi
 * carregado externamente).
 */
export function initPCA(model: PCAModel): void {
  if (model.mean_.length !== 256) {
    throw new Error(`PCA mean_ deve ter 256 elementos, recebeu ${model.mean_.length}`);
  }
  const expected = model.n_components * 256;
  if (model.components_.length !== expected) {
    throw new Error(
      `PCA components_ deve ter ${expected} elementos, recebeu ${model.components_.length}`
    );
  }
  _pca = model;
}

/**
 * Carrega embedding_pca.json via fetch e chama initPCA.
 * Deve ser chamado UMA vez na inicialização da aplicação (ex.: main.ts).
 * Tolerante a falha: loga erro mas não lança — o app continua com
 * FEATURE_MODE='geometry_only' se o JSON não estiver disponível.
 */
export async function loadPCA(url = '/models/embedding_pca.json'): Promise<void> {
  try {
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const model = await resp.json() as PCAModel;
    initPCA(model);
    console.log(
      `[fusion] PCA carregado: ${model.n_components} componentes, ` +
      `${(model.components_.length * 4 / 1024).toFixed(1)} KB de dados`
    );
  } catch (err) {
    console.warn('[fusion] Falha ao carregar embedding_pca.json — fusion desativado:', err);
  }
}

/** Retorna true se o modelo de PCA está disponível. */
export function isPCAReady(): boolean {
  return _pca !== null;
}

// ─── Projeção PCA ─────────────────────────────────────────────────────────────

/**
 * Projeta um embedding de 256 dims no espaço de n_components dims via PCA.
 * Operação: projected[c] = sum_i( components[c,i] * (embedding[i] - mean[i]) )
 */
function projectEmbedding(embedding: Float32Array, pca: PCAModel): number[] {
  const d    = 256;
  const n    = pca.n_components;
  const mean = pca.mean_;
  const comp = pca.components_;

  const projected = new Array<number>(n);
  for (let c = 0; c < n; c++) {
    let dot = 0;
    const offset = c * d;
    for (let i = 0; i < d; i++) {
      dot += comp[offset + i] * (embedding[i] - mean[i]);
    }
    projected[c] = dot;
  }
  return projected;
}

// ─── API pública ──────────────────────────────────────────────────────────────

/**
 * Constrói o vetor fundido [embedding_reduzido, geometryFeatures].
 *
 * @param embedding        Saída do encoderRunner (256 floats) ou null.
 * @param geometryFeatures Saída de featurePipeline.ts (N dims, qualquer tamanho).
 * @returns                Vetor de (n_components + N) dims, ou null se:
 *                           - embedding for null
 *                           - PCA ainda não foi carregado (loadPCA pendente)
 *                         O chamador é responsável por tratar null (fallback ou skip).
 */
export function buildFusedFeatureVector(
  embedding: Float32Array | null,
  geometryFeatures: number[],
): number[] | null {
  if (embedding === null) return null;
  if (_pca === null)       return null;

  const reduced = projectEmbedding(embedding, _pca);
  return [...reduced, ...geometryFeatures];
}

/**
 * Retorna as dimensões do vetor fundido para um dado tamanho de geometryFeatures.
 * Útil para diagnóstico e para pré-alocar buffers.
 * Retorna null se o PCA ainda não foi carregado.
 */
export function fusedDims(geometryDims: number): number | null {
  if (_pca === null) return null;
  return _pca.n_components + geometryDims;
}
