import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clearCalibration, startCalibrationMode, startCollectingPoint, feedRawData,
  consumeLastSampleDecision, getResumoDoPonto,
} from './calibration';

/**
 * Contrato depois da remoção dos gates de amostra na calibração.
 *
 * Antes, um bloco angular zerado (L2CS stale, ângulo implausível ou softmax
 * difusa) descartava a amostra. Na prática isso derrubava a linha INFERIOR da
 * grade inteira — é onde a pálpebra cobre a íris — e os alvos de baixo eram
 * pulados por esgotar as tentativas, deixando o modelo extrapolar aquela
 * região. A remoção troca "sem a linha de baixo" por "com a linha de baixo,
 * parte dela com bloco angular zerado".
 *
 * Este teste existe para que a volta do gate seja uma decisão, não um acidente.
 */
describe('calibração sem gates de amostra', () => {
  let relogio = 0;
  beforeEach(() => {
    clearCalibration();
    relogio = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (relogio += 80));
  });
  afterEach(() => { vi.restoreAllMocks(); });

  /** 6 dims (irisCore+l2cs); os slots [4] e [5] são o bloco angular. */
  const comBloco = (angular: number) => [0.1, 0.2, 0.3, 0.4, angular, angular];
  const pose = { yaw: 0.1, pitch: -0.05, roll: 0.01 };

  function primeiraDecisao(features: number[]) {
    startCalibrationMode();
    startCollectingPoint(0.5, 0.5, () => {});
    for (let i = 0; i < 12; i++) {
      feedRawData(features, features, { ...pose });
      const d = consumeLastSampleDecision();
      if (d && d.reason !== 'acclimation') return d;
    }
    return consumeLastSampleDecision();
  }

  it('amostra com bloco angular ZERADO é aceita', () => {
    expect(primeiraDecisao(comBloco(0))?.accepted).toBe(true);
  });

  it('amostra com bloco angular válido continua aceita', () => {
    expect(primeiraDecisao(comBloco(0.42))?.accepted).toBe(true);
  });

  it('o bloco zerado continua sendo CONTADO para o diagnóstico', () => {
    primeiraDecisao(comBloco(0));
    expect(getResumoDoPonto().porL2cs).toBeGreaterThan(0);
  });

  // A rejeição do PONTO também saiu: um alvo com poucas amostras era refeito
  // e, esgotadas as tentativas, PULADO — que é como a linha de baixo da grade
  // sumia do treino inteiro.
  it('ponto com menos que o mínimo é ACEITO, não refeito', () => {
    let resultado: boolean | null = null;
    startCalibrationMode();
    startCollectingPoint(0.5, 0.9, (ok) => { resultado = ok; });
    // Poucos quadros úteis: acomodação (600 ms) come os primeiros, e paramos
    // bem antes das 15 amostras de referência.
    for (let i = 0; i < 11; i++) feedRawData(comBloco(0), comBloco(0), { ...pose });
    // Estoura a janela do ponto para forçar o fechamento.
    for (let i = 0; i < 60; i++) feedRawData(comBloco(0), comBloco(0), { ...pose });
    expect(resultado).toBe(true);
  });

  it('nenhuma amostra sai com motivo de rejeição', () => {
    for (const f of [comBloco(0), comBloco(0.42)]) {
      const d = primeiraDecisao(f);
      expect(d?.reason).not.toBe('quality');
      expect(d?.reason).not.toBe('l2cs_invalid');
    }
  });
});
