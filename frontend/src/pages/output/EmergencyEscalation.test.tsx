import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { EmergencyEscalation } from './EmergencyEscalation';
import { api } from '../../utils/api';
import { playAlarmSound } from '../../utils/emergencyAudio';

vi.mock('../../utils/api', () => ({
  api: {
    sendHelpAlert: vi.fn(() => Promise.resolve({ ok: true })),
  },
}));

vi.mock('../../utils/emergencyAudio', () => ({
  playAlarmSound: vi.fn(),
  playCancelSound: vi.fn(),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    currentProfile: { id: 'patient123' },
  }),
}));

// Sem i18n inicializado, `t` devolve a própria chave.
vi.mock('../../components/ui/GazePageLayout', () => ({
  GazePageLayout: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));

describe('EmergencyEscalation — alarme local de emergência', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('mostra os tipos de urgência e liga o alarme local ao escolher um', () => {
    render(
      <MemoryRouter initialEntries={['/emergency']}>
        <EmergencyEscalation />
      </MemoryRouter>
    );

    expect(screen.getByRole('button', { name: /emergency.items.pain/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /emergency.items.breath/i })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /emergency.items.pain/i }));

    // Sirene local pelo utilitário compartilhado, aviso ao serviço em segundo plano.
    expect(playAlarmSound).toHaveBeenCalled();
    expect(api.sendHelpAlert).toHaveBeenCalledWith('patient123', 'high');

    // A tela fala de alarme LOCAL, não de "alerta enviado ao cuidador".
    expect(screen.getByText('emergency.localAlarm')).toBeInTheDocument();
    expect(screen.queryByText(/emergency.alertSent/)).not.toBeInTheDocument();

    // Cancelar é um alvo de olhar grande, com dwell curto.
    const cancelar = screen.getByRole('button', { name: 'emergency.cancelAlarm' });
    expect(cancelar).toHaveClass('gaze-button--xl');
    expect(cancelar).not.toHaveAttribute('data-no-dwell');
    expect(cancelar).toHaveAttribute('data-dwell-ms', '1000');
  });

  it('dispara sozinho com autoTrigger e fica mais forte após 15 segundos', () => {
    vi.useFakeTimers();

    render(
      <MemoryRouter initialEntries={['/emergency?autoTrigger=pain']}>
        <EmergencyEscalation />
      </MemoryRouter>
    );

    expect(api.sendHelpAlert).toHaveBeenCalledWith('patient123', 'high');
    expect(screen.getByText('emergency.localAlarm')).toBeInTheDocument();
    const chamadasIniciais = vi.mocked(playAlarmSound).mock.calls.length;

    act(() => {
      vi.advanceTimersByTime(15000);
    });

    expect(api.sendHelpAlert).toHaveBeenCalledWith('patient123', 'critical');
    expect(screen.getByText('emergency.escalated')).toBeInTheDocument();
    // A sirene continua tocando enquanto ninguém cancela.
    expect(vi.mocked(playAlarmSound).mock.calls.length).toBeGreaterThan(chamadasIniciais);
  });

  it('cancelar desliga o alarme e volta ao menu', () => {
    render(
      <MemoryRouter initialEntries={['/emergency?autoTrigger=breath']}>
        <EmergencyEscalation />
      </MemoryRouter>
    );

    fireEvent.click(screen.getByRole('button', { name: 'emergency.cancelAlarm' }));
    expect(screen.queryByText('emergency.localAlarm')).not.toBeInTheDocument();
  });
});
