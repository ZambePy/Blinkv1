import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { CaregiverGuide } from './CaregiverGuide';

// Mock base CaregiverPageLayout para simplificar as verificações
vi.mock('../../components/ui/CaregiverPageLayout', () => ({
  CaregiverPageLayout: ({ children, title }: { children: React.ReactNode; title: string }) => (
    <div>
      <h1>{title}</h1>
      {children}
    </div>
  ),
}));

describe('CaregiverGuide Page — Guia de Onboarding do Cuidador', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('deve renderizar as seções de posicionamento da câmera, iluminação, óculos e falhas na calibração', () => {
    render(
      <MemoryRouter initialEntries={['/caregiver/guide']}>
        <CaregiverGuide />
      </MemoryRouter>
    );

    expect(screen.getByText('Guia de Instalação e Suporte')).toBeInTheDocument();
    expect(screen.getByText(/1. Posicionamento da Câmera/i)).toBeInTheDocument();
    expect(screen.getByText(/2. Iluminação do Ambiente/i)).toBeInTheDocument();
    expect(screen.getByText(/3. Uso de Óculos e Lentes/i)).toBeInTheDocument();
    expect(screen.getByText(/O que fazer se a calibração falhar constantemente/i)).toBeInTheDocument();
  });

  it('deve navegar de volta para a rota especificada no parâmetro from da URL ao clicar em voltar', () => {
    render(
      <MemoryRouter initialEntries={['/caregiver/guide?from=/caregiver']}>
        <Routes>
          <Route path="/caregiver/guide" element={<CaregiverGuide />} />
          <Route path="/caregiver" element={<div>Painel do Cuidador</div>} />
        </Routes>
      </MemoryRouter>
    );

    const backBtn = screen.getByRole('button', { name: /Voltar/i });
    fireEvent.click(backBtn);

    expect(screen.getByText('Painel do Cuidador')).toBeInTheDocument();
  });
});
