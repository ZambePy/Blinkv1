import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
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

describe('KeyboardScreen — Varredura Hierárquica', () => {
  it('deve alternar para o layout hierárquico, navegar pelos subgrupos e digitar', () => {
    // Configura o layout como hierárquico no localStorage antes de iniciar o contexto
    localStorage.setItem(
      'irisflow_settings',
      JSON.stringify({ keyboardLayout: 'hierarchical' })
    );

    render(
      <BrowserRouter>
        <SettingsProvider>
          <KeyboardScreen />
        </SettingsProvider>
      </BrowserRouter>
    );

    // 1. Validar que o Top Level (6 blocos gigantes) foi renderizado
    const groupAE = screen.getByText('A - E');
    const groupZ = screen.getByText('Z / Outros');
    expect(groupAE).toBeInTheDocument();
    expect(groupZ).toBeInTheDocument();

    // 2. Clicar no grupo A - E para entrar nas letras
    fireEvent.click(groupAE);

    // 3. Validar que as letras do subgrupo A - E e o botão Voltar estão visíveis
    const letterC = screen.getByText('C');
    const btnVoltar = screen.getAllByText('Voltar').find(el => el.tagName.toLowerCase() === 'div')!;
    expect(letterC).toBeInTheDocument();
    expect(btnVoltar).toBeInTheDocument();

    // 4. Clicar na letra C para digitar e validar que retorna ao Top Level
    fireEvent.click(letterC);

    // A saída de texto deve exibir 'C'
    const outputContainer = screen.getByText('C');
    expect(outputContainer).toBeInTheDocument();

    // O menu deve ter voltado para o Top Level (A - E deve estar visível novamente)
    expect(screen.getByText('A - E')).toBeInTheDocument();

    // 5. Entrar no grupo Z / Outros e navegar até os números
    fireEvent.click(screen.getByText('Z / Outros'));

    const btn1to5 = screen.getByText('1 - 5');
    expect(btn1to5).toBeInTheDocument();

    // Entra nos números 1 a 5
    fireEvent.click(btn1to5);

    const btn3 = screen.getByText('3');
    expect(btn3).toBeInTheDocument();

    // Clica no número 3 e valida que o texto vira 'C3' e retorna ao menu principal
    fireEvent.click(btn3);
    expect(screen.getByText('C3')).toBeInTheDocument();
    expect(screen.getByText('A - E')).toBeInTheDocument();
  });
});
