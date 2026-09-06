import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { EmergencyEscalation } from './EmergencyEscalation';
import { api } from '../../utils/api';

vi.mock('../../utils/api', () => ({
  api: {
    sendHelpAlert: vi.fn(() => Promise.resolve({ ok: true })),
  },
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    currentProfile: { id: 'patient123' },
  }),
}));

// Mock GazePageLayout para simplificar os testes de renderização da página
vi.mock('../../components/ui/GazePageLayout', () => ({
  GazePageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('EmergencyEscalation Page — Escalonamento de Emergência', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('deve carregar os botões e permitir disparo manual de socorro', () => {
    render(
      <MemoryRouter initialEntries={['/emergency']}>
        <EmergencyEscalation />
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: /emergency.items.pain/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /emergency.items.breath/i })).toBeInTheDocument();

    // Dispara Dor
    fireEvent.click(screen.getByRole('button', { name: /emergency.items.pain/i }));

    expect(api.sendHelpAlert).toHaveBeenCalledWith('patient123', 'high');
    expect(screen.getByText(/Seu alerta foi enviado. Aguarde atendimento./i)).toBeInTheDocument();
  });

  it('deve autodisparar se a URL vier com autoTrigger e escalar para crítico após 15 segundos', () => {
    vi.useFakeTimers();

    render(
      <MemoryRouter initialEntries={['/emergency?autoTrigger=pain']}>
        <EmergencyEscalation />
      </MemoryRouter>
    );

    // Disparou automaticamente em prioridade alta
    expect(api.sendHelpAlert).toHaveBeenCalledWith('patient123', 'high');
    expect(screen.getByText(/Aguarde atendimento/i)).toBeInTheDocument();

    // Avança o relógio em 15 segundos para simular não-resposta do cuidador
    act(() => {
      vi.advanceTimersByTime(15000);
    });

    // Deve ter enviado sinal crítico escalado
    expect(api.sendHelpAlert).toHaveBeenCalledWith('patient123', 'critical');
    expect(screen.getByText(/ALERTA ESCALADO/i)).toBeInTheDocument();
    expect(screen.getByText(/Sinais críticos enviados repetidamente! Aguarde socorro imediato./i)).toBeInTheDocument();

    vi.useRealTimers();
  });
});
