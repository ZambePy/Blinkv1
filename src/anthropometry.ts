// P5.3 — antropometria: uma constante, um lugar, um landmark.
//
// ── Por que este módulo existe ──────────────────────────────────────────────
//
// Duas distâncias faciais parecidas circulavam pelo código:
//
//     6,3 cm   INTERPUPILAR   — entre os CENTROS das pupilas/íris
//     9,0 cm   CANTAL         — entre os CANTOS EXTERNOS dos olhos
//
// Elas diferem por 43%, e nada no tipo `number` impede usar uma no lugar da
// outra. `translationCompensation.ts` registra o custo real disso: a primeira
// versão daquele módulo usava 6,3 cm contra uma medida cantal, e toda a
// correção de translação saía com 43% de erro de escala — sem sintoma, porque
// o resultado continuava plausível.
//
// ── A defesa não é "escolher a constante certa" ─────────────────────────────
//
// É amarrar cada constante ao PAR DE LANDMARKS que a produz. Quem mede entre os
// índices 33↔263 mediu cantos externos e precisa da cantal; quem mede entre
// 468↔473 mediu centros de íris e precisa da interpupilar. Exportar os índices
// ao lado das constantes faz a escolha errada ficar visível na chamada, em vez
// de escondida num literal.
//
// ── Valores ─────────────────────────────────────────────────────────────────
//
// Ambos são medianas de adulto. Variam por indivíduo, etnia e idade, e é por
// isso que toda distância derivada daqui é ESTIMATIVA — o projeto tem um
// caminho separado (`deriveHorizontalFovDeg` + medição com fita métrica uma
// vez) para quando a precisão importa de verdade.

/** Distância entre os CANTOS EXTERNOS dos olhos (bi-ectocanthion), em cm.
 *  Mede-se entre os landmarks {@link LM_CANTO_EXTERNO_ESQUERDO} e
 *  {@link LM_CANTO_EXTERNO_DIREITO}. */
export const CANTHAL_DISTANCE_CM = 9.0;

/** Distância INTERPUPILAR (IPD), em cm. Mede-se entre os centros de íris,
 *  landmarks {@link LM_IRIS_ESQUERDA} e {@link LM_IRIS_DIREITA}. */
export const INTERPUPILLARY_DISTANCE_CM = 6.3;

// ── Landmarks do Face Mesh associados ────────────────────────────────────────
//
// Os índices são da topologia de 478 pontos do MediaPipe (468 do mesh facial +
// 10 de refinamento de íris). "Esquerdo" e "direito" seguem a convenção do
// MediaPipe, que nomeia pelo lado da PESSOA — numa imagem não espelhada o olho
// esquerdo dela aparece à direita do quadro.

/** Canto externo do olho esquerdo. */
export const LM_CANTO_EXTERNO_ESQUERDO = 33;
/** Canto externo do olho direito. */
export const LM_CANTO_EXTERNO_DIREITO = 263;
/** Centro da íris esquerda (existe só com refinamento de íris ligado). */
export const LM_IRIS_ESQUERDA = 468;
/** Centro da íris direita. */
export const LM_IRIS_DIREITA = 473;

/**
 * Distância câmera→rosto por triangulação, em cm.
 *
 * ── A geometria ─────────────────────────────────────────────────────────────
 *
 * A largura física coberta pelo frame à distância `d` é `2·d·tan(FOV/2)`. Uma
 * distância facial de `C` cm ocupa, em pixels, `C/larguraFrame × W`. Isolando:
 *
 *     d = (C × W) / (2 × iodPx × tan(FOV/2))
 *
 * ⚠️ `distanciaFisicaCm` tem que corresponder ao par de landmarks que produziu
 * `iodPx`. Passar a cantal para uma medida interpupilar dá 43% de erro — o bug
 * que este módulo existe para prevenir. Por isso o parâmetro é explícito e o
 * default é a cantal, que é o que `engine.ts` mede.
 *
 * Devolve `null` em entrada degenerada em vez de `Infinity`: uma distância
 * infinita contaminaria a compensação e o cursor pararia sem explicação.
 */
export function distanciaPorTriangulacao(
  iodPx: number,
  videoWidth: number,
  fovHorizontalGraus: number,
  distanciaFisicaCm: number = CANTHAL_DISTANCE_CM,
): number | null {
  if (!(iodPx > 0) || !(videoWidth > 0) || !(fovHorizontalGraus > 0) || fovHorizontalGraus >= 180) return null;
  if (!Number.isFinite(iodPx) || !Number.isFinite(videoWidth)) return null;
  const tanMeioFov = Math.tan((fovHorizontalGraus / 2) * Math.PI / 180);
  if (!(tanMeioFov > 0)) return null;
  const d = (distanciaFisicaCm * videoWidth) / (2 * iodPx * tanMeioFov);
  return Number.isFinite(d) && d > 0 ? d : null;
}

/**
 * Campo de visão horizontal a partir de uma distância MEDIDA, em graus.
 *
 * É o inverso de {@link distanciaPorTriangulacao}, e existe porque nenhuma API
 * do browser expõe o FOV da câmera. Se o cuidador medir a distância uma única
 * vez com fita métrica, a geometria devolve o FOV — e a partir daí o programa
 * estima a distância sozinho em toda sessão futura.
 *
 * É preferível a confiar no número do fabricante: webcams costumam declarar o
 * FOV na diagonal e arredondar para cima.
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
