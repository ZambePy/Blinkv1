import {
  extractEyeFeatures,
  extractCompactFeatures,
  projectFeatureSet,
  activeFeatureDims,
  ACTIVE_FEATURE_SET,
  FEATURE_VECTOR_ID,
} from './extractor';
import type { Point3D, AdvancedFrameFeatures, L2CSGazeInput, FeatureSet } from './extractor';
import type { BlinkDetector } from './extractor';

export interface FeaturePipelineResult {
  featuresLeft:  number[];
  featuresRight: number[];
  blinkDetected: boolean;
  advancedFeatures?: AdvancedFrameFeatures;
  // Repassa EARs por olho (calculados no extractor) para o engine ponderar
  // a fusão binocular durante a inferência live.
  leftEAR?: number;
  rightEAR?: number;
}

// BUG-10: A correção de isotropicLandmarks era aplicada DUAS VEZES quando a
// flag estava ligada — uma aqui e outra dentro de extractEyeFeatures (chamado
// por extractCompactFeatures). O resultado: x *= aspectRatio², z *= aspectRatio².
// Isso impedia que a flag funcionasse corretamente. A correção fica APENAS
// dentro de extractEyeFeatures, que recebe videoWidth/videoHeight do caller.
import { EXPERIMENT } from './config/experiment';

export const USE_COMPACT_FEATURES = true;

export function extractFeatures(
  landmarks: Point3D[],
  faceMatrix?: Float32Array,
  l2csGaze?: L2CSGazeInput | null,
  videoWidth?: number,
  videoHeight?: number,
  /** Conjunto de features a projetar. Existe para o harness poder medir
   *  variantes na MESMA gravação sem recompilar; o app nunca passa este
   *  argumento e segue no `ACTIVE_FEATURE_SET`. */
  featureSet?: FeatureSet,
  /** Detector de piscada a usar. Sem ele vale o singleton do módulo,
   *  que é o comportamento do app. O harness passa um por execução, para que
   *  medir uma variante não altere o limiar adaptativo que a próxima veria. */
  blinkDetector?: BlinkDetector,
): FeaturePipelineResult {
  // extractEyeFeatures (path legado, USE_COMPACT_FEATURES=false) não recebe
  // L2CS por design — só o compact expõe o extension point; se um dia quiser
  // suportar no path full, adicionar aqui.
  //
  let workingLandmarks = landmarks;
  if (EXPERIMENT.isotropicLandmarks && videoWidth && videoHeight && videoHeight > 0) {
    const aspectRatio = videoWidth / videoHeight;
    workingLandmarks = landmarks.map(p => ({
      ...p,
      x: p.x * aspectRatio,
      z: p.z * aspectRatio,
    }));
  }

  const geo = USE_COMPACT_FEATURES
    // B2.6 — as dimensões do vídeo seguem até o cálculo do EAR para a correção
    // de anisotropia. Antes eram descartadas aqui, e o EAR chegava ao detector
    // inflado por W/H (1,78× em 1080p).
    ? extractCompactFeatures(workingLandmarks, faceMatrix, l2csGaze, blinkDetector, videoWidth, videoHeight)
    : extractEyeFeatures(workingLandmarks, faceMatrix, videoWidth, videoHeight, blinkDetector);

  // A projeção no conjunto ativo mora AQUI, não dentro do extractor.
  // Motivo: `extractCompactFeatures` é o dono do layout e continua devolvendo
  // o vetor completo (37 ou 44 dims), o que preserva o contrato dos testes de
  // paridade e do bloco L2CS. Esta função é a fronteira que o engine e a
  // calibração consomem, então é o ponto certo para decidir o que o modelo vê.
  // Ver `ACTIVE_FEATURE_SET` em extractor.ts para a evidência da escolha.
  const featuresLeft = projectFeatureSet(geo.featuresLeft, featureSet);
  const featuresRight = projectFeatureSet(geo.featuresRight, featureSet);

  // B1.1 — assertiva de dimensão na fronteira.
  //
  // `projectFeatureSet` já lança quando o vetor é curto demais. Esta segunda
  // barreira pega o caso complementar: o conjunto projetar um comprimento
  // diferente do que `FEATURE_VECTOR_ID` anuncia. Se isso passasse, um perfil
  // salvo sob um ID seria carregado por uma sessão cujo vetor tem outra
  // semântica — e o sintoma só apareceria como cursor deslocado, sem erro.
  // Vetor vazio (frame sem rosto) é exceção legítima, igual em projectFeatureSet.
  const esperado = activeFeatureDims(featureSet ?? ACTIVE_FEATURE_SET);
  if (typeof esperado === 'number') {
    if (featuresLeft.length > 0 && featuresLeft.length !== esperado) {
      throw new RangeError(
        `[featurePipeline] vetor esquerdo com ${featuresLeft.length} dims, ` +
        `mas o conjunto ativo declara ${esperado} (FEATURE_VECTOR_ID='${FEATURE_VECTOR_ID}'). ` +
        `Perfis gravados com este ID seriam incompatíveis com o que o modelo vê.`
      );
    }
    if (featuresRight.length > 0 && featuresRight.length !== esperado) {
      throw new RangeError(
        `[featurePipeline] vetor direito com ${featuresRight.length} dims, ` +
        `mas o conjunto ativo declara ${esperado} (FEATURE_VECTOR_ID='${FEATURE_VECTOR_ID}').`
      );
    }
  }

  return {
    featuresLeft,
    featuresRight,
    blinkDetected: geo.blinkDetected,
    advancedFeatures: geo.advancedFeatures,
    leftEAR: geo.leftEAR,
    rightEAR: geo.rightEAR,
  };
}
