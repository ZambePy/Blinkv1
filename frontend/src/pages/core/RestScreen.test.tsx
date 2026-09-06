import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { RestScreen } from './RestScreen';
import { BrowserRouter } from 'react-router-dom';

vi.mock('../../context/GazeContext', () => ({
  useGaze: () => ({
    isDwelling: false,
    subscribe: vi.fn(() => vi.fn()),
  }),
}));

describe('RestScreen — Modo Descanso', () => {
  it('mostra a zona sem alvo e um único botão de voltar com dwell de 3 s', () => {
    render(
      <BrowserRouter>
        <RestScreen />
      </BrowserRouter>
    );

    expect(screen.getByText('Modo Descanso')).toBeInTheDocument();
    expect(screen.getByText(/Nada aqui reage ao olhar/i)).toBeInTheDocument();

    // O centro é zona de descanso: não pode ser alvo de dwell.
    expect(screen.getByLabelText(/Zona de descanso/i)).toHaveAttribute('data-no-dwell', 'true');

    // Um único alvo na tela, com dwell alongado.
    const botoes = screen.getAllByRole('button');
    expect(botoes).toHaveLength(1);
    expect(botoes[0]).toHaveTextContent('Voltar ao menu');
    expect(botoes[0]).toHaveAttribute('data-dwell-ms', '3000');
  });
});
