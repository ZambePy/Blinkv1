import { describe, it, expect } from 'vitest';
import { lerParametroDeUrl } from '../../frontend/src/urlParams';

// O app usa `HashRouter`: `useSearchParams` lê só a query depois do `#`, mas
// quem digita a URL escreve `?debug=1` antes dele. As duas formas valem.

const loc = (search: string, hash: string) => ({ search, hash });

describe('lê os dois formatos de URL', () => {
  it('query ANTES do hash — a forma que a documentação instrui', () => {
    expect(lerParametroDeUrl('debug', loc('?debug=1', '#/'))).toBe('1');
  });

  it('query DEPOIS do hash — a forma que o react-router considera canônica', () => {
    expect(lerParametroDeUrl('debug', loc('', '#/menu?debug=1'))).toBe('1');
  });

  it('sem o parâmetro devolve `null`, não string vazia', () => {
    expect(lerParametroDeUrl('debug', loc('?outro=1', '#/'))).toBeNull();
    expect(lerParametroDeUrl('debug', loc('', ''))).toBeNull();
  });

  it('o hash TEM precedência quando os dois existem', () => {
    // É ele que o react-router considera canônico para descrever a rota.
    expect(lerParametroDeUrl('ep', loc('?ep=wasm', '#/?ep=webgpu'))).toBe('webgpu');
  });

  it('hash sem query não atrapalha a leitura da search', () => {
    expect(lerParametroDeUrl('debug', loc('?debug=1', '#/calibration-check'))).toBe('1');
  });

  it('vários parâmetros na mesma URL', () => {
    const l = loc('?preflight=1&debug=1&ep=webgpu&diagonal=23.6', '#/');
    expect(lerParametroDeUrl('preflight', l)).toBe('1');
    expect(lerParametroDeUrl('ep', l)).toBe('webgpu');
    expect(lerParametroDeUrl('diagonal', l)).toBe('23.6');
  });
});
