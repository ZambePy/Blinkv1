import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { PhotoCaptureScreen } from './PhotoCaptureScreen';

// Mock do hook useGaze
vi.mock('../../context/GazeContext', () => ({
  useGaze: () => ({
    isDwelling: false,
    subscribe: vi.fn(() => vi.fn()),
  }),
}));

describe('PhotoCaptureScreen — Módulo de Câmera & Fotos', () => {
  beforeEach(() => {
    localStorage.clear();
    // Mock de getUserMedia
    Object.defineProperty(navigator, 'mediaDevices', {
      writable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() }],
        }),
      },
    });
  });

  it('deve renderizar os botões principais de navegação, disparo, filtro e tempo', async () => {
    await act(async () => {
      render(
        <BrowserRouter>
          <PhotoCaptureScreen />
        </BrowserRouter>
      );
    });

    // Verifica título
    expect(screen.getByText('Câmera & Fotos')).toBeInTheDocument();

    // Verifica botão de disparo grande
    expect(screen.getByText(/TIRAR FOTO/i)).toBeInTheDocument();

    // Verifica botão de filtro e tempo
    expect(screen.getByText('Filtro')).toBeInTheDocument();
    expect(screen.getByText('Tempo')).toBeInTheDocument();

    // Verifica botão Voltar
    expect(screen.getByText('Voltar')).toBeInTheDocument();
  });

  it('deve alternar os filtros de cor ao clicar no botão Filtro', async () => {
    await act(async () => {
      render(
        <BrowserRouter>
          <PhotoCaptureScreen />
        </BrowserRouter>
      );
    });

    const filterButton = screen.getByText('Filtro').closest('button');
    expect(filterButton).toBeInTheDocument();

    // Filtro inicial: Normal
    expect(screen.getByText('Normal')).toBeInTheDocument();

    // Clica para mudar filtro
    act(() => {
      fireEvent.click(filterButton!);
    });
    expect(screen.getByText('Vívido')).toBeInTheDocument();

    act(() => {
      fireEvent.click(filterButton!);
    });
    expect(screen.getByText('P&B')).toBeInTheDocument();
  });

  it('deve alternar as opções de temporizador ao clicar no botão Tempo', async () => {
    await act(async () => {
      render(
        <BrowserRouter>
          <PhotoCaptureScreen />
        </BrowserRouter>
      );
    });

    const timerButton = screen.getByText('Tempo').closest('button');
    expect(timerButton).toBeInTheDocument();

    // Inicial: 3 segundos
    expect(screen.getByText('3 segundos')).toBeInTheDocument();

    // Clica para 5s
    act(() => {
      fireEvent.click(timerButton!);
    });
    expect(screen.getByText('5 segundos')).toBeInTheDocument();

    // Clica para 0s (Sem atraso)
    act(() => {
      fireEvent.click(timerButton!);
    });
    expect(screen.getByText('Sem atraso')).toBeInTheDocument();
  });
});
