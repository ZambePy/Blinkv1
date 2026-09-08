import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import React from 'react';
import i18n from '../../i18n';
import { HistoricoDeSessoes } from './HistoricoDeSessoes';
import type { CalibrationLog } from '../../utils/clinicalLogger';

// -----------------------------------------------------------------------------
// A curva de acurácia ao longo do tempo — o argumento clínico do produto.
//
// A regra que não pode ceder: medições HERDADAS aparecem marcadas. Elas vêm de
// antes da separação por paciente e podem ser de outra pessoa desta máquina.
// Apresentá-las junto sem marca faria a curva parecer o acompanhamento de um
// paciente quando talvez seja de dois — e quem lê não teria como perceber.
// -----------------------------------------------------------------------------

let medicoes: CalibrationLog[] = [];

vi.mock('../../utils/clinicalLogger', () => ({
  getClinicalData: () => ({ sentences: [], calibrations: medicoes }),
}));

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
  medicoes = [];
});

const cal = (errorDeg: number, dia: string, herdado = false): CalibrationLog => ({
  id: dia,
  errorDeg,
  timestamp: `2026-09-${dia}T10:00:00.000Z`,
  ...(herdado ? { herdado: true } : {}),
});

const montar = () => render(<HistoricoDeSessoes />);

describe('sem medicoes', () => {
  it('diz que nao ha, em vez de mostrar tela vazia', () => {
    montar();
    expect(screen.getByText(/ainda não há medições/i)).toBeInTheDocument();
  });
});

describe('com uma medicao so', () => {
  it('nao desenha evolucao de um ponto so', () => {
    medicoes = [cal(2.4, '01')];
    montar();
    expect(screen.getByText(/a partir da segunda/i)).toBeInTheDocument();
  });
});

describe('com historico', () => {
  beforeEach(() => {
    medicoes = [cal(3.2, '01'), cal(2.8, '03'), cal(2.1, '05')];
  });

  it('mostra todas as medicoes', () => {
    montar();
    expect(screen.getAllByText(/°/).length).toBeGreaterThanOrEqual(3);
  });

  it('a mais recente vem primeiro', () => {
    const { container } = montar();
    const texto = container.textContent ?? '';
    expect(texto.indexOf('2,1')).toBeLessThan(texto.indexOf('3,2'));
  });

  it('resume melhor e pior', () => {
    montar();
    expect(screen.getByText(/melhor: 2,1/i)).toBeInTheDocument();
    expect(screen.getByText(/pior: 3,2/i)).toBeInTheDocument();
  });
});

describe('medicoes herdadas', () => {
  it('aparecem marcadas', () => {
    medicoes = [cal(3.2, '01', true), cal(2.1, '05')];
    montar();
    expect(screen.getAllByText(/herdado/i).length).toBeGreaterThanOrEqual(1);
  });

  it('a tela explica o que herdado significa', () => {
    medicoes = [cal(3.2, '01', true), cal(2.1, '05')];
    montar();
    expect(screen.getByText(/podem incluir medições de outra pessoa/i)).toBeInTheDocument();
  });

  it('sem herdadas, o aviso nao aparece', () => {
    // Nao poluir a tela com uma ressalva que nao se aplica.
    medicoes = [cal(2.1, '05'), cal(2.4, '03')];
    montar();
    expect(screen.queryByText(/podem incluir medições de outra pessoa/i)).toBeNull();
  });
});
