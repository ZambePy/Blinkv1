import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { FramingIndicator } from './FramingIndicator';

// -----------------------------------------------------------------------------
// Este componente produzia a caixa vermelha "Reflexo detectado!" que aparecia o
// tempo todo com óculos.
//
// A regra dele era `specular > 0.02` — QUADRO A QUADRO, sem janela nenhuma.
// Os outros dois consumidores do mesmo sinal exigem persistência:
// `calibration.ts` pede reflexo em >30% dos quadros do ponto, e o próprio
// módulo documenta que "um único frame com specular alto é ruído (piscada de
// luz, cursor branco cruzando o crop)".
//
// Este componente estava ÓRFÃO até ser montado no preparo de ambiente, então
// ninguém tinha percebido que ele ignorava a regra do projeto.
//
// A correção usa a mesma medida que o resto passou a usar: a mancha só
// atrapalha se ela SE MOVE. Parada é a assinatura do próprio óculos, e o
// rastreamento enxerga em volta dela.
// -----------------------------------------------------------------------------

let framing: Record<string, unknown> | null = null;

vi.mock('../../context/GazeContext', () => ({
  useGaze: () => ({
    state: 'tracking',
    getDiagnostics: () => (framing ? { framing } : null),
  }),
}));

const base = {
  hasFace: true,
  iod: 0.11,
  faceCenter: { x: 0.5, y: 0.5 },
};

beforeEach(() => {
  vi.useFakeTimers();
  framing = null;
});

function montarCom(over: Record<string, unknown>) {
  framing = { ...base, ...over };
  render(<FramingIndicator />);
  // O componente amostra por intervalo.
  act(() => {
    vi.advanceTimersByTime(300);
  });
}

const acusouReflexo = () => screen.queryByText(/reflexo detectado/i) !== null;

describe('assinatura de óculos — brilho parado', () => {
  it('não acusa, por mais forte que seja', () => {
    // O caso relatado: acusava, o usuário calibrava mesmo assim, e o erro saía
    // normal. Um aviso que não prevê degradação treina a pessoa a ignorar
    // avisos.
    montarCom({ specularRatio: 0.09, specularStability: 0.95 });
    expect(acusouReflexo()).toBe(false);
  });

  it('não acusa nem no limiar antigo de 2%', () => {
    montarCom({ specularRatio: 0.021, specularStability: 0.9 });
    expect(acusouReflexo()).toBe(false);
  });
});

describe('reflexo que atrapalha — brilho em movimento', () => {
  it('acusa', () => {
    montarCom({ specularRatio: 0.09, specularStability: 0.1 });
    expect(acusouReflexo()).toBe(true);
  });
});

describe('sem brilho', () => {
  it('não acusa, com estabilidade qualquer', () => {
    montarCom({ specularRatio: 0, specularStability: 0 });
    expect(acusouReflexo()).toBe(false);
  });
});

describe('sem a medida de estabilidade', () => {
  it('não acusa por um quadro só — a regra que o projeto já documentava', () => {
    // Compatibilidade com quadro em que o campo não foi preenchido. O antigo
    // acusaria aqui; o defeito era exatamente esse.
    montarCom({ specularRatio: 0.09 });
    expect(acusouReflexo()).toBe(false);
  });
});
