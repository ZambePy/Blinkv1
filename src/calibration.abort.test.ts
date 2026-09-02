import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as calib from './calibration';

describe('abortCalibration', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    calib.clearCalibration();
    calib.abortCalibration();
  });
  afterEach(() => {
    calib.abortCalibration();
    vi.useRealTimers();
  });

  it('devolve isCalibrating=false ao abortar no meio da coleta', () => {
    calib.startCalibrationMode({ quick: true });
    expect(calib.isCalibrating).toBe(true);

    calib.startCollectingPoint(0.1, 0.1, () => {});
    calib.abortCalibration();

    expect(calib.isCalibrating).toBe(false);
  });

  it('não dispara o callback do ponto em curso depois do abort', () => {
    const onDone = vi.fn();
    calib.startCalibrationMode({ quick: true });
    calib.startCollectingPoint(0.1, 0.1, onDone);

    calib.abortCalibration();
    // O timeout duro do ponto (currentCollectionMs + 800) chegaria aqui.
    vi.advanceTimersByTime(10_000);

    expect(onDone).not.toHaveBeenCalled();
  });

  it('deixa o modo de calibração limpo — startCollectingPoint volta a ser recusado', () => {
    const onDone = vi.fn();
    calib.startCalibrationMode({ quick: true });
    calib.abortCalibration();

    // Sem uma sessão ativa, o núcleo tem de recusar coleta (guarda que já
    // existia em startCollectingPoint, mas que nunca era alcançada porque
    // isCalibrating ficava preso em true).
    calib.startCollectingPoint(0.5, 0.5, onDone);
    vi.advanceTimersByTime(10_000);

    expect(onDone).not.toHaveBeenCalled();
    expect(calib.getCalibrationMode?.()).toBeNull();
  });

  it('é idempotente e seguro sem nenhuma calibração em curso', () => {
    expect(() => {
      calib.abortCalibration();
      calib.abortCalibration();
    }).not.toThrow();
    expect(calib.isCalibrating).toBe(false);
  });

  it('clearCalibration também derruba isCalibrating', () => {
    calib.startCalibrationMode({ quick: true });
    calib.startCollectingPoint(0.1, 0.1, () => {});

    calib.clearCalibration();

    expect(calib.isCalibrating).toBe(false);
  });

  it('permite recomeçar uma calibração limpa depois do abort', () => {
    calib.startCalibrationMode({ quick: true });
    calib.startCollectingPoint(0.1, 0.1, () => {});
    calib.abortCalibration();

    calib.startCalibrationMode({ quick: false });
    expect(calib.isCalibrating).toBe(true);
    expect(calib.getCalibrationMode?.()).toBe('full');
  });
});
