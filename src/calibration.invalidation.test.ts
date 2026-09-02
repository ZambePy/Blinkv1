import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  mapGaze, isCalibrated, clearCalibration,
  getCalibrationInvalidation, clearCalibrationInvalidation, onCalibrationInvalidated,
  startCalibrationMode, startCollectingPoint, feedRawData, completeCalibration,
} from './calibration';
import { EXPERIMENT } from './config/experiment';

// 0.2 — dimensão incompatível deve DESCARTAR a calibração e avisar, em vez de
// devolver null a 30 Hz para sempre.
//
// O cenário real: um perfil salvo antes da redução de 44 para 12 dims era
// considerado compatível por `buildContextKey` (que não codificava o pipeline),
// carregado, e só falhava dentro de `predictRidge`. O engine ia para `degraded`,
// o cursor caía no fallback do nariz, e nada dizia ao usuário que a saída era
// recalibrar.

/** PRNG determinístico — o ruído intra-alvo precisa existir (a penalidade Σ_W
 *  do Ridge é construída sobre ele) e precisa ser reprodutível. */
function prng(seed: number): () => number {
  let a = seed;
  return () => { a = (a * 1103515245 + 12345) & 0x7fffffff; return a / 0x7fffffff - 0.5; };
}

/** Treina um modelo real com vetores de `dims` dimensões.
 *
 *  Cada dimensão responde a x e y com coeficientes DIFERENTES. Um gerador
 *  ingênuo (`x·(d+1)·a + y·(d+1)·b`) faz toda dimensão ser múltiplo escalar da
 *  mesma combinação: a matriz vira singular e o treino falha em silêncio, com
 *  `isCalibrated()` devolvendo false e o teste medindo outra coisa. */
function calibrarCom(dims: number): void {
  const alvos = [
    { x: 0.2, y: 0.2 }, { x: 0.5, y: 0.2 }, { x: 0.8, y: 0.2 },
    { x: 0.2, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.8, y: 0.5 },
    { x: 0.2, y: 0.8 }, { x: 0.5, y: 0.8 }, { x: 0.8, y: 0.8 },
  ];
  const rnd = prng(42);
  // Num teste síncrono `performance.now()` não avança, e a coleta depende dele
  // em dois pontos: descarta os primeiros 400 ms (fase de sacada) e só chama
  // `processStaticPoint` — que é quem move as amostras para o `profile` —
  // quando passa de `currentCollectionMs` (1680 a 2800 ms). Sem avançar o
  // relógio o suficiente para CRUZAR esse teto, o perfil sai vazio mesmo com
  // frames aceitos: eles ficam presos no buffer do ponto.
  //
  // Passo de 80 ms × 40 amostras cobre 3,2 s. Descarta as 5 primeiras
  // (acomodação < 400 ms) e aceita ~17 antes do ponto fechar em 1680 ms — acima
  // de MIN_ACCEPTED_SAMPLES (15), que passou a rejeitar pontos ralos em 1.1.
  let relogio = 0;
  const spy = vi.spyOn(performance, 'now').mockImplementation(() => (relogio += 80));
  startCalibrationMode();
  for (const t of alvos) {
    startCollectingPoint(t.x, t.y, () => {});
    for (let i = 0; i < 40; i++) {
      const v = Array.from({ length: dims }, (_, d) =>
        Math.sin(d * 1.7 + 0.3) * t.x + Math.cos(d * 2.3 + 1.1) * t.y + rnd() * 0.01);
      const w = Array.from({ length: dims }, (_, d) =>
        Math.cos(d * 1.3 + 0.7) * t.x + Math.sin(d * 1.9 + 0.2) * t.y + rnd() * 0.01);
      feedRawData(v, w, null);
    }
  }
  completeCalibration();
  spy.mockRestore();
}

describe('mapGaze — dimensão incompatível', () => {
  beforeEach(() => {
    clearCalibration();
    clearCalibrationInvalidation();
    // Desliga expansão polinomial — estes testes verificam detecção de
    // dimensão incompatível com pipeline linear (8 dims). Com polynomialFeatures=true
    // o treino com 9 alvos × 44 features ultrapassa o timeout de 5 s do teste.
    (EXPERIMENT as { polynomialFeatures: boolean }).polynomialFeatures = false;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    (EXPERIMENT as { polynomialFeatures: boolean }).polynomialFeatures = true;
  });

  it('vetor com a dimensão certa prediz normalmente', () => {
    calibrarCom(8);
    expect(isCalibrated()).toBe(true);
    const v = Array.from({ length: 8 }, (_, d) => Math.sin(d * 1.7 + 0.3) * 0.3 + Math.cos(d * 2.3 + 1.1) * 0.4);
    const w = Array.from({ length: 8 }, (_, d) => Math.cos(d * 1.3 + 0.7) * 0.3 + Math.sin(d * 1.9 + 0.2) * 0.4);
    expect(mapGaze(v, w)).not.toBeNull();
    expect(getCalibrationInvalidation()).toBeNull();
  });

  it('vetor com dimensão errada descarta a calibração', () => {
    calibrarCom(8);
    expect(isCalibrated()).toBe(true);

    const errado = Array.from({ length: 12 }, () => 0.1);
    expect(mapGaze(errado, errado.slice())).toBeNull();

    // O ponto central: não fica tentando para sempre.
    expect(isCalibrated()).toBe(false);
  });

  it('registra o motivo, para a UI poder pedir recalibração', () => {
    calibrarCom(8);
    const errado = Array.from({ length: 12 }, () => 0.1);
    mapGaze(errado, errado.slice());

    const inv = getCalibrationInvalidation();
    expect(inv).not.toBeNull();
    expect(inv!.reason).toBe('feature_dim_mismatch');
    expect(inv!.detail).toMatch(/dimens/i);
  });

  it('notifica quem assinou o evento', () => {
    const vistos: string[] = [];
    const off = onCalibrationInvalidated((e) => vistos.push(e.reason));
    calibrarCom(8);
    const errado = Array.from({ length: 12 }, () => 0.1);
    mapGaze(errado, errado.slice());
    off();
    expect(vistos).toEqual(['feature_dim_mismatch']);
  });

  it('listener que lança não derruba o loop de rastreamento', () => {
    const off = onCalibrationInvalidated(() => { throw new Error('listener ruim'); });
    calibrarCom(8);
    const errado = Array.from({ length: 12 }, () => 0.1);
    expect(() => mapGaze(errado, errado.slice())).not.toThrow();
    off();
  });
});

// 0.2 — falha silenciosa que o teste acima expôs por acidente.
//
// `trainRidgeModel` não lança com perfil vazio: devolve um modelo com
// `numFeatures: 0`. Sem preflight, `completeCalibration` reportava `ok: true`,
// a UI exibia "Calibração Concluída", e só o primeiro `mapGaze` revelava o
// problema — estourando com "modelo treinado com 0 features".
describe('completeCalibration — preflight de amostras', () => {
  beforeEach(() => { clearCalibration(); clearCalibrationInvalidation(); });
  afterEach(() => { vi.restoreAllMocks(); });

  it('perfil vazio NÃO reporta sucesso', () => {
    startCalibrationMode();
    let outcome: unknown = null;
    completeCalibration((o) => { outcome = o; });
    expect(outcome).toMatchObject({ ok: false, reason: 'insufficient_samples' });
    expect(isCalibrated()).toBe(false);
  });

  it('menos de 3 alvos únicos também é insuficiente', () => {
    let relogio = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (relogio += 80));
    startCalibrationMode();
    for (const t of [{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.7 }]) {
      startCollectingPoint(t.x, t.y, () => {});
      for (let i = 0; i < 40; i++) {
        const v = Array.from({ length: 8 }, (_, d) => Math.sin(d) * t.x + Math.cos(d) * t.y);
        feedRawData(v, v.slice(), null);
      }
    }
    let outcome: unknown = null;
    completeCalibration((o) => { outcome = o; });
    expect(outcome).toMatchObject({ ok: false, reason: 'insufficient_samples' });
  });

  it('a mensagem diz quantas amostras e quantos alvos — diagnóstico acionável', () => {
    startCalibrationMode();
    let outcome: { ok: boolean; detail?: string } | null = null;
    completeCalibration((o) => { outcome = o as never; });
    expect(outcome!.detail).toMatch(/0 amostra/);
    expect(outcome!.detail).toMatch(/Mínimo: 3 alvos/);
  });
});
