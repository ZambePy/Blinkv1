import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { NewsScreen } from './NewsScreen';

const voz = vi.hoisted(() => ({ falar: vi.fn(() => Promise.resolve({})) }));
vi.mock('../../services/voz', () => ({ falar: voz.falar }));

vi.mock('../../context/GazeContext', () => ({
  useGaze: () => ({ subscribe: vi.fn(() => vi.fn()) }),
  useIsDwelling: () => false,
}));

const renderizar = () =>
  render(
    <BrowserRouter>
      <NewsScreen />
    </BrowserRouter>
  );

describe('NewsScreen — Jornal do Dia', () => {
  it('deixa explícito que o conteúdo é de demonstração', () => {
    renderizar();
    expect(screen.getByRole('note')).toHaveTextContent(/Conteúdo de demonstração/);
    expect(screen.getByRole('note')).toHaveTextContent(/não são\s+notícias reais/);
  });

  it('lê a notícia em voz alta por um alvo de fixação', async () => {
    renderizar();
    const ouvir = screen.getByLabelText('Ouvir a notícia Esportes em voz alta');
    // `act` assíncrono: a fala é uma promise e o `finally` volta o rótulo de
    // "Lendo…" para "Ouvir" depois que ela resolve.
    await act(async () => {
      fireEvent.click(ouvir);
    });
    expect(voz.falar).toHaveBeenCalledWith(expect.stringContaining('Esportes.'), { rate: 0.9 });
    expect(screen.getByLabelText('Ouvir a notícia Esportes em voz alta')).toHaveTextContent('Ouvir');
  });

  it('mantém uma saída para o menu', () => {
    renderizar();
    expect(screen.getByLabelText('Voltar para Ajuda e Lazer')).toBeInTheDocument();
  });
});
