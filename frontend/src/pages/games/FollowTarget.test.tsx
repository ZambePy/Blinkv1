import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { FollowTarget } from './FollowTarget';

vi.mock('../../context/GazeContext', () => ({
  useGaze: () => ({ subscribe: vi.fn(() => vi.fn()) }),
  useIsDwelling: () => false,
}));

const renderizar = () =>
  render(
    <BrowserRouter>
      <FollowTarget />
    </BrowserRouter>
  );

/** Placar de acertos lido do cabeçalho, que expõe os números via aria-label. */
function acertosNoPlacar(): number {
  const status = screen.getByRole('status');
  const m = /Acertos: (\d+)\./.exec(status.getAttribute('aria-label') ?? '');
  return m ? Number(m[1]) : NaN;
}

function perdidosNoPlacar(): number {
  const status = screen.getByRole('status');
  const m = /perdidos: (\d+)\./.exec(status.getAttribute('aria-label') ?? '');
  return m ? Number(m[1]) : NaN;
}

describe('FollowTarget — Siga o Alvo', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  /**
   * ESTE É O TESTE QUE IMPORTA.
   *
   * A versão anterior chamava `setScore(s => s + 1)` de dentro do
   * `moveTarget()` disparado por um `setInterval`: o placar subia sozinho, sem
   * o paciente fixar coisa alguma. Se alguém reintroduzir isso, este caso
   * falha — o tempo passa, os alvos trocam, e os acertos têm de continuar em 0.
   */
  it('não pontua sozinho: só o tempo passando nunca aumenta os acertos', () => {
    renderizar();
    expect(acertosNoPlacar()).toBe(0);

    // Vários prazos de alvo (4 s cada) sem nenhuma interação.
    act(() => {
      vi.advanceTimersByTime(20_000);
    });

    expect(acertosNoPlacar()).toBe(0);
    // Os alvos que expiraram viram ERRO — essa é a única coisa que o relógio
    // pode mexer.
    expect(perdidosNoPlacar()).toBeGreaterThan(0);
  });

  it('conta acerto apenas quando o alvo é efetivamente fixado', () => {
    renderizar();

    fireEvent.click(screen.getByLabelText('Fixar o alvo'));
    expect(acertosNoPlacar()).toBe(1);
    expect(perdidosNoPlacar()).toBe(0);

    fireEvent.click(screen.getByLabelText('Fixar o alvo'));
    expect(acertosNoPlacar()).toBe(2);
  });

  it('um alvo já resolvido não conta duas vezes quando o prazo dele vence', () => {
    renderizar();

    fireEvent.click(screen.getByLabelText('Fixar o alvo'));
    expect(acertosNoPlacar()).toBe(1);

    // O prazo do alvo JÁ ACERTADO vence agora; ele não pode virar erro.
    act(() => {
      vi.advanceTimersByTime(3_900);
    });
    expect(perdidosNoPlacar()).toBe(0);
    expect(acertosNoPlacar()).toBe(1);
  });

  it('fecha a rodada mostrando acertos, perdidos e o tempo médio até acertar', () => {
    renderizar();

    // 12 alvos na rodada: acerta todos, com 1 s entre um e outro.
    for (let i = 0; i < 12; i++) {
      const alvo = screen.queryByLabelText('Fixar o alvo');
      if (!alvo) break;
      act(() => {
        vi.advanceTimersByTime(1000);
      });
      fireEvent.click(alvo);
    }

    expect(screen.getByText('Rodada concluída')).toBeInTheDocument();
    expect(screen.getByText('Tempo médio até acertar')).toBeInTheDocument();
    // 1 s entre a criação do alvo e o clique → média de 1,0 s.
    expect(screen.getByText('1.0 s')).toBeInTheDocument();
    expect(screen.getByLabelText('Jogar novamente')).toBeInTheDocument();
    // Saída para o menu continua disponível na tela de fim.
    expect(screen.getAllByLabelText('Voltar para Ajuda e Lazer').length).toBeGreaterThan(0);
  });

  it('mantém uma saída para o menu visível durante o jogo', () => {
    renderizar();
    expect(screen.getByLabelText('Voltar para Ajuda e Lazer')).toBeInTheDocument();
  });
});
