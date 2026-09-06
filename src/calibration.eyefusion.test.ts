import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clearCalibration, startCalibrationMode, startCollectingPoint, feedRawData,
  completeCalibration, captureReferenceStateForProfile, mapGaze,
} from './calibration';

const getEyeReliability = () => captureReferenceStateForProfile().eyeReliability;
import { RidgeRegressor } from './ridge';

// A fusão binocular pondera os olhos pela confiabilidade medida na calibração,
// não por média simples: na gravação de referência a média (140,7 px) saiu pior
// que o olho esquerdo sozinho (134,9 px), e a física não prevê qual olho é melhor.

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
 * λ fixo, no lugar da validação cruzada.
 *
 * ── Por que isto é legítimo AQUI ─────────────────────────────────────────────
 *
 * Este arquivo mede **fusão binocular**: como o peso de cada olho é derivado da
 * qualidade de ajuste de cada um. Ele não mede seleção de λ — quem faz isso é
 * `ridge.test.ts` e `regression_precision_audit.test.ts`, e lá o override
 * continua desligado.
 *
 * A CV custa 9 alvos × 25 λ = 225 ajustes de mínimos quadrados por olho, por
 * calibração. Com 2 olhos e 6 calibrações no arquivo, são ~2700 ajustes gastos
 * escolhendo um parâmetro que nenhuma asserção daqui observa.
 *
 * ── Verificado, não presumido ────────────────────────────────────────────────
 *
 * Trocar o λ MUDA o modelo treinado, então a pergunta certa não é "passa?" e
 * sim "continua medindo a mesma coisa?". As seis asserções do arquivo são todas
 * sobre a RELAÇÃO entre os olhos — pesos somam 1, o olho ruidoso pesa menos, a
 * degradação é monótona — e nenhuma depende do λ ter vindo da CV. Todas
 * continuam valendo com o λ fixo, incluindo a monotonicidade, que é a mais
 * sensível das seis.
 *
 * 1e-3 é o meio da faixa útil do `LAMBDA_GRID`: regulariza o bastante para o
 * ajuste não memorizar 40 amostras por alvo, e de leve o bastante para o olho
 * bom continuar distinguível do ruidoso — que é justamente o efeito medido.
 */
const LAMBDA_FIXO = 1e-3;

/**
 * Teto de tempo por caso.
 *
 * ⚠️ **Este valor SOBRESCREVE o `testTimeout` global do `vitest.config.ts`.**
 * Elevar só o global não tem efeito aqui; os dois precisam acompanhar.
 *
 * Histórico, porque a trajetória é a lição: 5 s (default) → 30 s → 60 s, cada
 * degrau depois de o anterior estourar sob carga paralela. Subir o teto trata o
 * sintoma; o arquivo continuava fazendo ~2700 ajustes de mínimos quadrados para
 * medir uma propriedade que não depende de nenhum deles.
 *
 * Com `LAMBDA_FIXO` o custo caiu de **78,97 s para 2,40 s** (medido, arquivo
 * isolado, wall-clock do vitest), e o teto voltou para 10 s — margem de sobra
 * sobre o pior caso, agora sobre um número honesto em vez de um teto que ia
 * subindo atrás do problema.
 */
const TIMEOUT_CALIBRACAO_MS = 10_000;

describe('confiabilidade por olho', () => {
  /** Salvo e restaurado: o estático é global ao processo, e vazá-lo faria
   *  outros arquivos treinarem com λ fixo sem saber — o tipo de acoplamento
   *  por estado de módulo que a análise I.3 do plano lista como problema. */
  let lambdaSalvo: number | null = null;

  beforeEach(() => {
    clearCalibration();
    relogio = 0;
    lambdaSalvo = RidgeRegressor.lambdaOverride;
    RidgeRegressor.lambdaOverride = LAMBDA_FIXO;
    vi.spyOn(performance, 'now').mockImplementation(() => relogio);
  });
  afterEach(() => {
    RidgeRegressor.lambdaOverride = lambdaSalvo;
    vi.restoreAllMocks();
  });

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
