import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { EstadoDoMotorDeVoz } from '@tracker/voz/protocolo';

const estadoMock = vi.hoisted(() => ({ atual: null as EstadoDoMotorDeVoz | null }));
const ponteMock = vi.hoisted(() => ({
  importar: vi.fn(async () => ({ ok: true as const, duracaoS: 22, qualidade: 'boa' as const, avisos: ['Áudio longo: foram usados os melhores ~12 s.'] })),
  remover: vi.fn(async () => {}),
  baixarModelo: vi.fn(async () => ({ ok: true })),
  ativar: vi.fn(async () => {}),
  sintetizar: vi.fn(),
  sondar: vi.fn(async () => estadoMock.atual),
  estado: vi.fn(),
  onEstado: vi.fn(() => () => {}),
}));

vi.mock('../../services/voz', () => ({
  useEstadoDaVoz: () => estadoMock.atual,
  vozClonadaLiberadaPelaLicenca: () => true,
  aquecerCache: vi.fn(async () => 3),
}));
vi.mock('../../services/voz/local', () => ({
  ponteDaVoz: () => ponteMock,
  falarComVozClonada: vi.fn(async () => ({ ok: true, deCache: true, ms: 0 })),
}));
vi.mock('../../services/voz/sistema', () => ({ falarComVozDoSistema: vi.fn(async () => {}) }));
vi.mock('../../context/AuthContext', () => ({ useAuth: () => ({ currentProfile: { id: 'perfil-1' } }) }));
vi.mock('../../context/SettingsContext', () => ({ useSettings: () => ({ settings: { voiceGender: 'female' }, updateSettings: vi.fn() }) }));
vi.mock('../../context/ToastContext', () => ({ useToast: () => ({ success: vi.fn(), error: vi.fn(), info: vi.fn() }) }));

import { VozScreen, TERMO_DE_CONSENTIMENTO } from './VozScreen';

const semVoz = (): EstadoDoMotorDeVoz => ({
  disponivel: true,
  motor: 'parado',
  modelo: { baixado: false, baixando: false, progresso: null },
  dispositivo: null,
  voz: { importada: false },
  ativa: false,
  cache: { itens: 0, mb: 0 },
  sintetizando: false,
});

const montar = () => render(<MemoryRouter><VozScreen /></MemoryRouter>);

describe('VozScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    estadoMock.atual = semVoz();
  });

  it('sem modelo oferece o download; sem voz oferece importar', () => {
    montar();
    expect(screen.getByText(/Baixar o modelo agora/)).toBeInTheDocument();
    expect(screen.getByText(/Importar áudio da voz/)).toBeInTheDocument();
    fireEvent.click(screen.getByText(/Baixar o modelo agora/));
    expect(ponteMock.baixarModelo).toHaveBeenCalled();
  });

  it('a importação só acontece depois de aceitar o termo, e leva o termo junto', async () => {
    montar();
    fireEvent.click(screen.getByText(/Importar áudio da voz/));
    expect(screen.getByText(/Termo de consentimento/)).toBeInTheDocument();
    const confirmar = screen.getByText(/Aceitar e escolher o arquivo/).closest('button')!;
    expect(confirmar).toBeDisabled();
    fireEvent.click(screen.getByLabelText(/Li e aceito o termo/));
    expect(confirmar).not.toBeDisabled();
    fireEvent.click(confirmar);
    await waitFor(() => expect(ponteMock.importar).toHaveBeenCalled());
    const arg = ponteMock.importar.mock.calls[0][0] as { texto: string; aceitoEm: string; perfilId: string | null };
    expect(arg.texto).toBe(TERMO_DE_CONSENTIMENTO);
    expect(arg.perfilId).toBe('perfil-1');
    expect(new Date(arg.aceitoEm).getTime()).toBeGreaterThan(0);
    expect(await screen.findByText(/Voz importada: 22 s de fala útil, qualidade boa/)).toBeInTheDocument();
  });

  it('com voz importada mostra qualidade, liga/desliga e permite remover (com confirmação)', async () => {
    estadoMock.atual = { ...semVoz(), modelo: { baixado: true, baixando: false, progresso: null }, motor: 'pronto', dispositivo: 'cpu', voz: { importada: true, duracaoS: 18, qualidade: 'aceitavel', nomeDoArquivo: 'voz.opus', consentimentoEm: '2026-09-09T00:00:00Z' }, ativa: true };
    montar();
    expect(screen.getByText('Aceitável')).toBeInTheDocument();
    expect(screen.getByText('voz.opus')).toBeInTheDocument();
    const toggle = screen.getByLabelText(/Usar a voz clonada/) as HTMLInputElement;
    expect(toggle.checked).toBe(true);
    fireEvent.click(toggle);
    expect(ponteMock.ativar).toHaveBeenCalledWith(false);

    // A confirmação agora é um diálogo do próprio app (o `confirm` nativo fica
    // fora da árvore do documento e o olhar não o alcança). Cancelar não apaga.
    fireEvent.click(screen.getByText(/Remover voz/));
    fireEvent.click(await screen.findByText('Cancelar'));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(ponteMock.remover).not.toHaveBeenCalled();

    fireEvent.click(screen.getByText(/Remover voz/));
    fireEvent.click(await screen.findByText('Remover a voz'));
    await waitFor(() => expect(ponteMock.remover).toHaveBeenCalled());
  });

  it('termo cobre autorização, uso local e remoção', () => {
    expect(TERMO_DE_CONSENTIMENTO).toMatch(/autorizou expressamente/);
    expect(TERMO_DE_CONSENTIMENTO).toMatch(/apenas aqui/);
    expect(TERMO_DE_CONSENTIMENTO).toMatch(/remover a voz a qualquer momento/);
  });
});
