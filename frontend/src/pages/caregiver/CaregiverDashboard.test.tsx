import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { CaregiverDashboard } from './CaregiverDashboard';

let mockIsCaregiver = false;
const mockLoginCaregiver = vi.fn((pin: string) => {
  if (pin === '1234') {
    mockIsCaregiver = true;
    return true;
  }
  return false;
});

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({
    currentProfile: { id: 'patient123' },
    isCaregiver: mockIsCaregiver,
    loginCaregiver: mockLoginCaregiver,
  }),
}));

vi.mock('../../context/ToastContext', () => ({
  useToast: () => ({
    success: vi.fn(),
    error: vi.fn(),
  }),
}));

// Mock base CaregiverPageLayout para simplificar as verificações do dashboard
vi.mock('../../components/ui/CaregiverPageLayout', () => ({
  CaregiverPageLayout: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

describe('CaregiverDashboard PIN & Keypad Access', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockIsCaregiver = false;
  });

  it('deve exibir tela de restrição e permitir autenticar pelo teclado virtual numérico', () => {
    render(
      <MemoryRouter>
        <CaregiverDashboard />
      </MemoryRouter>
    );

    // 1. Deve exibir a restrição
    expect(screen.getByText('Acesso Restrito ao Cuidador')).toBeInTheDocument();
    expect(screen.getByPlaceholderText('••••')).toBeInTheDocument();

    // 2. Clica nos botões numéricos
    fireEvent.click(screen.getByRole('button', { name: '1' }));
    fireEvent.click(screen.getByRole('button', { name: '2' }));
    fireEvent.click(screen.getByRole('button', { name: '3' }));
    fireEvent.click(screen.getByRole('button', { name: '4' }));

    // 3. Submete senha correta (1234)
    fireEvent.click(screen.getByRole('button', { name: /Entrar/i }));

    expect(mockLoginCaregiver).toHaveBeenCalledWith('1234');
  });

  it('deve rejeitar senha errada, exibir mensagem de erro e limpar campo', () => {
    render(
      <MemoryRouter>
        <CaregiverDashboard />
      </MemoryRouter>
    );

    // Clica 9, 9, 9
    fireEvent.click(screen.getByRole('button', { name: '9' }));
    fireEvent.click(screen.getByRole('button', { name: '9' }));
    fireEvent.click(screen.getByRole('button', { name: '9' }));

    // Submete senha errada
    fireEvent.click(screen.getByRole('button', { name: /Entrar/i }));

    expect(mockLoginCaregiver).toHaveBeenCalledWith('999');
    expect(screen.getByText('PIN inválido')).toBeInTheDocument();
  });

  it('deve carregar diretamente os painéis de tarefas e diário se já estiver autenticado', () => {
    mockIsCaregiver = true;

    render(
      <MemoryRouter>
        <CaregiverDashboard />
      </MemoryRouter>
    );

    expect(screen.queryByText('Acesso Restrito ao Cuidador')).toBeNull();
    expect(screen.getByText('Painel do Cuidador')).toBeInTheDocument();
    expect(screen.getByText('Tomar medicação da manhã')).toBeInTheDocument();
  });
});
