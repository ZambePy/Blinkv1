import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { FramingIndicator } from './FramingIndicator';
import {
  DISTANCIA_OK_MIN_CM,
  DISTANCIA_OK_MAX_CM,
  FOV_DE_REFERENCIA_DEG,
  iodFractionParaDistancia,
} from '@tracker/setupReadiness';

// -----------------------------------------------------------------------------
// Este widget tinha a QUARTA implementação de "que distância é boa" no projeto,
// com banda própria `iod ∈ [0.18, 0.26]` cravada no componente. Em centímetros,
// com o FOV de referência, isso é 25–36 cm: praticamente colado no monitor.
//
// E comparava contra `framing.iod`, que o engine documenta como "normalizado e
// ANISOTRÓPICO, porque x divide por largura e y por altura" — grandeza
// diferente da fração para a qual bandas assim foram pensadas.
//
// A correção não é ajustar o número. É o widget deixar de decidir: distância
// boa passa a ser uma definição só, a do `setupReadiness`, em centímetros.
// -----------------------------------------------------------------------------

let framing: Record<string, unknown> | null = null;
let video = { width: 1920, height: 1080 };

vi.mock('../../context/GazeContext', () => ({
  useGaze: () => ({
    state: 'tracking',
    getDiagnostics: () => (framing ? { framing, video } : null),
  }),
}));

vi.mock('../../context/SettingsContext', () => ({
  useSettings: () => ({ settings: { cameraHorizontalFovDeg: FOV_DE_REFERENCIA_DEG } }),
}));

beforeEach(() => {
  vi.useFakeTimers();
  video = { width: 1920, height: 1080 };
});

/** Monta o widget com o rosto na distância pedida. */
function aDistanciaDe(cm: number) {
  const iodPx = iodFractionParaDistancia(cm, FOV_DE_REFERENCIA_DEG) * video.width;
  framing = {
    hasFace: true,
    iod: 0.11,
    iodPx,
    faceCenter: { x: 0.5, y: 0.5 },
    specularRatio: 0,
    specularStability: 1,
  };
  render(<FramingIndicator />);
  act(() => {
    vi.advanceTimersByTime(300);
  });
}

/** O VALOR, não o rótulo "Distância da Tela" que fica acima dele. */
const valorDaDistancia = () => screen.getByText(/\d+\s*cm|medindo/i).textContent ?? '';
const mandaAproximar = () => screen.queryByText(/aproxime/i) !== null;
const mandaAfastar = () => screen.queryByText(/afaste/i) !== null;

describe('a faixa de trabalho real não é reclamada', () => {
  it(`${DISTANCIA_OK_MIN_CM} cm está bom`, () => {
    aDistanciaDe(DISTANCIA_OK_MIN_CM);
    expect(mandaAproximar()).toBe(false);
    expect(mandaAfastar()).toBe(false);
  });

  it('60 cm está bom', () => {
    aDistanciaDe(60);
    expect(mandaAproximar()).toBe(false);
    expect(mandaAfastar()).toBe(false);
  });

  it(`${DISTANCIA_OK_MAX_CM} cm está bom`, () => {
    aDistanciaDe(DISTANCIA_OK_MAX_CM);
    expect(mandaAproximar()).toBe(false);
    expect(mandaAfastar()).toBe(false);
  });

  it('70 cm — o topo da faixa medida em uso — não manda aproximar', () => {
    // O sintoma relatado: a 70 cm o widget dizia "Muito longe (Aproxime-se)".
    aDistanciaDe(70);
    expect(mandaAproximar()).toBe(false);
  });
});

describe('fora da faixa, aponta o lado certo', () => {
  it('longe demais manda aproximar', () => {
    aDistanciaDe(DISTANCIA_OK_MAX_CM + 25);
    expect(mandaAproximar()).toBe(true);
  });

  it('perto demais manda afastar', () => {
    aDistanciaDe(DISTANCIA_OK_MIN_CM - 20);
    expect(mandaAfastar()).toBe(true);
  });
});

describe('mostra o número, não só o veredito', () => {
  it('cita a distância medida em cm', () => {
    // "Muito longe" sem número não diz quanto mexer.
    aDistanciaDe(90);
    expect(valorDaDistancia()).toMatch(/90\s*cm/);
  });
});

describe('sem como medir centímetros', () => {
  it('não inventa veredito quando falta a largura do vídeo', () => {
    video = { width: 0, height: 0 };
    framing = {
      hasFace: true,
      iod: 0.11,
      iodPx: 200,
      faceCenter: { x: 0.5, y: 0.5 },
      specularRatio: 0,
      specularStability: 1,
    };
    render(<FramingIndicator />);
    act(() => {
      vi.advanceTimersByTime(300);
    });

    expect(mandaAproximar()).toBe(false);
    expect(mandaAfastar()).toBe(false);
  });
});
