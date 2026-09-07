import { describe, it, expect, beforeEach } from 'vitest';
import { proximoBloco, limparContagemDeBlocos } from './registroDaSessao';

/**
 * O número do bloco era anotado à mão e, na prática, não era anotado: os
 * relatórios saíam com `blocoDeMedicao: undefined` e depois não havia como
 * separar a rodada logo após calibrar da repetição de 10 minutos — que é a
 * única comparação que a sessão de dois blocos existe para fazer.
 *
 * A contagem é ancorada no INSTANTE DO TREINO, não num contador global: é o
 * que faz "recalibrou, voltou a ser bloco 1" cair fora de graça.
 */
describe('registroDaSessao — número do bloco', () => {
  beforeEach(() => { limparContagemDeBlocos(); });

  it('a primeira rodada após um treino é o bloco 1', () => {
    expect(proximoBloco(1000)).toBe(1);
  });

  it('a segunda rodada contra a MESMA calibração é o bloco 2', () => {
    expect(proximoBloco(1000)).toBe(1);
    expect(proximoBloco(1000)).toBe(2);
  });

  it('conta além de 2 em vez de mentir que ainda é o bloco 2', () => {
    proximoBloco(1000);
    proximoBloco(1000);
    expect(proximoBloco(1000)).toBe(3);
  });

  it('recalibrar zera a contagem — o instante do treino é outro', () => {
    proximoBloco(1000);
    proximoBloco(1000);
    expect(proximoBloco(2000)).toBe(1);
  });

  it('sem calibração ativa não há bloco nenhum', () => {
    expect(proximoBloco(null)).toBeNull();
  });

  it('a contagem sobrevive a um reload (vive no localStorage)', () => {
    expect(proximoBloco(1000)).toBe(1);
    // Um reload não zera módulo nenhum: o estado tem que estar no storage.
    expect(JSON.parse(localStorage.getItem('irisflow.registroDaSessao')!).execucoes).toBe(1);
  });
});
