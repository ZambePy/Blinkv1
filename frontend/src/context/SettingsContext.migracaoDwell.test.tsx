import { describe, it, expect } from 'vitest';
import { renderHook } from '@testing-library/react';
import React from 'react';
import { SettingsProvider, useSettings } from './SettingsContext';
import { DWELL_PADRAO_MS } from '../dwellMs';

// -----------------------------------------------------------------------------
// `dwellSpeed: 'slow' | 'normal' | 'fast'` virou `dwellMs: number`.
//
// A migração é a parte que importa. Um paciente com ELA avançada configurado em
// "lento" que volta ao padrão de 1,5 s na primeira abertura depois da
// atualização fica sem conseguir clicar — e não tem como avisar ninguém disso.
// -----------------------------------------------------------------------------

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
);

const salvarLegado = (dwellSpeed: string) =>
  localStorage.setItem('irisflow_settings', JSON.stringify({ dwellSpeed }));

const lerDwell = () => renderHook(() => useSettings(), { wrapper }).result.current.settings.dwellMs;

describe('configuração antiga sobrevive à mudança de tipo', () => {
  it('"slow" salvo vira 2500 ms', () => {
    salvarLegado('slow');
    expect(lerDwell()).toBe(2500);
  });

  it('"fast" salvo vira 800 ms', () => {
    salvarLegado('fast');
    expect(lerDwell()).toBe(800);
  });

  it('"normal" salvo vira 1500 ms', () => {
    salvarLegado('normal');
    expect(lerDwell()).toBe(1500);
  });
});

describe('sem nada salvo', () => {
  it('usa o padrão', () => {
    expect(lerDwell()).toBe(DWELL_PADRAO_MS);
  });
});

describe('valor novo já em ms', () => {
  it('é lido direto, sem passar pela migração', () => {
    localStorage.setItem('irisflow_settings', JSON.stringify({ dwellMs: 1900 }));
    expect(lerDwell()).toBe(1900);
  });

  it('um ms fora da faixa é preso na leitura', () => {
    // Storage editado à mão, ou vindo de uma versão com outra faixa.
    localStorage.setItem('irisflow_settings', JSON.stringify({ dwellMs: 99999 }));
    expect(lerDwell()).toBeLessThanOrEqual(4000);
  });
});
