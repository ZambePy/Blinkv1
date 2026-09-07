import { describe, it, expect } from 'vitest';
import { buildL2CSBlock, ultimoDiagnosticoDoBloco, L2CS_CONFIDENCE_MIN } from './block';

/**
 * As três causas de bloco zerado produzem sete zeros idênticos. Quem consome o
 * vetor (a calibração) só via "tudo zero" e reportava as três como "o sistema
 * perdeu o olhar" — que só descreve UMA delas. Culpar o olhar do paciente por
 * um limiar de confiança do modelo faz a pessoa tentar se mexer menos, sem
 * efeito nenhum, porque a causa não é movimento.
 */
describe('buildL2CSBlock — motivo do bloco zerado', () => {
  const DIST = 1;
  const zerado = (b: number[]) => b.every((v) => v === 0);

  it('leitura obsoleta é "stale"', () => {
    expect(zerado(buildL2CSBlock(0.1, 0.1, false, DIST, 0.9))).toBe(true);
    expect(ultimoDiagnosticoDoBloco().motivo).toBe('stale');
  });

  it('ângulo fora da faixa é "implausivel", com o pitch em graus', () => {
    // 0,9 rad ≈ 51°, acima do limite de plausibilidade (~35°).
    expect(zerado(buildL2CSBlock(0.1, 0.9, true, DIST, 0.9))).toBe(true);
    const d = ultimoDiagnosticoDoBloco();
    expect(d.motivo).toBe('implausivel');
    expect(Math.abs(d.pitchDeg)).toBeGreaterThan(50);
  });

  it('softmax difusa é "confianca", e carrega o valor medido', () => {
    const conf = L2CS_CONFIDENCE_MIN - 0.01;
    expect(zerado(buildL2CSBlock(0.05, 0.05, true, DIST, conf))).toBe(true);
    const d = ultimoDiagnosticoDoBloco();
    expect(d.motivo).toBe('confianca');
    expect(d.confidence).toBeCloseTo(conf, 5);
  });

  it('bloco válido não marca motivo', () => {
    expect(zerado(buildL2CSBlock(0.05, 0.05, true, DIST, 0.9))).toBe(false);
    expect(ultimoDiagnosticoDoBloco().motivo).toBeNull();
  });
});
