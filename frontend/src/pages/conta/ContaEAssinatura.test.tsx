import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import i18n from '../../i18n';
import { ContaEAssinatura } from './ContaEAssinatura';

// -----------------------------------------------------------------------------
// A tela existe porque a licença pode vencer NO MEIO DO USO.
//
// Quando isso acontece, o cuidador precisa de um lugar que diga o que está
// havendo — e não de um app que simplesmente parou. Daí os quatro estados
// aparecerem com nome, inclusive os ruins.
//
// "Sair desta máquina" derruba o acesso do paciente. Confirmação obrigatória, e
// o aviso diz o que se perde e o que fica: perde o acesso, ficam a calibração e
// os perfis. Sem isso, "sair" parece apagar tudo e ninguém clica — ou clica
// achando que é só trocar de tela.
// -----------------------------------------------------------------------------

const sair = vi.fn();
let estado: Record<string, unknown> = {};

vi.mock('../../context/LicenseContext', () => ({
  useLicense: () => ({ sair, ...estado }),
}));

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
  sair.mockClear();
  estado = {
    status: 'active',
    lastVerifiedAt: Date.now(),
    license: {
      account: { email: 'gabriel@teste.com' },
      plan: { id: 'familiar', name: 'IrisFlow Familiar', validUntil: null, deviceLimit: 1 },
      token: 't',
      devicesUsed: 1,
      thisDevice: {
        deviceId: 'd1',
        deviceName: 'Computador com Windows',
        boundAt: new Date('2026-08-01T10:00:00Z').toISOString(),
      },
    },
  };
});

const montar = () =>
  render(
    <MemoryRouter initialEntries={['/conta']}>
      <Routes>
        <Route path="/conta" element={<ContaEAssinatura />} />
        <Route path="/login" element={<div>tela de login</div>} />
      </Routes>
    </MemoryRouter>
  );

describe('o que a tela mostra', () => {
  it('o e-mail da conta', () => {
    montar();
    expect(screen.getByText(/gabriel@teste\.com/)).toBeInTheDocument();
  });

  it('o nome do plano', () => {
    montar();
    expect(screen.getByText(/IrisFlow Familiar/)).toBeInTheDocument();
  });

  it('o dispositivo vinculado', () => {
    montar();
    expect(screen.getByText(/Computador com Windows/)).toBeInTheDocument();
  });

  it('validade por extenso, não ISO', () => {
    estado = {
      ...estado,
      license: {
        ...(estado.license as Record<string, unknown>),
        plan: { id: 'f', name: 'X', validUntil: '2027-03-14T00:00:00.000Z', deviceLimit: 1 },
      },
    };
    montar();
    expect(screen.queryByText(/\d{4}-\d{2}-\d{2}T/)).toBeNull();
    expect(screen.getByText(/válida até/i)).toBeInTheDocument();
  });

  it('diz que não vence, quando não vence', () => {
    montar();
    expect(screen.getByText(/sem data de expiração/i)).toBeInTheDocument();
  });
});

describe('os quatro estados aparecem com nome', () => {
  const casos = [
    ['active', /assinatura ativa/i],
    ['grace', /sem conexão/i],
    ['blocked', /não está valendo/i],
    ['none', /nenhuma assinatura/i],
  ] as const;

  for (const [st, texto] of casos) {
    it(`${st}`, () => {
      estado = { ...estado, status: st };
      montar();
      expect(screen.getByText(texto)).toBeInTheDocument();
    });
  }
});

describe('sair desta máquina', () => {
  it('não sai no primeiro clique', () => {
    // Derruba o acesso do paciente. Um clique acidental por dwell não pode
    // custar isso.
    montar();
    fireEvent.click(screen.getByRole('button', { name: /sair desta máquina/i }));
    expect(sair).not.toHaveBeenCalled();
  });

  it('avisa o que se perde E o que fica', () => {
    // "Sair" sem isso parece apagar a calibração, e ninguém clica — ou clica
    // achando que é só trocar de tela.
    montar();
    fireEvent.click(screen.getByRole('button', { name: /sair desta máquina/i }));
    expect(screen.getByText(/perde o acesso/i)).toBeInTheDocument();
    expect(screen.getByText(/ficam salvos|ficam salvas/i)).toBeInTheDocument();
  });

  it('sai depois de confirmar', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: /sair desta máquina/i }));
    fireEvent.click(screen.getByRole('button', { name: /sim, sair/i }));
    expect(sair).toHaveBeenCalled();
  });

  it('cancelar não sai', () => {
    montar();
    fireEvent.click(screen.getByRole('button', { name: /sair desta máquina/i }));
    fireEvent.click(screen.getByRole('button', { name: /cancelar/i }));
    expect(sair).not.toHaveBeenCalled();
  });
});

describe('sem licença', () => {
  it('não oferece sair de uma máquina onde ninguém entrou', () => {
    estado = { status: 'none', lastVerifiedAt: null, license: null };
    montar();
    expect(screen.queryByRole('button', { name: /sair desta máquina/i })).toBeNull();
  });
});
