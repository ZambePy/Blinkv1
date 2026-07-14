import { extractEyeFeatures } from './extractor';
import type { Point3D, AdvancedFrameFeatures } from './extractor';
import { buildFusedFeatureVector, isPCAReady } from './fusion';

// ─── Modo de operação ─────────────────────────────────────────────────────────
//
// 'geometry_only' — padrão atual e único modo validado em produção.
//   Usa apenas as features geométricas do extractor.ts (~258 dims por olho).
//   O regressor Ridge foi treinado neste vetor; NÃO mude para 'fused' sem
//   re-treinar o scaler e o regressor sobre o vetor fundido.
//
// 'fused' — NÃO ATIVAR NESTA TAREFA.
//   Concatena embedding CNN reduzido via PCA (18 dims) + geometria (~258 dims).
//   Requer: (1) re-fit do StandardScaler, (2) troca de regressor para KernelRidge.
//   Será ativado na próxima tarefa, após validação dos números de precisão.

export type FeatureMode = 'geometry_only' | 'fused';
export const FEATURE_MODE: FeatureMode = 'geometry_only';

// Habilita a execução da extração de embeddings CNN mesmo se FEATURE_MODE for geometry_only
// Útil para diagnosticar a fusão via Config C sob demanda sem ativar o modo de produção fusionado.
export const ENABLE_CNN_EXTRACTION: boolean = true;

// ─── Tipos ────────────────────────────────────────────────────────────────────

export interface FeaturePipelineResult {
  featuresLeft:  number[];
  featuresRight: number[];
  blinkDetected: boolean;
  /** Vetor fundido (embedding PCA + geometria) — presente apenas quando
   *  FEATURE_MODE='fused' E embedding não for null. Undefined caso contrário.
   *  Não usado pela calibração enquanto FEATURE_MODE='geometry_only'. */
  fusedLeft?:  number[] | null;
  fusedRight?: number[] | null;
  advancedFeatures?: AdvancedFrameFeatures;
}

// ─── Pipeline ─────────────────────────────────────────────────────────────────

export function extractFeatures(
  landmarks: Point3D[],
  faceMatrix?: Float32Array,
  /** Embedding CNN do frame atual (pode ser null se o encoder não retornou). */
  embedding?: Float32Array | null,
): FeaturePipelineResult {
  const geo = extractEyeFeatures(landmarks, faceMatrix);

  const featuresLeft  = [...geo.featuresLeft];
  const featuresRight = [...geo.featuresRight];

  const result: FeaturePipelineResult = {
    featuresLeft,
    featuresRight,
    blinkDetected: geo.blinkDetected,
    advancedFeatures: geo.advancedFeatures,
  };

  // Computar vetor fundido para validação — não é usado na predição enquanto
  // FEATURE_MODE='geometry_only'. Se o PCA não estiver carregado ou o embedding
  // for null, fusedLeft/Right ficam null (tratamento explícito, sem zeros falsos).
  if (isPCAReady()) {
    const embOrNull = embedding ?? null;
    result.fusedLeft  = buildFusedFeatureVector(embOrNull, featuresLeft);
    result.fusedRight = buildFusedFeatureVector(embOrNull, featuresRight);
  }

  return result;
}
