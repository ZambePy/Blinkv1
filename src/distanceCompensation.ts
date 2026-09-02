// Compensação de distância — o paciente não precisa reproduzir a distância.
//
// O PROBLEMA QUE RESOLVE
//
// Até aqui, calibrar a 60 cm e usar a 50 cm degradava a precisão sem aviso, e a
// única saída era recalibrar. Exigir que alguém com ELA reproduza a posição da
// cadeira todo dia não é um requisito razoável de produto.
//
// POR QUE DÁ PARA CORRIGIR SEM RECALIBRAR
//
// As features de íris já são divididas pela distância interocular no extractor,
// o que as torna invariantes a escala POR CONSTRUÇÃO: mais longe deixa tudo
// menor em pixels, e dividir pela distância interocular cancela isso. O ângulo
// do olho dentro da órbita é recuperado igual a qualquer distância.
//
// O que muda com a distância é só a conversão de ângulo para pixel:
//
//     deslocamento_na_tela = distância_até_a_TELA × tan(ângulo_do_olhar)
//
// É LINEAR na distância. Não é algo que o modelo precise aprender por
// distância — é uma multiplicação, e é exata para tela plana com o olho
// próximo do eixo.
//
// POR QUE NA SAÍDA E NÃO NAS FEATURES
//
// `distanceCorrection.ts` tentou isto escalando as dims de offset do
// vetor. Duas objeções:
//
//   1. Geometricamente, as features estão CERTAS — o ângulo do olho não mudou.
//      Quem está errado é a conversão para pixels. Corrigir a entrada para
//      compensar um erro da saída é heurística; corrigir a saída é a
//      identidade geométrica.
//   2. Aquele módulo depende de índices fixos do vetor (25..34) que deixaram
//      de existir quando o conjunto ativo passou a ser `iris12`. Índices
//      hardcoded de layout são exatamente o tipo de acoplamento que quebra em
//      silêncio.
//
// A DISTÂNCIA MEDIDA É ATÉ A CÂMERA, A QUE IMPORTA É ATÉ A TELA
//
// São grandezas diferentes quando a webcam não está sobre o monitor — que é,
// aliás, a configuração recomendada (câmera perto para ganhar pixels, tela
// longe para reduzir a excentricidade exigida).
//
// A saída é usar a VARIAÇÃO, não a razão: quando o paciente se aproxima 10 cm,
// as duas distâncias caem 10 cm. Então
//
//     d_tela_agora = d_tela_calibração + (d_câmera_agora − d_câmera_calibração)
//
// é exato para deslocamento ao longo do eixo, e não exige saber onde a câmera
// está em relação à tela. Usar a razão das distâncias de CÂMERA seria errado
// sempre que os dois números diferissem.

/** Faixa de variação em que a compensação linear é confiável, em cm.
 *
 *  Derivada do modelo de hipometria ajustado em `calibration.ts` (joelho em
 *  12,43°, inclinação 0,0253/grau), aplicada ao alvo mais lateral que a UI
 *  usa (x = 1/6, ou 33,3% da largura a partir do centro) numa tela de 23,6"
 *  calibrada a 60 cm:
 *
 *      variação   ângulo exigido   erro de ganho
 *        −10 cm       19,2°            8,4%
 *         −5 cm       17,6°            3,9%
 *          0          16,2°            0,0%
 *         +5 cm       15,0°            3,3%
 *        +10 cm       14,0°            6,2%
 *
 *  A assimetria é real e vale entender: aproximar da TELA exige mais
 *  excentricidade do olho, e é aí que a hipometria morde. Afastar é mais
 *  benigno. Por isso o limite negativo é mais apertado que o positivo. */
export const DELTA_OK_NEAR_CM = -6;
export const DELTA_OK_FAR_CM = 9;
export const DELTA_WARN_NEAR_CM = -12;
export const DELTA_WARN_FAR_CM = 18;

/** Clamp final do fator. Fora disto alguma medição está errada — aplicar um
 *  fator selvagem jogaria o cursor para fora da tela, o que é pior que não
 *  compensar. */
export const MIN_RATIO = 0.6;
export const MAX_RATIO = 1.6;

export type DistanceRangeStatus = 'ok' | 'warn' | 'out' | 'unknown';

export interface DistanceRange {
  status: DistanceRangeStatus;
  /** Variação em relação à distância de calibração, em cm. Negativo = mais
   *  perto. `null` quando alguma das duas medições falta. */
  deltaCm: number | null;
  /** Distância até a TELA inferida para o momento atual, em cm. */
  screenDistanceNowCm: number | null;
  /** Fator aplicado à predição. 1 = sem correção. */
  ratio: number;
  /** Texto acionável, no mesmo tom das outras checagens de setup. */
  message: string;
}

/**
 * Distância até a tela AGORA, a partir da variação medida na câmera.
 *
 * Aditiva, não proporcional — ver o cabeçalho. Devolve `null` quando falta
 * qualquer das três entradas, e nesse caso o caller não compensa nada.
 */
export function screenDistanceNowCm(
  cameraNowCm: number | null | undefined,
  cameraAtCalibrationCm: number | null | undefined,
  screenAtCalibrationCm: number | null | undefined,
): number | null {
  if (cameraNowCm == null || cameraAtCalibrationCm == null || screenAtCalibrationCm == null) return null;
  if (![cameraNowCm, cameraAtCalibrationCm, screenAtCalibrationCm].every(Number.isFinite)) return null;
  if (screenAtCalibrationCm <= 0) return null;
  const d = screenAtCalibrationCm + (cameraNowCm - cameraAtCalibrationCm);
  return d > 0 ? d : null;
}

/**
 * Avalia a variação de distância e devolve o fator de correção.
 *
 * Nunca lança e nunca devolve fator inválido: no pior caso devolve `ratio: 1`,
 * que é o comportamento anterior à compensação.
 */
export function evaluateDistanceRange(
  cameraNowCm: number | null | undefined,
  cameraAtCalibrationCm: number | null | undefined,
  screenAtCalibrationCm: number | null | undefined,
): DistanceRange {
  const screenNow = screenDistanceNowCm(cameraNowCm, cameraAtCalibrationCm, screenAtCalibrationCm);
  if (screenNow == null || cameraNowCm == null || cameraAtCalibrationCm == null) {
    return {
      status: 'unknown',
      deltaCm: null,
      screenDistanceNowCm: null,
      ratio: 1,
      message:
        'Distância não medida — calibre o campo de visão da câmera em ' +
        'Configurações para o sistema compensar mudanças de posição sozinho.',
    };
  }

  const deltaCm = cameraNowCm - cameraAtCalibrationCm;
  const rawRatio = screenNow / (screenAtCalibrationCm as number);
  const ratio = Math.min(MAX_RATIO, Math.max(MIN_RATIO, rawRatio));

  const status: DistanceRangeStatus =
    deltaCm >= DELTA_OK_NEAR_CM && deltaCm <= DELTA_OK_FAR_CM
      ? 'ok'
      : deltaCm >= DELTA_WARN_NEAR_CM && deltaCm <= DELTA_WARN_FAR_CM
      ? 'warn'
      : 'out';

  const sentido = deltaCm < 0 ? 'mais perto' : 'mais longe';
  const abs = Math.abs(deltaCm).toFixed(0);

  const message =
    status === 'ok'
      ? deltaCm >= -1.5 && deltaCm <= 1.5
        ? 'Na mesma distância da calibração.'
        : `${abs} cm ${sentido} que na calibração — dentro da faixa, compensado automaticamente.`
      : status === 'warn'
      ? `${abs} cm ${sentido} que na calibração. A compensação ainda atua, mas a precisão ` +
        `cai nas bordas. Aproxime-se da posição em que calibrou, ou recalibre aqui.`
      : `${abs} cm ${sentido} que na calibração — fora da faixa que a compensação cobre. ` +
        `Volte para perto da posição de calibração ou refaça a calibração nesta posição.`;

  return { status, deltaCm, screenDistanceNowCm: screenNow, ratio, message };
}

/**
 * Aplica o fator à predição, em torno do CENTRO da tela.
 *
 * O centro é o ponto fixo da transformação porque é para onde o olhar aponta
 * com ângulo zero — e ângulo zero não depende de distância nenhuma. Escalar em
 * torno da origem (canto superior esquerdo) deslocaria o centro junto, que é
 * justamente o ponto que não deveria se mexer.
 */
export function applyDistanceRatioToPrediction(
  x: number,
  y: number,
  viewportWidth: number,
  viewportHeight: number,
  ratio: number,
): { x: number; y: number } {
  if (!Number.isFinite(ratio) || ratio === 1) return { x, y };
  const cx = viewportWidth / 2;
  const cy = viewportHeight / 2;
  return {
    x: cx + (x - cx) * ratio,
    y: cy + (y - cy) * ratio,
  };
}
