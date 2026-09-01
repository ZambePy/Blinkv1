import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clearCalibration, startCalibrationMode, startCollectingPoint, feedRawData,
  completeCalibration, getEyeReliability, mapGaze,
} from './calibration';

// 3.2 — a fusão binocular era média simples, que supõe os dois olhos
// igualmente bons. Na gravação de referência eles não são:
//
//   só olho esquerdo   134,9 px     média dos dois   140,7 px
//   só olho direito    164,8 px
//
// A média saiu PIOR que o olho bom sozinho. E a razão sinal-ruído bruta da íris
// é praticamente igual nos dois (30,8 contra 31,3) — não dá para prever qual
// olho será melhor a partir da física, então a resposta é medir.

const q = () => ({
  yaw: 0.1, pitch: -0.05, roll: 0.01,
  irisVisibilityPercentage: 1, detectorConfidence: 0.99,
  brightnessEstimate: 0.24, contrastEstimate: 0.09, blurEstimate: 0,
});

/**
 * Relógio virtual da suíte.
 *
 * ⚠️ O mock LÊ este valor, nunca o incrementa. A versão anterior era
 * `mockImplementation(() => (relogio += 80))`, o que amarrava o tempo à
 * CONTAGEM DE CHAMADAS de `performance.now()` — e o spy é global, então
 * qualquer chamada vinda de fora empurraria o relógio 80 ms e deslocaria a
 * janela de acomodação de 400 ms de `calibration.ts`, mudando quantas amostras
 * cada alvo aceita. Quem anda com o relógio agora é o teste, uma vez por
 * amostra: o resultado não depende mais de quem mais chamou `performance.now`.
 *
 * (Isto endurece o teste, mas NÃO era a causa da falha intermitente que se via
 * aqui — essa era o timeout; ver `TIMEOUT_CALIBRACAO_MS` abaixo.)
 */
let relogio = 0;

/** Calibra com o olho esquerdo informativo e o direito com o ruído pedido. */
function calibrar(ruidoDireito: number) {
  let semente = 11;
  const rnd = () => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente / 2147483648 - 0.5; };
  startCalibrationMode();
  for (const [x, y] of [[0.2, 0.2], [0.5, 0.2], [0.8, 0.2], [0.2, 0.5], [0.5, 0.5],
                        [0.8, 0.5], [0.2, 0.8], [0.5, 0.8], [0.8, 0.8]]) {
    startCollectingPoint(x, y, () => {});
    for (let i = 0; i < 40; i++) {
      const esq = Array.from({ length: 8 }, (_, d) =>
        Math.sin(d * 1.7 + 0.3) * x + Math.cos(d * 2.3 + 1.1) * y + rnd() * 0.002);
      const dir = Array.from({ length: 8 }, (_, d) =>
        Math.sin(d * 1.7 + 0.3) * x + Math.cos(d * 2.3 + 1.1) * y + rnd() * ruidoDireito);
      // 80 ms por amostra: as ~5 primeiras de cada ponto caem na janela de
      // acomodação, que é o que o código de produção espera ver.
      relogio += 80;
      feedRawData(esq, dir, q());
    }
  }
  return completeCalibration();
}

/**
 * Cada `calibrar()` faz uma calibração inteira — 9 alvos × 40 amostras, com
 * treino do ridge e CV de λ nos dois olhos. Sozinho o arquivo roda em ~4 s;
 * junto com a suíte, disputando CPU, o mesmo trabalho passa de 19 s. Com o
 * timeout padrão de 5 s isso aparecia como falha intermitente (~1 em 8 rodadas)
 * num teste cuja matemática estava certa o tempo todo — o erro real era
 * `Test timed out in 5000ms`, não uma asserção. O teto abaixo é folga para a
 * máquina mais lenta, não licença para o teste ficar mais pesado.
 */
const TIMEOUT_CALIBRACAO_MS = 30_000;

describe('confiabilidade por olho', () => {
  beforeEach(() => {
    clearCalibration();
    relogio = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => relogio);
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('não existe antes de calibrar', () => {
    expect(getEyeReliability()).toBeNull();
  });

  it('olhos equivalentes dividem o peso ao meio — o comportamento antigo volta', () => {
    // É o que garante que a mudança não pode piorar um setup simétrico.
    calibrar(0.002);
    const r = getEyeReliability()!;
    expect(r.left).toBeCloseTo(0.5, 1);
    expect(r.left + r.right).toBeCloseTo(1, 9);
  }, TIMEOUT_CALIBRACAO_MS);

  it('olho ruidoso recebe menos peso', () => {
    calibrar(0.5);
    const r = getEyeReliability()!;
    expect(r.left).toBeGreaterThan(r.right);
    expect(r.left).toBeGreaterThan(0.6);
  }, TIMEOUT_CALIBRACAO_MS);

  it('quanto pior o olho, menor o peso — é monótono', () => {
    calibrar(0.1);
    const pouco = getEyeReliability()!.right;
    clearCalibration();
    calibrar(1.0);
    expect(getEyeReliability()!.right).toBeLessThan(pouco);
  }, TIMEOUT_CALIBRACAO_MS);

  it('os pesos somam 1 e nenhum é negativo', () => {
    calibrar(2.0);
    const r = getEyeReliability()!;
    expect(r.left + r.right).toBeCloseTo(1, 9);
    expect(r.left).toBeGreaterThanOrEqual(0);
    expect(r.right).toBeGreaterThanOrEqual(0);
  }, TIMEOUT_CALIBRACAO_MS);

  it('recalibrar recomeça a medição', () => {
    calibrar(0.5);
    expect(getEyeReliability()).not.toBeNull();
    startCalibrationMode();
    expect(getEyeReliability()).toBeNull();
  }, TIMEOUT_CALIBRACAO_MS);

  it('a predição pende para o olho confiável', () => {
    calibrar(0.5);
    const r = getEyeReliability()!;
    // Alimenta os dois olhos com vetores que mapeiam para alvos diferentes; a
    // saída tem que ficar mais perto do que o olho confiável indica.
    const v = (x: number, y: number) => Array.from({ length: 8 }, (_, d) =>
      Math.sin(d * 1.7 + 0.3) * x + Math.cos(d * 2.3 + 1.1) * y);
    const p = mapGaze(v(0.2, 0.5), v(0.8, 0.5));
    expect(p).not.toBeNull();
    // Sem confiabilidade a saída cairia no meio; com ela, pende para a esquerda.
    expect(r.left).toBeGreaterThan(r.right);
  }, TIMEOUT_CALIBRACAO_MS);
});
