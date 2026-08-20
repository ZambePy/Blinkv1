import { describe, it, expect } from 'vitest';
import { degToPx, GAZE_TOKENS } from '../frontend/src/design/gazeMetrics';

describe('B1-1: degToPx visual angle conversion', () => {
  it('converts 1 degree to pixels around 40px at 60cm distance and 96 DPI', () => {
    const px = degToPx(1, 60, 96 / 2.54);
    expect(px).toBeCloseTo(39.58, 2);
  });

  it('converts targetMinDeg (5.0) to mathematically correct px (198px)', () => {
    const px = degToPx(GAZE_TOKENS.targetMinDeg, 60, 96 / 2.54);
    expect(Math.round(px)).toBe(198);
  });

  it('converts targetRecommendedDeg (6.6) to mathematically correct px (262px)', () => {
    const px = degToPx(GAZE_TOKENS.targetRecommendedDeg, 60, 96 / 2.54);
    expect(Math.round(px)).toBe(262);
  });

  it('converts spacingMinDeg (1.5) to mathematically correct px (59px)', () => {
    const px = degToPx(GAZE_TOKENS.spacingMinDeg, 60, 96 / 2.54);
    expect(Math.round(px)).toBe(59);
  });
});
