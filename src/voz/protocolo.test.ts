import { describe, it, expect } from 'vitest';
import {
  separarLinhasJson,
  normalizarTextoParaFala,
  classificarReferencia,
  ehResposta,
  ehEvento,
  TEXTO_MAX_PARA_FALA,
} from './protocolo';

describe('separarLinhasJson', () => {
  it('devolve mensagens completas e guarda a linha parcial', () => {
    const r = separarLinhasJson('{"id":1,"ok":true}\n{"evento":"progresso","pct":10}\n{"id":2,');
    expect(r.mensagens).toEqual([{ id: 1, ok: true }, { evento: 'progresso', pct: 10 }]);
    expect(r.resto).toBe('{"id":2,');
  });

  it('ignora avisos de bibliotecas Python no meio do fluxo', () => {
    const r = separarLinhasJson('UserWarning: torch.load ...\n{"id":3,"ok":false,"erro":"x"}\n');
    expect(r.mensagens).toEqual([{ id: 3, ok: false, erro: 'x' }]);
    expect(r.resto).toBe('');
  });

  it('JSON quebrado não derruba o leitor', () => {
    expect(separarLinhasJson('{nope}\n').mensagens).toEqual([]);
  });

  it('classifica resposta e evento', () => {
    expect(ehResposta({ id: 1, ok: true })).toBe(true);
    expect(ehResposta({ evento: 'log' })).toBe(false);
    expect(ehEvento({ evento: 'log' })).toBe(true);
  });
});

describe('normalizarTextoParaFala', () => {
  it('colapsa espaços e apara', () => {
    expect(normalizarTextoParaFala('  Estou   com  sede.  ')).toBe('Estou com sede.');
  });
  it('limita o tamanho', () => {
    expect(normalizarTextoParaFala('a'.repeat(1000))).toHaveLength(TEXTO_MAX_PARA_FALA);
  });
});

describe('classificarReferencia', () => {
  it('pouca fala útil é fraca, mesmo limpa', () => {
    expect(classificarReferencia(4, 30)).toBe('fraca');
  });
  it('ruído forte é fraca, mesmo longa', () => {
    expect(classificarReferencia(40, 8)).toBe('fraca');
  });
  it('curta e limpa é aceitável; longa e limpa é boa', () => {
    expect(classificarReferencia(10, 25)).toBe('aceitavel');
    expect(classificarReferencia(20, 25)).toBe('boa');
    expect(classificarReferencia(20, 15)).toBe('aceitavel');
  });
  it('sem SNR medido decide só pela duração', () => {
    expect(classificarReferencia(20, null)).toBe('boa');
  });
});
