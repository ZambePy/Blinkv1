import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import { BubblePopGame } from './BubblePopGame';

vi.mock('../context/GazeContext', () => ({
  useGaze: () => ({ subscribe: vi.fn(() => vi.fn()) }),
  useIsDwelling: () => false,
}));

const renderizar = () =>
  render(
    <BrowserRouter>
      <BubblePopGame />
    </BrowserRouter>
  );

const bolhas = () => screen.queryAllByLabelText('Estourar bolha');

function pontosNoPlacar(): number {
  const status = screen.getByLabelText(/^Pontuação:/);
  const m = /Pontuação: (\d+)/.exec(status.getAttribute('aria-label') ?? '');
  return m ? Number(m[1]) : NaN;
}

describe('BubblePopGame — Estoura Bolhas', () => {
  beforeEach(() => {
    // Janela folgada: com 1024×768 o sorteio por rejeição às vezes não acha
    // lugar para a terceira bolha e o teste ficaria intermitente.
    Object.defineProperty(window, 'innerWidth', { value: 1600, writable: true });
    Object.defineProperty(window, 'innerHeight', { value: 1000, writable: true });
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('nasce com bolhas acionáveis e um caminho de saída visível', () => {
    renderizar();
    expect(bolhas().length).toBeGreaterThan(0);
    expect(screen.getByLabelText('Voltar para Ajuda e Lazer')).toBeInTheDocument();
  });

  it('só pontua quando uma bolha é estourada', () => {
    renderizar();
    expect(pontosNoPlacar()).toBe(0);

    // Tempo passando sozinho não pode pontuar.
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(pontosNoPlacar()).toBe(0);

    fireEvent.click(bolhas()[0]);
    expect(pontosNoPlacar()).toBe(1);
  });

  it('usa fixação curta (600–900 ms) nas bolhas', () => {
    renderizar();
    const dwell = Number(bolhas()[0].getAttribute('data-dwell-ms'));
    expect(dwell).toBeGreaterThanOrEqual(600);
    expect(dwell).toBeLessThanOrEqual(900);
  });

  it('encolhe a bolha a cada acerto, sem passar do piso de 130 px', () => {
    renderizar();
    const tamanhoInicial = parseFloat(bolhas()[0].style.width);
    expect(tamanhoInicial).toBe(220);

    // Estoura muitas vezes: o piso tem de segurar o encolhimento.
    for (let i = 0; i < 40; i++) {
      const atuais = bolhas();
      if (atuais.length === 0) break;
      fireEvent.click(atuais[0]);
    }

    const tamanhos = bolhas().map((b) => parseFloat(b.style.width));
    expect(Math.min(...tamanhos)).toBeLessThan(tamanhoInicial);
    expect(Math.min(...tamanhos)).toBeGreaterThanOrEqual(130);
  });

  it('nunca nasce sobre a faixa segura do topo nem sobreposta a outra bolha', () => {
    renderizar();
    const caixas = bolhas().map((b) => ({
      x: parseFloat(b.style.left) + parseFloat(b.style.width) / 2,
      y: parseFloat(b.style.top) + parseFloat(b.style.height) / 2,
      r: parseFloat(b.style.width) / 2,
      topo: parseFloat(b.style.top),
    }));

    for (const c of caixas) {
      // A faixa de 190 px no topo é onde ficam o voltar e a emergência.
      expect(c.topo).toBeGreaterThanOrEqual(190);
    }
    for (let i = 0; i < caixas.length; i++) {
      for (let j = i + 1; j < caixas.length; j++) {
        const d = Math.hypot(caixas[i].x - caixas[j].x, caixas[i].y - caixas[j].y);
        expect(d).toBeGreaterThanOrEqual(caixas[i].r + caixas[j].r);
      }
    }
  });

  it('encerra a rodada em 60 s e oferece jogar de novo', () => {
    renderizar();
    fireEvent.click(bolhas()[0]);

    act(() => {
      vi.advanceTimersByTime(60_000);
    });

    expect(screen.getByText('Fim da rodada!')).toBeInTheDocument();
    expect(bolhas().length).toBe(0);

    const jogarDeNovo = screen.getByLabelText('Jogar novamente');
    fireEvent.click(jogarDeNovo);
    expect(pontosNoPlacar()).toBe(0);
    expect(bolhas().length).toBeGreaterThan(0);
  });
});
