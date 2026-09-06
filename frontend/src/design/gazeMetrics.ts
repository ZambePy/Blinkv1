export const GAZE_TOKENS = {
  targetMinDeg: 5.0,
  targetRecommendedDeg: 6.6,
  spacingMinDeg: 1.5,
  restZoneMinDeg: 8.0,
};

/**
 * Distância e DPI de FALLBACK para o primeiro render, antes de o
 * `SettingsProvider` montar. 60 cm é o meio da faixa recomendada; 96 dpi é o
 * default de CSS. `aplicarGeometriaDoUsuario` substitui os dois pela geometria
 * real assim que as configurações carregam — numa TV de 40″ a 100 cm o alvo
 * mínimo correto passa de 300 px, não 198.
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
 * Pixels por centímetro derivados da geometria REAL da tela.
 *
 * `screenDiagonalIn` vem do EDID ou do cuidador; a diagonal em pixels vem do
 * viewport. É a mesma conta que `computeCalibrationTargets` usa para
 * posicionar os alvos — o design system e o pipeline precisam concordar sobre
 * quantos pixels tem um centímetro.
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
 * Recalcula as custom properties a partir da geometria do usuário.
 * Chamada pelo `SettingsProvider` quando `viewingDistanceCm` ou
 * `screenDiagonalIn` mudam.
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
  // A hit-area do botão lê este valor para não invadir os vizinhos.
  root.style.setProperty('--gaze-grid-gap', `${spacingMinPx}px`);
}

// Injeta no boot no navegador para uso via CSS custom properties.
// Valores de fallback; `aplicarGeometriaDoUsuario` os substitui assim que as
// configurações do usuário carregam.
if (typeof document !== 'undefined') {
  injetarTokens(FALLBACK_DISTANCE_CM, FALLBACK_PX_PER_CM);
}

/**
 * Tamanho mínimo de alvo, em px, para a geometria corrente. Fonte única para
 * `GazeButton` e `GazeGrid`.
 */
export function alvoMinimoPx(): number {
  if (typeof document === 'undefined') return Math.round(degToPx(GAZE_TOKENS.targetMinDeg));
  const lido = getComputedStyle(document.documentElement)
    .getPropertyValue('--gaze-target-min')
    .trim();
  const n = parseFloat(lido);
  return Number.isFinite(n) && n > 0 ? n : Math.round(degToPx(GAZE_TOKENS.targetMinDeg));
}
