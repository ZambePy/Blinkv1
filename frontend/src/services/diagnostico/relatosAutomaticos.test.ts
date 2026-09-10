import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  CHAVE_CONVITE_VISTO,
  CHAVE_LIGADO,
  INTERVALO_MINIMO_MS,
  MAXIMO_POR_SESSAO,
  _reiniciarParaTeste,
  conviteJaVisto,
  definirRelatosAutomaticos,
  deveEnviarAgora,
  marcarConviteVisto,
  registrarEnviador,
  relatosAutomaticosLigados,
} from './relatosAutomaticos';

beforeEach(() => {
  localStorage.clear();
  _reiniciarParaTeste();
});

describe('opt-in', () => {
  it('começa desligado e o convite ainda não foi visto', () => {
    expect(relatosAutomaticosLigados()).toBe(false);
    expect(conviteJaVisto()).toBe(false);
  });

  it('decidir — para qualquer lado — encerra o convite', () => {
    definirRelatosAutomaticos(false);
    expect(conviteJaVisto()).toBe(true);
    expect(localStorage.getItem(CHAVE_LIGADO)).toBeNull();

    localStorage.clear();
    definirRelatosAutomaticos(true);
    expect(localStorage.getItem(CHAVE_LIGADO)).toBe('1');
    expect(localStorage.getItem(CHAVE_CONVITE_VISTO)).toBe('1');
  });

  it('"agora não" só marca o convite', () => {
    marcarConviteVisto();
    expect(conviteJaVisto()).toBe(true);
    expect(relatosAutomaticosLigados()).toBe(false);
  });
});

describe('quando um erro vira envio', () => {
  it('desligado, nunca', () => {
    registrarEnviador(vi.fn(async () => true));
    expect(deveEnviarAgora(0)).toBe(false);
  });

  it('ligado mas sem quem envie (sem vínculo), nunca', () => {
    definirRelatosAutomaticos(true);
    expect(deveEnviarAgora(0)).toBe(false);
  });

  it('ligado e com enviador, envia', () => {
    definirRelatosAutomaticos(true);
    registrarEnviador(vi.fn(async () => true));
    expect(deveEnviarAgora(0)).toBe(true);
  });
});

describe('anti-inundação', () => {
  it('respeita o intervalo mínimo e o teto por sessão', async () => {
    definirRelatosAutomaticos(true);
    const enviar = vi.fn(async () => true);
    registrarEnviador(enviar);

    // Simula a captura chamando o caminho interno através do evento de janela.
    const { instalarRelatosAutomaticos } = await import('./relatosAutomaticos');
    instalarRelatosAutomaticos();

    const disparar = () => window.dispatchEvent(new ErrorEvent('error', { message: 'boom' }));

    disparar();
    disparar(); // dentro do intervalo: ignorado
    await Promise.resolve();
    expect(enviar).toHaveBeenCalledTimes(1);
  });

  it('as constantes têm o tamanho de quem já viu um loop de erro', () => {
    expect(INTERVALO_MINIMO_MS).toBeGreaterThanOrEqual(5 * 60_000);
    expect(MAXIMO_POR_SESSAO).toBeLessThanOrEqual(10);
  });
});
