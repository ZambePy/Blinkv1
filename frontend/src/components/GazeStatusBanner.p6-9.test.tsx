import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import '@testing-library/jest-dom';
import React from 'react';
import { GazeStatusBanner } from './GazeStatusBanner';
import { mensagemPara } from '@tracker/distanceAdvisory';

// -----------------------------------------------------------------------------
// P6.9 — o aceite pede que "o texto do banner diga a direção correta".
//
// `distanceAdvisory.test.ts` cobre a máquina de estados e o texto. Este arquivo
// cobre o que faltava: que o texto CHEGA à tela, e que a ordem de precedência
// não o deixa aparecer quando há coisa mais grave acontecendo.
// -----------------------------------------------------------------------------

const semProblemas = {
  state: 'tracking',
  cameraError: null,
  calibrationInvalidated: null,
};

describe('o aviso de distância chega à tela', () => {
  it('perto demais: o banner manda AFASTAR', () => {
    render(<GazeStatusBanner {...semProblemas} distanceAdvice={mensagemPara('perto')} />);
    expect(screen.getByTestId('gaze-status-banner')).toBeInTheDocument();
    expect(screen.getByText(/afaste-se/i)).toBeInTheDocument();
  });

  it('longe demais: o banner manda APROXIMAR', () => {
    render(<GazeStatusBanner {...semProblemas} distanceAdvice={mensagemPara('longe')} />);
    expect(screen.getByText(/aproxime-se/i)).toBeInTheDocument();
  });

  it('dentro da faixa: banner nenhum', () => {
    const { container } = render(
      <GazeStatusBanner {...semProblemas} distanceAdvice={mensagemPara('dentro')} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('sem a prop, nada muda — a compatibilidade é preservada', () => {
    const { container } = render(<GazeStatusBanner {...semProblemas} />);
    expect(container).toBeEmptyDOMElement();
  });
});

describe('a ordem de precedência', () => {
  it('erro de câmera VENCE o aviso de distância', () => {
    // Sem câmera, a distância não importa — e empilhar dois banners num
    // software assistivo é pior que mostrar só o mais grave.
    render(
      <GazeStatusBanner
        {...semProblemas}
        cameraError="Dispositivo em uso."
        distanceAdvice={mensagemPara('perto')}
      />,
    );
    expect(screen.getByText(/câmera não está disponível/i)).toBeInTheDocument();
    expect(screen.queryByText(/afaste-se/i)).not.toBeInTheDocument();
  });

  it('calibração invalidada VENCE o aviso de distância', () => {
    render(
      <GazeStatusBanner
        {...semProblemas}
        calibrationInvalidated="O pipeline mudou."
        distanceAdvice={mensagemPara('longe')}
      />,
    );
    expect(screen.getByText(/calibração deixou de valer/i)).toBeInTheDocument();
    expect(screen.queryByText(/aproxime-se/i)).not.toBeInTheDocument();
  });

  it('falta de calibração VENCE o aviso de distância', () => {
    // Faz sentido físico: sem calibração não há distância de referência contra
    // a qual comparar. O aviso seria sobre um número que não existe.
    render(
      <GazeStatusBanner
        {...semProblemas}
        state="uncalibrated"
        distanceAdvice={mensagemPara('perto')}
      />,
    );
    expect(screen.getByText(/ainda não há calibração/i)).toBeInTheDocument();
    expect(screen.queryByText(/afaste-se/i)).not.toBeInTheDocument();
  });

  it('o aviso de distância usa tom de AVISO, não de erro', () => {
    // O sistema continua funcionando, só com precisão pior que a calibrada.
    // Tratar isso como erro ensinaria o cuidador a ignorar banners vermelhos —
    // e aí o banner que importa de verdade também seria ignorado.
    // ⚠️ O React renderiza `style` como `rgb(...)`, não como hex — procurar
    // por '78350f' no HTML nunca casa.
    const aviso = render(<GazeStatusBanner {...semProblemas} distanceAdvice={mensagemPara('perto')} />);
    const cardAviso = aviso.getByTestId('gaze-status-banner').firstElementChild as HTMLElement;
    aviso.unmount();

    const erro = render(<GazeStatusBanner {...semProblemas} cameraError="x" />);
    const cardErro = erro.getByTestId('gaze-status-banner').firstElementChild as HTMLElement;

    // Âmbar (#78350f) para aviso, vermelho (#7f1d1d) para erro.
    expect(cardAviso.style.backgroundColor).toBe('rgb(120, 53, 15)');
    expect(cardErro.style.backgroundColor).toBe('rgb(127, 29, 29)');
    expect(cardAviso.style.backgroundColor).not.toBe(cardErro.style.backgroundColor);
  });
});
