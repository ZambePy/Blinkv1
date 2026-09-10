import React from 'react';
import { describe, expect, it } from 'vitest';
import { render } from '@testing-library/react';
import { GazeButton, insetParaAlvoMinimo } from './GazeButton';

/**
 * O alvo isolado existe porque o "Voltar" do cabeçalho tem 180×64 px — menos
 * de um terço do alvo mínimo de 5° — e o jitter do cursor na borda zerava o
 * dwell. Sem vizinho acionável ao redor, ampliar a zona invisível não rouba
 * clique de ninguém.
 */
describe('insetParaAlvoMinimo', () => {
  it('cresce só o necessário para o lado alcançar o mínimo', () => {
    // A altura precisa de 67 px por lado (64 + 2×67 = 198); a largura já está
    // a 18 px do mínimo, e aí a zona padrão de 12 px é o piso.
    expect(insetParaAlvoMinimo(180, 64, 198)).toEqual({ x: 12, y: 67 });
    expect(insetParaAlvoMinimo(100, 100, 400)).toEqual({ x: 150, y: 150 });
  });

  it('nunca encolhe abaixo da zona padrão de 12 px', () => {
    expect(insetParaAlvoMinimo(400, 300, 198)).toEqual({ x: 12, y: 12 });
  });

  it('sem tamanho declarado, mantém a zona padrão', () => {
    expect(insetParaAlvoMinimo(undefined, undefined, 198)).toEqual({ x: 12, y: 12 });
  });
});

describe('GazeButton isolado', () => {
  it('marca a classe e publica os insets por eixo', () => {
    const { container } = render(
      <GazeButton width={180} height={64} isolado noWarn>
        Voltar
      </GazeButton>,
    );
    const botao = container.querySelector('button')!;
    expect(botao.className).toContain('gaze-button--isolado');
    expect(botao.style.getPropertyValue('--gaze-hit-inset-x')).not.toBe('');
    expect(botao.style.getPropertyValue('--gaze-hit-inset-y')).not.toBe('');
    expect(botao.querySelector('.gaze-button-hit-area')).not.toBeNull();
  });

  it('sem `isolado`, nada muda — a zona limitada continua sendo o padrão', () => {
    const { container } = render(
      <GazeButton width={180} height={64} noWarn>
        Voltar
      </GazeButton>,
    );
    const botao = container.querySelector('button')!;
    expect(botao.className).not.toContain('gaze-button--isolado');
    expect(botao.style.getPropertyValue('--gaze-hit-inset-x')).toBe('');
  });
});
