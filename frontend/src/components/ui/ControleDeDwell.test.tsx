import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import i18n from '../../i18n';
import { ControleDeDwell } from './ControleDeDwell';
import { DWELL_MIN_MS, DWELL_MAX_MS } from '../../dwellMs';

// -----------------------------------------------------------------------------
// UM controle de tempo de permanência, usado pelo tutorial e pelas
// Configurações.
//
// Dois controles para a mesma grandeza é como limiares divergem: alguém ajusta
// a faixa num e esquece o outro, e a partir daí a mesma configuração significa
// coisas diferentes dependendo da tela em que foi mexida.
// -----------------------------------------------------------------------------

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
});

const montar = (props: Partial<React.ComponentProps<typeof ControleDeDwell>> = {}) =>
  render(<ControleDeDwell valorMs={1500} aoMudar={vi.fn()} {...props} />);

const slider = () => screen.getByRole('slider') as HTMLInputElement;

describe('o slider', () => {
  it('mostra o valor atual em segundos, que é como se pensa no tempo', () => {
    montar({ valorMs: 1500 });
    expect(screen.getByText(/1[,.]5\s*s/)).toBeInTheDocument();
  });

  it('cobre toda a faixa permitida', () => {
    montar();
    expect(Number(slider().min)).toBe(DWELL_MIN_MS);
    expect(Number(slider().max)).toBe(DWELL_MAX_MS);
  });

  it('reporta o valor ao mexer', () => {
    const aoMudar = vi.fn();
    montar({ aoMudar });
    fireEvent.change(slider(), { target: { value: '2200' } });
    expect(aoMudar).toHaveBeenCalledWith(2200);
  });

  it('nunca reporta fora da faixa', () => {
    // Um `input[type=range]` respeita min/max, mas o valor também chega de
    // storage editado à mão e de preset. Prender aqui evita dwell infinito.
    const aoMudar = vi.fn();
    montar({ aoMudar });
    fireEvent.change(slider(), { target: { value: '999999' } });
    expect(aoMudar).toHaveBeenCalledWith(DWELL_MAX_MS);
  });
});

describe('os presets', () => {
  it('oferece os três atalhos', () => {
    montar();
    expect(screen.getByRole('button', { name: /lento/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /normal/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /r[áa]pido/i })).toBeInTheDocument();
  });

  it('clicar num preset reporta o valor dele', () => {
    const aoMudar = vi.fn();
    montar({ aoMudar });
    fireEvent.click(screen.getByRole('button', { name: /lento/i }));
    expect(aoMudar).toHaveBeenCalledWith(2500);
  });

  it('o preset correspondente ao valor aparece marcado', () => {
    montar({ valorMs: 2500 });
    expect(screen.getByRole('button', { name: /lento/i })).toHaveAttribute('aria-pressed', 'true');
  });

  it('valor entre dois presets não marca nenhum', () => {
    // Marcar um atalho que não corresponde ao configurado mentiria sobre o
    // estado — e o slider existe justamente para permitir valores próprios.
    montar({ valorMs: 1150 });
    for (const nome of [/lento/i, /normal/i, /r[áa]pido/i]) {
      expect(screen.getByRole('button', { name: nome })).toHaveAttribute('aria-pressed', 'false');
    }
  });
});

describe('acessibilidade', () => {
  it('o slider tem rótulo', () => {
    montar();
    expect(slider()).toHaveAccessibleName();
  });

  it('anuncia o valor em segundos, não em milissegundos', () => {
    // "1500" lido por um leitor de tela não diz nada; "1,5 segundos" diz.
    montar({ valorMs: 1500 });
    expect(slider().getAttribute('aria-valuetext')).toMatch(/1[,.]5/);
  });
});
