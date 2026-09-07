import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { GazeStatusBanner } from './GazeStatusBanner';

// -----------------------------------------------------------------------------
// Remoção permanente dos avisos de calibração, a pedido.
//
// Eram três — "Ainda não há calibração", "A calibração deixou de valer" e
// "Distância diferente da calibração" — e apareciam em TODAS as telas, porque o
// banner mora no `GazeProvider`, que envolve o app inteiro. Cobriam o topo do
// login e do onboarding, telas que o cuidador opera com mouse e teclado e onde
// não existe controle por olhar nenhum.
//
// O bloqueio que eles anunciavam continua valendo: sem calibração o dwell segue
// desligado, inclusive para o botão de emergência. Isso é afirmado em
// `GazeContext.dwell.test.tsx`. O que saiu foi o aviso, não a proteção.
//
// Os describes antigos ("o aviso de distância chega à tela" e "a ordem de
// precedência") foram junto: um teste que afirma a existência de um banner que
// não existe mais não protege nada — impede a mudança.
// -----------------------------------------------------------------------------

const semProblemas = {
  state: 'tracking',
  cameraError: null,
  calibrationInvalidated: null,
};

describe('avisos de calibração removidos', () => {
  it('não mostra nada quando falta calibração', () => {
    const { container } = render(<GazeStatusBanner {...semProblemas} state="uncalibrated" />);
    expect(container.firstChild).toBeNull();
  });

  it('não mostra nada quando a calibração deixou de valer', () => {
    const { container } = render(
      <GazeStatusBanner {...semProblemas} calibrationInvalidated="a tela mudou" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('não mostra nada quando a distância foge da calibração', () => {
    const { container } = render(
      <GazeStatusBanner {...semProblemas} distanceAdvice="você está mais perto" />
    );
    expect(container.firstChild).toBeNull();
  });

  it('nada aparece no caminho feliz', () => {
    const { container } = render(<GazeStatusBanner {...semProblemas} />);
    expect(container.firstChild).toBeNull();
  });
});

describe('o que o banner ainda faz', () => {
  it('avisa quando a câmera falha', () => {
    // Sem isto, webcam desconectada = cursor sumido e nada clicável, sem uma
    // palavra na tela. O usuário-alvo não tem como diagnosticar isso sozinho.
    render(<GazeStatusBanner {...semProblemas} cameraError="Permissão negada." />);

    expect(screen.getByTestId('gaze-status-banner')).toBeInTheDocument();
    expect(screen.getByText(/câmera não está disponível/i)).toBeInTheDocument();
  });

  it('avisa quando o rastreamento perde o rosto', () => {
    render(<GazeStatusBanner {...semProblemas} gazeLostMessage="Não estou te vendo" />);
    expect(screen.getByTestId('gaze-status-banner')).toBeInTheDocument();
  });

  it('a falha de câmera vence a perda de rosto', () => {
    // Sem câmera, dizer que o rosto sumiu responde a pergunta errada.
    render(
      <GazeStatusBanner
        {...semProblemas}
        cameraError="Permissão negada."
        gazeLostMessage="Não estou te vendo"
      />
    );
    expect(screen.getByText(/câmera não está disponível/i)).toBeInTheDocument();
  });
});
