import { describe, it, expect } from 'vitest';
import { planTuningStep, DEFAULT_TARGET, TARGET_IOD_FRACTION } from './cameraTuner';
import type { CameraCapabilities, CameraState } from './cameraTuner';

// -----------------------------------------------------------------------------
// B3.3 — `?? 0` no engine desfazia a decisão do `qualityAnalyzer` de não
//        fabricar medição.
//
//   latestQuality = {
//     brightness: cropQuality.brightnessEstimate ?? 0,   // "não medido" → 0
//     blur:       cropQuality.blurEstimate ?? 0,
//     ...
//   };
//
// O `qualityAnalyzer` devolve `{}` (ou só `detectorConfidence`) quando não
// consegue medir — decisão deliberada e documentada no módulo. O engine
// convertia isso em `specular: 0` (ótimo), `blur: 0` (ótimo) e `brightness: 0`
// (péssimo) SIMULTANEAMENTE: um estado fisicamente impossível, exibido ao
// cuidador na pré-calibração como se fosse leitura de sensor.
//
// Pior que exibir: o `cameraTuner` consome esses números para fechar a malha
// de controle. Um `brightness: 0` fabricado faz o planner concluir "crop
// preto, aumente o brilho" e MEXER NO HARDWARE do paciente a partir de uma
// ausência de leitura.
//
// Este teste cobre o consumidor mais perigoso — a malha de controle. A parte
// do tipo (campos opcionais em `EngineDiagnostics.quality`) é verificada pelo
// próprio `tsc`, que recusou o código antigo quando os campos ficaram
// opcionais.
// -----------------------------------------------------------------------------

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

describe('B3.3 — brilho não medido não vira "aumente o brilho"', () => {
  it('brightness undefined NÃO produz constraint de brilho', () => {
    // O cenário do bug: com `?? 0`, `measured.brightness = 0` contra o alvo
    // 0,45 fazia o planner empurrar o brilho da câmera para cima — a partir de
    // nada.
    const step = planTuningStep(CAPS, STATE, medida({ brightness: undefined }));
    expect(step.constraints.brightness).toBeUndefined();
  });

  it('brightness = 0 MEDIDO continua produzindo constraint', () => {
    // A distinção que importa: zero medido é informação legítima (a imagem
    // está de fato preta) e a malha deve agir. Zero fabricado, não.
    const step = planTuningStep(CAPS, STATE, medida({ brightness: 0 }));
    expect(step.constraints.brightness).toBeDefined();
  });

  it('a ausência de medida é REPORTADA, não silenciada', () => {
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

describe('B3.3 — contraste não medido recebe o mesmo tratamento', () => {
  it('contrast undefined NÃO produz constraint de contraste', () => {
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

describe('B3.3 — o eixo de zoom segue funcionando sem medida de imagem', () => {
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
