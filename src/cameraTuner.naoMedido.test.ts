import { describe, it, expect } from 'vitest';
import { planTuningStep, DEFAULT_TARGET, TARGET_IOD_FRACTION } from './cameraTuner';
import type { CameraCapabilities, CameraState } from './cameraTuner';

// O `qualityAnalyzer` devolve campos ausentes quando não consegue medir. A
// malha de controle da câmera precisa tratar `undefined`/NaN como "não medido"
// — nunca como 0 — senão conclui "crop preto, aumente o brilho" e mexe no
// hardware do paciente a partir de uma ausência de leitura.

const CAPS: CameraCapabilities = {
  zoom: { min: 1, max: 4, step: 0.1 },
  brightness: { min: 0, max: 255, step: 1 },
  contrast: { min: 0, max: 255, step: 1 },
};

const STATE: CameraState = { zoom: 2, brightness: 128, contrast: 128 };

/** Medição com o zoom já convergido, para isolar os eixos de imagem. */
function medida(over: Partial<Parameters<typeof planTuningStep>[2]> = {}) {
  return {
    hasFace: true,
    iodFraction: TARGET_IOD_FRACTION,
    brightness: DEFAULT_TARGET.brightness,
    contrast: DEFAULT_TARGET.contrast,
    ...over,
  };
}

describe('brilho não medido não vira "aumente o brilho"', () => {
  it('brightness undefined não produz constraint de brilho', () => {
    // Com `?? 0`, `measured.brightness = 0` contra o alvo 0,45 empurraria o
    // brilho da câmera para cima — a partir de nada.
    const step = planTuningStep(CAPS, STATE, medida({ brightness: undefined }));
    expect(step.constraints.brightness).toBeUndefined();
  });

  it('brightness = 0 medido continua produzindo constraint', () => {
    // A distinção que importa: zero medido é informação legítima (a imagem
    // está de fato preta) e a malha deve agir. Zero fabricado, não.
    const step = planTuningStep(CAPS, STATE, medida({ brightness: 0 }));
    expect(step.constraints.brightness).toBeDefined();
  });

  it('a ausência de medida é reportada, não silenciada', () => {
    // Sem isso o cuidador vê a malha "não fazer nada" sem saber por quê.
    const step = planTuningStep(CAPS, STATE, medida({ brightness: undefined }));
    expect(step.reasons.join(' ')).toContain('brilho não medido');
  });

  it('sem medida, o passo não se declara convergido', () => {
    // Declarar convergência sobre um eixo que não foi medido faria a malha
    // parar de tentar — e ela precisa voltar a agir assim que a medição
    // voltar.
    const step = planTuningStep(CAPS, STATE, medida({ brightness: undefined }));
    expect(step.converged).toBe(false);
  });

  it('sem medida, não há conselho físico sobre iluminação', () => {
    // "Ilumine o rosto de frente" a partir de uma não-leitura é o mesmo erro,
    // só que dirigido ao humano em vez do driver.
    const step = planTuningStep(
      { zoom: CAPS.zoom },   // driver sem controle de brilho
      { zoom: 2 },
      medida({ brightness: undefined }),
    );
    expect(step.physicalAdvice ?? '').not.toContain('Ilumine');
  });
});

describe('contraste não medido recebe o mesmo tratamento', () => {
  it('contrast undefined não produz constraint de contraste', () => {
    const step = planTuningStep(CAPS, STATE, medida({ contrast: undefined }));
    expect(step.constraints.contrast).toBeUndefined();
  });

  it('a ausência de contraste é reportada', () => {
    const step = planTuningStep(CAPS, STATE, medida({ contrast: undefined }));
    expect(step.reasons.join(' ')).toContain('contraste não medido');
  });

  it('NaN é tratado como não medido', () => {
    // Defesa contra um `undefined` que virou NaN numa conta intermediária.
    const step = planTuningStep(CAPS, STATE, medida({ brightness: NaN }));
    expect(step.constraints.brightness).toBeUndefined();
  });
});

describe('o eixo de zoom segue funcionando sem medida de imagem', () => {
  it('zoom converge mesmo com brilho e contraste ausentes', () => {
    // Os eixos são independentes: não medir a imagem não pode paralisar o
    // ajuste de densidade do rosto, que é o que mais afeta a acurácia.
    const step = planTuningStep(
      CAPS,
      STATE,
      medida({
        iodFraction: TARGET_IOD_FRACTION * 0.5,
        brightness: undefined,
        contrast: undefined,
      }),
    );
    expect(step.constraints.zoom).toBeDefined();
  });
});
