import { describe, it, expect } from 'vitest';
import { planTuningStep, DEFAULT_TARGET, TARGET_IOD_FRACTION, TARGET_BRIGHTNESS } from './cameraTuner';
import type { CameraCapabilities, CameraState } from './cameraTuner';

// -----------------------------------------------------------------------------
// B3.14 — Zoom multiplicativo colapsa quando o driver reporta `zoom.min = 0`.
//
//   const current = state.zoom ?? caps.zoom.min;   // 0
//   const desired = current * iodErrorRatio;       // 0 · qualquer = 0
//   const maxStep = current * MAX_ZOOM_STEP_RATIO; // 0
//   const bounded = clamp(desired, ±0)             // 0
//   next === current                               // → conclui "atLimit"
//
// `state.zoom` vem de `track.getSettings()` e é `undefined` em vários drivers
// — o campo é opcional no padrão. Quando isso coincide com um `zoom.min` de 0
// (comum em webcams que expõem zoom como "0..100%"), a lei de controle
// **nunca sai do lugar** e o app avisa *"Zoom no máximo e o rosto ainda está
// pequeno"* com o zoom em 0.
//
// O conselho resultante — "aproxime a câmera" — é dado numa situação em que o
// software tinha toda a margem do mundo para agir sozinho.
//
// Segundo defeito, brilho: passo bang-bang de 15% da faixa, sem ganho
// proporcional nem histerese. Pode oscilar em torno do alvo indefinidamente. E
// como o contraste é condicionado a `brightnessConverged`, **o contraste nunca
// é ajustado** justamente quando a imagem está pior.
// -----------------------------------------------------------------------------

/** Driver que reporta zoom como 0..100 — o caso que travava. */
const CAPS_ZOOM_ZERO: CameraCapabilities = {
  zoom: { min: 0, max: 100, step: 1 },
  brightness: { min: 0, max: 255, step: 1 },
  contrast: { min: 0, max: 255, step: 1 },
};

/** Driver "bem-comportado", com zoom multiplicativo a partir de 1. */
const CAPS_ZOOM_UM: CameraCapabilities = {
  zoom: { min: 1, max: 4, step: 0.1 },
  brightness: { min: 0, max: 255, step: 1 },
  contrast: { min: 0, max: 255, step: 1 },
};

/** Rosto pequeno demais: a malha precisa AUMENTAR o zoom. */
const ROSTO_PEQUENO = {
  hasFace: true,
  iodFraction: TARGET_IOD_FRACTION * 0.5,
  brightness: TARGET_BRIGHTNESS,
  contrast: DEFAULT_TARGET.contrast,
};

describe('B3.14 — zoom com min = 0 não trava a malha', () => {
  it('sem state.zoom e com min = 0, ainda produz um passo', () => {
    // O caso do bug: `current = 0`, tudo multiplicado por zero, `next ===
    // current`, e a malha conclui `atLimit` sem nunca ter tentado.
    const step = planTuningStep(CAPS_ZOOM_ZERO, {}, ROSTO_PEQUENO);
    expect(step.constraints.zoom).toBeDefined();
    expect(step.constraints.zoom as number).toBeGreaterThan(0);
  });

  it('NÃO declara "no limite" quando há faixa de sobra', () => {
    // A mensagem "Zoom no máximo e o rosto ainda está pequeno" com o zoom em 0
    // é factualmente falsa, e manda o cuidador mover o hardware sem
    // necessidade.
    const step = planTuningStep(CAPS_ZOOM_ZERO, {}, ROSTO_PEQUENO);
    expect(step.atLimit).toBe(false);
    expect(step.physicalAdvice ?? '').not.toContain('Zoom no máximo');
  });

  it('state.zoom = 0 explícito também não trava', () => {
    const step = planTuningStep(CAPS_ZOOM_ZERO, { zoom: 0 }, ROSTO_PEQUENO);
    expect(step.constraints.zoom as number).toBeGreaterThan(0);
  });

  it('o passo respeita o teto da faixa', () => {
    const step = planTuningStep(CAPS_ZOOM_ZERO, { zoom: 99 }, ROSTO_PEQUENO);
    const z = step.constraints.zoom;
    if (z !== undefined) expect(z as number).toBeLessThanOrEqual(100);
  });

  it('no topo real da faixa, aí sim declara limite', () => {
    // A detecção de limite precisa continuar funcionando — o que estava
    // errado era acusá-la cedo demais.
    const step = planTuningStep(CAPS_ZOOM_ZERO, { zoom: 100 }, ROSTO_PEQUENO);
    expect(step.atLimit).toBe(true);
    expect(step.physicalAdvice ?? '').toContain('Aproxime');
  });
});

describe('B3.14 — o driver multiplicativo continua funcionando', () => {
  it('zoom a partir de 1 dá passo proporcional', () => {
    // Regressão: o piso não pode ter quebrado o caminho que já funcionava.
    const step = planTuningStep(CAPS_ZOOM_UM, { zoom: 2 }, ROSTO_PEQUENO);
    expect(step.constraints.zoom as number).toBeGreaterThan(2);
    expect(step.constraints.zoom as number).toBeLessThanOrEqual(2.5);
  });

  it('rosto grande demais reduz o zoom', () => {
    const step = planTuningStep(CAPS_ZOOM_UM, { zoom: 3 }, {
      ...ROSTO_PEQUENO,
      iodFraction: TARGET_IOD_FRACTION * 2,
    });
    expect(step.constraints.zoom as number).toBeLessThan(3);
  });

  it('convergido não mexe no zoom', () => {
    const step = planTuningStep(CAPS_ZOOM_UM, { zoom: 2 }, {
      ...ROSTO_PEQUENO,
      iodFraction: TARGET_IOD_FRACTION,
    });
    expect(step.constraints.zoom).toBeUndefined();
  });
});

describe('B3.14 — o contraste não fica refém do brilho', () => {
  it('contraste é ajustado mesmo com o brilho ainda fora da faixa', () => {
    // O bug: `if (brightnessConverged && !contrastConverged && caps.contrast)`.
    // Como o brilho é bang-bang e pode oscilar indefinidamente em torno do
    // alvo, o contraste **nunca** era ajustado — e é justamente quando a
    // imagem está ruim que a borda da íris precisa de contraste.
    const step = planTuningStep(CAPS_ZOOM_UM, { zoom: 2, brightness: 128, contrast: 100 }, {
      hasFace: true,
      iodFraction: TARGET_IOD_FRACTION,
      brightness: TARGET_BRIGHTNESS * 0.4,   // longe do alvo
      contrast: DEFAULT_TARGET.contrast * 0.3,
    });
    expect(step.constraints.contrast).toBeDefined();
  });

  it('brilho e contraste podem ser ajustados no mesmo passo', () => {
    const step = planTuningStep(CAPS_ZOOM_UM, { zoom: 2, brightness: 128, contrast: 100 }, {
      hasFace: true,
      iodFraction: TARGET_IOD_FRACTION,
      brightness: TARGET_BRIGHTNESS * 0.4,
      contrast: DEFAULT_TARGET.contrast * 0.3,
    });
    expect(step.constraints.brightness).toBeDefined();
    expect(step.constraints.contrast).toBeDefined();
  });
});

describe('B3.14 — o brilho usa ganho proporcional', () => {
  it('erro grande produz passo maior que erro pequeno', () => {
    // Bang-bang de 15% fixo: longe do alvo demora demais, perto do alvo
    // ultrapassa e volta — a oscilação que impedia `brightnessConverged`.
    const base = { hasFace: true, iodFraction: TARGET_IOD_FRACTION, contrast: DEFAULT_TARGET.contrast };
    const st: CameraState = { zoom: 2, brightness: 128, contrast: 128 };

    const longe = planTuningStep(CAPS_ZOOM_UM, st, { ...base, brightness: 0.05 });
    const perto = planTuningStep(CAPS_ZOOM_UM, st, { ...base, brightness: TARGET_BRIGHTNESS - 0.10 });

    const dLonge = Math.abs((longe.constraints.brightness as number) - 128);
    const dPerto = Math.abs((perto.constraints.brightness as number) - 128);
    expect(dLonge).toBeGreaterThan(dPerto);
  });

  it('dentro da faixa morta não mexe', () => {
    const step = planTuningStep(CAPS_ZOOM_UM, { zoom: 2, brightness: 128, contrast: 128 }, {
      hasFace: true,
      iodFraction: TARGET_IOD_FRACTION,
      brightness: TARGET_BRIGHTNESS,
      contrast: DEFAULT_TARGET.contrast,
    });
    expect(step.constraints.brightness).toBeUndefined();
    expect(step.converged).toBe(true);
  });
});
