import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import React from 'react';
import { MemoryRouter } from 'react-router-dom';
import {
  FatigueIndicator,
  FATIGUE_BLINK_RATE_THRESHOLD,
  FATIGUE_BLINK_RATE_HYSTERESIS,
  FATIGUE_POLL_INTERVAL_MS,
  MIN_CONSECUTIVE_ABOVE,
} from './FatigueIndicator';

// D7.4 (ROADMAP §5) — testes garantem:
// (i)   aviso aparece só quando taxa >= threshold por N polls CONSECUTIVOS
//       (não em um pico isolado — evita "cry wolf");
// (ii)  histerese: só some quando cai < threshold - hysteresis (evita
//       banner piscando na zona 20-25/min);
// (iii) NUNCA aparece em rotas de emergência ou calibração (regra 2);
// (iv)  NUNCA aparece em rotas do cuidador (settings/caregiver);
// (v)   NUNCA aparece em rotas públicas (/, /login);
// (vi)  cede ao banner de degradação B4-2 (isDegraded tem prioridade).

let mockBlinkRate = 0;
let mockIsDegraded = false;

// `calibration` precisa ter IDENTIDADE ESTÁVEL entre renders — o
// `useEffect` do FatigueIndicator tem `[calibration]` como deps, e um
// objeto novo a cada render disparaia cleanup+setup do interval e
// resetaria `consecutiveAbove`/`isShowing` (perdendo o histórico
// necessário para o sustained detection funcionar). No runtime real
// isso já é garantido pelo useMemo do GazeProvider.
const stableCalibration = {
  getRecentBlinkRatePerMinute: (_windowMs?: number) => mockBlinkRate,
};

vi.mock('../context/GazeContext', () => ({
  useGaze: () => ({
    calibration: stableCalibration,
    isDegraded: mockIsDegraded,
  }),
}));

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

describe('FatigueIndicator (D7.4)', () => {
  beforeEach(() => {
    mockBlinkRate = 0;
    mockIsDegraded = false;
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const renderAt = (path: string) => render(
    <MemoryRouter initialEntries={[path]}>
      <FatigueIndicator />
    </MemoryRouter>,
  );

  const advancePolls = (n: number) => {
    act(() => { vi.advanceTimersByTime(FATIGUE_POLL_INTERVAL_MS * n + 50); });
  };

  it('não aparece com taxa abaixo do limiar (repouso normal ~17/min)', () => {
    mockBlinkRate = 17;
    renderAt('/menu');
    advancePolls(5);
    expect(screen.queryByTestId('fatigue-indicator')).toBeNull();
  });

  it('não aparece com um único pico acima do limiar (menos que MIN_CONSECUTIVE_ABOVE)', () => {
    // O useEffect roda tick SÍNCRONO no mount + tick por interval em cada
    // advancePolls. Total = 1 + advancePolls. Para ficar abaixo de MIN=3,
    // fazemos advancePolls(MIN - 2) → 1 (mount) + 1 (interval) = 2 total.
    mockBlinkRate = 30;
    renderAt('/menu');
    advancePolls(MIN_CONSECUTIVE_ABOVE - 2);
    expect(screen.queryByTestId('fatigue-indicator')).toBeNull();
  });

  it('APARECE após MIN_CONSECUTIVE_ABOVE polls acima do limiar (~30s sustentado)', () => {
    // 1 mount + (MIN-1) intervals = MIN ticks totais → atinge limiar.
    mockBlinkRate = FATIGUE_BLINK_RATE_THRESHOLD + 2;
    renderAt('/menu');
    advancePolls(MIN_CONSECUTIVE_ABOVE - 1);
    expect(screen.getByTestId('fatigue-indicator')).toBeInTheDocument();
    expect(screen.getByText(/Modo Descanso/i)).toBeInTheDocument();
  });

  it('histerese — permanece visível quando cai para a zona limiar (entre threshold-hyst e threshold)', () => {
    mockBlinkRate = FATIGUE_BLINK_RATE_THRESHOLD + 5;
    renderAt('/menu');
    advancePolls(MIN_CONSECUTIVE_ABOVE - 1);
    expect(screen.getByTestId('fatigue-indicator')).toBeInTheDocument();

    // Cai para dentro da zona de histerese
    mockBlinkRate = FATIGUE_BLINK_RATE_THRESHOLD - Math.floor(FATIGUE_BLINK_RATE_HYSTERESIS / 2);
    advancePolls(2);
    expect(screen.getByTestId('fatigue-indicator')).toBeInTheDocument();
  });

  it('some quando taxa cai claramente abaixo (threshold - hysteresis)', () => {
    mockBlinkRate = FATIGUE_BLINK_RATE_THRESHOLD + 5;
    renderAt('/menu');
    advancePolls(MIN_CONSECUTIVE_ABOVE - 1);
    expect(screen.getByTestId('fatigue-indicator')).toBeInTheDocument();

    // Cai bem abaixo do threshold - histerese
    mockBlinkRate = FATIGUE_BLINK_RATE_THRESHOLD - FATIGUE_BLINK_RATE_HYSTERESIS - 5;
    advancePolls(1);
    expect(screen.queryByTestId('fatigue-indicator')).toBeNull();
  });

  it('NUNCA aparece na rota /calibration-check, mesmo com taxa alta sustentada', () => {
    mockBlinkRate = 40;
    renderAt('/calibration-check');
    advancePolls(MIN_CONSECUTIVE_ABOVE + 2);
    expect(screen.queryByTestId('fatigue-indicator')).toBeNull();
  });

  it('NUNCA aparece na rota /emergency, mesmo com taxa alta sustentada', () => {
    mockBlinkRate = 40;
    renderAt('/emergency');
    advancePolls(MIN_CONSECUTIVE_ABOVE + 2);
    expect(screen.queryByTestId('fatigue-indicator')).toBeNull();
  });

  it('NUNCA aparece em rotas de cuidador (/settings, /caregiver/*)', () => {
    mockBlinkRate = 40;
    const { unmount } = renderAt('/settings');
    advancePolls(MIN_CONSECUTIVE_ABOVE + 2);
    expect(screen.queryByTestId('fatigue-indicator')).toBeNull();
    unmount();

    renderAt('/caregiver/dashboard');
    advancePolls(MIN_CONSECUTIVE_ABOVE + 2);
    expect(screen.queryByTestId('fatigue-indicator')).toBeNull();
  });

  it('NUNCA aparece em / ou /login', () => {
    mockBlinkRate = 40;
    const { unmount } = renderAt('/');
    advancePolls(MIN_CONSECUTIVE_ABOVE + 2);
    expect(screen.queryByTestId('fatigue-indicator')).toBeNull();
    unmount();

    renderAt('/login');
    advancePolls(MIN_CONSECUTIVE_ABOVE + 2);
    expect(screen.queryByTestId('fatigue-indicator')).toBeNull();
  });

  it('cede ao banner de degradação B4-2 (isDegraded=true suprime aviso)', () => {
    mockBlinkRate = 40;
    mockIsDegraded = true;
    renderAt('/menu');
    advancePolls(MIN_CONSECUTIVE_ABOVE + 2);
    expect(screen.queryByTestId('fatigue-indicator')).toBeNull();
  });
});
