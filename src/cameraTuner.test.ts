import { describe, it, expect } from 'vitest';
import {
  planTuningStep,
  planStabilizationStep,
  deriveHorizontalFovDeg,
  DEFAULT_TARGET,
  TARGET_IOD_FRACTION,
  type CameraCapabilities,
  type CameraState,
  type TuningMeasurement,
} from './cameraTuner';

const CAPS_COMPLETA: CameraCapabilities = {
  zoom: { min: 1, max: 4, step: 0.1 },
  brightness: { min: 0, max: 255, step: 1 },
  exposureMode: ['none', 'manual', 'continuous'],
  whiteBalanceMode: ['manual', 'continuous'],
  focusMode: ['continuous'],
};

const medido = (over: Partial<TuningMeasurement> = {}): TuningMeasurement => ({
  hasFace: true,
  iodFraction: 0.099,   // o valor real da gravação que deu 115 px
  brightness: 0.236,    // idem
  contrast: 0.094,      // idem
  ...over,
});

/** Medição já no alvo, para isolar UM eixo por teste. */
const noAlvo = (over: Partial<TuningMeasurement> = {}): TuningMeasurement =>
  medido({
    iodFraction: DEFAULT_TARGET.iodFraction,
    brightness: DEFAULT_TARGET.brightness,
    contrast: DEFAULT_TARGET.contrast,
    ...over,
  });

describe('planTuningStep — malha fechada do zoom', () => {
  it('sem rosto não mexe em nada', () => {
    const s = planTuningStep(CAPS_COMPLETA, { zoom: 1 }, medido({ hasFace: false }));
    expect(s.constraints).toEqual({});
    expect(s.converged).toBe(false);
  });

  it('rosto pequeno demais → aumenta o zoom', () => {
    const s = planTuningStep(CAPS_COMPLETA, { zoom: 1 }, medido());
    expect(s.constraints.zoom).toBeGreaterThan(1);
    expect(s.converged).toBe(false);
  });

  it('respeita o passo máximo por iteração (não salta para o alvo de uma vez)', () => {
    // 0,099 → 0,20 pediria zoom 2,02×. O amortecimento limita a +25%.
    const s = planTuningStep(CAPS_COMPLETA, { zoom: 1 }, medido());
    expect(s.constraints.zoom).toBeLessThanOrEqual(1.25 + 1e-9);
  });

  it('converge iterando — a malha alcança o alvo em poucos passos', () => {
    // Simula o driver: zoom escala linearmente o tamanho do rosto no frame.
    let zoom = 1;
    const iodBase = 0.099;
    let passos = 0;
    for (; passos < 30; passos++) {
      const m = noAlvo({ iodFraction: iodBase * zoom });
      const s = planTuningStep(CAPS_COMPLETA, { zoom }, m);
      if (s.converged) break;
      if (typeof s.constraints.zoom === 'number') zoom = s.constraints.zoom;
      else break;
    }
    expect(passos).toBeLessThan(20);
    expect(iodBase * zoom).toBeCloseTo(TARGET_IOD_FRACTION, 1);
  });

  it('rosto grande demais → reduz o zoom', () => {
    const s = planTuningStep(CAPS_COMPLETA, { zoom: 3 }, medido({ iodFraction: 0.40 }));
    expect(s.constraints.zoom).toBeLessThan(3);
  });

  it('já no alvo → convergido e sem constraints', () => {
    const s = planTuningStep(CAPS_COMPLETA, { zoom: 2 }, noAlvo());
    expect(s.converged).toBe(true);
    expect(s.constraints).toEqual({});
  });

  it('snap ao step do driver', () => {
    const caps: CameraCapabilities = { zoom: { min: 1, max: 4, step: 0.5 } };
    const s = planTuningStep(caps, { zoom: 1 }, noAlvo({ iodFraction: 0.099 }));
    expect([1, 1.5].includes(s.constraints.zoom as number)).toBe(true);
  });
});

describe('planTuningStep — quando o software esgota', () => {
  it('zoom no máximo e rosto ainda pequeno → manda aproximar a CÂMERA', () => {
    const s = planTuningStep(CAPS_COMPLETA, { zoom: 4 }, medido());
    expect(s.atLimit).toBe(true);
    expect(s.physicalAdvice).toMatch(/CÂMERA/);
    // Precisa dizer para NÃO mexer na tela: aproximar a tela pioraria a
    // excentricidade exigida do olhar.
    expect(s.physicalAdvice).toMatch(/tela onde está/);
  });

  it('driver sem zoom → não finge que ajustou', () => {
    const s = planTuningStep({}, {}, medido());
    expect(s.constraints.zoom).toBeUndefined();
    expect(s.atLimit).toBe(true);
    expect(s.physicalAdvice).toMatch(/não expõe controle de zoom/);
  });

  it('driver sem brilho e rosto escuro → aconselha luz física', () => {
    const s = planTuningStep(
      { zoom: { min: 1, max: 4 } }, { zoom: 2 },
      medido({ iodFraction: TARGET_IOD_FRACTION }),
    );
    expect(s.atLimit).toBe(true);
    expect(s.physicalAdvice).toMatch(/Ilumine/);
  });
});

describe('planTuningStep — brilho', () => {
  it('crop escuro → sobe o brilho da câmera', () => {
    const s = planTuningStep(CAPS_COMPLETA, { zoom: 1, brightness: 128 }, medido());
    expect(s.constraints.brightness).toBeGreaterThan(128);
  });

  it('crop estourado → desce o brilho', () => {
    const s = planTuningStep(
      CAPS_COMPLETA, { zoom: 1, brightness: 200 },
      noAlvo({ brightness: 0.9 }),
    );
    expect(s.constraints.brightness).toBeLessThan(200);
  });

  it('dentro da faixa morta não mexe — evita caçar exposição', () => {
    const s = planTuningStep(
      CAPS_COMPLETA, { zoom: 2, brightness: 128 },
      noAlvo({ brightness: DEFAULT_TARGET.brightness + 0.05 }),
    );
    expect(s.constraints.brightness).toBeUndefined();
  });
});

describe('planStabilizationStep', () => {
  it('trava só os modos que o driver declara suportar', () => {
    const s = planStabilizationStep(CAPS_COMPLETA);
    expect(s.constraints.exposureMode).toBe('manual');
    expect(s.constraints.whiteBalanceMode).toBe('manual');
    // focusMode só tem 'continuous' — pedir 'manual' faria applyConstraints
    // rejeitar o lote inteiro, inclusive os dois que funcionariam.
    expect(s.constraints.focusMode).toBeUndefined();
  });

  it('driver sem modos manuais → não emite constraint e explica', () => {
    const s = planStabilizationStep({});
    expect(s.constraints).toEqual({});
    expect(s.atLimit).toBe(true);
    expect(s.physicalAdvice).toMatch(/correção automática de luz/);
  });
});

describe('deriveHorizontalFovDeg', () => {
  it('recupera o FOV de uma geometria construída à mão', () => {
    const fov = 80, d = 50, videoWidth = 1280, canthal = 9.0;
    const frameCm = 2 * d * Math.tan((fov / 2) * (Math.PI / 180));
    const iod = (canthal / frameCm) * videoWidth;
    expect(deriveHorizontalFovDeg(iod, videoWidth, d, canthal)).toBeCloseTo(fov, 6);
  });

  it('bate com a medição real do repositório', () => {
    // ci-baseline.jsonl: iod 127 px em 1280, distância declarada 60 cm.
    // Se o FOV derivado ficar bem acima do que a webcam anuncia (90°), é sinal
    // de que a distância declarada está errada — que foi exatamente a suspeita
    // levantada na auditoria.
    const fov = deriveHorizontalFovDeg(127, 1280, 60)!;
    expect(fov).toBeGreaterThan(60);
    expect(fov).toBeLessThan(120);
  });

  it('rejeita entradas degeneradas', () => {
    expect(deriveHorizontalFovDeg(0, 1280, 60)).toBeNull();
    expect(deriveHorizontalFovDeg(127, 0, 60)).toBeNull();
    expect(deriveHorizontalFovDeg(127, 1280, 0)).toBeNull();
  });
});

describe('planTuningStep — contraste (item 2)', () => {
  it('sobe o contraste quando o brilho já convergiu', () => {
    const caps = { ...CAPS_COMPLETA, contrast: { min: 0, max: 255, step: 1 } };
    const s = planTuningStep(caps, { zoom: 2, contrast: 128 }, noAlvo({ contrast: 0.094 }));
    expect(s.constraints.contrast).toBeGreaterThan(128);
  });

  it('NÃO mexe no contraste enquanto o brilho está fora do alvo', () => {
    // Em muitos drivers o ganho de contraste altera o brilho aparente; mexer
    // nos dois ao mesmo tempo faz um passo desfazer o outro.
    const caps = { ...CAPS_COMPLETA, contrast: { min: 0, max: 255, step: 1 } };
    const s = planTuningStep(caps, { zoom: 2, contrast: 128 }, noAlvo({ brightness: 0.10, contrast: 0.094 }));
    expect(s.constraints.contrast).toBeUndefined();
    expect(s.constraints.brightness).toBeDefined();
  });

  it('driver sem contraste e borda mole → aconselha luz física', () => {
    const s = planTuningStep(
      { zoom: { min: 1, max: 4 }, brightness: { min: 0, max: 255 } },
      { zoom: 2 },
      noAlvo({ contrast: 0.05 }),
    );
    expect(s.atLimit).toBe(true);
    expect(s.physicalAdvice).toMatch(/contraste/i);
  });

  it('contraste dentro da faixa morta não gera constraint', () => {
    const caps = { ...CAPS_COMPLETA, contrast: { min: 0, max: 255, step: 1 } };
    const s = planTuningStep(caps, { zoom: 2, contrast: 128 }, noAlvo());
    expect(s.constraints.contrast).toBeUndefined();
    expect(s.converged).toBe(true);
  });
});

describe('planStabilizationStep — cintilação (item 1)', () => {
  it('aplica powerLineFrequency quando o driver suporta a rede inferida', () => {
    const caps = { ...CAPS_COMPLETA, powerLineFrequency: [0, 50, 60] };
    expect(planStabilizationStep(caps, 50).constraints.powerLineFrequency).toBe(50);
  });

  it('não pede uma frequência que o driver não lista', () => {
    // Constraint inválida faz applyConstraints rejeitar o lote inteiro,
    // inclusive exposureMode/whiteBalanceMode que funcionariam.
    const caps = { ...CAPS_COMPLETA, powerLineFrequency: [60] };
    expect(planStabilizationStep(caps, 50).constraints.powerLineFrequency).toBeUndefined();
    expect(planStabilizationStep(caps, 50).constraints.exposureMode).toBe('manual');
  });

  it('sem cintilação detectada não mexe na frequência', () => {
    const caps = { ...CAPS_COMPLETA, powerLineFrequency: [0, 50, 60] };
    expect(planStabilizationStep(caps, null).constraints.powerLineFrequency).toBeUndefined();
  });
});
