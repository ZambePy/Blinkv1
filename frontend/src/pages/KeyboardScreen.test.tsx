import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { KeyboardScreen } from './KeyboardScreen';
import { SettingsProvider } from '../context/SettingsContext';
import { BrowserRouter } from 'react-router-dom';

// Mock do i18next translation hook
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => key,
  }),
}));

// Mock do speech synthesis do browser
if (typeof window !== 'undefined') {
  window.speechSynthesis = {
    cancel: vi.fn(),
    speak: vi.fn(),
  } as any;
}

// Mock do hook useGaze para evitar loops de vídeo reais em ambiente de testes
vi.mock('../context/GazeContext', () => ({
  useGaze: () => ({
    isDwelling: false,
    subscribe: vi.fn(() => vi.fn()),
    isComposing: false,
    setIsComposing: vi.fn(),
  }),
}));

describe('KeyboardScreen — Varredura Hierárquica 2x3', () => {
  it('deve alternar para o layout hierárquico 2x3, navegar pelos subgrupos e digitar', () => {
    render(
      <BrowserRouter>
        <SettingsProvider>
          <KeyboardScreen />
        </SettingsProvider>
      </BrowserRouter>
    );

    // 1. Validar que o Top Level (6 blocos gigantes) foi renderizado
    const groupAE = screen.getByText('A B C'); // the top part of the label
    const groupZ = screen.getByText('Y Z');
    expect(groupAE).toBeInTheDocument();
    expect(groupZ).toBeInTheDocument();

    // 2. Clicar no grupo A - F para entrar nas letras
    fireEvent.click(groupAE);

    // 3. Validar que as letras do subgrupo A - F e o botão Voltar estão visíveis.
    //    Na barra superior em tela cheia o voltar é só a seta, identificada
    //    pelo aria-label — não há mais o rótulo textual "Voltar".
    const letterC = screen.getByText('C');
    const btnVoltar = screen.getByLabelText('Voltar');
    expect(letterC).toBeInTheDocument();
    expect(btnVoltar).toBeInTheDocument();

    // 4. Clicar na letra C para digitar e validar que retorna ao Top Level
    fireEvent.click(letterC);

    // A saída de texto deve exibir 'C' no display superior
    const outputContainer = screen.getAllByText('C')[0];
    expect(outputContainer).toBeInTheDocument();

    // O menu deve ter voltado para o Top Level (A B C deve estar visível novamente)
    expect(screen.getByText('A B C')).toBeInTheDocument();

    // 5. Entrar no grupo Y Z ␣ para ações
    fireEvent.click(screen.getByText('Y Z'));

    const btnApagar = screen.getByText('Apagar');
    expect(btnApagar).toBeInTheDocument();

    // Entra em apagar
    fireEvent.click(btnApagar);

    // Permanece no mesmo grupo (conforme regra)
    expect(screen.getByText('Apagar')).toBeInTheDocument();
  });
});
