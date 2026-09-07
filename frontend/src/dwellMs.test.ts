import { describe, it, expect } from 'vitest';
import {
  DWELL_MIN_MS,
  DWELL_MAX_MS,
  PRESETS_DE_DWELL,
  dwellMsDoLegado,
  limitarDwellMs,
  presetMaisProximo,
} from './dwellMs';

// -----------------------------------------------------------------------------
// O tempo de permanência era um enum de três valores: lento, normal, rápido.
//
// Três degraus não cobrem a distância entre um paciente com ELA avançada — que
// pode precisar de três segundos para fixar — e alguém com boa fixação, para
// quem 2,5 s é uma espera irritante em cada letra digitada. Entre 0,8 e 2,5 s
// não havia nada.
//
// A migração importa mais que a faixa: quem já configurou "lento" não pode
// perder essa escolha e voltar ao padrão na primeira abertura depois da
// atualização — para alguns pacientes isso deixa o app inoperável até alguém
// notar.
// -----------------------------------------------------------------------------

describe('migração do enum antigo', () => {
  it('lento vira 2500 ms', () => {
    expect(dwellMsDoLegado('slow')).toBe(2500);
  });

  it('normal vira 1500 ms', () => {
    expect(dwellMsDoLegado('normal')).toBe(1500);
  });

  it('rápido vira 800 ms', () => {
    expect(dwellMsDoLegado('fast')).toBe(800);
  });

  it('os três valores migrados caem dentro da faixa do slider', () => {
    // Se um deles caísse fora, o slider mostraria uma posição que não existe.
    for (const v of ['slow', 'normal', 'fast'] as const) {
      const ms = dwellMsDoLegado(v);
      expect(ms).toBeGreaterThanOrEqual(DWELL_MIN_MS);
      expect(ms).toBeLessThanOrEqual(DWELL_MAX_MS);
    }
  });

  it('valor desconhecido cai no normal em vez de quebrar', () => {
    // Um enum vindo de uma versão futura, ou lixo no storage.
    expect(dwellMsDoLegado('turbo' as 'fast')).toBe(1500);
  });
});

describe('limitarDwellMs', () => {
  it('deixa passar um valor da faixa', () => {
    expect(limitarDwellMs(1200)).toBe(1200);
  });

  it('prende abaixo do mínimo', () => {
    expect(limitarDwellMs(50)).toBe(DWELL_MIN_MS);
  });

  it('prende acima do máximo', () => {
    expect(limitarDwellMs(99999)).toBe(DWELL_MAX_MS);
  });

  it('NaN vira o padrão, não dwell infinito', () => {
    // Um slider vazio produz NaN. Sem isto o dwell nunca completaria e o
    // paciente ficaria sem conseguir clicar em nada, sem saber por quê.
    expect(limitarDwellMs(Number.NaN)).toBe(1500);
  });

  it('Infinity vira o máximo', () => {
    expect(limitarDwellMs(Number.POSITIVE_INFINITY)).toBe(DWELL_MAX_MS);
  });

  it('negativo vira o mínimo', () => {
    expect(limitarDwellMs(-500)).toBe(DWELL_MIN_MS);
  });
});

describe('os presets', () => {
  it('são três, do mais lento ao mais rápido', () => {
    expect(PRESETS_DE_DWELL.map((p) => p.ms)).toEqual([2500, 1500, 800]);
  });

  it('todos cabem na faixa', () => {
    for (const p of PRESETS_DE_DWELL) {
      expect(p.ms).toBeGreaterThanOrEqual(DWELL_MIN_MS);
      expect(p.ms).toBeLessThanOrEqual(DWELL_MAX_MS);
    }
  });
});

describe('presetMaisProximo — qual atalho destacar', () => {
  it('marca o preset exato', () => {
    expect(presetMaisProximo(1500)?.id).toBe('normal');
  });

  it('não marca nada quando o valor é claramente entre dois', () => {
    // O ponto do slider é justamente permitir valores que não são preset.
    // Destacar um deles mentiria sobre o que está configurado.
    expect(presetMaisProximo(1150)).toBeNull();
  });

  it('tolera arredondamento do slider', () => {
    expect(presetMaisProximo(1495)?.id).toBe('normal');
  });
});
