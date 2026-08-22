// Testes para A2-1, A2-2, A2-3, A2-4 — mudanças de precisão do filtro e blink.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  LowPassFilter,
  OneEuroFilter,
  OneEuroFilter2D,
  FILTER_PRESETS,
  FILTER_PRESETS_V2,
} from './oneEuroFilter';
import { BlinkDetector } from './extractor';

// ── A2-2: LowPassFilter — primeira amostra não puxada para zero ───────────

describe('A2-2: LowPassFilter — primeira amostra não interpolada com zero', () => {
  it('com alpha=0.5, primeira saída é o valor bruto (não 0.5 × value + 0.5 × 0)', () => {
    const f = new LowPassFilter(0.5);
    const out = f.filter(100);
    // Antes do fix: out = 0.5 * 100 + 0.5 * 0 = 50. Agora: out = 100.
    expect(out).toBe(100);
  });

  it('segunda amostra interpola normalmente', () => {
    const f = new LowPassFilter(0.5);
    f.filter(100);
    const out2 = f.filter(200);
    // 0.5 * 200 + 0.5 * 100 = 150
    expect(out2).toBeCloseTo(150, 5);
  });

  it('com alpha=0.99 (caso de uso real do filtro em pixels), sem salto na origem', () => {
    const f = new LowPassFilter(0.99);
    const out = f.filter(960); // centro de uma tela 1920px
    expect(out).toBe(960);
    // Se houvesse puxada para zero: 0.99 * 960 + 0.01 * 0 = 950.4 — ainda perto,
    // mas no espaço normalizado (A2-1) alpha≈0.5 e o salto seria de ~metade da tela.
  });

  it('converge para o valor de sinal estático independente do ponto de partida', () => {
    const f = new LowPassFilter(0.5);
    let out = 0;
    for (let i = 0; i < 20; i++) out = f.filter(42);
    expect(out).toBeCloseTo(42, 5);
  });
});

// ── A2-3: OneEuroFilter2D.setParams — preserva estado sem recriá-lo ───────

describe('A2-3: setParams não descarta o estado filtrado', () => {
  it('setParams muta parâmetros mas continua do último valor filtrado', () => {
    const f = new OneEuroFilter2D(30, 0.05, 2.5);

    // Warm up: filtrar durante 10 frames com sinal estático
    for (let i = 0; i < 10; i++) {
      f.filter(500, 300, i / 30);
    }

    // Captura a posição antes da troca de preset
    const { x: xBefore, y: yBefore } = f.filter(500, 300, 10 / 30);

    // Troca preset via setParams
    f.setParams(0.020, 0.3); // preset 'estavel'

    // Próximo frame — deve continuar de onde parou, não saltar para origem
    const { x: xAfter, y: yAfter } = f.filter(500, 300, 11 / 30);

    // Sem o fix, `new OneEuroFilter(...)` zerava o estado → output próximo de
    // alpha*value + (1-alpha)*0. Com o fix, continua da última posição filtrada.
    // Tolerância ampla (5px) para não ser frágil a variações de freq/alpha.
    expect(Math.abs(xAfter - xBefore)).toBeLessThan(10);
    expect(Math.abs(yAfter - yBefore)).toBeLessThan(10);
  });

  it('setMincutoff/setBeta em OneEuroFilter não lançam para valores válidos', () => {
    const f = new OneEuroFilter(30, 0.05, 2.0);
    expect(() => f.setMincutoff(0.10)).not.toThrow();
    expect(() => f.setBeta(5.0)).not.toThrow();
  });

  it('setMincutoff lança para mincutoff <= 0', () => {
    const f = new OneEuroFilter(30, 0.05, 2.0);
    expect(() => f.setMincutoff(0)).toThrow();
    expect(() => f.setMincutoff(-1)).toThrow();
  });
});

// ── A2-1: FILTER_PRESETS — flags filterInNormalizedSpace ─────────────────

describe('A2-1: FilterConfig — flag filterInNormalizedSpace', () => {
  it('todos os presets legados têm filterInNormalizedSpace=false', () => {
    expect(FILTER_PRESETS.estavel.filterInNormalizedSpace).toBe(false);
    expect(FILTER_PRESETS.balanceado.filterInNormalizedSpace).toBe(false);
    expect(FILTER_PRESETS.responsivo.filterInNormalizedSpace).toBe(false);
  });

  it('todos os presets v2 têm filterInNormalizedSpace=true', () => {
    expect(FILTER_PRESETS_V2['estavel-v2'].filterInNormalizedSpace).toBe(true);
    expect(FILTER_PRESETS_V2['balanceado-v2'].filterInNormalizedSpace).toBe(true);
    expect(FILTER_PRESETS_V2['responsivo-v2'].filterInNormalizedSpace).toBe(true);
  });

  it('presets v2 têm mincutoff > 0.20 (em normalizado, não milésimos de Hz)', () => {
    // Em espaço de pixel, mincutoff=0.05 era inerte. Em normalizado, precisa ser
    // ≥ 0.30 para produzir alpha ≈ 0.50 a 30fps — filtragem real.
    expect(FILTER_PRESETS_V2['estavel-v2'].mincutoff).toBeGreaterThanOrEqual(0.20);
    expect(FILTER_PRESETS_V2['balanceado-v2'].mincutoff).toBeGreaterThanOrEqual(0.30);
    expect(FILTER_PRESETS_V2['responsivo-v2'].mincutoff).toBeGreaterThanOrEqual(0.50);
  });
});

// ── A2-4: BlinkDetector — encapsulamento e correção da realimentação ──────

describe('A2-4: BlinkDetector', () => {
  let bd: BlinkDetector;

  beforeEach(() => {
    bd = new BlinkDetector({ histLen: 50, minHistory: 5, blinkRatio: 0.8, thrMin: 0.10, thrMax: 0.22 });
  });

  it('antes de ter histórico suficiente, usa thrMax como default conservador', () => {
    // EAR=0.21 está ABAIXO de thrMax=0.22 → seria contado como piscada
    expect(bd.update(0.21)).toBe(true);
    // EAR=0.23 está ACIMA de thrMax=0.22 → não piscada
    expect(bd.update(0.23)).toBe(false);
  });

  it('acumula apenas frames de NÃO piscada no histórico', () => {
    bd = new BlinkDetector({ minHistory: 3, thrMax: 0.22 });
    // 5 frames de olho aberto (não piscada)
    for (let i = 0; i < 5; i++) bd.update(0.30);
    // 3 frames de piscada (não devem entrar no histórico)
    for (let i = 0; i < 3; i++) bd.update(0.05);
    // Apenas os 5 frames de olho aberto devem estar no histórico
    expect(bd.nonBlinkCount).toBe(5);
  });

  it('threshold adaptativo usa só a média dos frames de olho aberto', () => {
    bd = new BlinkDetector({ minHistory: 3, blinkRatio: 0.8, thrMin: 0.10, thrMax: 0.22 });
    // 5 frames de olho bem aberto (EAR ≈ 0.35)
    for (let i = 0; i < 5; i++) bd.update(0.35);
    // Threshold adaptativo ≈ 0.35 * 0.8 = 0.28 (dentro de [0.10, 0.22]? Não!)
    // 0.28 > 0.22, então clampado para 0.22
    // EAR=0.15 < 0.22 → piscada
    expect(bd.update(0.15)).toBe(true);
  });

  it('threshold é clampado em [thrMin, thrMax]', () => {
    bd = new BlinkDetector({ minHistory: 3, blinkRatio: 0.8, thrMin: 0.10, thrMax: 0.22 });
    // Simula EAR muito alto (0.50) — threshold seria 0.40, mas deve ser clampado em 0.22
    for (let i = 0; i < 5; i++) bd.update(0.50);
    // EAR=0.20 deve ser piscada porque 0.20 < clamp(0.50*0.8=0.40, 0.10, 0.22)=0.22
    expect(bd.update(0.20)).toBe(true);
    // EAR=0.23 não é piscada
    expect(bd.update(0.23)).toBe(false);
  });

  it('reset() limpa o histórico completamente', () => {
    for (let i = 0; i < 10; i++) bd.update(0.30);
    expect(bd.nonBlinkCount).toBe(10);
    bd.reset();
    expect(bd.nonBlinkCount).toBe(0);
  });

  it('sem realimentação: piscadas frequentes não corrompem o threshold', () => {
    bd = new BlinkDetector({ histLen: 50, minHistory: 5, blinkRatio: 0.8, thrMin: 0.10, thrMax: 0.22 });
    // 5 frames de olho aberto: estabelece threshold
    for (let i = 0; i < 5; i++) bd.update(0.30);

    const thresholdAfterGood = 0.30 * 0.8; // = 0.24 → clampado a 0.22
    // 20 frames de piscada — NÃO devem entrar no histórico
    for (let i = 0; i < 20; i++) bd.update(0.05);

    // Histórico ainda deve ter só os 5 frames de olho aberto
    expect(bd.nonBlinkCount).toBe(5);

    // EAR=0.15 ainda deve ser piscada (threshold continua baseado nos 5 bons)
    expect(bd.update(0.15)).toBe(true);
    // EAR=0.23 não piscada (acima do teto clampado)
    expect(bd.update(0.23)).toBe(false);
  });
});

// ── Camada 3 do conforto visual: taxa de piscada por minuto ──────────────
// Alimentando esse contador com timestamps injetados dá teste determinístico
// (não depende de Date.now()). Cobre edge-detection e sliding window.
describe('Camada 3: BlinkDetector.getBlinkRatePerMinute', () => {
  let bd: BlinkDetector;
  const BASE = 1_000_000;                             // t0 arbitrário

  beforeEach(() => {
    // minHistory baixo pra threshold ficar utilizável rápido nos testes.
    bd = new BlinkDetector({ minHistory: 3, blinkRatio: 0.8, thrMin: 0.10, thrMax: 0.22 });
    for (let i = 0; i < 5; i++) bd.update(0.35, BASE - 10000 + i);   // aquece histórico com "olho aberto"
  });

  it('conta uma piscada por evento, não por frame', () => {
    // Uma piscada de 10 frames (~333ms a 30fps) deve contar como 1, não 10.
    for (let i = 0; i < 10; i++) bd.update(0.05, BASE + i * 33);
    // Reabre olho
    for (let i = 0; i < 5; i++) bd.update(0.35, BASE + 400 + i * 33);
    // Numa janela de 60s temos 1 piscada → 1 * (60000/60000) = 1.
    expect(bd.getBlinkRatePerMinute(60000, BASE + 1000)).toBe(1);
  });

  it('sliding window esquece eventos antigos', () => {
    // Piscada em t = BASE
    bd.update(0.05, BASE);
    bd.update(0.35, BASE + 200);
    // 90s depois: janela de 60s não vê a piscada antiga.
    expect(bd.getBlinkRatePerMinute(60000, BASE + 90000)).toBe(0);
    // Janela de 120s vê: 1 piscada em 120s → 0.5/min.
    expect(bd.getBlinkRatePerMinute(120000, BASE + 90000)).toBe(0.5);
  });

  it('escala para minuto conforme a janela', () => {
    // 3 piscadas nos primeiros 10s
    for (let i = 0; i < 3; i++) {
      bd.update(0.05, BASE + i * 2000);
      bd.update(0.35, BASE + i * 2000 + 100);
    }
    // Em janela de 10s temos 3 → 3 * (60000/10000) = 18/min
    expect(bd.getBlinkRatePerMinute(10000, BASE + 5500)).toBe(18);
  });

  it('reset limpa o histórico de piscadas', () => {
    for (let i = 0; i < 3; i++) {
      bd.update(0.05, BASE + i * 1000);
      bd.update(0.35, BASE + i * 1000 + 100);
    }
    expect(bd.getBlinkRatePerMinute(60000, BASE + 5000)).toBeGreaterThan(0);
    bd.reset();
    expect(bd.getBlinkRatePerMinute(60000, BASE + 5000)).toBe(0);
  });
});
