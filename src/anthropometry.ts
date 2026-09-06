// Constantes antropométricas e os landmarks do Face Mesh que as medem.
//
// Cuidado com a distância INTERPUPILAR (~6,3 cm, entre centros de íris): ela
// é 43% menor que a cantal e já foi usada por engano contra uma medida entre
// cantos externos, escalando toda a compensação de translação sem sintoma
// visível. Cada constante aqui fica ao lado do par de landmarks que a produz
// justamente para a troca ficar visível na chamada.
//
// Os valores são medianas de adulto; toda distância derivada deles é
// estimativa. Quando a precisão importa, o FOV vem de uma medição real com
// fita métrica (`deriveHorizontalFovDeg`).

/** Distância entre os CANTOS EXTERNOS dos olhos (bi-ectocanthion), em cm.
 *  Mede-se entre os landmarks {@link LM_CANTO_EXTERNO_ESQUERDO} e
 *  {@link LM_CANTO_EXTERNO_DIREITO}. */
export const CANTHAL_DISTANCE_CM = 9.0;

// Índices da topologia de 478 pontos do MediaPipe (468 do mesh + 10 de íris).
// "Esquerdo"/"direito" seguem a convenção do MediaPipe: o lado da PESSOA — numa
// imagem não espelhada o olho esquerdo dela aparece à direita do quadro.

/** Canto externo do olho esquerdo. */
export const LM_CANTO_EXTERNO_ESQUERDO = 33;
/** Canto externo do olho direito. */
export const LM_CANTO_EXTERNO_DIREITO = 263;
/** Centro da íris esquerda (existe só com refinamento de íris ligado). */
export const LM_IRIS_ESQUERDA = 468;
/** Centro da íris direita. */
export const LM_IRIS_DIREITA = 473;

/**
 * Campo de visão horizontal a partir de uma distância MEDIDA, em graus.
 *
 * Inverso da triangulação `d = (C × W) / (2 × iodPx × tan(FOV/2))`. Existe
 * porque nenhuma API do browser expõe o FOV da câmera: medindo a distância uma
 * vez com fita métrica, a geometria devolve o FOV e o programa passa a estimar
 * a distância sozinho. Mais confiável que o número do fabricante, que costuma
 * ser o FOV diagonal arredondado para cima.
 *
 * `distanciaFisicaCm` tem que corresponder ao par de landmarks que produziu
 * `iodPx` (default: cantal, que é o que `engine.ts` mede).
 */
export function fovHorizontalDeg(
  iodPx: number,
  videoWidth: number,
  distanciaCm: number,
  distanciaFisicaCm: number = CANTHAL_DISTANCE_CM,
): number | null {
  if (!(iodPx > 0) || !(videoWidth > 0) || !(distanciaCm > 0)) return null;
  const larguraFrameCm = (videoWidth / iodPx) * distanciaFisicaCm;
  const meioFovRad = Math.atan(larguraFrameCm / (2 * distanciaCm));
  const graus = (meioFovRad * 2 * 180) / Math.PI;
  return Number.isFinite(graus) && graus > 0 && graus < 180 ? graus : null;
}
