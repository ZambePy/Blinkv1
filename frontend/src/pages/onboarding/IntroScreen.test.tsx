import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import i18n from '../../i18n';
import { IntroScreen } from './IntroScreen';
import { INTRO_SEEN_KEY } from './bootDestination';

// -----------------------------------------------------------------------------
// Uma tela só, e ela precisa responder três coisas antes do cuidador decidir
// se vale a pena continuar: o que o produto faz, quem usa, e em que idioma.
// -----------------------------------------------------------------------------

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
});

const montar = () =>
  render(
    <MemoryRouter initialEntries={['/intro']}>
      <Routes>
        <Route path="/intro" element={<IntroScreen />} />
        <Route path="/login" element={<div>tela de login</div>} />
      </Routes>
    </MemoryRouter>
  );

describe('o que a tela conta', () => {
  it('explica o produto em uma frase', () => {
    montar();
    expect(screen.getByText(/transforma o movimento dos olhos/i)).toBeInTheDocument();
  });

  it('nomeia os dois papéis: quem usa e quem acompanha', () => {
    montar();
    expect(screen.getByText(/para quem usa/i)).toBeInTheDocument();
    expect(screen.getByText(/para quem acompanha/i)).toBeInTheDocument();
  });
});

describe('escolha de idioma', () => {
  it('oferece o seletor', () => {
    montar();
    expect(screen.getByRole('button', { name: /portugu|português/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /english|inglês/i })).toBeInTheDocument();
  });

  it('troca o texto da própria tela ao mudar o idioma', () => {
    // O seletor precisa valer já aqui. Se só valesse depois, o cuidador
    // escolheria "English" e continuaria lendo português.
    montar();
    fireEvent.click(screen.getByRole('button', { name: /english|inglês/i }));
    expect(screen.getByText(/turns eye movement/i)).toBeInTheDocument();
  });
});

describe('o botão Começar', () => {
  it('leva ao login', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: /começar/i }));
    expect(screen.getByText('tela de login')).toBeInTheDocument();
  });

  it('marca a apresentação como vista, para não repetir todo boot', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: /começar/i }));
    expect(localStorage.getItem(INTRO_SEEN_KEY)).toBe('true');
  });
});
