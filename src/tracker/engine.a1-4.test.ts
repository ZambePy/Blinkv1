import { describe, it, expect } from 'vitest';
import { updateDegradedTimer, DEGRADED_THRESHOLD_MS } from './engine';

// A1-4 — lógica pura do timer de degradação. O engine é factory + rAF + DOM,
// difícil de testar end-to-end; esta função pura é o coração do detector e é
// testada isolada.

describe('A1-4: updateDegradedTimer', () => {
  it('frame válido zera o timer e não degrada', () => {
    const r = updateDegradedTimer({
      mapGazeReturnedNull: false,
      isCalibrated: true,
      isCalibrating: false,
      currentNullSinceMs: 100,
      now: 500,
    });
    expect(r.newNullSinceMs).toBeNull();
    expect(r.isDegraded).toBe(false);
  });

  it('sem calibração, null não conta como degradação', () => {
    const r = updateDegradedTimer({
      mapGazeReturnedNull: true,
      isCalibrated: false,
      isCalibrating: false,
      currentNullSinceMs: null,
      now: 1000,
    });
    expect(r.newNullSinceMs).toBeNull();
    expect(r.isDegraded).toBe(false);
  });

  it('em modo de calibração, null não conta como degradação', () => {
    const r = updateDegradedTimer({
      mapGazeReturnedNull: true,
      isCalibrated: true,
      isCalibrating: true,
      currentNullSinceMs: null,
      now: 1000,
    });
    expect(r.newNullSinceMs).toBeNull();
    expect(r.isDegraded).toBe(false);
  });

  it('primeiro null pós-calibração inicia o timer, ainda não degrada', () => {
    const r = updateDegradedTimer({
      mapGazeReturnedNull: true,
      isCalibrated: true,
      isCalibrating: false,
      currentNullSinceMs: null,
      now: 1000,
    });
    expect(r.newNullSinceMs).toBe(1000);
    expect(r.isDegraded).toBe(false);
  });

  it('null contínuo sob o limiar não degrada', () => {
    const r = updateDegradedTimer({
      mapGazeReturnedNull: true,
      isCalibrated: true,
      isCalibrating: false,
      currentNullSinceMs: 1000,
      now: 1000 + DEGRADED_THRESHOLD_MS - 1,
    });
    expect(r.newNullSinceMs).toBe(1000);
    expect(r.isDegraded).toBe(false);
  });

  it('null contínuo acima do limiar degrada', () => {
    const r = updateDegradedTimer({
      mapGazeReturnedNull: true,
      isCalibrated: true,
      isCalibrating: false,
      currentNullSinceMs: 1000,
      now: 1000 + DEGRADED_THRESHOLD_MS + 1,
    });
    expect(r.newNullSinceMs).toBe(1000);
    expect(r.isDegraded).toBe(true);
  });

  it('após degradar, um único frame válido sai do estado degradado', () => {
    // Simula uma sequência: null por 600ms → válido
    let state: number | null = 0;
    let now = 0;

    // primeiro null
    let r = updateDegradedTimer({ mapGazeReturnedNull: true, isCalibrated: true, isCalibrating: false, currentNullSinceMs: state, now });
    state = r.newNullSinceMs;
    expect(r.isDegraded).toBe(false);

    // 600ms depois, ainda null → degradou
    now = 600;
    r = updateDegradedTimer({ mapGazeReturnedNull: true, isCalibrated: true, isCalibrating: false, currentNullSinceMs: state, now });
    state = r.newNullSinceMs;
    expect(r.isDegraded).toBe(true);

    // frame válido logo depois → sai
    now = 610;
    r = updateDegradedTimer({ mapGazeReturnedNull: false, isCalibrated: true, isCalibrating: false, currentNullSinceMs: state, now });
    expect(r.newNullSinceMs).toBeNull();
    expect(r.isDegraded).toBe(false);
  });

  it('thresholdMs custom permite testar sem esperar 500ms real', () => {
    const r = updateDegradedTimer({
      mapGazeReturnedNull: true,
      isCalibrated: true,
      isCalibrating: false,
      currentNullSinceMs: 100,
      now: 200,
      thresholdMs: 50,
    });
    expect(r.isDegraded).toBe(true);
  });

  it('glitch isolado de 1 frame não degrada em taxa 30fps', () => {
    // 33ms entre frames — bem abaixo dos 500ms
    const r = updateDegradedTimer({
      mapGazeReturnedNull: true,
      isCalibrated: true,
      isCalibrating: false,
      currentNullSinceMs: 0,
      now: 33,
    });
    expect(r.isDegraded).toBe(false);
  });
});
