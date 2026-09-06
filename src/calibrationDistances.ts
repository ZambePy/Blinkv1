// Resolução das DUAS distâncias de uma sessão de calibração.
//
// "Distância até a câmera" e "distância até a tela" são grandezas diferentes:
// o setup recomendado é câmera perto / tela longe, e com FOV 90° a câmera
// ideal fica a ~22 cm enquanto a tela fica a 60 cm. Um `??` que deixava a
// medida de câmera assumir o lugar da distância de tela (só quando o FOV
// estava calibrado, daí o sintoma intermitente) tinha três efeitos:
//
//  (a) A grade de calibração encolhe: os alvos saem do orçamento
//      `budgetCm = d·tan(16°)`, e com d=25 vão para 28%/72% em vez de 17%/83%.
//      O Ridge treina só nos 44% centrais e a validação vira extrapolação.
//  (b) A compensação de distância fica com o denominador errado (~90 px num
//      viewport de 1920).
//  (c) O erro angular do relatório mente por ~2,4×.
//
// Este módulo é o único lugar responsável por essa distinção.

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
