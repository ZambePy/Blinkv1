import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, act, waitFor } from '@testing-library/react';
import React from 'react';
import {
  LicenseProvider,
  useLicense,
  LICENSE_KEY,
  GRACE_PERIOD_MS,
} from './LicenseContext';
import {
  createMockLicenseService,
  CONTAS_DE_TESTE,
  SENHA_DE_TESTE,
  MOCK_NETWORK_KEY,
} from '../services/license';
import { getDeviceId } from '../services/license/deviceId';
import type { LicenseService } from '../services/license';

// -----------------------------------------------------------------------------
// O ponto mais delicado do Bloco 1 é a tolerância offline.
//
// Quem usa este app tem ELA e frequentemente está sozinho. Bloquear a
// comunicação porque o Wi-Fi caiu é pior do que aceitar uma licença não
// verificada por alguns dias — mas "alguns dias" precisa ter uma borda
// definida, e é ela que estes testes prendem.
// -----------------------------------------------------------------------------

let service: LicenseService;

beforeEach(() => {
  service = createMockLicenseService();
});

/** Sonda: expõe o contexto como texto para as asserções. */
const Sonda: React.FC = () => {
  const { status, license, entrar, sair } = useLicense();
  return (
    <div>
      <span data-testid="status">{status}</span>
      <span data-testid="email">{license?.account.email ?? '—'}</span>
      <button
        data-testid="entrar"
        onClick={() => {
          void entrar(CONTAS_DE_TESTE.ativa, SENHA_DE_TESTE);
        }}
      >
        entrar
      </button>
      <button data-testid="sair" onClick={() => void sair()}>
        sair
      </button>
    </div>
  );
};

const montar = () =>
  render(
    <LicenseProvider service={service}>
      <Sonda />
    </LicenseProvider>
  );

const status = () => screen.getByTestId('status').textContent;

/** Grava uma licença como se um boot anterior a tivesse deixado. */
function semearLicenca(lastVerifiedAt: number, token = 'token-de-boot-anterior') {
  localStorage.setItem(
    LICENSE_KEY,
    JSON.stringify({
      account: { email: CONTAS_DE_TESTE.ativa },
      plan: { id: 'familiar', name: 'IrisFlow Familiar', validUntil: null, deviceLimit: 1 },
      token,
      deviceId: getDeviceId(),
      boundAt: new Date(lastVerifiedAt).toISOString(),
      lastVerifiedAt,
    })
  );
}

describe('boot sem licença nenhuma', () => {
  it('termina em "none", não em "checking" para sempre', async () => {
    montar();
    await waitFor(() => expect(status()).toBe('none'));
  });
});

describe('login', () => {
  it('leva a licença a "active" e guarda a conta', async () => {
    montar();
    await waitFor(() => expect(status()).toBe('none'));

    await act(async () => {
      screen.getByTestId('entrar').click();
    });

    await waitFor(() => expect(status()).toBe('active'));
    expect(screen.getByTestId('email').textContent).toBe(CONTAS_DE_TESTE.ativa);
  });

  it('persiste a licença, e o boot seguinte já começa ativo', async () => {
    const primeiroBoot = montar();
    await waitFor(() => expect(status()).toBe('none'));
    await act(async () => {
      screen.getByTestId('entrar').click();
    });
    await waitFor(() => expect(status()).toBe('active'));

    // Fecha o app e abre de novo: não pode pedir login outra vez.
    primeiroBoot.unmount();
    montar();

    await waitFor(() => expect(status()).toBe('active'));
    expect(screen.getByTestId('email').textContent).toBe(CONTAS_DE_TESTE.ativa);
  });
});

describe('sair', () => {
  it('volta para "none" e apaga a licença gravada', async () => {
    montar();
    await waitFor(() => expect(status()).toBe('none'));
    await act(async () => {
      screen.getByTestId('entrar').click();
    });
    await waitFor(() => expect(status()).toBe('active'));

    await act(async () => {
      screen.getByTestId('sair').click();
    });

    await waitFor(() => expect(status()).toBe('none'));
    expect(localStorage.getItem(LICENSE_KEY)).toBeNull();
  });
});

describe('tolerância offline — as bordas', () => {
  it('sem rede, licença verificada há pouco vale: entra em "grace"', async () => {
    semearLicenca(Date.now() - 60_000);
    localStorage.setItem(MOCK_NETWORK_KEY, 'offline');

    montar();

    await waitFor(() => expect(status()).toBe('grace'));
  });

  it('sem rede, um instante ANTES do limite ainda vale', async () => {
    semearLicenca(Date.now() - (GRACE_PERIOD_MS - 60_000));
    localStorage.setItem(MOCK_NETWORK_KEY, 'offline');

    montar();

    await waitFor(() => expect(status()).toBe('grace'));
  });

  it('sem rede, um instante DEPOIS do limite bloqueia', async () => {
    semearLicenca(Date.now() - (GRACE_PERIOD_MS + 60_000));
    localStorage.setItem(MOCK_NETWORK_KEY, 'offline');

    montar();

    await waitFor(() => expect(status()).toBe('blocked'));
  });
});

describe('recusa do servidor não ganha tolerância', () => {
  it('token inválido bloqueia na hora, mesmo recém-verificado', async () => {
    // Houve conversa com o servidor e a resposta foi não. Diferente de silêncio
    // da rede — aqui insistir seria contornar uma revogação.
    semearLicenca(Date.now() - 60_000, 'token-que-o-servidor-nao-conhece');

    montar();

    await waitFor(() => expect(status()).toBe('blocked'));
  });
});

describe('storage corrompido', () => {
  it('não derruba a árvore React no boot', async () => {
    // Um localStorage truncado já derrubou o SettingsContext neste projeto.
    localStorage.setItem(LICENSE_KEY, '{"account":{"email":');

    expect(() => montar()).not.toThrow();
    await waitFor(() => expect(status()).toBe('none'));
  });
});
