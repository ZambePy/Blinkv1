import { beforeEach, describe, expect, it } from 'vitest';
import { montarRelatorio, nomeDoArquivo } from './relatorioDeSuporte';
import { chaveDoPerfil, definirPerfilAtivo } from '../../utils/clinicalLogger';

const PERFIL = 'perfil-de-teste';

beforeEach(() => {
  localStorage.clear();
  // Sem perfil ativo o histórico é sempre vazio, de propósito (o logger não
  // atribui medição a ninguém). O relatório precisa de um para ter o que dizer.
  definirPerfilAtivo(PERFIL);
});

describe('relatório de suporte', () => {
  it('não vaza NADA do que o paciente escreveu', () => {
    // Uma frase que só existiria se alguém a tivesse digitado por fixação.
    const segredo = 'meu diagnóstico piorou muito esta semana';
    localStorage.setItem(
      chaveDoPerfil(PERFIL),
      JSON.stringify({
        sentences: [{ id: '1', text: segredo, timestamp: '2026-09-01T10:00:00.000Z' }],
        calibrations: [{ id: 'c1', errorDeg: 1.4, timestamp: '2026-09-01T09:00:00.000Z' }],
      }),
    );

    const r = montarRelatorio();
    const json = JSON.stringify(r);

    expect(json).not.toContain(segredo);
    expect(json).not.toContain('diagnóstico');
    // Mas o número está lá: é isso que serve para o suporte.
    expect(r.uso.frases_faladas).toBe(1);
    expect(r.uso.caracteres).toBe(segredo.length);
  });

  it('resume a calibração por números, não por amostras', () => {
    localStorage.setItem(
      chaveDoPerfil(PERFIL),
      JSON.stringify({
        sentences: [],
        calibrations: [
          { id: 'a', errorDeg: 2.1, timestamp: '2026-09-01T09:00:00.000Z' },
          { id: 'b', errorDeg: 1.2, timestamp: '2026-09-02T09:00:00.000Z' },
        ],
      }),
    );
    const r = montarRelatorio();
    expect(r.rastreamento.calibracoes_registradas).toBe(2);
    expect(r.rastreamento.ultimo_erro_graus).toBe(1.2);
    expect(r.rastreamento.melhor_erro_graus).toBe(1.2);
  });

  it('aguenta um histórico vazio sem quebrar', () => {
    const r = montarRelatorio();
    expect(r.uso.frases_faladas).toBe(0);
    expect(r.rastreamento.ultimo_erro_graus).toBeNull();
    expect(r.aplicativo.nome).toBe('IrisFlow Communicator');
  });

  it('inclui o estado da voz quando existe, e null quando não', () => {
    expect(montarRelatorio().voz).toBeNull();
    const r = montarRelatorio({
      estadoDaVoz: { motor: 'pronto', modelo: { baixado: true }, voz: { importada: true }, cache: { mb: 12 } },
    });
    expect(r.voz).toEqual({ motor: 'pronto', modelo_baixado: true, voz_importada: true, cache_mb: 12 });
  });

  it('o nome do arquivo é datado e não tem caractere proibido no Windows', () => {
    const nome = nomeDoArquivo(new Date('2026-09-10T01:02:03.000Z'));
    expect(nome).toBe('irisflow-suporte-2026-09-10-01-02-03.json');
    expect(nome).not.toMatch(/[:*?"<>|]/);
  });
});
