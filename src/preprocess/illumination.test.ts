import { describe, it, expect } from 'vitest';
import {
  planIllumination,
  fracaoSaturada,
  ILLUMINATION_BAND,
  type IlluminationInput,
} from './illumination';

// P4.4 — controle de iluminação ANTES de a imagem virar feature.
//
// A escada, da mais eficaz para a menos:
//
//   1. sensor    constraints do MediaStream (`cameraTuner`). É o único degrau
//                que corrige a luz ANTES da quantização.
//   2. software  CLAHE + gama. Redistribui o que chegou; NÃO recupera o que o
//                sensor perdeu.
//   3. aviso     quando nenhum dos dois basta, dizer ao cuidador o que fazer
//                fisicamente.
//
// A ordem não é preferência estética: é o que separa corrigir de maquiar. Um
// crop estourado passado por CLAHE fica com histograma bonito e continua sem a
// borda da íris, porque a informação foi perdida na captura.

const entrada = (over: Partial<IlluminationInput> = {}): IlluminationInput => ({
  measured: { brightness: 0.45, contrast: 0.2 },
  sensorPodeAgir: false,
  sensorNoLimite: false,
  conselhoFisico: null,
  softwareDisponivel: true,
  fracaoSaturada: 0,
  ...over,
});

describe('planIllumination — a escada', () => {
  it('imagem no alvo: nenhum degrau é acionado', () => {
    const p = planIllumination(entrada());
    expect(p.layer).toBe('ok');
    expect(p.software).toEqual({ clahe: false, gamma: false });
    expect(p.advice).toBeNull();
  });

  it('imagem fora do alvo com o sensor podendo agir: degrau 1', () => {
    const p = planIllumination(entrada({
      measured: { brightness: 0.15, contrast: 0.2 },
      sensorPodeAgir: true,
    }));
    expect(p.layer).toBe('sensor');
    // Software NÃO entra junto: mexer nos dois ao mesmo tempo faz a malha da
    // câmera perseguir um alvo que o software está mudando por baixo dela.
    expect(p.software).toEqual({ clahe: false, gamma: false });
    expect(p.reasons.join(' ')).toContain('sensor');
  });

  it('sensor esgotado, software disponível: degrau 2', () => {
    const p = planIllumination(entrada({
      measured: { brightness: 0.15, contrast: 0.05 },
      sensorPodeAgir: false,
      sensorNoLimite: true,
      conselhoFisico: 'Ilumine de frente.',
    }));
    expect(p.layer).toBe('software');
    expect(p.software.gamma).toBe(true);   // brilho fora do alvo
    expect(p.software.clahe).toBe(true);   // contraste fora do alvo
    // O aviso continua disponível: software é paliativo, não solução.
    expect(p.advice).toBe('Ilumine de frente.');
  });

  it('só o contraste ruim aciona CLAHE, sem gama', () => {
    const p = planIllumination(entrada({
      measured: { brightness: 0.45, contrast: 0.04 },
      sensorNoLimite: true,
    }));
    expect(p.software).toEqual({ clahe: true, gamma: false });
  });

  it('só o brilho ruim aciona gama, sem CLAHE', () => {
    const p = planIllumination(entrada({
      measured: { brightness: 0.15, contrast: 0.2 },
      sensorNoLimite: true,
    }));
    expect(p.software).toEqual({ clahe: false, gamma: true });
  });

  it('sensor esgotado e software desligado: degrau 3', () => {
    const p = planIllumination(entrada({
      measured: { brightness: 0.15, contrast: 0.05 },
      sensorNoLimite: true,
      softwareDisponivel: false,
      conselhoFisico: 'Ilumine de frente.',
    }));
    expect(p.layer).toBe('advise');
    expect(p.advice).toBe('Ilumine de frente.');
  });
});

describe('planIllumination — o limite honesto do software', () => {
  it('imagem ESTOURADA não é tratada com software: vai direto ao aviso', () => {
    // CLAHE sobre pixels saturados redistribui o que sobrou e devolve um
    // histograma de aparência saudável. A borda da íris continua ausente, e
    // agora sem nada no diagnóstico indicando o problema. É a diferença entre
    // corrigir e maquiar.
    const p = planIllumination(entrada({
      measured: { brightness: 0.9, contrast: 0.03 },
      sensorNoLimite: true,
      softwareDisponivel: true,
      fracaoSaturada: 0.25,
    }));
    expect(p.layer).toBe('advise');
    expect(p.software).toEqual({ clahe: false, gamma: false });
    expect(p.reasons.join(' ')).toMatch(/satura/i);
    expect(p.advice).toBeTruthy();
  });

  it('saturação pequena não bloqueia o software', () => {
    const p = planIllumination(entrada({
      measured: { brightness: 0.2, contrast: 0.05 },
      sensorNoLimite: true,
      fracaoSaturada: 0.01,
    }));
    expect(p.layer).toBe('software');
  });
});

describe('planIllumination — sem medição (B3.3)', () => {
  it('brilho e contraste não medidos: não age, e diz por quê', () => {
    const p = planIllumination(entrada({ measured: {} }));
    expect(p.layer).toBe('ok');
    expect(p.software).toEqual({ clahe: false, gamma: false });
    expect(p.reasons.join(' ')).toContain('não medido');
  });

  it('só o brilho medido: decide sobre o brilho e ignora o eixo mudo', () => {
    const p = planIllumination(entrada({
      measured: { brightness: 0.15 },
      sensorNoLimite: true,
    }));
    expect(p.software).toEqual({ clahe: false, gamma: true });
  });
});

describe('fracaoSaturada', () => {
  it('conta os extremos 0 e 255 do histograma', () => {
    const h = new Int32Array(256);
    h[0] = 10; h[255] = 10; h[128] = 80;
    expect(fracaoSaturada(h)).toBeCloseTo(0.2, 6);
  });

  it('histograma vazio devolve 0 em vez de NaN', () => {
    expect(fracaoSaturada(new Int32Array(256))).toBe(0);
  });

  it('imagem sem extremos devolve 0', () => {
    const h = new Int32Array(256);
    h[100] = 500;
    expect(fracaoSaturada(h)).toBe(0);
  });
});

describe('a faixa aceitável é declarada', () => {
  it('brilho e contraste têm banda explícita, e a de brilho cerca o alvo do cameraTuner', () => {
    expect(ILLUMINATION_BAND.brightness.min).toBeLessThan(0.45);
    expect(ILLUMINATION_BAND.brightness.max).toBeGreaterThan(0.45);
    expect(ILLUMINATION_BAND.contrast.min).toBeGreaterThan(0);
  });
});
