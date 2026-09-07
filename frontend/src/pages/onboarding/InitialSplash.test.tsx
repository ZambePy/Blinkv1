import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import i18n from '../../i18n';
import { InitialSplash } from './InitialSplash';
import { LicenseProvider, LICENSE_KEY } from '../../context/LicenseContext';
import { AuthProvider } from '../../context/AuthContext';
import { aceitarConsentimento } from '../../services/local/consent';
import { criarPerfil } from '../../services/local/profiles';
import { INTRO_SEEN_KEY } from './bootDestination';
import { isDevMode } from '../../devMode';
import {
  createMockLicenseService,
  CONTAS_DE_TESTE,
  SENHA_DE_TESTE,
  getDeviceBinding,
  getDeviceId,
} from '../../services/license';
import type { LicenseService } from '../../services/license';

// -----------------------------------------------------------------------------
// O splash existe para decidir para onde ir, não para vender o produto. A
// decisão em si mora em `bootDestination` e é testada lá; aqui interessa que a
// tela informe o que está fazendo e leve a pessoa ao destino escolhido.
// -----------------------------------------------------------------------------

const ESPERA = { timeout: 4000 };

let service: LicenseService;

beforeEach(async () => {
  sessionStorage.clear();
  await i18n.changeLanguage('pt-BR');
  service = createMockLicenseService();
});

async function semearLicencaAtiva() {
  const device = getDeviceBinding();
  const r = await service.login(CONTAS_DE_TESTE.ativa, SENHA_DE_TESTE, device);
  if (!r.ok) throw new Error('o mock deveria aceitar a conta ativa');
  localStorage.setItem(
    LICENSE_KEY,
    JSON.stringify({
      account: r.license.account,
      plan: r.license.plan,
      token: r.license.token,
      deviceId: getDeviceId(),
      boundAt: device.boundAt,
      lastVerifiedAt: Date.now(),
    })
  );
}

const montar = () =>
  render(
    <LicenseProvider service={service}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/']}>
          <Routes>
            <Route path="/" element={<InitialSplash />} />
            <Route path="/intro" element={<div>tela de boas-vindas</div>} />
            <Route path="/login" element={<div>tela de login</div>} />
            <Route path="/consent" element={<div>tela de consentimento</div>} />
            <Route path="/profiles" element={<div>tela de perfis</div>} />
            <Route path="/menu" element={<div>tela de menu</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </LicenseProvider>
  );

describe('enquanto verifica', () => {
  it('diz que está verificando a licença, em vez de uma tela parada', () => {
    montar();
    expect(screen.getByText(/verificando licença/i)).toBeInTheDocument();
  });

  it('anuncia o progresso para leitores de tela', () => {
    montar();
    expect(screen.getByRole('status')).toBeInTheDocument();
  });
});

describe('para onde vai', () => {
  it('primeira abertura da vida: boas-vindas', async () => {
    montar();
    await waitFor(
      () => expect(screen.getByText('tela de boas-vindas')).toBeInTheDocument(),
      ESPERA
    );
  });

  it('boas-vindas já vistas, sem licença: login', async () => {
    localStorage.setItem(INTRO_SEEN_KEY, 'true');
    montar();
    await waitFor(() => expect(screen.getByText('tela de login')).toBeInTheDocument(), ESPERA);
  });

  it('licença ativa, sem termo aceito: consentimento', async () => {
    await semearLicencaAtiva();
    montar();
    await waitFor(
      () => expect(screen.getByText('tela de consentimento')).toBeInTheDocument(),
      ESPERA
    );
  });

  it('licença e termo, sem perfil: escolha de perfil', async () => {
    await semearLicencaAtiva();
    aceitarConsentimento(CONTAS_DE_TESTE.ativa);
    montar();
    await waitFor(() => expect(screen.getByText('tela de perfis')).toBeInTheDocument(), ESPERA);
  });

  it('tudo pronto: menu, sem passar por login nenhum', async () => {
    // O caso mais comum do dia a dia: o cuidador abre o app e o paciente
    // precisa comunicar. Qualquer tela a mais aqui é uma barreira diária.
    await semearLicencaAtiva();
    aceitarConsentimento(CONTAS_DE_TESTE.ativa);
    const perfil = criarPerfil({ name: 'Joana' });
    localStorage.setItem('irisflow_auth', JSON.stringify({ currentProfile: perfil }));

    montar();

    await waitFor(() => expect(screen.getByText('tela de menu')).toBeInTheDocument(), ESPERA);
  });
});

describe('Modo Desenvolvedor', () => {
  it('leva ao menu e liga a flag pelo módulo devMode', async () => {
    // Gravar direto no sessionStorage — como fazia antes — não dispara o evento
    // que o GazeContext escuta, e o cursor de gaze continuava ligado.
    montar();
    fireEvent.click(screen.getByRole('button', { name: /modo desenvolvedor/i }));

    expect(isDevMode()).toBe(true);
    await waitFor(() => expect(screen.getByText('tela de menu')).toBeInTheDocument(), ESPERA);
  });
});
