import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';
import i18n from '../../i18n';
import { EstadoDaSessao } from './EstadoDaSessao';

// -----------------------------------------------------------------------------
// A faixa de estado do menu principal.
//
// O menu é a tela do PACIENTE — é dali que ele fala, escreve e pede ajuda.
// Encher de informação atrapalha quem está tentando comunicar. Então só entra
// o que muda uma decisão do cuidador:
//
//   - quando a calibração foi feita (uma de duas semanas atrás explica um dia
//     ruim de precisão, e nada além da data denuncia isso);
//   - se a licença está em tolerância offline (vira bloqueio em alguns dias, e
//     o cuidador precisa saber antes, não no dia em que trava).
// -----------------------------------------------------------------------------

let carimbo: number | null = null;
let statusDaLicenca = 'active';
let ultimaVerificacao: number | null = null;

vi.mock('@tracker/calibration', async (orig) => {
  const real = await orig<typeof import('@tracker/calibration')>();
  return { ...real, getCalibrationTimestampMs: () => carimbo };
});

vi.mock('../../context/LicenseContext', () => ({
  useLicense: () => ({
    status: statusDaLicenca,
    lastVerifiedAt: ultimaVerificacao,
  }),
}));

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
  carimbo = null;
  statusDaLicenca = 'active';
  ultimaVerificacao = null;
});

const montar = () =>
  render(
    <MemoryRouter initialEntries={['/menu']}>
      <Routes>
        <Route path="/menu" element={<EstadoDaSessao />} />
        <Route path="/calibration-check" element={<div>tela de calibracao</div>} />
      </Routes>
    </MemoryRouter>
  );

describe('a idade da calibração', () => {
  it('aparece quando há calibração', () => {
    carimbo = Date.now() - 3 * 24 * 60 * 60 * 1000;
    montar();
    expect(screen.getByText(/há 3 dias/i)).toBeInTheDocument();
  });

  it('diz que não há, em vez de omitir', () => {
    // Silêncio faria o cuidador supor que está calibrado.
    carimbo = null;
    montar();
    expect(screen.getByText(/sem calibração/i)).toBeInTheDocument();
  });
});

describe('recalibrar', () => {
  it('leva à calibração', () => {
    carimbo = Date.now();
    montar();
    fireEvent.click(screen.getByRole('button', { name: /recalibrar/i }));
    expect(screen.getByText('tela de calibracao')).toBeInTheDocument();
  });

  it('está disponível mesmo sem calibração — é justamente o caso', () => {
    carimbo = null;
    montar();
    expect(screen.getByRole('button', { name: /recalibrar|calibrar/i })).toBeEnabled();
  });
});

describe('a licença em tolerância offline', () => {
  it('avisa no menu, não só num banner que some entre telas', () => {
    statusDaLicenca = 'grace';
    ultimaVerificacao = Date.now() - 2 * 24 * 60 * 60 * 1000;
    montar();
    expect(screen.getByText(/sem conexão/i)).toBeInTheDocument();
  });

  it('não avisa nada quando a licença está em dia', () => {
    // A tela do paciente não ganha ruído por uma condição que não existe.
    statusDaLicenca = 'active';
    montar();
    expect(screen.queryByText(/sem conexão/i)).toBeNull();
  });
});

describe('discrição', () => {
  it('não anuncia nada com aria-live', () => {
    // Um leitor de tela relendo "calibração de hoje" a cada render competiria
    // com a comunicação, que é o propósito da tela.
    carimbo = Date.now();
    const { container } = montar();
    expect(container.querySelectorAll('[aria-live]')).toHaveLength(0);
  });
});
