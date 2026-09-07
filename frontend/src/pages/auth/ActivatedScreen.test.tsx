import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import i18n from '../../i18n';
import { ActivatedScreen } from './ActivatedScreen';
import { LicenseProvider, LICENSE_KEY } from '../../context/LicenseContext';
import {
  createMockLicenseService,
  CONTAS_DE_TESTE,
  SENHA_DE_TESTE,
  getDeviceBinding,
  getDeviceId,
} from '../../services/license';
import type { LicenseService, LoginFailure } from '../../services/license';

// -----------------------------------------------------------------------------
// Duas telas no mesmo lugar, porque são o mesmo momento do fluxo: "sua licença
// está ativa aqui" e "sua licença está ativa noutro lugar, quer trazer?".
//
// A transferência derruba a máquina antiga. Fazer isso sem confirmação
// explícita desconectaria o computador da clínica sem ninguém saber.
// -----------------------------------------------------------------------------

let service: LicenseService;

beforeEach(async () => {
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

/** Provoca a recusa `device-limit` para alimentar a variante de transferência. */
async function recusaPorOutroPC(): Promise<Extract<LoginFailure, { reason: 'device-limit' }>> {
  const r = await service.login(CONTAS_DE_TESTE.outroPC, SENHA_DE_TESTE, getDeviceBinding());
  if (r.ok || r.reason !== 'device-limit') throw new Error('esperava device-limit');
  return r;
}

const montar = (state?: unknown) =>
  render(
    <LicenseProvider service={service}>
      <MemoryRouter initialEntries={[{ pathname: '/activated', state }]}>
        <Routes>
          <Route path="/activated" element={<ActivatedScreen />} />
          <Route path="/consent" element={<div>tela de consentimento</div>} />
          <Route path="/login" element={<div>tela de login</div>} />
        </Routes>
      </MemoryRouter>
    </LicenseProvider>
  );

describe('licença recém-ativada', () => {
  it('mostra o nome do plano', async () => {
    await semearLicencaAtiva();
    montar();
    await waitFor(() => expect(screen.getByText(/IrisFlow Familiar/)).toBeInTheDocument());
  });

  it('diz que este computador foi vinculado', async () => {
    await semearLicencaAtiva();
    montar();
    await waitFor(() =>
      expect(screen.getByText(/este computador foi vinculado/i)).toBeInTheDocument()
    );
  });

  it('mostra a validade por extenso, não uma data ISO crua', async () => {
    // "2027-03-14T00:00:00.000Z" não é informação para um cuidador.
    await semearLicencaAtiva();
    montar();
    await waitFor(() => expect(screen.getByText(/válida até/i)).toBeInTheDocument());
    expect(screen.queryByText(/\d{4}-\d{2}-\d{2}T/)).toBeNull();
  });

  it('continuar leva ao termo de privacidade', async () => {
    await semearLicencaAtiva();
    montar();
    await waitFor(() => expect(screen.getByRole('button', { name: /continuar/i })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: /continuar/i }));
    expect(screen.getByText('tela de consentimento')).toBeInTheDocument();
  });
});

describe('sem licença e sem transferência pendente', () => {
  it('volta para o login em vez de mostrar uma tela vazia', async () => {
    montar();
    await waitFor(() => expect(screen.getByText('tela de login')).toBeInTheDocument());
  });
});

describe('variante de transferência', () => {
  it('lista a máquina que hoje está ativa', async () => {
    const recusa = await recusaPorOutroPC();
    montar({ transferencia: recusa });

    expect(screen.getByText(/computador da clínica/i)).toBeInTheDocument();
  });

  it('explica que ativar aqui desconecta a outra', async () => {
    const recusa = await recusaPorOutroPC();
    montar({ transferencia: recusa });

    expect(screen.getByText(/desconectar o aparelho abaixo/i)).toBeInTheDocument();
  });

  it('confirmar transfere e a tela passa a mostrar a licença ativa', async () => {
    const recusa = await recusaPorOutroPC();
    montar({ transferencia: recusa });

    fireEvent.click(screen.getByRole('button', { name: /transferir para este computador/i }));

    await waitFor(() =>
      expect(screen.getByText(/este computador foi vinculado/i)).toBeInTheDocument()
    );
  });

  it('cancelar volta ao login sem transferir nada', async () => {
    const recusa = await recusaPorOutroPC();
    montar({ transferencia: recusa });

    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));

    await waitFor(() => expect(screen.getByText('tela de login')).toBeInTheDocument());
  });
});
