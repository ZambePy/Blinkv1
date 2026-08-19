// Testes para A3-1 — módulo de invariantes explícitas.
// Verificam: lançamento em NODE_ENV=test, acumulação em produção,
// e cada uma das 5 invariantes instrumentadas.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  assertInvariant,
  assertFeatureDim,
  assertFiniteFeatures,
  assertScalerFitted,
  assertScreenUnchanged,
  assertCalibrationClaimedOk,
  getInvariantViolations,
  clearInvariantViolations,
  InvariantError,
} from './invariants';

// NODE_ENV=test é verdadeiro em Vitest — assertInvariant deve lançar.

describe('A3-1: assertInvariant', () => {
  beforeEach(() => clearInvariantViolations());

  it('não faz nada quando cond=true', () => {
    expect(() => assertInvariant(true, 'FEATURE_DIM', 'ok')).not.toThrow();
    expect(getInvariantViolations()).toHaveLength(0);
  });

  it('lança InvariantError quando cond=false (NODE_ENV=test)', () => {
    expect(() => assertInvariant(false, 'FEATURE_DIM', 'dims diferentes')).toThrow(InvariantError);
  });

  it('InvariantError tem o código correto', () => {
    let err: unknown;
    try { assertInvariant(false, 'FINITE_FEATURES', 'NaN detectado'); }
    catch (e) { err = e; }
    expect(err).toBeInstanceOf(InvariantError);
    expect((err as InvariantError).code).toBe('FINITE_FEATURES');
  });

  it('InvariantError.message contém código e detalhe', () => {
    let msg = '';
    try { assertInvariant(false, 'SCALER_FITTED', 'sem treino'); }
    catch (e) { msg = (e as Error).message; }
    expect(msg).toContain('SCALER_FITTED');
    expect(msg).toContain('sem treino');
  });
});

describe('A3-1: assertFeatureDim', () => {
  beforeEach(() => clearInvariantViolations());

  it('não lança quando dims iguais', () => {
    expect(() => assertFeatureDim(44, 44)).not.toThrow();
  });

  it('lança quando dims diferentes', () => {
    expect(() => assertFeatureDim(44, 51)).toThrow(InvariantError);
  });
});

describe('A3-1: assertFiniteFeatures', () => {
  beforeEach(() => clearInvariantViolations());

  it('não lança para array de números finitos', () => {
    expect(() => assertFiniteFeatures([1, 2, 3, 0.5, -1.7], 'L')).not.toThrow();
  });

  it('lança se houver NaN', () => {
    expect(() => assertFiniteFeatures([1, NaN, 3], 'L')).toThrow(InvariantError);
  });

  it('lança se houver Infinity', () => {
    expect(() => assertFiniteFeatures([1, 2, Infinity], 'R')).toThrow(InvariantError);
  });

  it('lança se houver -Infinity', () => {
    expect(() => assertFiniteFeatures([-Infinity, 2, 3], 'L')).toThrow(InvariantError);
  });
});

describe('A3-1: assertScalerFitted', () => {
  beforeEach(() => clearInvariantViolations());

  it('não lança quando fitted=true', () => {
    expect(() => assertScalerFitted(true, 'L')).not.toThrow();
  });

  it('lança quando fitted=false', () => {
    expect(() => assertScalerFitted(false, 'R')).toThrow(InvariantError);
  });
});

describe('A3-1: assertScreenUnchanged', () => {
  beforeEach(() => clearInvariantViolations());

  it('não lança quando resolução igual', () => {
    expect(() => assertScreenUnchanged(1920, 1080, 1920, 1080)).not.toThrow();
  });

  it('lança quando width difere', () => {
    expect(() => assertScreenUnchanged(1920, 1080, 2560, 1080)).toThrow(InvariantError);
  });

  it('lança quando height difere', () => {
    expect(() => assertScreenUnchanged(1920, 1080, 1920, 1440)).toThrow(InvariantError);
  });
});

describe('A3-1: assertCalibrationClaimedOk (regra 3 do plano em código)', () => {
  beforeEach(() => clearInvariantViolations());

  it('não lança quando isCalibrated=true', () => {
    expect(() => assertCalibrationClaimedOk(true)).not.toThrow();
  });

  it('lança quando isCalibrated=false — bug dos óculos pré-A1-1', () => {
    // Este é o cenário exato do bug: UI declara "Calibração Concluída" mas
    // o regressor não treinado. assertCalibrationClaimedOk(false) deve lançar
    // em test, expondo a desconexão entre UI e estado interno.
    expect(() => assertCalibrationClaimedOk(false)).toThrow(InvariantError);
  });
});
