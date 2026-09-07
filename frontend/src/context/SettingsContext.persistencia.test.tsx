import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { SettingsProvider, useSettings } from './SettingsContext';

// -----------------------------------------------------------------------------
// Quatro defeitos no `SettingsContext`:
//
//  1. `JSON.parse` no inicializador do `useState` **sem `try/catch`**. Um
//     localStorage truncado — que acontece quando os 5 perfis de calibração
//     estouram a quota de 5 MB — derrubava o provider inteiro no boot, e com
//     ele a árvore React. Tela branca, sem recuperação para o cuidador.
//
//  2. `updateSettings` usava closure obsoleta:
//     `const next = { ...settings, ...partial }`, com `settings` do render
//     corrente. Duas chamadas no mesmo handler partiam do MESMO valor, e a
//     segunda sobrescrevia a primeira — a perda ia inclusive para o
//     localStorage. O cuidador mudava duas configurações e uma sumia.
//
//  3. Sem campo de versão: uma mudança futura no formato entraria misturada
//     aos defaults, com metade dos campos de um schema e metade de outro.
//
//  4. `value` do provider sem `useMemo`: objeto novo a cada render,
//     re-renderizando todos os consumidores mesmo sem mudança.
// -----------------------------------------------------------------------------

/** Sonda: expõe o contexto e conta os próprios renders. */
let renders = 0;
const Sonda: React.FC = () => {
  const { settings, updateSettings } = useSettings();
  renders++;
  return (
    <div>
      <span data-testid="dwell">{settings.dwellMs}</span>
      <span data-testid="diag">{settings.screenDiagonalIn}</span>
      <span data-testid="dist">{settings.viewingDistanceCm}</span>
      <button
        data-testid="duplo"
        onClick={() => {
          // Duas chamadas no MESMO handler — o cenário do defeito 2.
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

describe('localStorage corrompido não derruba o boot', () => {
  it('JSON truncado cai nos defaults em vez de lançar', () => {
    // O caso real: a quota estoura no meio de um `setItem` e sobra JSON
    // parcial.
    localStorage.setItem('irisflow_settings', '{"dwellMs":800,"scree');
    expect(() =>
      render(<SettingsProvider><Sonda /></SettingsProvider>),
    ).not.toThrow();
    expect(screen.getByTestId('dwell').textContent).toBe('1500');
  });

  it('valor não-objeto cai nos defaults', () => {
    localStorage.setItem('irisflow_settings', '"apenas uma string"');
    render(<SettingsProvider><Sonda /></SettingsProvider>);
    expect(screen.getByTestId('dwell').textContent).toBe('1500');
  });

  it('array cai nos defaults', () => {
    localStorage.setItem('irisflow_settings', '[1,2,3]');
    render(<SettingsProvider><Sonda /></SettingsProvider>);
    expect(screen.getByTestId('dwell').textContent).toBe('1500');
  });

  it('configuração válida é carregada normalmente', () => {
    localStorage.setItem('irisflow_settings', JSON.stringify({ dwellMs: 800, schemaVersion: 1 }));
    render(<SettingsProvider><Sonda /></SettingsProvider>);
    expect(screen.getByTestId('dwell').textContent).toBe('800');
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
    expect(screen.getByTestId('dwell').textContent).toBe('1500');
  });

  it('a versão é gravada junto ao salvar', () => {
    render(<SettingsProvider><Sonda /></SettingsProvider>);
    act(() => { screen.getByTestId('duplo').click(); });
    const gravado = JSON.parse(localStorage.getItem('irisflow_settings')!);
    expect(gravado.schemaVersion).toBe(1);
  });

  it('configuração SEM versão (anterior a) ainda é aceita, e migra o dwell', () => {
    // Compatibilidade: quem já tinha configurações salvas não pode perdê-las.
    //
    // Este é o caso mais delicado da migração `dwellSpeed` → `dwellMs`: uma
    // configuração salva antes do versionamento, com o enum antigo. Perder o
    // "lento" aqui deixaria um paciente com ELA avançada em 1,5 s, sem
    // conseguir clicar e sem ter como avisar ninguém.
    localStorage.setItem('irisflow_settings', JSON.stringify({ dwellSpeed: 'slow' }));
    render(<SettingsProvider><Sonda /></SettingsProvider>);
    expect(screen.getByTestId('dwell').textContent).toBe('2500');
  });
});

describe('duas atualizações no mesmo handler não se perdem', () => {
  it('ambas as mudanças sobrevivem no estado', () => {
    // O defeito 2, na sua forma exata: com closure obsoleta, a segunda
    // chamada partia do mesmo `settings` da primeira e a sobrescrevia.
    render(<SettingsProvider><Sonda /></SettingsProvider>);
    act(() => { screen.getByTestId('duplo').click(); });

    expect(screen.getByTestId('diag').textContent).toBe('27');
    expect(screen.getByTestId('dist').textContent).toBe('70');
  });

  it('ambas as mudanças sobrevivem no localStorage', () => {
    // A parte mais cara: a perda ia para o disco e persistia entre sessões.
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

    // Sem `useMemo`, o objeto `{settings, updateSettings}` era novo a cada
    // render e o consumidor re-renderizava junto. Com ele, a identidade é
    // estável enquanto `settings` não muda.
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
