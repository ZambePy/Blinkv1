import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act, waitFor } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import type { GazeSample } from '../context/GazeContext';
import type { MotivoDeSaida } from '@tracker/computador/protocolo';
import { useModoComputador } from './useModoComputador';
import type { PonteDoModoComputador } from './ponte';

// O hook só precisa de `subscribe` (olhar) e `settings.dwellMs`.
const assinantes = new Set<(s: GazeSample) => void>();
const suspenderDwell = vi.fn();
vi.mock('../context/GazeContext', () => ({
  suspenderDwell: (v: boolean) => suspenderDwell(v),
  useGaze: () => ({
    subscribe: (cb: (s: GazeSample) => void) => {
      assinantes.add(cb);
      return () => assinantes.delete(cb);
    },
  }),
}));
vi.mock('../context/SettingsContext', () => ({ useSettings: () => ({ settings: { dwellMs: 1200 } }) }));

function pontoFalsa() {
  let aoParar: ((m: MotivoDeSaida) => void) | null = null;
  const olhares: unknown[] = [];
  const ponte: PonteDoModoComputador & { simularParada: (m: MotivoDeSaida) => void; olhares: unknown[]; iniciar: ReturnType<typeof vi.fn> } = {
    capacidades: vi.fn(async () => ({ suportado: true, plataforma: 'win32', mouse: true, teclado: true, lupa: true })),
    iniciar: vi.fn(async () => ({ ok: true as const })),
    parar: vi.fn(async () => {}),
    olhar: (a) => olhares.push(a),
    onParou: (cb) => { aoParar = cb; return () => { aoParar = null; }; },
    simularParada: (m) => aoParar?.(m),
    olhares,
  };
  return ponte;
}

const Tela: React.FC<{ ponte: PonteDoModoComputador }> = ({ ponte }) => {
  const modo = useModoComputador(ponte);
  return (
    <div>
      <span data-testid="ativo">{String(modo.ativo)}</span>
      <span data-testid="aviso">{modo.aviso ?? ''}</span>
      <span data-testid="erro">{modo.erro ?? ''}</span>
      <button onClick={() => void modo.iniciar()}>ligar</button>
      <button onClick={() => void modo.parar()}>desligar</button>
    </div>
  );
};

const montar = (ponte: PonteDoModoComputador) =>
  render(
    <MemoryRouter initialEntries={['/virtual-mouse']}>
      <Routes>
        <Route path="/virtual-mouse" element={<Tela ponte={ponte} />} />
        <Route path="/emergency" element={<div>TELA DE EMERGÊNCIA</div>} />
      </Routes>
    </MemoryRouter>,
  );

const amostra = (x: number): GazeSample => ({ x, y: 50, timestamp: 1000 + x, hasFace: true, eyeState: 'open' });

describe('useModoComputador', () => {
  beforeEach(() => assinantes.clear());

  it('liga com o dwell das configurações e passa o olhar adiante; desligar corta o fluxo', async () => {
    const ponte = pontoFalsa();
    montar(ponte);
    fireEvent.click(screen.getByText('ligar'));
    await waitFor(() => expect(screen.getByTestId('ativo').textContent).toBe('true'));
    expect(ponte.iniciar).toHaveBeenCalledWith(expect.objectContaining({ dwellMs: 1200, lupa: true }));
    expect(ponte.iniciar.mock.calls[0][0].tamanhoCursorPx).toBeLessThan(48);

    act(() => { for (const cb of assinantes) cb(amostra(10)); });
    expect(ponte.olhares).toHaveLength(1);
    expect(ponte.olhares[0]).toMatchObject({ x: 10, y: 50, t: 1010, hasFace: true, eyeState: 'open', degraded: false, uncalibrated: false });

    // Enquanto ativo, o dwell do app fica suspenso (a janela está oculta).
    expect(suspenderDwell).toHaveBeenLastCalledWith(true);

    fireEvent.click(screen.getByText('desligar'));
    await waitFor(() => expect(screen.getByTestId('ativo').textContent).toBe('false'));
    act(() => { for (const cb of assinantes) cb(amostra(20)); });
    expect(ponte.olhares).toHaveLength(1);
    expect(ponte.parar).toHaveBeenCalled();
    expect(suspenderDwell).toHaveBeenLastCalledWith(false);
  });

  it('desmontar a tela com o modo ligado encerra no sistema também', async () => {
    const ponte = pontoFalsa();
    const { unmount } = montar(ponte);
    fireEvent.click(screen.getByText('ligar'));
    await waitFor(() => expect(screen.getByTestId('ativo').textContent).toBe('true'));
    unmount();
    expect(ponte.parar).toHaveBeenCalled();
    expect(suspenderDwell).toHaveBeenLastCalledWith(false);
  });

  it('recusa do sistema vira erro na tela, sem ligar', async () => {
    const ponte = pontoFalsa();
    ponte.iniciar.mockResolvedValueOnce({ ok: false, motivo: 'Sessão Wayland.' });
    montar(ponte);
    fireEvent.click(screen.getByText('ligar'));
    await waitFor(() => expect(screen.getByTestId('erro').textContent).toBe('Sessão Wayland.'));
    expect(screen.getByTestId('ativo').textContent).toBe('false');
  });

  it('"Socorro" na sobreposição abre a tela de emergência do app', async () => {
    const ponte = pontoFalsa();
    montar(ponte);
    fireEvent.click(screen.getByText('ligar'));
    await waitFor(() => expect(screen.getByTestId('ativo').textContent).toBe('true'));
    act(() => ponte.simularParada('emergencia'));
    expect(await screen.findByText('TELA DE EMERGÊNCIA')).toBeInTheDocument();
    expect(assinantes.size).toBe(0);
  });

  it('tela que mudou explica e desliga', async () => {
    const ponte = pontoFalsa();
    montar(ponte);
    fireEvent.click(screen.getByText('ligar'));
    await waitFor(() => expect(screen.getByTestId('ativo').textContent).toBe('true'));
    act(() => ponte.simularParada('tela_mudou'));
    expect(screen.getByTestId('ativo').textContent).toBe('false');
    expect(screen.getByTestId('aviso').textContent).toMatch(/Recalibre/);
  });
});
