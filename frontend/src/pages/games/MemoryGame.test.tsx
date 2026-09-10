import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { MemoryGame } from './MemoryGame';

vi.mock('../../context/GazeContext', () => ({
  useGaze: () => ({ subscribe: vi.fn(() => vi.fn()) }),
  useIsDwelling: () => false,
}));

const renderizar = () =>
  render(
    <BrowserRouter>
      <MemoryGame />
    </BrowserRouter>
  );

function estado(): { pares: number; jogadas: number } {
  const status = screen.getByRole('status');
  const rotulo = status.getAttribute('aria-label') ?? '';
  return {
    pares: Number(/Pares encontrados: (\d+)/.exec(rotulo)?.[1] ?? NaN),
    jogadas: Number(/Jogadas: (\d+)/.exec(rotulo)?.[1] ?? NaN),
  };
}

/** Carta pelo número exibido no aria-label, independente de estar aberta. */
const carta = (n: number) => screen.getByLabelText(new RegExp(`^Carta ${n}[,:]`));

describe('MemoryGame — Jogo da Memória', () => {
  beforeEach(() => {
    // Embaralhamento determinístico: com todos os pesos iguais o `sort` é
    // estável e o baralho fica [par1..par6, par1..par6] — a carta 1 casa com a
    // carta 7. Sem isso não dá para escrever um teste de PAR.
    vi.spyOn(Math, 'random').mockReturnValue(0.5);
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('mostra 12 cartas escondidas numa grade 4×3', () => {
    renderizar();
    expect(screen.getAllByLabelText(/^Carta \d+, escondida$/).length).toBe(12);
    expect(screen.getByLabelText('Voltar para Ajuda e Lazer')).toBeInTheDocument();
  });

  it('vira a carta olhada e conta a jogada só ao virar a segunda', () => {
    renderizar();
    expect(estado().jogadas).toBe(0);

    fireEvent.click(carta(1));
    expect(carta(1).getAttribute('aria-label')).toMatch(/^Carta 1: /);
    expect(estado().jogadas).toBe(0);

    fireEvent.click(carta(7));
    expect(estado().jogadas).toBe(1);
    expect(estado().pares).toBe(1);
  });

  /**
   * Regressão da mutação direta do state.
   *
   * A versão anterior escrevia `newCards[index].isFlipped = true` nos MESMOS
   * objetos guardados no state, e o `setTimeout` de desvirar trabalhava sobre
   * objetos já alterados por cliques posteriores — cartas ficavam viradas para
   * sempre. Aqui o par errado tem de voltar a ficar escondido.
   */
  it('desvira o par errado depois do prazo, sem deixar carta presa', () => {
    renderizar();

    fireEvent.click(carta(1));
    fireEvent.click(carta(2)); // emoji diferente
    expect(estado().jogadas).toBe(1);
    expect(estado().pares).toBe(0);
    // As duas ficam visíveis para o paciente conseguir ler.
    expect(carta(1).getAttribute('aria-label')).toMatch(/^Carta 1: /);
    expect(carta(2).getAttribute('aria-label')).toMatch(/^Carta 2: /);

    act(() => {
      vi.advanceTimersByTime(1400);
    });

    expect(carta(1).getAttribute('aria-label')).toBe('Carta 1, escondida');
    expect(carta(2).getAttribute('aria-label')).toBe('Carta 2, escondida');
    // E continuam jogáveis.
    fireEvent.click(carta(1));
    expect(carta(1).getAttribute('aria-label')).toMatch(/^Carta 1: /);
  });

  it('ignora cliques enquanto o par errado está exposto', () => {
    renderizar();
    fireEvent.click(carta(1));
    fireEvent.click(carta(2));

    fireEvent.click(carta(3)); // trava ativa
    expect(carta(3).getAttribute('aria-label')).toBe('Carta 3, escondida');
    expect(estado().jogadas).toBe(1);
  });

  it('comemora quando todos os pares são encontrados e permite jogar de novo', () => {
    renderizar();

    // Baralho determinístico: a carta n casa com a carta n+6.
    for (let n = 1; n <= 6; n++) {
      fireEvent.click(carta(n));
      fireEvent.click(carta(n + 6));
    }

    expect(estado().pares).toBe(6);
    expect(screen.getByText('Você encontrou todos os pares!')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('Jogar novamente'));
    expect(estado().pares).toBe(0);
    expect(estado().jogadas).toBe(0);
    expect(screen.getAllByLabelText(/^Carta \d+, escondida$/).length).toBe(12);
  });
});
