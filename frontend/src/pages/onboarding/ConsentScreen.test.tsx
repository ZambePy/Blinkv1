import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import '../../i18n';
import i18n from '../../i18n';
import { ConsentScreen } from './ConsentScreen';
import { LicenseProvider } from '../../context/LicenseContext';
import { lerConsentimento, CONSENT_VERSION } from '../../services/local/consent';
import { createMockLicenseService } from '../../services/license';

// -----------------------------------------------------------------------------
// O termo é o que sustenta a promessa de privacidade do produto: imagem de
// câmera e calibração nunca saem da máquina. Se o botão avançasse sem o
// checkbox, o registro de aceite viraria ficção — pior do que não ter registro,
// porque documenta um consentimento que não houve.
// -----------------------------------------------------------------------------

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
});

const montar = () =>
  render(
    <LicenseProvider service={createMockLicenseService()}>
      <MemoryRouter initialEntries={['/consent']}>
        <Routes>
          <Route path="/consent" element={<ConsentScreen />} />
          <Route path="/profiles" element={<div>tela de perfis</div>} />
        </Routes>
      </MemoryRouter>
    </LicenseProvider>
  );

const botaoContinuar = () => screen.getByRole('button', { name: /concordar e continuar/i });
const checkbox = () => screen.getByRole('checkbox');

describe('o texto do termo', () => {
  it('diz o que fica na máquina e o que vai ao servidor', () => {
    montar();
    expect(screen.getByText(/nunca saem daqui/i)).toBeInTheDocument();
    expect(screen.getByText(/apenas o seu login/i)).toBeInTheDocument();
  });
});

describe('o portão do checkbox', () => {
  it('começa com o botão desabilitado', () => {
    montar();
    expect(botaoContinuar()).toBeDisabled();
  });

  it('habilita o botão ao marcar', () => {
    montar();
    fireEvent.click(checkbox());
    expect(botaoContinuar()).toBeEnabled();
  });

  it('desabilita de novo ao desmarcar', () => {
    montar();
    fireEvent.click(checkbox());
    fireEvent.click(checkbox());
    expect(botaoContinuar()).toBeDisabled();
  });

  it('não grava nada enquanto o checkbox não é marcado', () => {
    montar();
    fireEvent.click(botaoContinuar());
    expect(lerConsentimento()).toBeNull();
  });
});

describe('ao aceitar', () => {
  it('grava versão e data e segue para os perfis', () => {
    montar();
    fireEvent.click(checkbox());
    fireEvent.click(botaoContinuar());

    const registro = lerConsentimento();
    expect(registro?.version).toBe(CONSENT_VERSION);
    expect(new Date(registro!.acceptedAt).toISOString()).toBe(registro!.acceptedAt);
    expect(screen.getByText('tela de perfis')).toBeInTheDocument();
  });
});

describe('idioma', () => {
  it('mostra o termo em inglês quando o idioma é inglês', async () => {
    // Se a escolha de idioma da tela de boas-vindas não alcançar o termo, o
    // usuário aceita um texto que não consegue ler.
    await i18n.changeLanguage('en');
    montar();
    expect(screen.getByText(/never leave this machine/i)).toBeInTheDocument();
  });
});
