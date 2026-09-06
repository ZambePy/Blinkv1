import { describe, it, expect } from 'vitest';
import {
  FILTER_PRESETS,
  FILTER_PRESETS_V2,
  alphaFromCutoff,
  tauFromCutoff,
  OneEuroFilter2D,
} from './oneEuroFilter';

// `alpha(mincutoff)` é adimensional (não depende de px vs. normalizado; só o
// termo `beta·|ẋ|` muda de escala) e os presets declaram alpha e τ medidos
// pela fórmula real: `alpha = 1/(1+τ/te)`, `τ = 1/(2π·fc)`. Um One Euro mal
// parametrizado viciaria o benchmark contra o Kalman+EMA.

/** Referência analítica, escrita de forma independente da implementação. */
function alphaEsperado(cutoffHz: number, freqHz: number): number {
  const te = 1 / freqHz;
  const tau = 1 / (2 * Math.PI * cutoffHz);
  return 1 / (1 + tau / te);
}

describe('a fórmula de alpha está exposta e correta', () => {
  it('alphaFromCutoff bate com a fórmula analítica', () => {
    for (const fc of [0.02, 0.05, 0.15, 0.3, 0.5, 1.0, 3.0, 10.0]) {
      for (const freq of [24, 30, 60]) {
        expect(alphaFromCutoff(fc, freq)).toBeCloseTo(alphaEsperado(fc, freq), 12);
      }
    }
  });

  it('os números REAIS do relatório são reproduzidos', () => {
    // Se estes valores mudarem, algum preset foi alterado sem atualizar a
    // documentação — o mesmo defeito reaparecendo.
    expect(alphaFromCutoff(0.05, 30)).toBeCloseTo(0.0104, 4);
    expect(alphaFromCutoff(0.50, 30)).toBeCloseTo(0.0948, 4);
    expect(alphaFromCutoff(1.00, 30)).toBeCloseTo(0.1732, 3);
  });

  it('os números DOCUMENTADOS antes eram falsos', () => {
    // "a 30 fps e mincutoff=0.02, alpha≈0.99" → o real é 0,0042.
    expect(alphaFromCutoff(0.02, 30)).toBeLessThan(0.01);
    // "mincutoff 0.5 produz alpha≈0.50" → o real é 0,095, 5× menor.
    expect(Math.abs(alphaFromCutoff(0.5, 30) - 0.5)).toBeGreaterThan(0.4);
  });

  it('tauFromCutoff devolve a constante de tempo em segundos', () => {
    expect(tauFromCutoff(0.05)).toBeCloseTo(3.183, 3);
    expect(tauFromCutoff(0.50)).toBeCloseTo(0.318, 3);
    expect(tauFromCutoff(1.00)).toBeCloseTo(0.159, 3);
  });
});

describe('alpha é adimensional: não depende do espaço de coordenadas', () => {
  it('o mesmo mincutoff dá o mesmo alpha em px e em normalizado', () => {
    // A afirmação central que o bloco "v2" contradizia. A prova é trivial —
    // a fórmula não tem nenhum termo de escala espacial — mas fica travada
    // aqui porque foi exatamente esse engano que gerou os presets errados.
    expect(alphaFromCutoff(0.5, 30)).toBe(alphaFromCutoff(0.5, 30));
    // E o filtro se comporta identicamente sobre entradas reescaladas.
    const emPx = new OneEuroFilter2D(30, 0.5, 0);
    const emNorm = new OneEuroFilter2D(30, 0.5, 0);
    const ESCALA = 1920;
    for (let i = 0; i < 20; i++) {
      const t = i / 30;
      const alvoNorm = 0.3 + i * 0.01;
      const a = emPx.filter(alvoNorm * ESCALA, 0, t);
      const b = emNorm.filter(alvoNorm, 0, t);
      expect(a.x / ESCALA).toBeCloseTo(b.x, 9);
    }
  });
});

describe('os presets declaram alpha e τ medidos', () => {
  it('todo preset v1 traz alphaAt30 e tauSec coerentes com mincutoff', () => {
    for (const [nome, cfg] of Object.entries(FILTER_PRESETS)) {
      expect(cfg.alphaAt30, `preset ${nome}`).toBeCloseTo(alphaFromCutoff(cfg.mincutoff, 30), 6);
      expect(cfg.tauSec, `preset ${nome}`).toBeCloseTo(tauFromCutoff(cfg.mincutoff), 6);
    }
  });

  it('todo preset v2 traz alphaAt30 e tauSec coerentes com mincutoff', () => {
    for (const [nome, cfg] of Object.entries(FILTER_PRESETS_V2)) {
      expect(cfg.alphaAt30, `preset ${nome}`).toBeCloseTo(alphaFromCutoff(cfg.mincutoff, 30), 6);
      expect(cfg.tauSec, `preset ${nome}`).toBeCloseTo(tauFromCutoff(cfg.mincutoff), 6);
    }
  });

  it('os presets são monotônicos: estável < balanceado < responsivo', () => {
    // Se um preset "responsivo" filtrasse mais que o "estável", o nome mentiria
    // para o cuidador que escolhe na tela de configurações.
    expect(FILTER_PRESETS.estavel.alphaAt30).toBeLessThan(FILTER_PRESETS.balanceado.alphaAt30);
    expect(FILTER_PRESETS.balanceado.alphaAt30).toBeLessThan(FILTER_PRESETS.responsivo.alphaAt30);

    expect(FILTER_PRESETS_V2['estavel-v2'].alphaAt30)
      .toBeLessThan(FILTER_PRESETS_V2['balanceado-v2'].alphaAt30);
    expect(FILTER_PRESETS_V2['balanceado-v2'].alphaAt30)
      .toBeLessThan(FILTER_PRESETS_V2['responsivo-v2'].alphaAt30);
  });

  it('o τ de cada preset é plausível para uso interativo', () => {
    // Um τ de 3,18 s (o do `balanceado` legado) significa que um viés residual
    // leva mais de 3 s para decair — inutilizável para dwell de 1,5 s. Este
    // teste não escolhe o valor certo (isso é do benchmark); só barra os absurdos.
    for (const [nome, cfg] of Object.entries(FILTER_PRESETS_V2)) {
      expect(cfg.tauSec, `preset ${nome}`).toBeLessThan(1.0);
      expect(cfg.tauSec, `preset ${nome}`).toBeGreaterThan(0.02);
    }
  });
});

describe('comportamento observável do filtro bate com o τ declarado', () => {
  it('a resposta ao degrau atinge ~63% em τ segundos', () => {
    // A definição de constante de tempo. Verificar isto liga o número
    // declarado ao comportamento real — que é o ponto do bug: os presets
    // declaravam um alpha que o filtro nunca produziu.
    const cfg = FILTER_PRESETS_V2['balanceado-v2'];
    // beta=0 isola o mincutoff; com beta o cutoff sobe durante movimento e a
    // resposta deixa de ser um exponencial puro.
    const f = new OneEuroFilter2D(30, cfg.mincutoff, 0);

    f.filter(0, 0, 0);
    let saidaEmTau = 0;
    const passo = 1 / 30;
    for (let i = 1; i * passo <= cfg.tauSec + 1e-9; i++) {
      saidaEmTau = f.filter(1, 0, i * passo).x;
    }
    expect(saidaEmTau).toBeGreaterThan(0.5);
    expect(saidaEmTau).toBeLessThan(0.75);
  });
});
