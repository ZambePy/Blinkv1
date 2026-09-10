import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  estadoDaAtualizacao,
  instalarAtualizacao,
  ouvirAtualizacao,
  textoDaFaixa,
  verificarAtualizacao,
} from './atualizacao';

type Janela = { irisflowAtualizacao?: unknown };

afterEach(() => {
  delete (window as unknown as Janela).irisflowAtualizacao;
});

describe('sem ponte (navegador, testes)', () => {
  it('fica inativa e não escuta nada', async () => {
    expect((await estadoDaAtualizacao()).fase).toBe('inativa');
    expect(await instalarAtualizacao()).toBe(false);
    expect(await verificarAtualizacao()).toBe(false);
    const parar = ouvirAtualizacao(() => undefined);
    expect(() => parar()).not.toThrow();
  });
});

describe('com ponte', () => {
  it('repassa estado, instalar e verificar', async () => {
    const instalar = vi.fn(async () => true);
    const verificar = vi.fn(async () => true);
    const aoMudar = vi.fn((cb: (e: unknown) => void) => {
      cb({ fase: 'pronta', versao: '1.2.3' });
      return () => undefined;
    });
    (window as unknown as Janela).irisflowAtualizacao = {
      estado: async () => ({ fase: 'em_dia', versao: '1.0.0' }),
      instalar,
      verificar,
      aoMudar,
    };
    expect(await estadoDaAtualizacao()).toEqual({ fase: 'em_dia', versao: '1.0.0' });
    expect(await instalarAtualizacao()).toBe(true);
    expect(await verificarAtualizacao()).toBe(true);
    const visto: unknown[] = [];
    ouvirAtualizacao((e) => visto.push(e));
    expect(visto).toEqual([{ fase: 'pronta', versao: '1.2.3' }]);
  });

  it('uma ponte que lança não derruba o app', async () => {
    (window as unknown as Janela).irisflowAtualizacao = {
      estado: async () => {
        throw new Error('x');
      },
      instalar: async () => {
        throw new Error('x');
      },
      verificar: async () => {
        throw new Error('x');
      },
      aoMudar: () => {
        throw new Error('x');
      },
    };
    expect((await estadoDaAtualizacao()).fase).toBe('inativa');
    expect(await instalarAtualizacao()).toBe(false);
    expect(() => ouvirAtualizacao(() => undefined)()).not.toThrow();
  });
});

describe('texto da faixa', () => {
  it('só interrompe para "baixando" e "pronta"', () => {
    expect(textoDaFaixa({ fase: 'inativa', motivo: 'x' })).toBeNull();
    expect(textoDaFaixa({ fase: 'verificando' })).toBeNull();
    expect(textoDaFaixa({ fase: 'em_dia', versao: '1' })).toBeNull();
    expect(textoDaFaixa({ fase: 'erro', mensagem: 'x' })).toBeNull();
    expect(textoDaFaixa({ fase: 'baixando', versao: '2.0.0', progresso: 40 })).toEqual({
      titulo: 'Baixando a versão 2.0.0… 40%',
      acao: null,
    });
    expect(textoDaFaixa({ fase: 'pronta', versao: '2.0.0' })).toEqual({
      titulo: 'Nova versão 2.0.0 pronta',
      acao: 'reiniciar',
    });
  });
});
