// Resolução das DUAS distâncias de uma sessão de calibração (B1.4).
//
// Existe para que a distinção entre "distância até a câmera" e "distância até
// a tela" tenha um único lugar responsável, em vez de ser refeita — e errada —
// em cada chamador.
//
// ## O bug que este módulo fecha
//
// `CalibrationCheck.tsx` fazia:
//
//   const estimatedDistanceCm = calibration.getCurrentCameraDistanceCm?.() ?? null;
//   const distCm = estimatedDistanceCm ?? settings.viewingDistanceCm;
//   calibration.setCalibrationDistancesCm?.(estimatedDistanceCm, distCm);
//
// `getCurrentCameraDistanceCm()` é `estimateDistanceCm(iodPx, videoWidth, fov)`
// — distância até a CÂMERA. O `??` fazia essa medida assumir o lugar da
// distância até a TELA sempre que existisse, o que só acontece quando
// `cameraHorizontalFovDeg` está calibrado. Daí o sintoma ser intermitente
// entre postos de uso: onde ninguém calibrou o FOV, o bug não aparece.
//
// ## Por que são grandezas diferentes
//
// O setup recomendado no README é câmera perto / tela longe — "posicionamento
// da câmera independente do monitor permite aproximar a câmera sem aproximar a
// tela". Com FOV 90°, `idealDistanceCm` dá ~22,5 cm para a câmera enquanto a
// tela fica a 60 cm. São 2,7× de diferença.
//
// ## Os três efeitos de confundi-las
//
//  (a) A grade de calibração encolhe. Os alvos são posicionados por orçamento
//      de excentricidade angular: `budgetCm = d·tan(16°)`. Com d=60 os alvos
//      ficam em 17%/83%; com d=25 a fração cai para 0,137, é clampada pelo
//      piso 0,22, e os alvos vão para 28%/72%. O Ridge treina só nos 44%
//      centrais e os pontos de validação em 25/75 viram extrapolação.
//  (b) A compensação de distância fica com o denominador errado — 0,76 onde o
//      correto é 0,90, ~90 px de deslocamento num viewport de 1920.
//  (c) O erro angular do relatório mente por ~2,4×.

import { DEFAULT_VIEWING_DISTANCE_CM } from './calibration';

export interface CalibrationDistanceInput {
  /**
   * Distância câmera→rosto medida neste frame, em cm, ou `null` quando o FOV
   * da câmera não foi calibrado e portanto não há medida.
   */
  measuredCameraDistanceCm: number | null | undefined;
  /**
   * Distância olho→tela configurada pelo cuidador, em cm. É a única fonte
   * legítima para a distância de tela hoje: nenhum sensor do sistema a mede.
   */
  configuredViewingDistanceCm: number | null | undefined;
}

export interface CalibrationDistances {
  /** Distância até a câmera. `null` quando não medida. Usada APENAS como
   *  referência para calcular a VARIAÇÃO relativa depois — nunca como
   *  distância de tela. */
  cameraCm: number | null;
  /** Distância até a tela. Governa o orçamento de excentricidade da grade e o
   *  erro angular do relatório. Nunca `null`: cai no default se a configuração
   *  estiver ausente ou corrompida. */
  screenCm: number;
}

/**
 * Separa as duas distâncias de forma explícita.
 *
 * Regra única: **a distância de câmera nunca vira distância de tela.** Se a
 * configuração da tela estiver ausente, não-finita ou não-positiva, cai no
 * default de produção — nunca no valor de câmera, por mais que ele seja a
 * única medida disponível. Um número medido do eixo errado é pior que um
 * default declarado, porque parece medição.
 */
export function resolveCalibrationDistances(
  input: CalibrationDistanceInput,
): CalibrationDistances {
  const camera = input.measuredCameraDistanceCm;
  const cameraCm =
    typeof camera === 'number' && Number.isFinite(camera) && camera > 0 ? camera : null;

  const configurada = input.configuredViewingDistanceCm;
  const screenCm =
    typeof configurada === 'number' && Number.isFinite(configurada) && configurada > 0
      ? configurada
      : DEFAULT_VIEWING_DISTANCE_CM;

  return { cameraCm, screenCm };
}
