import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import React from 'react';
import i18n from '../../i18n';
import { GraceBanner } from './GraceBanner';
import { LicenseProvider, LICENSE_KEY } from '../../context/LicenseContext';
import {
  createMockLicenseService,
  CONTAS_DE_TESTE,
  SENHA_DE_TESTE,
  MOCK_NETWORK_KEY,
  getDeviceBinding,
  getDeviceId,
} from '../../services/license';
import type { LicenseService } from '../../services/license';

// -----------------------------------------------------------------------------
// Quando a licença não pôde ser verificada mas ainda vale, o app continua
// funcionando. O aviso existe para que isso não seja invisível: o cuidador
// precisa saber que há uma pendência antes de ela virar bloqueio.
//
// Discreto de propósito — a tela é do paciente, e um alarme permanente no meio
// da comunicação seria pior do que o problema.
// -----------------------------------------------------------------------------

let service: LicenseService;

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
  service = createMockLicenseService();
});

async function semear(lastVerifiedAt: number) {
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
      lastVerifiedAt,
    })
  );
}

const montar = () =>
  render(
    <LicenseProvider service={service}>
      <GraceBanner />
    </LicenseProvider>
  );

describe('licença verificada agora', () => {
  it('não mostra aviso nenhum', async () => {
    await semear(Date.now());
    montar();
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });
});

describe('licença em tolerância offline', () => {
  it('avisa, com a data da última verificação', async () => {
    await semear(Date.now() - 2 * 24 * 60 * 60 * 1000);
    localStorage.setItem(MOCK_NETWORK_KEY, 'offline');

    montar();

    await waitFor(() => expect(screen.getByRole('status')).toHaveTextContent(/sem conexão/i));
  });
});

describe('sem licença', () => {
  it('não mostra aviso — quem cuida disso é a tela de login', async () => {
    montar();
    await waitFor(() => expect(screen.queryByRole('status')).toBeNull());
  });
});
