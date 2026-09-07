import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import { MemoryRouter, Routes, Route } from 'react-router-dom';
import React from 'react';

// -----------------------------------------------------------------------------
// Dois defeitos desta tela.
//
// 1. O `<main>` era `height: 100vh` com `overflow: hidden`. Nada rolava, nunca.
//    O conteúdo já era alto — título, painel de prontidão com nove itens,
//    seletor de condição óptica, botões — e o cartão de instruções que o
//    Bloco 4 acrescentou empurrou o botão de começar para fora da tela. Sem
//    rolagem, não havia como iniciar a calibração: o usuário ficava preso numa
//    tela cujo único propósito é sair dela.
//
//    A rolagem por olhar também não salvava: ela procura um ancestral rolável,
//    e `overflow: hidden` garante que não existe nenhum.
//
// 2. Não havia como reaproveitar uma calibração salva. Todo retorno à tela
//    exigia refazer 9 pontos — um a dois minutos de fixação para quem tem ELA.
//
// A rolagem é liberada SÓ no estágio de preparação. Durante a coleta os alvos
// são posicionados em coordenadas de viewport: rolar ali deslocaria o alvo em
// relação ao ponto medido e corromperia a calibração EM SILÊNCIO — sem erro,
// só com números piores.
// -----------------------------------------------------------------------------

let calibrado = false;
let carimboDaCalibracao: number | null = null;

vi.mock('../../context/GazeContext', () => ({
  useGaze: () => ({
    calibration: {
      isCalibrated: () => calibrado,
      start: vi.fn(),
      abort: vi.fn(),
      addPoint: vi.fn(),
      complete: vi.fn(),
    },
    l2csStatus: 'ready',
    getSessionUptimeMs: () => 1000,
    recording: { isActive: () => false, start: vi.fn(), stop: vi.fn() },
    getDiagnostics: () => null,
  }),
}));

vi.mock('../../context/SettingsContext', () => ({
  useSettings: () => ({
    settings: {
      screenDiagonalIn: 23.6,
      viewingDistanceCm: 60,
      screenGeometrySource: 'manual',
      cameraHorizontalFovDeg: 69.7,
      dwellMs: 1500,
    },
    updateSettings: vi.fn(),
  }),
}));

vi.mock('../../context/AuthContext', () => ({
  useAuth: () => ({ currentProfile: { id: 'p1', name: 'Joana' } }),
}));

vi.mock('@tracker/calibration', async (orig) => {
  const real = await orig<typeof import('@tracker/calibration')>();
  return { ...real, getCalibrationTimestampMs: () => carimboDaCalibracao };
});

import { CalibrationCheck } from './CalibrationCheck';

function montar() {
  return render(
    <MemoryRouter initialEntries={['/calibration-check']}>
      <Routes>
        <Route path="/calibration-check" element={<CalibrationCheck />} />
        <Route path="/menu" element={<div>tela de menu</div>} />
        <Route path="/tutorial" element={<div>tela de tutorial</div>} />
      </Routes>
    </MemoryRouter>
  );
}

const principal = () => document.querySelector('main') as HTMLElement;

beforeEach(() => {
  calibrado = false;
  carimboDaCalibracao = null;
  vi.clearAllMocks();
  Object.defineProperty(navigator, 'mediaDevices', {
    configurable: true,
    value: {
      getUserMedia: vi.fn(async () => {
        throw new Error('sem câmera no teste');
      }),
    },
  });
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('a tela de preparação rola', () => {
  it('o container permite rolagem vertical', () => {
    // Sem isto o botão de começar fica inalcançável, e a tela vira um beco.
    montar();
    expect(['auto', 'scroll']).toContain(principal().style.overflowY);
  });

  it('e assim a rolagem por olhar tem o que rolar', () => {
    // A rolagem por borda procura um ancestral rolável. Com `overflow: hidden`
    // ela não encontra nenhum e não faz nada — o defeito não era dela.
    montar();
    expect(principal().style.overflowY).not.toBe('hidden');
  });
});

describe('durante a coleta a tela NÃO rola', () => {
  it('rolar deslocaria o alvo em relação ao ponto medido', () => {
    // Corromperia a calibração em silêncio: sem erro, só com números piores —
    // e ninguém conseguiria diagnosticar isso lendo o relatório depois.
    montar();
    act(() => {
      screen.getByTestId('start-calibration-full').click();
    });
    expect(principal().style.overflowY).toBe('hidden');
  });
});

describe('reaproveitar a calibração salva', () => {
  it('não oferece quando não há calibração', () => {
    calibrado = false;
    montar();
    expect(screen.queryByTestId('usar-calibracao-salva')).toBeNull();
  });

  it('oferece quando há', () => {
    // Refazer 9 pontos é um a dois minutos de fixação para quem tem ELA.
    calibrado = true;
    carimboDaCalibracao = Date.now() - 3 * 24 * 60 * 60 * 1000;
    montar();
    expect(screen.getByTestId('usar-calibracao-salva')).toBeInTheDocument();
  });

  it('diz QUANDO ela foi feita', () => {
    // "Salva" sozinho não ajuda a decidir. Uma calibração de semanas atrás,
    // com o paciente noutra posição, é pior que refazer.
    calibrado = true;
    carimboDaCalibracao = Date.now() - 3 * 24 * 60 * 60 * 1000;
    montar();
    expect(screen.getByTestId('usar-calibracao-salva').textContent).toMatch(/3 dias|dias/i);
  });

  it('não inicia coleta nenhuma', () => {
    calibrado = true;
    carimboDaCalibracao = Date.now();
    montar();

    act(() => {
      screen.getByTestId('usar-calibracao-salva').click();
    });

    // Se tivesse iniciado, o estágio mudaria e a tela deixaria de rolar.
    expect(screen.queryByTestId('start-calibration-full')).toBeNull();
  });

  it('leva ao destino, sem passar pela coleta', () => {
    calibrado = true;
    carimboDaCalibracao = Date.now();
    montar();

    act(() => {
      screen.getByTestId('usar-calibracao-salva').click();
    });

    expect(screen.getByText(/tela de menu|tela de tutorial/)).toBeInTheDocument();
  });
});
