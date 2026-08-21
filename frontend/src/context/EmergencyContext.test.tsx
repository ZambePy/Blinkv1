import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { EmergencyProvider } from './EmergencyContext';

vi.mock('./GazeContext', () => ({
  useGaze: () => ({
    isDegraded: false,
  }),
}));

vi.mock('./AuthContext', () => ({
  useAuth: () => ({
    currentProfile: { id: 'patient123' },
  }),
}));

describe('EmergencyContext — Sistema de Emergência Canônica', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('deve exibir o botão de emergência na tela do paciente e ocultar nas do cuidador', () => {
    // Paciente
    const { unmount } = render(
      <MemoryRouter initialEntries={['/menu']}>
        <EmergencyProvider>
          <div>Tela do Paciente</div>
        </EmergencyProvider>
      </MemoryRouter>
    );
    expect(screen.getByRole('button', { name: /Emergência/i })).toBeInTheDocument();
    unmount();

    // Cuidador
    render(
      <MemoryRouter initialEntries={['/settings']}>
        <EmergencyProvider>
          <div>Tela do Cuidador</div>
        </EmergencyProvider>
      </MemoryRouter>
    );
    expect(screen.queryByRole('button', { name: /Emergência/i })).toBeNull();
  });

  it('deve entrar em estado de confirmação e iniciar contagem regressiva ao clicar no botão', () => {
    vi.useFakeTimers();
    render(
      <MemoryRouter initialEntries={['/menu']}>
        <EmergencyProvider>
          <div>Conteúdo</div>
        </EmergencyProvider>
      </MemoryRouter>
    );

    const button = screen.getByRole('button', { name: /Emergência/i });
    fireEvent.click(button);

    // Modal de confirmação deve aparecer
    expect(screen.getByRole('alertdialog')).toBeInTheDocument();
    expect(screen.getByText(/Enviando alerta de socorro em/i)).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();

    // Avança 2s
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(screen.getByText('3')).toBeInTheDocument();

    // Clica em Cancelar
    const cancelBtn = screen.getByRole('button', { name: /CANCELAR/i });
    fireEvent.click(cancelBtn);

    // Modal deve sumir
    expect(screen.queryByRole('alertdialog')).toBeNull();
    vi.useRealTimers();
  });

  it('deve disparar redirecionamento de emergência se a contagem chegar a 0', () => {
    vi.useFakeTimers();
    
    render(
      <MemoryRouter initialEntries={['/menu']}>
        <EmergencyProvider>
          <Routes>
            <Route path="/menu" element={<div>Menu</div>} />
            <Route path="/emergency" element={<div>Tela de Escalabilidade de Emergência</div>} />
          </Routes>
        </EmergencyProvider>
      </MemoryRouter>
    );

    const button = screen.getByRole('button', { name: /Emergência/i });
    fireEvent.click(button);

    // Avança 5s completos
    act(() => {
      vi.advanceTimersByTime(5000);
    });

    // O modal desaparece e fomos redirecionados
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(screen.getByText('Tela de Escalabilidade de Emergência')).toBeInTheDocument();

    vi.useRealTimers();
  });
});
