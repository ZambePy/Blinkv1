import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { MeditationScreen } from './MeditationScreen';

vi.mock('../../context/GazeContext', () => ({
  useGaze: () => ({ subscribe: vi.fn(() => vi.fn()) }),
  useIsDwelling: () => false,
}));

const renderizar = () =>
  render(
    <BrowserRouter>
      <MeditationScreen />
    </BrowserRouter>
  );

describe('MeditationScreen — Meditação Visual', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('começa parada e é iniciada por um alvo de fixação', () => {
    renderizar();
    expect(screen.getByText('Pronto')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Iniciar a sessão de respiração'));
    expect(screen.getByText('Inale')).toBeInTheDocument();
    expect(screen.getByLabelText('Pausar a sessão de respiração')).toBeInTheDocument();
  });

  it('percorre o ciclo 4-4-4 e conta os ciclos completos', () => {
    renderizar();
    fireEvent.click(screen.getByLabelText('Iniciar a sessão de respiração'));

    act(() => void vi.advanceTimersByTime(4000));
    expect(screen.getByText('Segure')).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(4000));
    expect(screen.getByText('Exale')).toBeInTheDocument();

    act(() => void vi.advanceTimersByTime(4000));
    expect(screen.getByText('Inale')).toBeInTheDocument();
    expect(screen.getByRole('status').getAttribute('aria-label')).toContain('Ciclos completos: 1');
  });

  it('para de avançar quando pausada — nada roda sozinho depois disso', () => {
    renderizar();
    fireEvent.click(screen.getByLabelText('Iniciar a sessão de respiração'));
    act(() => void vi.advanceTimersByTime(4000));
    expect(screen.getByText('Segure')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Pausar a sessão de respiração'));
    act(() => void vi.advanceTimersByTime(30_000));
    // Pausada: a fase não pode ter andado.
    expect(screen.getByLabelText('Iniciar a sessão de respiração')).toBeInTheDocument();
    fireEvent.click(screen.getByLabelText('Iniciar a sessão de respiração'));
    expect(screen.getByText('Segure')).toBeInTheDocument();
  });

  it('mantém uma saída para o menu durante a sessão', () => {
    renderizar();
    fireEvent.click(screen.getByLabelText('Iniciar a sessão de respiração'));
    expect(screen.getByLabelText('Voltar para Ajuda e Lazer')).toBeInTheDocument();
  });
});
