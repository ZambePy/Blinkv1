import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import React from 'react';
import { BrowserRouter } from 'react-router-dom';
import type { GazeSample } from '@tracker/tracker/engine';
import { DrawingGame } from './DrawingGame';

// Guarda o callback registrado pela tela para simular amostras do olhar.
const gaze = vi.hoisted(() => ({
  callback: null as ((s: GazeSample) => void) | null,
  cancelar: vi.fn(),
}));

vi.mock('../../context/GazeContext', () => ({
  useGaze: () => ({
    subscribe: (cb: (s: GazeSample) => void) => {
      gaze.callback = cb;
      return gaze.cancelar;
    },
  }),
  useIsDwelling: () => false,
}));

const amostra = (x: number, y: number, hasFace = true): GazeSample => ({
  x,
  y,
  timestamp: 0,
  hasFace,
});

const renderizar = () =>
  render(
    <BrowserRouter>
      <DrawingGame />
    </BrowserRouter>
  );

describe('DrawingGame — Desenho com Olhar', () => {
  beforeEach(() => {
    gaze.callback = null;
    gaze.cancelar.mockClear();
  });

  it('assina o fluxo do olhar ao montar e cancela ao sair', () => {
    const { unmount } = renderizar();
    expect(gaze.callback).toBeTypeOf('function');
    unmount();
    expect(gaze.cancelar).toHaveBeenCalled();
  });

  it('começa com o pincel desligado e alterna por um alvo de fixação longa', () => {
    renderizar();

    const alternar = screen.getByLabelText('Ligar o pincel');
    // Dwell longo: este botão é a única forma de PARAR de pintar.
    expect(Number(alternar.getAttribute('data-dwell-ms'))).toBeGreaterThanOrEqual(1500);
    expect(alternar).toHaveAttribute('aria-pressed', 'false');

    fireEvent.click(alternar);

    const desligar = screen.getByLabelText('Desligar o pincel');
    expect(desligar).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Pincel ligado')).toBeInTheDocument();
  });

  it('processa amostras do olhar sem quebrar, com o pincel ligado ou desligado', () => {
    renderizar();
    const emitir = () => {
      gaze.callback?.(amostra(500, 400));
      gaze.callback?.(amostra(520, 420, false)); // sem rosto: ignorada
      gaze.callback?.(amostra(-50, -50)); // fora do canvas: ignorada
    };

    expect(emitir).not.toThrow();
    fireEvent.click(screen.getByLabelText('Ligar o pincel'));
    expect(emitir).not.toThrow();
  });

  it('oferece cores, espessura, apagar e saída para o menu na barra lateral', () => {
    renderizar();

    expect(screen.getByLabelText('Cor Azul')).toBeInTheDocument();
    expect(screen.getByLabelText('Cor Vermelho')).toBeInTheDocument();
    expect(screen.getByLabelText('Cor Verde')).toBeInTheDocument();
    expect(screen.getByLabelText('Cor Amarelo')).toBeInTheDocument();
    expect(screen.getByLabelText('Apagar todo o desenho')).toBeInTheDocument();
    expect(screen.getByLabelText('Voltar para Ajuda e Lazer')).toBeInTheDocument();

    // A cor selecionada muda de fato.
    expect(screen.getByLabelText('Cor Azul')).toHaveAttribute('aria-checked', 'true');
    fireEvent.click(screen.getByLabelText('Cor Verde'));
    expect(screen.getByLabelText('Cor Verde')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByLabelText('Cor Azul')).toHaveAttribute('aria-checked', 'false');
  });

  it('cicla a espessura do pincel', () => {
    renderizar();
    const botao = () => screen.getByLabelText(/^Espessura /);
    expect(botao().getAttribute('aria-label')).toContain('Média');
    fireEvent.click(botao());
    expect(botao().getAttribute('aria-label')).toContain('Grossa');
    fireEvent.click(botao());
    expect(botao().getAttribute('aria-label')).toContain('Fina');
  });

  it('mantém o desenho por mouse para quem testa sem rastreamento', () => {
    renderizar();
    const canvas = screen.getByLabelText('Área de desenho');
    expect(() => {
      fireEvent.mouseDown(canvas, { clientX: 100, clientY: 100 });
      fireEvent.mouseMove(canvas, { clientX: 160, clientY: 140 });
      fireEvent.mouseUp(canvas);
    }).not.toThrow();
  });
});
