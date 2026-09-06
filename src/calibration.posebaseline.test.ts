import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clearCalibration, startCalibrationMode, startCollectingPoint, feedRawData,
  getSessionPoseDrift,
} from './calibration';

// A deriva de pose ao longo da calibração é medida por alvo (não por sessão):
// ENTRE pontos existe deriva monótona, que vira relatório em vez de descarte.

const q = (yaw: number, pitch = 0, roll = 0) => ({
  yaw, pitch, roll,
  irisVisibilityPercentage: 1, detectorConfidence: 1,
  brightnessEstimate: 0.5, contrastEstimate: 0.3, blurEstimate: 0,
});
const v = () => [0.1, 0.2, 0.3, 0.4];

/** Coleta um ponto inteiro com a pose dada, até `processStaticPoint` fechar. */
function coletarPonto(x: number, y: number, pose: ReturnType<typeof q>, n = 40) {
  startCollectingPoint(x, y, () => {});
  for (let i = 0; i < n; i++) feedRawData(v(), v(), pose);
}

describe('medição da deriva entre alvos', () => {
  let relogio = 0;
  beforeEach(() => {
    clearCalibration();
    relogio = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (relogio += 80));
  });
  afterEach(() => { vi.restoreAllMocks(); });
  const graus = (d: number) => (d * Math.PI) / 180;

  it('não reporta nada com menos de dois alvos', () => {
    startCalibrationMode();
    coletarPonto(0.5, 0.5, q(0.1));
    expect(getSessionPoseDrift()).toBeNull();
  });

  it('mede a amplitude entre as medianas dos alvos', () => {
    startCalibrationMode();
    coletarPonto(0.2, 0.2, q(0.10, 0.00));
    coletarPonto(0.5, 0.5, q(0.10 + graus(1), 0.00));
    coletarPonto(0.8, 0.8, q(0.10 + graus(3), graus(-2)));
    const d = getSessionPoseDrift()!;
    expect(d.targets).toBe(3);
    expect(d.yawDeg).toBeCloseTo(3, 1);
    expect(d.pitchDeg).toBeCloseTo(2, 1);
  });

  it('converte para pixels, que é a unidade em que a deriva dói', () => {
    startCalibrationMode();
    coletarPonto(0.2, 0.2, q(0.10));
    coletarPonto(0.8, 0.8, q(0.10 + graus(3)));
    const d = getSessionPoseDrift()!;
    // ~38,5 px/grau na tela de referência; a geometria default pode diferir,
    // então só se afirma a ordem de grandeza e o sinal.
    expect(d.yawPx).toBeGreaterThan(30);
    expect(d.yawPx / d.yawDeg).toBeGreaterThan(10);
  });

  it('distingue deriva monótona de errática pela tendência', () => {
    startCalibrationMode();
    for (let i = 0; i < 4; i++) coletarPonto(0.2 + i * 0.2, 0.5, q(0.10 + graus(i)));
    expect(getSessionPoseDrift()!.trendRYaw).toBeGreaterThan(0.95);

    startCalibrationMode();
    for (const g of [0, 3, 0.5, 2.5]) coletarPonto(0.5, 0.5, q(0.10 + graus(g)));
    expect(Math.abs(getSessionPoseDrift()!.trendRYaw)).toBeLessThan(0.8);
  });

  it('recomeçar a calibração zera a medição', () => {
    startCalibrationMode();
    coletarPonto(0.2, 0.2, q(0.10));
    coletarPonto(0.8, 0.8, q(0.10 + graus(3)));
    expect(getSessionPoseDrift()).not.toBeNull();
    startCalibrationMode();
    expect(getSessionPoseDrift()).toBeNull();
  });
});
