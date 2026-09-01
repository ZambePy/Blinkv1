import { describe, it, expect } from 'vitest';
import { avaliarDerivaDePose, POSE_DRIFT_WARN_PX } from './calibration';
import type { SessionPoseDrift } from './calibration';

/**
 * 1.1-UI — a deriva de pose entre alvos já era medida e já disparava um
 * `console.warn`, mas nenhuma tela lia. A sessão do relatório
 * `accuracy-report-1788225161304` calibrou com 238 px-equivalentes de deriva —
 * 4× o limiar — e seguiu direto para o teste de precisão sem avisar ninguém.
 *
 * Este veredito é a fonte única: o log do `calibration.ts` e a tela de
 * calibração leem daqui, para não divergirem com o tempo.
 */
const drift = (over: Partial<SessionPoseDrift> = {}): SessionPoseDrift => ({
  targets: 9,
  yawDeg: 0.6, pitchDeg: 6.2, rollDeg: 0.9,
  yawPx: 24, pitchPx: 238,
  trendRYaw: 0.58, trendRPitch: -0.98,
  ...over,
});

describe('avaliarDerivaDePose', () => {
  it('sem medição não emite veredito — nada a dizer não é o mesmo que está tudo bem', () => {
    expect(avaliarDerivaDePose(null)).toBeNull();
  });

  it('abaixo do limiar não incomoda o usuário', () => {
    expect(avaliarDerivaDePose(drift({ yawPx: 10, pitchPx: 20 }))).toBeNull();
  });

  it('usa o PIOR eixo, não a média — 10px em X e 200px em Y é um problema', () => {
    const v = avaliarDerivaDePose(drift({ yawPx: 10, pitchPx: 200 }))!;
    expect(v).not.toBeNull();
    expect(v.piorEixoPx).toBe(200);
    expect(v.eixo).toBe('pitch');
  });

  it('reproduz a sessão real de 238px e a classifica como monótona', () => {
    const v = avaliarDerivaDePose(drift())!;
    expect(v.piorEixoPx).toBe(238);
    expect(v.monotona).toBe(true);
    // Deriva monótona = escorregar na cadeira. Apoiar a nuca resolve mais que
    // recalibrar, e é isso que o usuário precisa ouvir.
    expect(v.acao).toBe('apoiar-a-nuca');
  });

  it('deriva errática pede recalibrar, não apoiar a nuca', () => {
    const v = avaliarDerivaDePose(drift({ trendRYaw: 0.1, trendRPitch: -0.2 }))!;
    expect(v.monotona).toBe(false);
    expect(v.acao).toBe('refazer');
  });

  it('o limiar é o mesmo que o log usa', () => {
    expect(avaliarDerivaDePose(drift({ yawPx: POSE_DRIFT_WARN_PX - 1, pitchPx: 0 }))).toBeNull();
    expect(avaliarDerivaDePose(drift({ yawPx: POSE_DRIFT_WARN_PX + 1, pitchPx: 0 }))).not.toBeNull();
  });

  it('a mensagem cita o número medido, para o cuidador saber o tamanho do problema', () => {
    const v = avaliarDerivaDePose(drift())!;
    expect(v.mensagem).toContain('238');
  });
});