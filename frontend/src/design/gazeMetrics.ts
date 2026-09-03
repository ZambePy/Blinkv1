export const GAZE_TOKENS = {
  targetMinDeg: 5.0,
  targetRecommendedDeg: 6.6,
  spacingMinDeg: 1.5,
  restZoneMinDeg: 8.0,
};

/**
 * Distância e DPI de FALLBACK — B3.24.
 *
 * 60 cm é o meio da faixa recomendada; 96 dpi é o default de CSS. São chutes
 * razoáveis para o primeiro render, **antes** de o `SettingsProvider` montar.
 *
 * Não são os números certos para nenhum posto de uso específico, e é por isso
 * que `aplicarGeometriaDoUsuario` existe: o app JÁ conhece
 * `settings.viewingDistanceCm` e `settings.screenDiagonalIn` — usa os dois
 * para posicionar os alvos de calibração — e o design system os ignorava.
 *
 * O efeito de ignorá-los: numa TV de 40″ a 100 cm, `degToPx(5°)` devolve
 * 198 px quando o valor correto passa de 300 px. O aviso de acessibilidade
 * vira falso positivo (ou falso negativo, numa tela pequena e próxima) — e um
 * aviso que mente sobre acessibilidade é pior que nenhum, porque o cuidador
 * aprende a ignorá-lo.
 */
export const FALLBACK_DISTANCE_CM = 60;
export const FALLBACK_PX_PER_CM = 96 / 2.54;

export function degToPx(
  deg: number,
  distanceCm: number = FALLBACK_DISTANCE_CM,
  pxPerCm: number = FALLBACK_PX_PER_CM,
): number {
  const rad = (deg * Math.PI) / 180;
  const cm = 2 * distanceCm * Math.tan(rad / 2);
  return cm * pxPerCm;
}

/**
 * Pixels por centímetro derivados da geometria REAL da tela (B3.24).
 *
 * `screenDiagonalIn` vem do EDID (B2.11) ou do cuidador; a diagonal em pixels
 * vem do viewport. É a mesma conta que `computeCalibrationTargets` usa para
 * posicionar os alvos — ter duas fontes divergentes para "quantos pixels tem
 * um centímetro" é como o design system acabou usando 96 dpi enquanto o
 * pipeline usava o valor medido.
 */
export function pxPerCmFromScreen(
  viewportWidthPx: number,
  viewportHeightPx: number,
  screenDiagonalIn: number,
): number {
  if (!(viewportWidthPx > 0) || !(viewportHeightPx > 0) || !(screenDiagonalIn > 0)) {
    return FALLBACK_PX_PER_CM;
  }
  const diagPx = Math.hypot(viewportWidthPx, viewportHeightPx);
  return diagPx / (screenDiagonalIn * 2.54);
}

/**
 * Recalcula as custom properties a partir da geometria do usuário (B3.24).
 *
 * Chamada pelo `SettingsProvider` quando `viewingDistanceCm` ou
 * `screenDiagonalIn` mudam. Antes de existir, os tokens eram calculados uma
 * única vez no import do módulo, com 60 cm e 96 dpi fixos, e nunca mais.
 */
export function aplicarGeometriaDoUsuario(
  distanceCm: number,
  screenDiagonalIn: number,
): void {
  if (typeof document === 'undefined') return;
  const pxPerCm = pxPerCmFromScreen(
    document.documentElement.clientWidth,
    document.documentElement.clientHeight,
    screenDiagonalIn,
  );
  injetarTokens(distanceCm, pxPerCm);
}

function injetarTokens(distanceCm: number, pxPerCm: number): void {
  const root = document.documentElement;
  const targetMinPx = Math.round(degToPx(GAZE_TOKENS.targetMinDeg, distanceCm, pxPerCm));
  const targetRecPx = Math.round(degToPx(GAZE_TOKENS.targetRecommendedDeg, distanceCm, pxPerCm));
  const spacingMinPx = Math.round(degToPx(GAZE_TOKENS.spacingMinDeg, distanceCm, pxPerCm));
  const restZoneMinPx = Math.round(degToPx(GAZE_TOKENS.restZoneMinDeg, distanceCm, pxPerCm));

  root.style.setProperty('--gaze-target-min', `${targetMinPx}px`);
  root.style.setProperty('--gaze-target-rec', `${targetRecPx}px`);
  root.style.setProperty('--gaze-spacing-min', `${spacingMinPx}px`);
  root.style.setProperty('--gaze-rest-zone-min', `${restZoneMinPx}px`);
  // B3.27 — a hit-area do botão lê este valor para não invadir os vizinhos.
  root.style.setProperty('--gaze-grid-gap', `${spacingMinPx}px`);
}

// Injeta no boot no navegador para uso via CSS custom properties.
// Valores de fallback; `aplicarGeometriaDoUsuario` os substitui assim que as
// configurações do usuário carregam.
if (typeof document !== 'undefined') {
  injetarTokens(FALLBACK_DISTANCE_CM, FALLBACK_PX_PER_CM);
  console.log(
    `[gazeMetrics] tokens de fallback injetados ` +
    `(${FALLBACK_DISTANCE_CM} cm, ${FALLBACK_PX_PER_CM.toFixed(1)} px/cm). ` +
    `Serão substituídos pela geometria do usuário quando as configurações carregarem.`,
  );
}

/**
 * Tamanho mínimo de alvo, em px, para a geometria corrente (B3.24).
 *
 * Fonte ÚNICA — `GazeButton` e `GazeGrid` tinham cada um o literal `198`,
 * derivado de 5,0° a 60 cm e 96 dpi. Dois lugares com o mesmo número mágico
 * significam que mudar a geometria corrige metade da UI.
 */
export function alvoMinimoPx(): number {
  if (typeof document === 'undefined') return Math.round(degToPx(GAZE_TOKENS.targetMinDeg));
  const lido = getComputedStyle(document.documentElement)
    .getPropertyValue('--gaze-target-min')
    .trim();
  const n = parseFloat(lido);
  return Number.isFinite(n) && n > 0 ? n : Math.round(degToPx(GAZE_TOKENS.targetMinDeg));
}
