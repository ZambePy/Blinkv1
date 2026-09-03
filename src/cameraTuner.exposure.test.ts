import { describe, it, expect } from 'vitest';
import {
  planExposureStep,
  TARGET_BRIGHTNESS,
  type CameraCapabilities,
  type CameraState,
  type TuningMeasurement,
} from './cameraTuner';

// P4.3 — desligar a auto-exposição, com o tempo de exposição DERIVADO da
// medição em vez de chutado.
//
// Por que importa: a auto-exposição da webcam reajusta continuamente, e cada
// reajuste muda o contraste da borda da íris — que é exatamente o que o
// landmark usa para se posicionar. Sobre um sinal de ~7 px, essa oscilação
// pesa. `planStabilizationStep` já pede `exposureMode: 'manual'`; o que faltava
// era escolher QUAL exposição, e dizer o que fazer quando o driver não deixa.
//
// O aceite pede três configurações de hardware, porque são três respostas
// diferentes — e a terceira (não expõe nada) é a que o projeto costuma errar,
// fingindo que ajustou.

const medida = (brightness?: number): TuningMeasurement => ({
  hasFace: true,
  iodFraction: 0.2,
  brightness,
  contrast: 0.1,
});

describe('planExposureStep — driver expõe tudo', () => {
  const caps: CameraCapabilities = {
    exposureMode: ['continuous', 'manual'],
    exposureTime: { min: 10, max: 2000, step: 10 },
    exposureCompensation: { min: -3, max: 3, step: 0.5 },
  };

  it('trava o modo e deriva o tempo de exposição da medição', () => {
    // Crop a 0,225 contra alvo 0,45: precisa do DOBRO de exposição.
    const p = planExposureStep(caps, { exposureTime: 200 }, medida(0.225));
    expect(p.constraints.exposureMode).toBe('manual');
    expect(typeof p.constraints.exposureTime).toBe('number');
    // Amortecido: não salta direto para 400, mas sobe.
    const t = p.constraints.exposureTime as number;
    expect(t).toBeGreaterThan(200);
    expect(t).toBeLessThanOrEqual(400);
    expect(p.supportLevel).toBe('full');
    expect(p.physicalAdvice).toBeNull();
  });

  it('imagem estourada: reduz o tempo de exposição', () => {
    const p = planExposureStep(caps, { exposureTime: 800 }, medida(0.9));
    expect(p.constraints.exposureTime as number).toBeLessThan(800);
  });

  it('respeita a grade do driver e os limites da faixa', () => {
    const p = planExposureStep(caps, { exposureTime: 1990 }, medida(0.05));
    const t = p.constraints.exposureTime as number;
    expect(t).toBeLessThanOrEqual(2000);
    expect(t % 10).toBe(0); // step = 10
  });

  it('brilho no alvo: nada de tempo, só o travamento do modo', () => {
    const p = planExposureStep(caps, { exposureTime: 200 }, medida(TARGET_BRIGHTNESS));
    expect(p.constraints.exposureMode).toBe('manual');
    expect(p.constraints.exposureTime).toBeUndefined();
    expect(p.converged).toBe(true);
  });

  it('sem `exposureTime` no estado, parte do meio da faixa em vez de assumir', () => {
    const p = planExposureStep(caps, {}, medida(0.225));
    const t = p.constraints.exposureTime as number;
    // Meio da faixa é 1005; snapado à grade e amortecido para cima.
    expect(t).toBeGreaterThan(1005);
    expect(p.reasons.join(' ')).toContain('meio da faixa');
  });

  it('no teto da faixa e ainda escuro: vira conselho físico, não silêncio', () => {
    const p = planExposureStep(caps, { exposureTime: 2000 }, medida(0.05));
    expect(p.atLimit).toBe(true);
    expect(p.physicalAdvice).toMatch(/luz|ilumin/i);
  });
});

describe('planExposureStep — driver expõe parcialmente', () => {
  it('só o modo manual, com a imagem escura: NÃO trava, e diz por quê', () => {
    // Travar a exposição num valor escuro é PIOR que deixar automática: a
    // câmera perde a capacidade de compensar e a imagem fica escura para
    // sempre. Sem poder escrever `exposureTime` nem `exposureCompensation`,
    // travar é destruir o único mecanismo que ainda podia ajudar.
    const caps: CameraCapabilities = { exposureMode: ['continuous', 'manual'] };
    const p = planExposureStep(caps, {}, medida(0.225));
    expect(p.constraints.exposureMode).toBeUndefined();
    expect(p.constraints.exposureTime).toBeUndefined();
    expect(p.supportLevel).toBe('partial');
    expect(p.reasons.join(' ')).toContain('exposureTime');
    expect(p.physicalAdvice).toMatch(/luz|ilumin/i);
  });

  it('só o modo manual, com a imagem JÁ no alvo: trava — é exatamente o caso de uso', () => {
    // Aqui travar é o objetivo: congela uma exposição boa antes que a
    // auto-exposição volte a caçar e mexa no contraste da borda da íris.
    const caps: CameraCapabilities = { exposureMode: ['continuous', 'manual'] };
    const p = planExposureStep(caps, {}, medida(TARGET_BRIGHTNESS));
    expect(p.constraints.exposureMode).toBe('manual');
    expect(p.converged).toBe(true);
  });

  it('compensação de exposição sem tempo absoluto: fecha a malha pelo outro canal', () => {
    const caps: CameraCapabilities = {
      exposureMode: ['manual'],
      exposureCompensation: { min: -3, max: 3, step: 0.5 },
    };
    const p = planExposureStep(caps, { exposureCompensation: 0 }, medida(0.225));
    // Dobrar a luz é +1 EV; o passo sai do log₂ da razão desejada.
    expect(p.constraints.exposureCompensation as number).toBeGreaterThan(0);
    expect(p.constraints.exposureMode).toBe('manual');
    // `supportLevel` descreve se a MALHA FECHA, não quantos campos o driver
    // expõe. Compensação em EV é um canal de controle legítimo — mais grosso
    // que o tempo absoluto, mas suficiente para dirigir a exposição. Chamar
    // isso de 'partial' faria a UI avisar o cuidador de uma limitação que não
    // existe neste hardware.
    expect(p.supportLevel).toBe('full');
  });

  it('tempo de exposição sem modo manual: não adianta escrever o tempo', () => {
    // Sem `exposureMode: manual` o driver continua reajustando sozinho e
    // sobrescreve o que escrevermos. Pedir assim mesmo produziria um plano que
    // parece ter funcionado e não funcionou.
    const caps: CameraCapabilities = { exposureTime: { min: 10, max: 2000 } };
    const p = planExposureStep(caps, { exposureTime: 200 }, medida(0.225));
    expect(p.constraints.exposureTime).toBeUndefined();
    expect(p.supportLevel).toBe('partial');
    expect(p.reasons.join(' ')).toContain('exposureMode');
  });
});

describe('planExposureStep — driver não expõe nada', () => {
  it('não inventa constraint e diz qual é a ação física', () => {
    const p = planExposureStep({}, {}, medida(0.225));
    expect(p.constraints).toEqual({});
    expect(p.supportLevel).toBe('none');
    expect(p.atLimit).toBe(true);
    expect(p.physicalAdvice).toBeTruthy();
    // A ação tem que ser executável por um cuidador, não por um engenheiro.
    expect(p.physicalAdvice).toMatch(/painel|luminária|luz|ilumin/i);
  });
});

describe('planExposureStep — guardas', () => {
  it('sem rosto, não mexe: a medição de brilho não significa nada', () => {
    const caps: CameraCapabilities = {
      exposureMode: ['manual'],
      exposureTime: { min: 10, max: 2000 },
    };
    const p = planExposureStep(caps, { exposureTime: 200 }, {
      hasFace: false, iodFraction: 0, brightness: 0.1,
    });
    expect(p.constraints).toEqual({});
    expect(p.reasons.join(' ')).toContain('sem rosto');
  });

  it('brilho NÃO MEDIDO pula o eixo em vez de tratar como zero (B3.3)', () => {
    const caps: CameraCapabilities = {
      exposureMode: ['manual'],
      exposureTime: { min: 10, max: 2000 },
    };
    const p = planExposureStep(caps, { exposureTime: 200 }, medida(undefined));
    // O modo ainda é travado — isso não depende de medição.
    expect(p.constraints.exposureMode).toBe('manual');
    // Mas o TEMPO não: derivar exposição de uma não-leitura é o bug B3.3.
    expect(p.constraints.exposureTime).toBeUndefined();
    expect(p.reasons.join(' ')).toContain('não medido');
  });

  it('é determinístico: mesma entrada, mesmo plano', () => {
    const caps: CameraCapabilities = {
      exposureMode: ['manual'],
      exposureTime: { min: 10, max: 2000, step: 10 },
    };
    const a = planExposureStep(caps, { exposureTime: 200 }, medida(0.3));
    const b = planExposureStep(caps, { exposureTime: 200 }, medida(0.3));
    expect(a).toEqual(b);
  });
});
