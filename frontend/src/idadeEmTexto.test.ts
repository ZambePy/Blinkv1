import { describe, it, expect } from 'vitest';
import { idadeEmTexto, SEM_DATA } from './idadeEmTexto';

// -----------------------------------------------------------------------------
// "há 3 dias" é o que decide se vale reaproveitar uma calibração.
//
// O cálculo estava cravado dentro do `CalibrationCheck`, e o menu precisa do
// MESMO texto. Duas cópias divergem no primeiro ajuste — uma diria "há 1 dia" e
// a outra "de ontem" para o mesmo carimbo, e o cuidador não saberia em qual
// acreditar.
// -----------------------------------------------------------------------------

const AGORA = new Date('2026-09-07T12:00:00Z').getTime();
const DIA = 24 * 60 * 60 * 1000;

describe('idades comuns', () => {
  it('agora mesmo é "de hoje"', () => {
    expect(idadeEmTexto(AGORA, AGORA)).toBe('de hoje');
  });

  it('algumas horas atrás ainda é "de hoje"', () => {
    expect(idadeEmTexto(AGORA - 5 * 60 * 60 * 1000, AGORA)).toBe('de hoje');
  });

  it('um dia atrás é "de ontem"', () => {
    expect(idadeEmTexto(AGORA - DIA, AGORA)).toBe('de ontem');
  });

  it('três dias atrás', () => {
    expect(idadeEmTexto(AGORA - 3 * DIA, AGORA)).toBe('há 3 dias');
  });

  it('trinta dias atrás', () => {
    expect(idadeEmTexto(AGORA - 30 * DIA, AGORA)).toBe('há 30 dias');
  });
});

describe('sem carimbo', () => {
  it('null não vira "de hoje"', () => {
    // O menu encontra isto antes da primeira calibração. "De hoje" ali seria
    // uma afirmação falsa sobre algo que nunca aconteceu.
    expect(idadeEmTexto(null, AGORA)).toBe(SEM_DATA);
  });

  it('NaN também não', () => {
    expect(idadeEmTexto(Number.NaN, AGORA)).toBe(SEM_DATA);
  });

  it('Infinity também não', () => {
    expect(idadeEmTexto(Number.POSITIVE_INFINITY, AGORA)).toBe(SEM_DATA);
  });
});

describe('relógio do sistema mexido', () => {
  it('carimbo no futuro não vira idade negativa', () => {
    // Acontece: fuso trocado, relógio corrigido, máquina que voltou do sono
    // com hora errada. "há -2 dias" na tela é pior que "de hoje".
    expect(idadeEmTexto(AGORA + 2 * DIA, AGORA)).toBe('de hoje');
  });
});

describe('a borda entre hoje e ontem', () => {
  it('23 h atrás ainda é "de hoje"', () => {
    expect(idadeEmTexto(AGORA - 23 * 60 * 60 * 1000, AGORA)).toBe('de hoje');
  });

  it('25 h atrás já é "de ontem"', () => {
    expect(idadeEmTexto(AGORA - 25 * 60 * 60 * 1000, AGORA)).toBe('de ontem');
  });
});
