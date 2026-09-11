import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MAX_AMOSTRAS_POR_CELULA,
  abortCalibration,
  clearCalibration,
  definirAlvoDaPerseguicao,
  feedRawData,
  finalizarPerseguicao,
  iniciarPerseguicao,
  startCalibrationMode,
  startCollectingPoint,
} from './calibration';
import { posicaoNaTrajetoria } from './calibration/perseguicao';
/**
 * A ponte entre a perseguição e o resto da calibração: é aqui que o rótulo
 * contínuo vira perfil de treino, e é aqui que os modos de falha caros moram —
 * agrupamento por amostra, buffer que nunca para de crescer, e uma calibração
 * por pontos morta em silêncio.
 */

/** Vetor de features plausível para um olhar em `(fx, fy)` de tela. */
function features(fx: number, fy: number, ruido = 0): number[] {
  const v = new Array(44).fill(0);
  v[0] = 0.1 + fx * 0.3 + ruido;
  v[1] = 0.1 + fy * 0.3 + ruido;
  v[2] = fx;
  v[3] = fy;
  // Bloco angular não-nulo, para o quadro não contar como "L2CS zerado".
  for (let i = 37; i < 44; i++) v[i] = 0.01 * (i - 36) + fx * 0.001;
  return v;
}

function ruidoDeterministico(semente: number) {
  let e = semente >>> 0;
  return () => {
    e = (e * 1664525 + 1013904223) >>> 0;
    return e / 0xffffffff - 0.5;
  };
}

/** Alimenta uma perseguição de `n` quadros; `segue` decide se o olhar obedece. */
function perseguir(n: number, segue: (i: number) => boolean = () => true) {
  const r = ruidoDeterministico(99);
  const duracao = n * 33;
  for (let i = 0; i < n; i++) {
    const alvo = posicaoNaTrajetoria(i * 33, duracao);
    definirAlvoDaPerseguicao(alvo.x, alvo.y);
    const olhar = segue(i) ? alvo : { x: 0.5, y: 0.5 };
    const f = features(olhar.x, olhar.y, r() * 0.001);
    feedRawData(f, f, {
      irisVisibilityPercentage: 0.9,
      detectorConfidence: 0.95,
      brightnessEstimate: 0.45,
      contrastEstimate: 0.25,
      blurEstimate: 0.2,
    });
  }
}

/**
 * Relógio de teste.
 *
 * `feedRawData` carimba cada amostra de perseguição com `performance.now()`, e
 * num laço de teste os 150 quadros chegam no MESMO instante — nenhum trecho
 * teria duração, e o piso de meio segundo por trecho descartaria tudo. Aqui
 * cada leitura avança 33 ms, que é o intervalo real a 30 Hz.
 */
let relogioMs = 0;
const relogioReal = performance.now.bind(performance);

beforeEach(() => {
  clearCalibration();
  relogioMs = 1000;
  vi.spyOn(performance, 'now').mockImplementation(() => {
    relogioMs += 33;
    return relogioMs;
  });
});

afterEach(() => {
  vi.mocked(performance.now).mockRestore?.();
  performance.now = relogioReal;
});

describe('perseguição ligada à calibração', () => {
  it('quem segue o alvo produz amostras aproveitadas', () => {
    expect(iniciarPerseguicao()).toBe(true);
    perseguir(150);
    const r = finalizarPerseguicao();
    expect(r.vistos).toBe(150);
    expect(r.utilizavel).toBe(true);
    expect(r.aproveitados).toBeGreaterThan(50);
    expect(r.fracaoSeguida).toBeGreaterThan(0.7);
  });

  it('quem não consegue perseguir é descartado INTEIRO, não aproveitado pela metade', () => {
    // A proteção clínica: em ELA avançada a perseguição degrada antes da
    // fixação, e treinar com o que sobrou entregaria um modelo ruim calado.
    iniciarPerseguicao();
    perseguir(150, () => false);
    const r = finalizarPerseguicao();
    expect(r.utilizavel).toBe(false);
    expect(r.aproveitados).toBe(0);
  });

  it('o número de GRUPOS fica na casa das dezenas, não das centenas', () => {
    // O modo de falha caro: rótulo contínuo usado também como grupo daria um
    // grupo por amostra, o leave-one-target-out viraria leave-one-sample-out e
    // o treino explodiria em tempo e memória.
    iniciarPerseguicao();
    perseguir(600);
    const r = finalizarPerseguicao();
    // Com o teto por célula, 600 quadros não viram 600 amostras de treino.
    expect(r.aproveitados).toBeLessThanOrEqual(MAX_AMOSTRAS_POR_CELULA * 25);
    expect(r.aproveitados).toBeLessThan(600);
  });

  it('abortar no meio não deixa o buffer crescendo para sempre', () => {
    // A guarda da perseguição em `feedRawData` vem ANTES do teste de
    // `isCalibrating`: sem limpeza no abort, TODO quadro seguinte do app
    // continuaria sendo empurrado no buffer, sem teto.
    iniciarPerseguicao();
    perseguir(30);
    abortCalibration();
    perseguir(200); // depois do abort, nada disso pode ser guardado
    const r = finalizarPerseguicao();
    expect(r.vistos).toBe(0);
    expect(r.utilizavel).toBe(false);
  });

  it('não sequestra uma calibração por pontos em curso', () => {
    startCalibrationMode();
    startCollectingPoint(0.5, 0.5, () => undefined);
    expect(iniciarPerseguicao()).toBe(false);
    abortCalibration();
  });

  it('finalizar sem perseguição em curso não mata a calibração por pontos', () => {
    startCalibrationMode();
    const r = finalizarPerseguicao();
    expect(r.vistos).toBe(0);
    expect(r.utilizavel).toBe(false);
    // A chamada por engano não pode ter encerrado a calibração de pontos.
    startCollectingPoint(0.5, 0.5, () => undefined);
    const f = features(0.5, 0.5);
    expect(() => feedRawData(f, f, null)).not.toThrow();
    abortCalibration();
  });

  it('quadro sem alvo definido não vira amostra sem rótulo', () => {
    iniciarPerseguicao();
    const f = features(0.5, 0.5);
    feedRawData(f, f, null); // nenhum `definirAlvoDaPerseguicao` antes
    const r = finalizarPerseguicao();
    expect(r.vistos).toBe(0);
  });
});
