export const GAZE_TOKENS = {
  targetMinDeg: 5.0,
  targetRecommendedDeg: 6.6,
  spacingMinDeg: 1.5,
  restZoneMinDeg: 8.0,
};

export function degToPx(deg: number, distanceCm: number = 60, pxPerCm: number = 96 / 2.54): number {
  const rad = (deg * Math.PI) / 180;
  const cm = 2 * distanceCm * Math.tan(rad / 2);
  return cm * pxPerCm;
}

// Injeta no boot no navegador para uso via CSS custom properties
if (typeof document !== 'undefined') {
  const root = document.documentElement;
  const targetMinPx = Math.round(degToPx(GAZE_TOKENS.targetMinDeg));
  const targetRecPx = Math.round(degToPx(GAZE_TOKENS.targetRecommendedDeg));
  const spacingMinPx = Math.round(degToPx(GAZE_TOKENS.spacingMinDeg));
  const restZoneMinPx = Math.round(degToPx(GAZE_TOKENS.restZoneMinDeg));

  root.style.setProperty('--gaze-target-min', `${targetMinPx}px`);
  root.style.setProperty('--gaze-target-rec', `${targetRecPx}px`);
  root.style.setProperty('--gaze-spacing-min', `${spacingMinPx}px`);
  root.style.setProperty('--gaze-rest-zone-min', `${restZoneMinPx}px`);

  console.log(
    `[gazeMetrics] CSS custom properties injetadas: ` +
    `--gaze-target-min=${targetMinPx}px, ` +
    `--gaze-spacing-min=${spacingMinPx}px`
  );
}
