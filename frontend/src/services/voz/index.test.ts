import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { EstadoDoMotorDeVoz } from '@tracker/voz/protocolo';

const local = vi.hoisted(() => ({
  tocarWav: vi.fn(async () => {}),
  pararVozClonada: vi.fn(),
  ponteDaVoz: vi.fn(),
}));
const sistema = vi.hoisted(() => ({
  falarComVozDoSistema: vi.fn(async () => {}),
  pararVozDoSistema: vi.fn(),
}));
vi.mock('./local', () => local);
vi.mock('./sistema', () => sistema);

import { falar, vozClonadaLiberadaPelaLicenca, vozClonadaPronta, aquecerCache, acompanharEstadoDaVoz, _redefinirVoz, ORCAMENTO_DA_VOZ_CLONADA_MS } from './index';
import { LICENSE_KEY } from '../../context/LicenseContext';

const pronta = (): EstadoDoMotorDeVoz => ({
  disponivel: true,
  motor: 'pronto',
  modelo: { baixado: true, baixando: false, progresso: null },
  dispositivo: 'cpu',
  voz: { importada: true, duracaoS: 20, qualidade: 'boa' },
  ativa: true,
  cache: { itens: 0, mb: 0 },
  sintetizando: false,
});

const WAV = () => new ArrayBuffer(8);

/** Ponte falsa: `emCache` responde ao `{soCache:true}`; `gerar` à geração completa. */
function ponteCom(estado: EstadoDoMotorDeVoz, comportamento: { emCache?: boolean; gerarMs?: number; gerarFalha?: 'motor' | 'sem_modelo' } = {}) {
  const sintetizar = vi.fn(async (_t: string, o?: { soCache?: boolean }) => {
    if (o?.soCache) {
      return comportamento.emCache
        ? { ok: true as const, wav: WAV(), deCache: true, ms: 0 }
        : { ok: false as const, motivo: 'nao_em_cache' as const };
    }
    if (comportamento.gerarMs) await new Promise((r) => setTimeout(r, comportamento.gerarMs));
    if (comportamento.gerarFalha) return { ok: false as const, motivo: comportamento.gerarFalha };
    return { ok: true as const, wav: WAV(), deCache: false, ms: comportamento.gerarMs ?? 1 };
  });
  const ponte = {
    estado: vi.fn(async () => estado),
    onEstado: vi.fn(() => () => {}),
    importar: vi.fn(),
    remover: vi.fn(),
    baixarModelo: vi.fn(),
    sintetizar,
    sondar: vi.fn(async () => estado),
    ativar: vi.fn(),
  };
  local.ponteDaVoz.mockReturnValue(ponte);
  return ponte;
}

describe('services/voz', () => {
  beforeEach(() => {
    _redefinirVoz();
    vi.clearAllMocks();
    vi.useRealTimers();
    localStorage.clear();
    local.tocarWav.mockResolvedValue(undefined);
  });

  it('frase em cache: toca a clonada na hora, sem acordar a geração', async () => {
    const ponte = ponteCom(pronta(), { emCache: true });
    const r = await falar('  Estou com sede  ');
    expect(r).toEqual({ origem: 'clonada' });
    expect(ponte.sintetizar).toHaveBeenCalledTimes(1);
    expect(ponte.sintetizar).toHaveBeenCalledWith('Estou com sede', { soCache: true });
    expect(local.tocarWav).toHaveBeenCalled();
    expect(sistema.falarComVozDoSistema).not.toHaveBeenCalled();
  });

  it('frase nova gerada dentro do prazo sai clonada', async () => {
    const ponte = ponteCom(pronta(), { gerarMs: 20 });
    const r = await falar('Oi');
    expect(r).toEqual({ origem: 'clonada' });
    expect(ponte.sintetizar).toHaveBeenCalledTimes(2);
    expect(ponte.sintetizar).toHaveBeenLastCalledWith('Oi');
  });

  it('geração lenta: fala com o sistema agora e deixa a geração terminar para o cache', async () => {
    vi.useFakeTimers();
    const ponte = ponteCom(pronta(), { gerarMs: ORCAMENTO_DA_VOZ_CLONADA_MS * 4 });
    const p = falar('Frase longa e nova');
    await vi.advanceTimersByTimeAsync(ORCAMENTO_DA_VOZ_CLONADA_MS + 50);
    const r = await p;
    expect(r).toEqual({ origem: 'sistema', motivo: 'demorou' });
    expect(sistema.falarComVozDoSistema).toHaveBeenCalledWith('Frase longa e nova', {});
    expect(local.tocarWav).not.toHaveBeenCalled();
    // A geração não foi cancelada: continua para aquecer o cache.
    expect(ponte.sintetizar).toHaveBeenCalledTimes(2);
  });

  it('se a geração falhar, cai para a voz do sistema e diz por quê', async () => {
    ponteCom(pronta(), { gerarFalha: 'sem_modelo' });
    const r = await falar('Oi');
    expect(r).toEqual({ origem: 'sistema', motivo: 'sem_modelo' });
    expect(sistema.falarComVozDoSistema).toHaveBeenCalledWith('Oi', {});
  });

  it('uma fala nova durante a espera substitui a anterior (a última vence)', async () => {
    vi.useFakeTimers();
    ponteCom(pronta(), { gerarMs: 500 });
    const primeira = falar('Primeira');
    await vi.advanceTimersByTimeAsync(100);
    const segunda = falar('Segunda');
    await vi.advanceTimersByTimeAsync(1000);
    expect(await primeira).toEqual({ origem: 'nenhuma', motivo: 'substituida' });
    expect(await segunda).toEqual({ origem: 'clonada' });
    expect(local.tocarWav).toHaveBeenCalledTimes(1);
  });

  it('voz importada mas desligada → sistema; `sistema: true` força o sistema', async () => {
    ponteCom({ ...pronta(), ativa: false });
    expect(await falar('a')).toEqual({ origem: 'sistema' });
    _redefinirVoz();
    const ponte = ponteCom(pronta());
    expect(await falar('b', { sistema: true, rate: 1.2 })).toEqual({ origem: 'sistema' });
    expect(ponte.sintetizar).not.toHaveBeenCalled();
    expect(sistema.falarComVozDoSistema).toHaveBeenLastCalledWith('b', { sistema: true, rate: 1.2 });
  });

  it('fora do Electron (sem ponte) fala com o sistema sem reclamar', async () => {
    local.ponteDaVoz.mockReturnValue(null);
    expect(await falar('x')).toEqual({ origem: 'sistema' });
  });

  it('texto vazio não fala nada', async () => {
    expect(await falar('   ')).toEqual({ origem: 'nenhuma', motivo: 'texto vazio' });
  });

  it('a licença decide: sem features libera; features.voz=false bloqueia', async () => {
    expect(vozClonadaLiberadaPelaLicenca()).toBe(true);
    localStorage.setItem(LICENSE_KEY, JSON.stringify({ plan: { id: 'essencial', features: { voz: false } } }));
    expect(vozClonadaLiberadaPelaLicenca()).toBe(false);
    ponteCom(pronta());
    await acompanharEstadoDaVoz();
    expect(vozClonadaPronta()).toBe(false);
    expect(await falar('y')).toEqual({ origem: 'sistema' });
    localStorage.setItem(LICENSE_KEY, JSON.stringify({ plan: { id: 'voz', features: { voz: true } } }));
    expect(vozClonadaPronta()).toBe(true);
  });

  it('aquecerCache sintetiza cada frase e para no primeiro erro do motor', async () => {
    const ponte = ponteCom(pronta());
    await acompanharEstadoDaVoz();
    ponte.sintetizar
      .mockResolvedValueOnce({ ok: true, wav: WAV(), deCache: false, ms: 1 })
      .mockResolvedValueOnce({ ok: false, motivo: 'texto' })
      .mockResolvedValueOnce({ ok: true, wav: WAV(), deCache: true, ms: 0 })
      .mockResolvedValueOnce({ ok: false, motivo: 'motor', erro: 'caiu' });
    const n = await aquecerCache(['a', '', 'b', 'c', 'd', 'e'], ponte);
    expect(n).toBe(2);
    expect(ponte.sintetizar).toHaveBeenCalledTimes(4);
  });
});
