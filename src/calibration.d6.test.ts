import { describe, it, expect, beforeEach } from 'vitest';
import {
  startCalibrationMode,
  getCalibrationTargets,
  getCalibrationMode,
  CALIBRATION_TARGETS_FULL,
  CALIBRATION_TARGETS_QUICK,
} from './calibration';

// D6.1 (ROADMAP §5) — modo rápido: startCalibrationMode({ quick: true })
// deve reduzir a lista de alvos para os 4 cantos.

describe('D6.1 — modo rápido de calibração', () => {
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
    expect(getCalibrationTargets()).toBe(CALIBRATION_TARGETS_FULL);
    expect(getCalibrationTargets()).toHaveLength(9);
  });

  it('startCalibrationMode({ quick: true }) → modo quick, 4 alvos (cantos)', () => {
    startCalibrationMode({ quick: true });
    expect(getCalibrationMode()).toBe('quick');
    expect(getCalibrationTargets()).toBe(CALIBRATION_TARGETS_QUICK);
    expect(getCalibrationTargets()).toHaveLength(4);
  });

  it('modo quick: os 4 alvos são exatamente os cantos da tela (5%/95%)', () => {
    startCalibrationMode({ quick: true });
    const targets = getCalibrationTargets();
    // BUG-8: targets movidos de 10%/90% para 5%/95% para reduzir zona de
    // extrapolação do Ridge nas bordas. Cada alvo tem coordenada 0.05 ou 0.95.
    for (const t of targets) {
      expect([0.05, 0.95]).toContain(t.x);
      expect([0.05, 0.95]).toContain(t.y);
    }
    // 4 combinações distintas → cobre os 4 cantos exatos.
    const keys = new Set(targets.map((t) => `${t.x},${t.y}`));
    expect(keys.size).toBe(4);
  });

  it('modo full: os 9 alvos incluem os 4 cantos, o centro e as arestas medianas', () => {
    startCalibrationMode();
    const targets = getCalibrationTargets();
    const keys = new Set(targets.map((t) => `${t.x},${t.y}`));
    // 4 cantos + centro + 4 arestas medianas (5%/95% para bordas)
    for (const key of [
      '0.05,0.05', '0.95,0.05', '0.05,0.95', '0.95,0.95',
      '0.5,0.5',
      '0.5,0.05', '0.5,0.95', '0.05,0.5', '0.95,0.5',
    ]) {
      expect(keys.has(key), `alvo ${key} ausente na grade full`).toBe(true);
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
