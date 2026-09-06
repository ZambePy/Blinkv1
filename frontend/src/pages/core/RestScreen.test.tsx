import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import { RestScreen } from './RestScreen';
import { BrowserRouter } from 'react-router-dom';

// Mock do hook useGaze
vi.mock('../../context/GazeContext', () => ({
  useGaze: () => ({
    isDwelling: false,
    subscribe: vi.fn(() => vi.fn()),
  }),
}));

describe('RestScreen — Modo Descanso', () => {
  it('deve renderizar com instruções de tela suspensa e botão de acordar com 3s', () => {
    render(
      <BrowserRouter>
        <RestScreen />
      </BrowserRouter>
    );

    // Verifica título da página
    expect(screen.getByText('Modo Descanso')).toBeInTheDocument();

    // Verifica texto explicativo do repouso
    expect(
      screen.getByText(/O rastreamento ocular de ações foi pausado/i)
    ).toBeInTheDocument();

    // Verifica botão de acordar e atributo customizado de dwell de 3000ms
    const btnWake = screen.getByText('Acordar Tela (3s)');
    expect(btnWake).toBeInTheDocument();
    expect(btnWake.closest('button')).toHaveAttribute('data-dwell-ms', '3000');
  });
});
