import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { PhotoCaptureScreen } from './PhotoCaptureScreen';

// A câmera vem do GazeContext (mesmo stream do rastreador); a tela não abre
// um getUserMedia próprio. Aqui o contexto não tem stream: modo demonstração.
const getCameraStream = vi.fn(() => null);
vi.mock('../../context/GazeContext', () => ({
  useGaze: () => ({
    isDwelling: false,
    subscribe: vi.fn(() => vi.fn()),
    getCameraStream,
  }),
}));

const renderScreen = async () => {
  await act(async () => {
    render(
      <BrowserRouter>
        <PhotoCaptureScreen />
      </BrowserRouter>
    );
  });
};

describe('PhotoCaptureScreen — Câmera e Fotos', () => {
  beforeEach(() => {
    localStorage.clear();
    getCameraStream.mockClear();
  });

  it('renderiza navegação, disparo, filtro e tempo, sem abrir uma segunda câmera', async () => {
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      writable: true,
      value: { getUserMedia },
    });

    await renderScreen();

    expect(screen.getByText('Câmera e Fotos')).toBeInTheDocument();
    expect(screen.getByText(/TIRAR FOTO/i)).toBeInTheDocument();
    expect(screen.getByText('Filtro')).toBeInTheDocument();
    expect(screen.getByText('Tempo')).toBeInTheDocument();
    expect(screen.getByText('Voltar')).toBeInTheDocument();

    // O stream é pedido ao contexto, nunca ao navegador.
    expect(getCameraStream).toHaveBeenCalled();
    expect(getUserMedia).not.toHaveBeenCalled();
  });

  it('alterna os filtros de cor ao acionar o botão Filtro', async () => {
    await renderScreen();

    const filterButton = screen.getByText('Filtro').closest('button');
    expect(filterButton).toBeInTheDocument();
    expect(screen.getByText('Normal')).toBeInTheDocument();

    act(() => {
      fireEvent.click(filterButton!);
    });
    expect(screen.getByText('Vívido')).toBeInTheDocument();

    act(() => {
      fireEvent.click(filterButton!);
    });
    expect(screen.getByText('P&B')).toBeInTheDocument();
  });

  it('alterna o tempo de espera ao acionar o botão Tempo', async () => {
    await renderScreen();

    const timerButton = screen.getByText('Tempo').closest('button');
    expect(timerButton).toBeInTheDocument();
    expect(screen.getByText('3 segundos')).toBeInTheDocument();

    act(() => {
      fireEvent.click(timerButton!);
    });
    expect(screen.getByText('5 segundos')).toBeInTheDocument();

    act(() => {
      fireEvent.click(timerButton!);
    });
    expect(screen.getByText('Sem atraso')).toBeInTheDocument();
  });
});
