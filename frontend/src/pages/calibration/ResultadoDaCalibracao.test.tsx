import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import i18n from '../../i18n';
import { ResultadoDaCalibracao } from './ResultadoDaCalibracao';
import type { CalibrationFitDiagnostics } from '@tracker/calibration';

// -----------------------------------------------------------------------------
// O resultado em linguagem de cuidador.
//
// A regra que não pode ceder: REFAZER NUNCA É OBRIGATÓRIO. Mesmo no pior
// veredito, seguir continua disponível — quem decide é o cuidador, que sabe
// coisas que o software não sabe: o paciente está cansado, a luz vai melhorar,
// a consulta é daqui a pouco.
// -----------------------------------------------------------------------------

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
});

const diag = (veredicto: string, over: Record<string, unknown> = {}) =>
  ({
    trainErrorPx: 50,
    looErrorPx: 70,
    looByTarget: [],
    poseMean: null,
    poseStd: null,
    poseDrift: { targets: 8, yawDeg: 1, pitchDeg: 1, rollDeg: 1 },
    gridDiagnosis: {
      veredicto,
      centroPx: 100,
      periferiaPx: 110,
      razao: 1.1,
      piorAlvoPx: 150,
      mensagem: null,
    },
    ...over,
  }) as unknown as CalibrationFitDiagnostics;

const montar = (d: CalibrationFitDiagnostics | null) =>
  render(
    <MemoryRouter>
      <ResultadoDaCalibracao diagnostico={d} aoSeguir={vi.fn()} />
    </MemoryRouter>
  );

const seguir = () => screen.getByRole('button', { name: /seguir/i });
const refazer = () => screen.getByRole('button', { name: /refazer/i });

describe('os tres vereditos chegam a tela', () => {
  it('bom', () => {
    montar(diag('ok'));
    expect(screen.getByText(/boa calibração/i)).toBeInTheDocument();
  });

  it('aceitavel', () => {
    montar(diag('periferia_fora_de_alcance'));
    expect(screen.getByText(/aceitável/i)).toBeInTheDocument();
  });

  it('refazer', () => {
    montar(diag('sessao_ruim'));
    expect(screen.getByText(/vale refazer/i)).toBeInTheDocument();
  });
});

describe('refazer nunca e obrigatorio', () => {
  it('seguir continua habilitado no pior veredito', () => {
    montar(diag('sessao_ruim'));
    expect(seguir()).toBeEnabled();
  });

  it('a tela diz em voz alta que refazer e opcional', () => {
    montar(diag('sessao_ruim'));
    expect(screen.getByText(/sempre opcional|quem decide é você/i)).toBeInTheDocument();
  });

  it('nenhum botao aparece desabilitado', () => {
    const { container } = montar(diag('sessao_ruim'));
    expect(container.querySelectorAll('button[disabled]')).toHaveLength(0);
  });
});

describe('o motivo vem antes do numero', () => {
  it('deriva postural e dita com todas as letras', () => {
    montar(
      diag('sessao_ruim', { poseDrift: { targets: 8, yawDeg: 4.5, pitchDeg: 1, rollDeg: 1 } })
    );
    expect(screen.getByText(/cabeça mudou de posição/i)).toBeInTheDocument();
  });

  it('e explica que recalibrar sem corrigir repete o resultado', () => {
    montar(
      diag('sessao_ruim', { poseDrift: { targets: 8, yawDeg: 4.5, pitchDeg: 1, rollDeg: 1 } })
    );
    expect(screen.getByText(/repete o resultado/i)).toBeInTheDocument();
  });

  it('o motivo aparece no DOM antes do numero', () => {
    const { container } = montar(diag('sessao_ruim'));
    const texto = container.textContent ?? '';
    const posMotivo = texto.search(/luz ou distância/i);
    const posNumero = texto.search(/erro médio da calibração/i);
    expect(posMotivo).toBeGreaterThanOrEqual(0);
    expect(posNumero).toBeGreaterThan(posMotivo);
  });
});

describe('os numeros ficam visiveis para quem mede', () => {
  it('mostra o erro em px', () => {
    montar(diag('ok', { looErrorPx: 123 }));
    expect(screen.getByText(/123 px/)).toBeInTheDocument();
  });

  it('mostra a deriva em graus', () => {
    montar(diag('ok', { poseDrift: { targets: 8, yawDeg: 2.5, pitchDeg: 1, rollDeg: 1 } }));
    expect(screen.getByText(/2,5°/)).toBeInTheDocument();
  });
});

describe('sem diagnostico', () => {
  it('nao manda refazer nem inventa numero', () => {
    montar(null);
    expect(screen.queryByText(/vale refazer/i)).toBeNull();
    expect(screen.queryByText(/erro médio da calibração/i)).toBeNull();
  });
});
