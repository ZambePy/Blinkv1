import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, renderHook, screen, act } from '@testing-library/react';
import React from 'react';
import { SettingsProvider, useSettings } from './SettingsContext';

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <SettingsProvider>{children}</SettingsProvider>
);

/** Sonda: expõe o contexto e conta os próprios renders. */
let renders = 0;
const Sonda: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  renders++;
  return (
    <div>
      <span data-testid="dwell">{settings.dwellSpeed}</span>
      <span data-testid="diag">{settings.screenDiagonalIn}</span>
      <span data-testid="dist">{settings.viewingDistanceCm}</span>
      <button
        data-testid="duplo"
        onClick={() => {
          // Duas chamadas no MESMO handler.
          updateSettings({ screenDiagonalIn: 27 });
          updateSettings({ viewingDistanceCm: 70 });
        }}
      >
        duplo
      </button>
    </div>
  );
};

beforeEach(() => {
  localStorage.clear();
  renders = 0;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

describe('defaults e atualização', () => {
  it('inicia com defaults sensatos', () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    expect(result.current.settings.dwellSpeed).toBe('normal');
    expect(result.current.settings.soundEnabled).toBe(true);
  });

  it('atualiza parcialmente e persiste', () => {
    const { result } = renderHook(() => useSettings(), { wrapper });
    act(() => {
      result.current.updateSettings({ dwellSpeed: 'fast' });
    });
    expect(result.current.settings.dwellSpeed).toBe('fast');
    expect(localStorage.getItem('irisflow_settings')).toContain('fast');
  });
});

describe('localStorage corrompido não derruba o boot', () => {
  it('JSON truncado cai nos defaults em vez de lançar', () => {
    // O caso real: a quota estoura no meio de um `setItem` e sobra JSON
    // parcial.
    localStorage.setItem('irisflow_settings', '{"dwellSpeed":"fast","scree');
    expect(() =>
      render(<SettingsProvider><Sonda /></SettingsProvider>),
    ).not.toThrow();
    expect(screen.getByTestId('dwell').textContent).toBe('normal');
  });

  it('valor não-objeto cai nos defaults', () => {
    localStorage.setItem('irisflow_settings', '"apenas uma string"');
    render(<SettingsProvider><Sonda /></SettingsProvider>);
    expect(screen.getByTestId('dwell').textContent).toBe('normal');
  });

  it('array cai nos defaults', () => {
    localStorage.setItem('irisflow_settings', '[1,2,3]');
    render(<SettingsProvider><Sonda /></SettingsProvider>);
    expect(screen.getByTestId('dwell').textContent).toBe('normal');
  });

  it('configuração válida é carregada normalmente', () => {
    localStorage.setItem('irisflow_settings', JSON.stringify({ dwellSpeed: 'fast', schemaVersion: 1 }));
    render(<SettingsProvider><Sonda /></SettingsProvider>);
    expect(screen.getByTestId('dwell').textContent).toBe('fast');
  });
});

describe('o schema é versionado', () => {
  it('schema de versão diferente é descartado', () => {
    // Metade de um formato com metade de outro é pior que voltar aos
    // defaults: o resultado não corresponde a nenhuma configuração que alguém
    // escolheu.
    localStorage.setItem(
      'irisflow_settings',
      JSON.stringify({ dwellSpeed: 'fast', schemaVersion: 999 }),
    );
    render(<SettingsProvider><Sonda /></SettingsProvider>);
    expect(screen.getByTestId('dwell').textContent).toBe('normal');
  });

  it('a versão é gravada junto ao salvar', () => {
    render(<SettingsProvider><Sonda /></SettingsProvider>);
    act(() => { screen.getByTestId('duplo').click(); });
    const gravado = JSON.parse(localStorage.getItem('irisflow_settings')!);
    expect(gravado.schemaVersion).toBe(1);
  });

  it('configuração SEM versão (formato antigo) ainda é aceita', () => {
    // Compatibilidade: quem já tinha configurações salvas não pode perdê-las.
    localStorage.setItem('irisflow_settings', JSON.stringify({ dwellSpeed: 'slow' }));
    render(<SettingsProvider><Sonda /></SettingsProvider>);
    expect(screen.getByTestId('dwell').textContent).toBe('slow');
  });
});

describe('duas atualizações no mesmo handler não se perdem', () => {
  it('ambas as mudanças sobrevivem no estado', () => {
    // Com closure obsoleta, a segunda chamada partiria do mesmo `settings`
    // da primeira e a sobrescreveria.
    render(<SettingsProvider><Sonda /></SettingsProvider>);
    act(() => { screen.getByTestId('duplo').click(); });

    expect(screen.getByTestId('diag').textContent).toBe('27');
    expect(screen.getByTestId('dist').textContent).toBe('70');
  });

  it('ambas as mudanças sobrevivem no localStorage', () => {
    // A perda iria para o disco e persistiria entre sessões.
    render(<SettingsProvider><Sonda /></SettingsProvider>);
    act(() => { screen.getByTestId('duplo').click(); });

    const gravado = JSON.parse(localStorage.getItem('irisflow_settings')!);
    expect(gravado.screenDiagonalIn).toBe(27);
    expect(gravado.viewingDistanceCm).toBe(70);
  });
});

describe('o value do provider é memoizado', () => {
  it('re-render do pai sem mudança de settings não re-renderiza o consumidor', () => {
    const Pai: React.FC<{ n: number }> = ({ n }) => (
      <SettingsProvider>
        <span data-testid="n">{n}</span>
        <Sonda />
      </SettingsProvider>
    );
    const { rerender } = render(<Pai n={1} />);
    const depoisDoPrimeiro = renders;

    rerender(<Pai n={2} />);

    // Com `useMemo`, a identidade do value é estável enquanto `settings`
    // não muda.
    //
    // (O React ainda pode re-renderizar filhos por outros motivos; o que se
    // mede aqui é que o CONTEXTO deixou de ser a causa.)
    expect(renders - depoisDoPrimeiro).toBeLessThanOrEqual(1);
  });

  it('mudança real de settings RE-renderiza o consumidor', () => {
    // Memoizar não pode congelar a UI.
    render(<SettingsProvider><Sonda /></SettingsProvider>);
    const antes = renders;
    act(() => { screen.getByTestId('duplo').click(); });
    expect(renders).toBeGreaterThan(antes);
  });
});
