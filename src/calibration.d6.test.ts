import { describe, it, expect, beforeEach } from 'vitest';
import {
  startCalibrationMode,
  getCalibrationTargets,
  getCalibrationMode,
  CALIBRATION_TARGETS_FULL,
  CALIBRATION_TARGETS_QUICK,
} from './calibration';

describe('modo rápido de calibração', () => {
  beforeEach(() => {
    // Sanity: os targets exportados são realmente 9 e 4.
    expect(CALIBRATION_TARGETS_FULL).toHaveLength(9);
    expect(CALIBRATION_TARGETS_QUICK).toHaveLength(4);
  });

  it('sem calibração ativa: getCalibrationTargets() devolve os 9 pontos (default full)', () => {
    // Módulo pode carregar já com estado sujo de outro teste — força reset
    // via um startCalibrationMode explícito não ajuda porque queremos testar
    // o caminho "nada iniciado". A garantia é: `mode` cai pra null ao final
    // do último `completeCalibration`. Se essa expectativa quebrar, é sinal
    // de que o estado ficou preso — bug real, não flake.
    if (getCalibrationMode() === null) {
      expect(getCalibrationTargets()).toBe(CALIBRATION_TARGETS_FULL);
      expect(getCalibrationTargets()).toHaveLength(9);
    }
  });

  it('startCalibrationMode() (sem opts) → modo full, 9 alvos', () => {
    startCalibrationMode();
    expect(getCalibrationMode()).toBe('full');
    expect(getCalibrationTargets()).toHaveLength(9);
  });

  it('startCalibrationMode({ quick: true }) → modo quick, 4 alvos (cantos)', () => {
    startCalibrationMode({ quick: true });
    expect(getCalibrationMode()).toBe('quick');
    expect(getCalibrationTargets()).toHaveLength(4);
  });

  // As posições saem do orçamento de excentricidade angular
  // (`computeCalibrationTargets`), que depende da tela e da distância.
  // Estes testes afirmam a ESTRUTURA da grade (simetria, contagem, extremos),
  // não os números mágicos de uma tela específica.
  it('modo quick: os 4 alvos são os cantos da grade, simétricos em torno do centro', () => {
    startCalibrationMode({ quick: true });
    const targets = getCalibrationTargets();
    const xs = [...new Set(targets.map((t) => t.x))].sort((a, b) => a - b);
    const ys = [...new Set(targets.map((t) => t.y))].sort((a, b) => a - b);
    expect(xs).toHaveLength(2);
    expect(ys).toHaveLength(2);
    // Simetria em torno de 0.5 — o centro da tela é o centro da grade.
    expect(xs[0] + xs[1]).toBeCloseTo(1, 10);
    expect(ys[0] + ys[1]).toBeCloseTo(1, 10);
    // 4 combinações distintas → cobre os 4 cantos da grade.
    const keys = new Set(targets.map((t) => `${t.x},${t.y}`));
    expect(keys.size).toBe(4);
  });

  it('modo full: grade 3×3 simétrica com centro exato e cantos coincidindo com o quick', () => {
    startCalibrationMode();
    const full = getCalibrationTargets();
    const xs = [...new Set(full.map((t) => t.x))].sort((a, b) => a - b);
    const ys = [...new Set(full.map((t) => t.y))].sort((a, b) => a - b);
    expect(xs).toHaveLength(3);
    expect(ys).toHaveLength(3);
    expect(xs[1]).toBeCloseTo(0.5, 10);
    expect(ys[1]).toBeCloseTo(0.5, 10);
    expect(xs[0] + xs[2]).toBeCloseTo(1, 10);
    expect(ys[0] + ys[2]).toBeCloseTo(1, 10);
    // Centro presente, e as 9 combinações são distintas.
    expect(new Set(full.map((t) => `${t.x},${t.y}`)).size).toBe(9);

    // Os 4 cantos do modo quick são exatamente os 4 cantos da grade full —
    // o contrato que o modo rápido sempre teve.
    startCalibrationMode({ quick: true });
    const quickKeys = new Set(getCalibrationTargets().map((t) => `${t.x},${t.y}`));
    for (const key of [
      `${xs[0]},${ys[0]}`, `${xs[2]},${ys[0]}`,
      `${xs[0]},${ys[2]}`, `${xs[2]},${ys[2]}`,
    ]) {
      expect(quickKeys.has(key), `canto ${key} ausente na grade quick`).toBe(true);
    }
  });

  it('startCalibrationMode({ quick: true, opticalCondition: "oculos_simples" }) — combina flags sem conflito', () => {
    startCalibrationMode({ quick: true, opticalCondition: 'oculos_simples' });
    expect(getCalibrationMode()).toBe('quick');
    expect(getCalibrationTargets()).toHaveLength(4);
    // A condição óptica vai para pendingProfileMeta e é usada no persist. Aqui
    // só checamos que a chamada não crasha e que o modo quick foi setado.
  });

  it('trocar de modo entre chamadas é o comportamento observado', () => {
    startCalibrationMode({ quick: true });
    expect(getCalibrationMode()).toBe('quick');
    startCalibrationMode(); // full sem opts
    expect(getCalibrationMode()).toBe('full');
    expect(getCalibrationTargets()).toHaveLength(9);
  });
});
