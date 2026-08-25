import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { GamesMenu } from './GamesMenu';

// Mock do hook useGaze
vi.mock('../context/GazeContext', () => ({
  useGaze: () => ({
    isDwelling: false,
    subscribe: vi.fn(() => vi.fn()),
  }),
}));

describe('GamesMenu — Ajuda e Lazer', () => {
  it('deve renderizar o título de Ajuda e Lazer e todos os cards de atividade incluindo Tirar Foto', () => {
    render(
      <BrowserRouter>
        <GamesMenu />
      </BrowserRouter>
    );

    // Verifica título principal
    expect(screen.getByText('Ajuda e Lazer')).toBeInTheDocument();

    // Verifica novos itens adicionados
    expect(screen.getByText('Tirar Foto')).toBeInTheDocument();
    expect(screen.getByText('Galeria de Fotos')).toBeInTheDocument();

    // Verifica jogos anteriores mantidos com tamanho ampliado
    expect(screen.getByText('Estoura Bolhas')).toBeInTheDocument();
    expect(screen.getByText('Jogo da Memória')).toBeInTheDocument();
    expect(screen.getByText('Siga o Alvo')).toBeInTheDocument();
    expect(screen.getByText('Desenho com Olhar')).toBeInTheDocument();

    // Verifica botão de voltar
    expect(screen.getByText('Voltar')).toBeInTheDocument();
  });
});
