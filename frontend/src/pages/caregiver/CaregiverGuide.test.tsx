import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { HashRouter, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
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

  // O app roda sob `HashRouter`: o hash É a rota. Um `<a href="#guia-camera">`
  // navegaria para a rota inexistente `/guia-camera` (tela vazia) em vez de
  // rolar até a seção.
  it('os tópicos são botões que rolam até a seção, não âncoras de hash (HashRouter)', () => {
    const LocationProbe: React.FC = () => <div data-testid="pathname">{useLocation().pathname}</div>;
    window.location.hash = '#/caregiver/guide';
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;

    render(
      <HashRouter>
        <LocationProbe />
        <Routes>
          <Route path="/caregiver/guide" element={<CaregiverGuide />} />
          <Route path="*" element={<div>rota inexistente</div>} />
        </Routes>
      </HashRouter>
    );

    const nav = screen.getByRole('navigation', { name: 'Tópicos do guia' });
    expect(nav.querySelectorAll('a[href^="#"]')).toHaveLength(0);

    fireEvent.click(screen.getByRole('button', { name: 'Câmera' }));

    expect(scroll).toHaveBeenCalled();
    expect(screen.getByTestId('pathname').textContent).toBe('/caregiver/guide');
    expect(screen.queryByText('rota inexistente')).toBeNull();
    window.location.hash = '';
  });
});
