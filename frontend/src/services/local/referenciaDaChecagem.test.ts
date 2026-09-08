import { describe, it, expect } from 'vitest';
import {
  CHAVE_DA_REFERENCIA,
  lerReferencia,
  gravarReferencia,
  limparReferencia,
} from './referenciaDaChecagem';

// -----------------------------------------------------------------------------
// A referência da checagem é AMARRADA AO CARIMBO DA CALIBRAÇÃO.
//
// Quando a calibração muda, a referência antiga não vale: comparar a checagem
// de hoje contra uma referência tirada do modelo anterior mediria a diferença
// entre dois modelos, não a deriva do posto de uso — e o veredito falaria de
// uma coisa achando que fala de outra.
//
// É o mesmo mecanismo que o `blocoDeMedicao` já usa para reiniciar a contagem.
// -----------------------------------------------------------------------------

describe('sem referência', () => {
  it('lê null', () => {
    expect(lerReferencia(1000)).toBeNull();
  });
});

describe('gravar e ler', () => {
  it('devolve o que foi gravado, para a mesma calibração', () => {
    gravarReferencia(1000, 2.4);
    expect(lerReferencia(1000)?.erroDeg).toBe(2.4);
  });

  it('carimba a data em ISO 8601', () => {
    gravarReferencia(1000, 2.4);
    const r = lerReferencia(1000)!;
    expect(new Date(r.em).toISOString()).toBe(r.em);
  });
});

describe('a amarração ao carimbo', () => {
  it('outra calibração NÃO enxerga a referência', () => {
    gravarReferencia(1000, 2.4);
    expect(lerReferencia(2000)).toBeNull();
  });

  it('gravar para outra calibração substitui — só uma vale por vez', () => {
    gravarReferencia(1000, 2.4);
    gravarReferencia(2000, 3.1);

    expect(lerReferencia(2000)?.erroDeg).toBe(3.1);
    expect(lerReferencia(1000)).toBeNull();
  });
});

describe('entradas degeneradas', () => {
  it('carimbo nulo não lê nada', () => {
    gravarReferencia(1000, 2.4);
    expect(lerReferencia(null)).toBeNull();
  });

  it('erro não-finito não é gravado', () => {
    // Uma medição que falhou não pode virar a referência contra a qual todas
    // as próximas serão julgadas.
    gravarReferencia(1000, Number.NaN);
    expect(lerReferencia(1000)).toBeNull();
  });

  it('erro zero não é gravado', () => {
    // 0° é implausível como medição, e vira referência que reprova tudo.
    gravarReferencia(1000, 0);
    expect(lerReferencia(1000)).toBeNull();
  });

  it('registro corrompido lê null, sem lançar', () => {
    localStorage.setItem(CHAVE_DA_REFERENCIA, '{"calibTs":');
    expect(() => lerReferencia(1000)).not.toThrow();
    expect(lerReferencia(1000)).toBeNull();
  });
});

describe('limpar', () => {
  it('faz a próxima checagem virar a primeira de novo', () => {
    gravarReferencia(1000, 2.4);
    limparReferencia();
    expect(lerReferencia(1000)).toBeNull();
  });
});
