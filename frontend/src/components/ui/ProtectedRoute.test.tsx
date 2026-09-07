import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import { ProtectedRoute } from './ProtectedRoute';
import { LicenseProvider } from '../../context/LicenseContext';
import { AuthProvider } from '../../context/AuthContext';
import { LICENSE_KEY } from '../../context/LicenseContext';
import { aceitarConsentimento } from '../../services/local/consent';
import { criarPerfil } from '../../services/local/profiles';
import {
  createMockLicenseService,
  CONTAS_DE_TESTE,
  SENHA_DE_TESTE,
  getDeviceBinding,
  getDeviceId,
} from '../../services/license';
import type { LicenseService } from '../../services/license';

// -----------------------------------------------------------------------------
// Até agora este componente estava ÓRFÃO: o `App.tsx` definia um `Protected`
// local que era `({ children }) => <>{children}</>`. Toda rota "protegida" era
// pública — dava para chegar ao menu sem licença, sem consentimento e sem
// perfil, bastando digitar a URL.
//
// Estes testes prendem a ordem do portão. A ordem importa: mandar alguém sem
// licença para `/profiles` faria a pessoa cadastrar um paciente para só depois
// descobrir que não pode usar o app.
// -----------------------------------------------------------------------------

let service: LicenseService;

beforeEach(() => {
  sessionStorage.clear();
  service = createMockLicenseService();
});

/** Grava uma licença válida como se o login já tivesse acontecido. */
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

const montar = (requireCaregiver = false) =>
  render(
    <LicenseProvider service={service}>
      <AuthProvider>
        <MemoryRouter initialEntries={['/protegida']}>
          <Routes>
            <Route
              path="/protegida"
              element={
                <ProtectedRoute requireCaregiver={requireCaregiver}>
                  <div>conteudo protegido</div>
                </ProtectedRoute>
              }
            />
            <Route path="/login" element={<div>tela de login</div>} />
            <Route path="/consent" element={<div>tela de consentimento</div>} />
            <Route path="/profiles" element={<div>tela de perfis</div>} />
            <Route path="/menu" element={<div>tela de menu</div>} />
          </Routes>
        </MemoryRouter>
      </AuthProvider>
    </LicenseProvider>
  );

const viu = (texto: string) => screen.getByText(texto);

describe('sem licença', () => {
  it('manda para o login', async () => {
    montar();
    await waitFor(() => expect(viu('tela de login')).toBeInTheDocument());
  });

  it('não mostra o conteúdo protegido', async () => {
    montar();
    await waitFor(() => expect(viu('tela de login')).toBeInTheDocument());
    expect(screen.queryByText('conteudo protegido')).toBeNull();
  });
});

describe('com licença, sem consentimento', () => {
  it('manda para o termo antes de qualquer outra coisa', async () => {
    await semearLicencaAtiva();
    montar();
    await waitFor(() => expect(viu('tela de consentimento')).toBeInTheDocument());
  });
});

describe('com licença e consentimento, sem perfil', () => {
  it('manda para a escolha de perfil', async () => {
    await semearLicencaAtiva();
    aceitarConsentimento(CONTAS_DE_TESTE.ativa);
    montar();
    await waitFor(() => expect(viu('tela de perfis')).toBeInTheDocument());
  });
});

describe('com tudo em ordem', () => {
  it('deixa passar', async () => {
    await semearLicencaAtiva();
    aceitarConsentimento(CONTAS_DE_TESTE.ativa);
    const perfil = criarPerfil({ name: 'Joana' });
    localStorage.setItem('irisflow_auth', JSON.stringify({ currentProfile: perfil }));

    montar();

    await waitFor(() => expect(viu('conteudo protegido')).toBeInTheDocument());
  });
});

describe('licença em tolerância offline', () => {
  it('deixa passar — a comunicação não pode cair porque o Wi-Fi caiu', async () => {
    await semearLicencaAtiva();
    aceitarConsentimento(CONTAS_DE_TESTE.ativa);
    const perfil = criarPerfil({ name: 'Joana' });
    localStorage.setItem('irisflow_auth', JSON.stringify({ currentProfile: perfil }));
    localStorage.setItem('irisflow_mock_network', 'offline');

    montar();

    await waitFor(() => expect(viu('conteudo protegido')).toBeInTheDocument());
  });
});

describe('Modo Desenvolvedor', () => {
  it('passa direto, sem licença, consentimento nem perfil', async () => {
    // Mantido a pedido, para inspecionar o estado do produto sem refazer o
    // fluxo inteiro. Registrado no §9 do spec como pendência de lançamento.
    sessionStorage.setItem('irisflow_dev_mode', 'true');

    montar();

    await waitFor(() => expect(viu('conteudo protegido')).toBeInTheDocument());
  });
});

describe('área do cuidador', () => {
  it('manda para o menu quando o PIN não foi informado', async () => {
    await semearLicencaAtiva();
    aceitarConsentimento(CONTAS_DE_TESTE.ativa);
    const perfil = criarPerfil({ name: 'Joana' });
    localStorage.setItem('irisflow_auth', JSON.stringify({ currentProfile: perfil }));

    montar(true);

    await waitFor(() => expect(viu('tela de menu')).toBeInTheDocument());
  });
});
