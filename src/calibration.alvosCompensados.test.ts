import { describe, it, expect, vi } from 'vitest';
import {
  clearCalibration, startCalibrationMode, startCollectingPoint, feedRawData,
  completeCalibration, getCalibrationTargets, getCollectionMsForPoint,
  duracaoTotalDoPonto, getCalibrationFitDiagnostics,
} from './calibration';

// Os alvos de treino são compensados pela pose de cada amostra, então cada
// amostra fica com uma coordenada de alvo própria. Agrupar por essa coordenada
// transformava o leave-one-target-out em leave-one-SAMPLE-out: a validação
// cruzada passava a rodar um fold por amostra (~640 em vez de 9), o treino
// levava ~50 s por olho — a tela de calibração congelava no último ponto — e a
// penalidade anisotrópica desligava por não sobrar grupo com duas amostras.
//
// O grupo tem de ser o alvo NOMINAL. Este teste segura as duas consequências:
// tempo e número de grupos.

let relogio = 0;

/** Features correlacionadas, como as reais: iris offsets + bloco angular. */
function vetor(x: number, y: number, rnd: () => number) {
  const ox = (x - 0.5) * 0.08, oy = (y - 0.5) * 0.05;
  return [
    ox + rnd() * 0.001, oy + rnd() * 0.001,
    ox * 1.02 + rnd() * 0.0012, oy * 0.98 + rnd() * 0.0012,
    (x - 0.5) * 0.6 + rnd() * 0.004, (y - 0.5) * 0.4 + rnd() * 0.004,
  ];
}

describe('treino com alvos compensados por pose', () => {
  it('agrupa por alvo nominal: 9 grupos e treino rápido, com a cabeça se mexendo', () => {
    vi.spyOn(performance, 'now').mockImplementation(() => relogio);
    clearCalibration();
    let semente = 3;
    const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648 - 0.5; };

    startCalibrationMode();
    for (const t of getCalibrationTargets()) {
      startCollectingPoint(t.x, t.y, () => {});
      const dur = duracaoTotalDoPonto(getCollectionMsForPoint(t.x, t.y));
      for (let ms = 0; ms <= dur + 200; ms += 33) {
        relogio += 33;
        // Pose diferente a cada quadro: é o que uma cabeça real faz, e é o que
        // dá a cada amostra um alvo compensado próprio.
        feedRawData(vetor(t.x, t.y, rnd), vetor(t.x, t.y, rnd), {
          yaw: 0.1 + rnd() * 0.03, pitch: -0.05 + rnd() * 0.03, roll: 0.01,
          irisVisibilityPercentage: 1, detectorConfidence: 0.99,
          brightnessEstimate: 0.24, contrastEstimate: 0.09, blurEstimate: 0,
        });
      }
    }

    const t0 = Date.now();
    let outcome: { ok: boolean } | null = null;
    completeCalibration((o) => { outcome = o as { ok: boolean }; });
    const duracao = Date.now() - t0;

    expect(outcome).toEqual({ ok: true });

    const fit = getCalibrationFitDiagnostics();
    expect(fit).not.toBeNull();
    // Um grupo por ALVO, não por amostra.
    expect(fit!.samplesPerTarget).toHaveLength(9);
    expect(fit!.looByTarget).toHaveLength(9);
    for (const n of fit!.samplesPerTarget) expect(n).toBeGreaterThan(10);

    // Teto generoso: o certo roda em ~1 s; o defeito levava ~50 s POR OLHO.
    expect(duracao).toBeLessThan(5_000);
  }, 120_000);
});
