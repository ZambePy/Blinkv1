import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import { GamesMenu } from './GamesMenu';

vi.mock('../context/GazeContext', () => ({
  useGaze: () => ({ subscribe: vi.fn(() => vi.fn()) }),
  useIsDwelling: () => false,
}));

/**
 * Notícias e Meditação existiam como rotas navegáveis, mas nenhuma tela levava
 * a elas: eram órfãs, alcançáveis só digitando a URL — ou seja, inalcançáveis
 * para quem usa o app pelo olhar. Estes casos existem para que não voltem a
 * sumir do menu.
 */
const renderizarCom = (destino: string) =>
  render(
    <MemoryRouter initialEntries={['/games']}>
      <Routes>
        <Route path="/games" element={<GamesMenu />} />
        <Route path={destino} element={<div>CHEGOU</div>} />
      </Routes>
    </MemoryRouter>
  );

describe('GamesMenu — Lazer e bem-estar', () => {
  it('lista Notícias e Meditação junto com os jogos', () => {
    renderizarCom('/news');
    expect(screen.getByText('Lazer e bem-estar')).toBeInTheDocument();
    expect(screen.getByText('Notícias')).toBeInTheDocument();
    expect(screen.getByText('Meditação')).toBeInTheDocument();
    expect(screen.getByText('Estoura Bolhas')).toBeInTheDocument();
    expect(screen.getByText('Siga o Alvo')).toBeInTheDocument();
  });

  it('navega para Notícias', () => {
    renderizarCom('/news');
    fireEvent.click(screen.getByLabelText(/^Abrir Notícias/));
    expect(screen.getByText('CHEGOU')).toBeInTheDocument();
  });

  it('navega para Meditação', () => {
    renderizarCom('/meditation');
    fireEvent.click(screen.getByLabelText(/^Abrir Meditação/));
    expect(screen.getByText('CHEGOU')).toBeInTheDocument();
  });
});
