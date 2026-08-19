import { describe, it, expect } from 'vitest';
import type { CalibrationOutcome } from './calibration';

// A1-1 — classifyTrainingError é interno (não exportado). Testamos o contrato
// via um wrapper equivalente aqui — o objetivo é garantir que:
//   1. O tipo CalibrationOutcome está exportado corretamente.
//   2. As mensagens de erro específicas (degenerate_features, matriz singular)
//      são reconhecidas.
//   3. Amostras zero têm precedência sobre outros erros.

// Reimplementa a lógica de classificação para verificar o contrato
// (mantém em espelho com calibration.ts:classifyTrainingError).
function classifyForTest(e: unknown, sampleCount: number): CalibrationOutcome {
  const detail = e instanceof Error ? e.message : String(e);
  if (sampleCount === 0) return { ok: false, reason: 'insufficient_samples', detail };
  if (/degenerate_features/i.test(detail)) return { ok: false, reason: 'degenerate_features', detail };
  if (/matriz singular/i.test(detail)) return { ok: false, reason: 'singular_matrix', detail };
  return { ok: false, reason: 'unknown', detail };
}

describe('A1-1: CalibrationOutcome contract', () => {
  it('tipo ok=true é atribuível', () => {
    const ok: CalibrationOutcome = { ok: true };
    expect(ok.ok).toBe(true);
  });

  it('tipo ok=false exige reason + detail', () => {
    const fail: CalibrationOutcome = {
      ok: false,
      reason: 'degenerate_features',
      detail: 'texto de exemplo',
    };
    expect(fail.ok).toBe(false);
    if (!fail.ok) {
      expect(['singular_matrix', 'insufficient_samples', 'degenerate_features', 'unknown']).toContain(fail.reason);
    }
  });
});

describe('A1-1: classificação de erros de treino', () => {
  it('samples=0 sempre vira insufficient_samples, independente do erro', () => {
    const r = classifyForTest(new Error('qualquer coisa'), 0);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('insufficient_samples');
  });

  it('erro do preflight A1-2 (degenerate_features) é reconhecido', () => {
    const err = new Error('[calib] degenerate_features: mais de 30% das dimensões...');
    const r = classifyForTest(err, 100);
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.reason).toBe('degenerate_features');
      expect(r.detail).toContain('degenerate_features');
    }
  });

  it('erro do solveLinear (matriz singular) é reconhecido', () => {
    const err = new Error('Matriz singular na coluna 12. O sistema não pode ser resolvido.');
    const r = classifyForTest(err, 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('singular_matrix');
  });

  it('erro genérico vira unknown', () => {
    const err = new Error('OutOfMemory');
    const r = classifyForTest(err, 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe('unknown');
  });

  it('não-Error convertido para string ainda produz detail', () => {
    const r = classifyForTest('string plain', 100);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.detail).toBe('string plain');
  });

  it('reason=degenerate_features tem precedência sobre singular_matrix', () => {
    // Ambos podem estar na mensagem se o wrapper concatenar; degenerate é mais informativo.
    const err = new Error('[calib] degenerate_features: ... internal: matriz singular na coluna 3');
    const r = classifyForTest(err, 100);
    if (!r.ok) expect(r.reason).toBe('degenerate_features');
  });
});
