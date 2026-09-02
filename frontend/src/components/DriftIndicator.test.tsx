import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import { DriftIndicator } from './DriftIndicator';

let mockBias: { x: number; y: number; samples: number } = { x: 0, y: 0, samples: 0 };
let mockIsDegraded = false;

vi.mock('../context/GazeContext', () => ({
  useGaze: () => ({
    calibration: {
      getSessionBias: () => mockBias,
    },
    isDegraded: mockIsDegraded,
  }),
}));

// GazeButton depende de useDwell/DwellContext no runtime; mockamos como
// um botão HTML simples para isolar o teste do sistema de gaze. Filtra
// props não-DOM (noWarn, emergency, etc.) para não poluir o log com
// warnings do React sobre atributos desconhecidos.
vi.mock('./ui/GazeButton', () => ({
  GazeButton: ({ children, onClick, style, ...rest }: React.PropsWithChildren<{ onClick?: () => void; style?: React.CSSProperties; [k: string]: unknown }>) => {
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { noWarn, emergency, width, height, ...domRest } = rest as Record<string, unknown>;
    return (
      <button type="button" onClick={onClick} style={style} {...(domRest as React.ButtonHTMLAttributes<HTMLButtonElement>)}>
        {children}
      </button>
    );
  },
}));

describe('DriftIndicator', () => {
  beforeEach(() => {
    mockBias = { x: 0, y: 0, samples: 0 };
    mockIsDegraded = false;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const renderAt = (path: string) => render(
    <MemoryRouter initialEntries={[path]}>
      <DriftIndicator />
    </MemoryRouter>,
  );

  const advanceOnePoll = () => act(() => { vi.advanceTimersByTime(1100); });

  it('não aparece quando bias.samples < 20 (drift ainda é ruído)', () => {
    mockBias = { x: 0.10, y: 0.10, samples: 5 }; // magnitude grande mas amostras pouca
    renderAt('/menu');
    advanceOnePoll();
    expect(screen.queryByTestId('drift-indicator')).toBeNull();
  });

  it('não aparece quando |bias| está abaixo de 5% da tela', () => {
    mockBias = { x: 0.02, y: 0.02, samples: 50 }; // magnitude ~0.028 < 0.05
    renderAt('/menu');
    advanceOnePoll();
    expect(screen.queryByTestId('drift-indicator')).toBeNull();
  });

  it('APARECE quando |bias| > 5% da tela e há amostras suficientes', () => {
    mockBias = { x: 0.06, y: 0.06, samples: 50 }; // magnitude ~0.085 > 0.05
    renderAt('/menu');
    advanceOnePoll();
    expect(screen.getByTestId('drift-indicator')).toBeInTheDocument();
    expect(screen.getByText(/Recalibração rápida recomendada/i)).toBeInTheDocument();
  });

  it('NUNCA aparece na rota /calibration-check, mesmo com drift alto', () => {
    mockBias = { x: 0.20, y: 0.20, samples: 100 };
    renderAt('/calibration-check');
    advanceOnePoll();
    expect(screen.queryByTestId('drift-indicator')).toBeNull();
  });

  it('NUNCA aparece na rota /emergency, mesmo com drift alto', () => {
    mockBias = { x: 0.20, y: 0.20, samples: 100 };
    renderAt('/emergency');
    advanceOnePoll();
    expect(screen.queryByTestId('drift-indicator')).toBeNull();
  });

  it('NUNCA aparece em rotas de cuidador (/settings, /caregiver/*)', () => {
    mockBias = { x: 0.20, y: 0.20, samples: 100 };
    const { unmount } = renderAt('/settings');
    advanceOnePoll();
    expect(screen.queryByTestId('drift-indicator')).toBeNull();
    unmount();

    renderAt('/caregiver/dashboard');
    advanceOnePoll();
    expect(screen.queryByTestId('drift-indicator')).toBeNull();
  });

  it('NUNCA aparece em / ou /login (rotas públicas de onboarding)', () => {
    mockBias = { x: 0.20, y: 0.20, samples: 100 };
    const { unmount } = renderAt('/');
    advanceOnePoll();
    expect(screen.queryByTestId('drift-indicator')).toBeNull();
    unmount();

    renderAt('/login');
    advanceOnePoll();
    expect(screen.queryByTestId('drift-indicator')).toBeNull();
  });

  it('some quando isDegraded=true (banner de degradação tem prioridade)', () => {
    mockBias = { x: 0.20, y: 0.20, samples: 100 };
    mockIsDegraded = true;
    renderAt('/menu');
    advanceOnePoll();
    expect(screen.queryByTestId('drift-indicator')).toBeNull();
  });

  it('atualiza a decisão quando o bias muda entre ticks (não é one-shot)', () => {
    // Começa abaixo do threshold
    mockBias = { x: 0.01, y: 0.01, samples: 100 };
    renderAt('/menu');
    advanceOnePoll();
    expect(screen.queryByTestId('drift-indicator')).toBeNull();

    // Bias cresce — próximo poll deve mostrar
    mockBias = { x: 0.10, y: 0.10, samples: 100 };
    advanceOnePoll();
    expect(screen.getByTestId('drift-indicator')).toBeInTheDocument();

    // E volta a esconder se recalibrar reset o bias
    mockBias = { x: 0, y: 0, samples: 0 };
    advanceOnePoll();
    expect(screen.queryByTestId('drift-indicator')).toBeNull();
  });
});
