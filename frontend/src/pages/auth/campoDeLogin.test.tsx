import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import React from 'react';
import i18n from '../../i18n';
import { LoginScreen } from './LoginScreen';
import { LicenseProvider } from '../../context/LicenseContext';
import { createMockLicenseService } from '../../services/license';

// -----------------------------------------------------------------------------
// O campo de login aparecia em duas cores: a faixa do ícone escura e o resto
// mais claro, como se a caixa estivesse partida ao meio.
//
// A causa não estava no componente e sim no CSS global: `index.css` aplica
// `outline: 3px solid` + `box-shadow: 0 0 0 6px rgba(27,84,168,.15)` em
// `input:focus-visible`. Como o fundo e a borda do campo moravam numa `<div>`
// EXTERNA e o `<input>` era transparente por dentro, o anel de foco desenhava
// em volta do input interno — dentro da caixa — em vez de em volta do controle
// que a pessoa enxerga. O resultado lia como bug de cor.
//
// A correção é estrutural: quem carrega fundo, borda e raio passa a ser o
// próprio `<input>`, e o ícone flutua sobre ele. Aí o anel de foco global
// coincide com a caixa visível, que é o que ele sempre quis contornar.
// -----------------------------------------------------------------------------

const AQUI = dirname(fileURLToPath(import.meta.url));

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
});

const montar = () =>
  render(
    <LicenseProvider service={createMockLicenseService()}>
      <MemoryRouter>
        <LoginScreen />
      </MemoryRouter>
    </LicenseProvider>
  );

describe('o campo carrega a própria caixa', () => {
  it('o input tem fundo e borda, em vez de ser transparente dentro de uma div', () => {
    montar();
    const email = screen.getByLabelText(/e-mail/i);

    expect(email.style.background).toContain('var(--field-bg)');
    expect(email.style.border).toContain('var(--field-border)');
  });

  it('o input tem raio próprio, para o anel de foco acompanhar o formato', () => {
    montar();
    expect(screen.getByLabelText(/e-mail/i).style.borderRadius).not.toBe('');
  });

  it('o input abre espaço à esquerda para o ícone não cobrir o texto', () => {
    montar();
    const padding = screen.getByLabelText(/e-mail/i).style.paddingLeft;
    expect(parseFloat(padding)).toBeGreaterThan(2);
  });

  it('senha e e-mail usam a mesma caixa', () => {
    // Na captura os dois campos apareciam diferentes entre si; um deles estava
    // com foco. Iguais em repouso é o mínimo.
    montar();
    const email = screen.getByLabelText(/e-mail/i);
    const senha = screen.getByLabelText(/senha/i);
    expect(senha.style.background).toBe(email.style.background);
    expect(senha.style.border).toBe(email.style.border);
  });
});

describe('o CSS global acompanha o tema escuro', () => {
  const css = () => readFileSync(resolve(AQUI, '../../index.css'), 'utf8');

  it('declara color-scheme, para o Chromium não pintar controles claros', () => {
    // Sem isto o navegador desenha caixa de senha, autocomplete e barra de
    // rolagem com a paleta clara, por cima do nosso tema escuro.
    expect(css()).toMatch(/color-scheme:\s*dark/);
  });

  it('neutraliza o fundo do autofill do Chromium', () => {
    // `-webkit-autofill` pinta um fundo azul claro com prioridade que
    // `background: transparent` não vence. Só um inset box-shadow cobre.
    expect(css()).toMatch(/-webkit-autofill/);
  });
});
