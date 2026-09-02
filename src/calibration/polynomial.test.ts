import { describe, it, expect } from 'vitest';
import { expandPolynomialFeatures, expandedDimension } from './polynomial';

describe('expandPolynomialFeatures', () => {
  it('grau 2 sobre d=1: devolve [x, x²]', () => {
    expect(expandPolynomialFeatures([3])).toEqual([3, 9]);
  });

  it('grau 2 sobre d=2: devolve [x, y, x², xy, y²]', () => {
    expect(expandPolynomialFeatures([2, 3])).toEqual([2, 3, 4, 6, 9]);
  });

  it('grau 2 sobre d=3: devolve 3 + 6 = 9 features', () => {
    // [a, b, c, a², ab, ac, b², bc, c²]
    expect(expandPolynomialFeatures([1, 2, 3])).toEqual([
      1, 2, 3,          // originais
      1, 2, 3,          // a², ab, ac
      4, 6,             // b², bc
      9,                // c²
    ]);
  });

  it('não muta a entrada', () => {
    const input = [1, 2];
    const copy = [...input];
    expandPolynomialFeatures(input);
    expect(input).toEqual(copy);
  });

  it('vetor vazio devolve vetor vazio', () => {
    expect(expandPolynomialFeatures([])).toEqual([]);
  });

  it('valores NaN passam adiante sem quebrar', () => {
    // Ridge lida com NaN separadamente; polynomial não deve introduzir NaN em input finito.
    const out = expandPolynomialFeatures([NaN, 2]);
    expect(Number.isNaN(out[0])).toBe(true);
    expect(out[1]).toBe(2);
  });
});

describe('expandedDimension', () => {
  it('d=0 → 0', () => expect(expandedDimension(0)).toBe(0));
  it('d=1 → 2', () => expect(expandedDimension(1)).toBe(2));
  it('d=8 → 44', () => expect(expandedDimension(8)).toBe(44));
  it('d=12 → 90', () => expect(expandedDimension(12)).toBe(90));
});
