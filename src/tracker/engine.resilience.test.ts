import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { runLoopBody, emitToSubscribers, resetLoopErrorState, getLoopErrorCount } from './loopGuard';

/**
 * O loop de rAF não tinha nenhum `try/catch` e a chamada de
 * `requestAnimationFrame(loop)` era a ÚLTIMA linha do corpo. Qualquer exceção
 * — em `detectForVideo`, no analisador de qualidade, num subscriber de gaze ou
 * num handler de clique do React disparado por dwell — pulava o reagendamento
 * e matava o loop em silêncio: `running` continuava `true`, o estado continuava
 * `tracking`, e o cursor simplesmente congelava sem nenhuma via de recuperação
 * a não ser recarregar o app.
 *
 * Para um usuário com ELA, um cursor congelado sem mensagem é indistinguível
 * de "o programa travou" — e ele não tem como reiniciar sozinho.
 */
describe('loopGuard — o loop sobrevive a exceções', () => {
  beforeEach(() => { resetLoopErrorState(); vi.restoreAllMocks(); });
  afterEach(() => { vi.restoreAllMocks(); });

  describe('runLoopBody', () => {
    it('reagenda o próximo frame mesmo quando o corpo lança', () => {
      const schedule = vi.fn();
      vi.spyOn(console, 'error').mockImplementation(() => {});

      runLoopBody(() => { throw new Error('detectForVideo explodiu'); }, schedule);

      expect(schedule).toHaveBeenCalledTimes(1);
    });

    it('reagenda normalmente quando o corpo não lança', () => {
      const schedule = vi.fn();
      const body = vi.fn();

      runLoopBody(body, schedule);

      expect(body).toHaveBeenCalledTimes(1);
      expect(schedule).toHaveBeenCalledTimes(1);
    });

    it('conta os erros para diagnóstico em vez de engolir em silêncio', () => {
      const schedule = vi.fn();
      vi.spyOn(console, 'error').mockImplementation(() => {});

      runLoopBody(() => { throw new Error('a'); }, schedule);
      runLoopBody(() => { throw new Error('b'); }, schedule);

      expect(getLoopErrorCount()).toBe(2);
      expect(schedule).toHaveBeenCalledTimes(2);
    });

    it('sobrevive a 100 frames consecutivos com exceção', () => {
      const schedule = vi.fn();
      vi.spyOn(console, 'error').mockImplementation(() => {});

      for (let i = 0; i < 100; i++) {
        runLoopBody(() => { throw new Error(`frame ${i}`); }, schedule);
      }

      expect(schedule).toHaveBeenCalledTimes(100);
      expect(getLoopErrorCount()).toBe(100);
    });

    it('não deixa uma exceção do próprio schedule propagar para o chamador', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => {
        runLoopBody(() => {}, () => { throw new Error('rAF indisponível'); });
      }).not.toThrow();
    });
  });

  describe('emitToSubscribers', () => {
    const amostra = { x: 1, y: 2, timestamp: 0, hasFace: true };

    it('um subscriber que lança não impede os outros de receberem', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const ordem: string[] = [];
      const subs = [
        () => { ordem.push('a'); },
        () => { throw new Error('subscriber quebrado'); },
        () => { ordem.push('c'); },
      ];

      emitToSubscribers(subs, amostra);

      expect(ordem).toEqual(['a', 'c']);
    });

    it('não propaga a exceção do subscriber para o loop', () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      expect(() => {
        emitToSubscribers([() => { throw new Error('boom'); }], amostra);
      }).not.toThrow();
    });

    it('entrega a todos quando ninguém lança', () => {
      const a = vi.fn();
      const b = vi.fn();

      emitToSubscribers([a, b], amostra);

      expect(a).toHaveBeenCalledWith(amostra);
      expect(b).toHaveBeenCalledWith(amostra);
    });
  });
});
