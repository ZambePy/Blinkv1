import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import i18n from '../../../i18n';
import { VerificacaoDoMonitor } from './VerificacaoDoMonitor';

// -----------------------------------------------------------------------------
// Deste número sai a conversão de pixels para graus no relatório de precisão.
// Um erro angular calculado sobre uma diagonal chutada é um número com cara de
// medido que não é comparável com nenhum outro.
//
// Daí a regra dura desta tela: quando o EDID não responde, o campo aparece
// VAZIO. Preencher 24" "porque a maioria é 24" e apresentar isso como lido do
// monitor é o pior resultado possível aqui — pior que não ter tela nenhuma,
// porque cria confiança onde não há informação.
// -----------------------------------------------------------------------------

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
});

const montar = (props: Partial<React.ComponentProps<typeof VerificacaoDoMonitor>> = {}) =>
  render(<VerificacaoDoMonitor diagonalDoEdid={23.6} aoMudar={vi.fn()} {...props} />);

const campo = () => screen.getByLabelText(/diagonal em polegadas/i) as HTMLInputElement;

describe('quando o EDID respondeu', () => {
  it('mostra o valor lido do monitor', () => {
    montar();
    expect(screen.getByText(/23\.6 polegadas/i)).toBeInTheDocument();
  });

  it('já reporta o valor lido, marcado como vindo do EDID', () => {
    const aoMudar = vi.fn();
    montar({ aoMudar });
    expect(aoMudar).toHaveBeenCalledWith(23.6, 'edid');
  });

  it('corrigir à mão marca a origem como manual', () => {
    // O relatório precisa distinguir: um número digitado e um lido do monitor
    // não têm a mesma confiança.
    const aoMudar = vi.fn();
    montar({ aoMudar });

    fireEvent.change(campo(), { target: { value: '27' } });

    expect(aoMudar).toHaveBeenLastCalledWith(27, 'manual');
  });
});

describe('quando o EDID não respondeu', () => {
  it('deixa o campo VAZIO em vez de chutar um valor plausível', () => {
    montar({ diagonalDoEdid: null });
    expect(campo().value).toBe('');
  });

  it('não reporta valor nenhum enquanto o campo estiver vazio', () => {
    // Reportar um default aqui viraria um erro angular calculado sobre um
    // número que ninguém mediu.
    const aoMudar = vi.fn();
    montar({ diagonalDoEdid: null, aoMudar });
    expect(aoMudar).toHaveBeenCalledWith(null, 'manual');
  });

  it('explica o custo de não ter o valor', () => {
    montar({ diagonalDoEdid: null });
    expect(screen.getByText(/vira estimativa/i)).toBeInTheDocument();
  });

  it('diz como medir, canto a canto e sem a moldura', () => {
    montar({ diagonalDoEdid: null });
    expect(screen.getByText(/sem a moldura/i)).toBeInTheDocument();
  });
});

describe('validação', () => {
  it('recusa um número fora da faixa plausível de monitor', () => {
    const aoMudar = vi.fn();
    montar({ diagonalDoEdid: null, aoMudar });

    fireEvent.change(campo(), { target: { value: '200' } });

    expect(screen.getByRole('alert')).toHaveTextContent(/entre 10 e 60/i);
    expect(aoMudar).toHaveBeenLastCalledWith(null, 'manual');
  });

  it('recusa texto', () => {
    const aoMudar = vi.fn();
    montar({ diagonalDoEdid: null, aoMudar });

    fireEvent.change(campo(), { target: { value: 'vinte e quatro' } });

    expect(aoMudar).toHaveBeenLastCalledWith(null, 'manual');
  });

  it('aceita decimal com ponto — 23.6 é um tamanho real', () => {
    const aoMudar = vi.fn();
    montar({ diagonalDoEdid: null, aoMudar });

    fireEvent.change(campo(), { target: { value: '23.6' } });

    expect(aoMudar).toHaveBeenLastCalledWith(23.6, 'manual');
  });

  it('aceita decimal com vírgula — é como se digita em português', () => {
    const aoMudar = vi.fn();
    montar({ diagonalDoEdid: null, aoMudar });

    fireEvent.change(campo(), { target: { value: '23,6' } });

    expect(aoMudar).toHaveBeenLastCalledWith(23.6, 'manual');
  });
});
