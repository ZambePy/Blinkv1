import { describe, it, expect } from 'vitest';
import {
  GazeFallback,
  FALLBACK_HOLD_MS,
  MENSAGEM_SEM_ROSTO,
} from './gazeFallback';

// -----------------------------------------------------------------------------
// P7.5 — última posição válida por 2 s, depois "Posicione o rosto".
//
// O comportamento atual do `GazeContext` é: rosto some → opacidade 0.35 →
// nada mais, para sempre. O cursor fantasma fica na tela indefinidamente, e o
// paciente não tem como distinguir "a câmera não me vê" de "o app travou".
// -----------------------------------------------------------------------------

const P = (x: number, y: number, nowMs: number) =>
  ({ gazeValido: true, x, y, nowMs });
const PERDIDO = (nowMs: number) =>
  ({ gazeValido: false, x: 0, y: 0, nowMs });

describe('gaze válido', () => {
  it('o cursor segue a medição', () => {
    const f = new GazeFallback();
    const r = f.step(P(800, 400, 1000));
    expect(r.estado).toBe('ativo');
    expect(r.posicao).toEqual({ x: 800, y: 400 });
    expect(r.mostrarCursor).toBe(true);
    expect(r.mensagem).toBeNull();
  });
});

describe('perda curta: segura a última posição', () => {
  it('congela na última posição válida, sem projetar', () => {
    // Congelar, não projetar — a diferença para o `blinkHold`. Numa piscada a
    // pessoa continua olhando para o alvo; com o rosto perdido ninguém sabe
    // para onde ela olha, e projetar seria inventar.
    const f = new GazeFallback();
    f.step(P(800, 400, 1000));
    const a = f.step(PERDIDO(1100));
    const b = f.step(PERDIDO(1500));
    expect(a.estado).toBe('segurando');
    expect(a.posicao).toEqual({ x: 800, y: 400 });
    expect(b.posicao).toEqual({ x: 800, y: 400 });  // MESMA posição
  });

  it('o cursor continua visível durante o hold', () => {
    // Perdas de 100–300 ms são rotina (detector pula quadro, auto-exposure
    // pisca). Esconder o cursor a cada uma produziria um pisca-pisca pior que
    // o congelamento que este módulo veio corrigir.
    const f = new GazeFallback();
    f.step(P(800, 400, 1000));
    expect(f.step(PERDIDO(1200)).mostrarCursor).toBe(true);
  });

  it('NÃO mostra a mensagem durante o hold', () => {
    // Um banner que pisca a cada perda curta treina o paciente a ignorá-lo —
    // e aí ele não serve para a perda que importa.
    const f = new GazeFallback();
    f.step(P(800, 400, 1000));
    expect(f.step(PERDIDO(1200)).mensagem).toBeNull();
  });

  it('recuperar antes do teto volta a seguir a medição', () => {
    const f = new GazeFallback();
    f.step(P(800, 400, 1000));
    f.step(PERDIDO(1500));
    const r = f.step(P(300, 200, 1900));
    expect(r.estado).toBe('ativo');
    expect(r.posicao).toEqual({ x: 300, y: 200 });
  });

  it('o relógio da perda reinicia a cada recuperação', () => {
    // Sem isso, perdas curtas e frequentes somariam até o teto e o cursor
    // sumiria no meio de uma sessão que estava funcionando.
    const f = new GazeFallback();
    f.step(P(800, 400, 0));
    for (let t = 100; t < 6000; t += 100) {
      f.step(PERDIDO(t));
      const r = f.step(P(800, 400, t + 10));
      expect(r.estado).toBe('ativo');
    }
  });
});

describe('perda longa: esconde e avisa', () => {
  it(`acima de ${FALLBACK_HOLD_MS} ms o cursor some`, () => {
    const f = new GazeFallback();
    f.step(P(800, 400, 1000));
    const r = f.step(PERDIDO(1000 + FALLBACK_HOLD_MS + 1));
    expect(r.estado).toBe('perdido');
    expect(r.mostrarCursor).toBe(false);
    expect(r.posicao).toBeNull();
  });

  it('a posição vira `null`, não (0,0)', () => {
    // (0,0) desenharia um cursor no canto superior esquerdo, que o paciente
    // leria como uma posição de olhar. É a mesma distinção de `B3.3`: "não
    // sei" não é um número.
    const f = new GazeFallback();
    f.step(P(800, 400, 1000));
    const r = f.step(PERDIDO(4000));
    expect(r.posicao).toBeNull();
  });

  it('a mensagem diz o que FAZER, não o que quebrou', () => {
    // Quem lê isto pode não ter como pedir ajuda para interpretar a tela.
    const f = new GazeFallback();
    f.step(P(800, 400, 1000));
    expect(f.step(PERDIDO(4000)).mensagem).toBe(MENSAGEM_SEM_ROSTO);
    expect(MENSAGEM_SEM_ROSTO.toLowerCase()).toContain('posicione');
  });

  it('recuperar depois do teto volta ao normal e limpa a mensagem', () => {
    const f = new GazeFallback();
    f.step(P(800, 400, 1000));
    f.step(PERDIDO(5000));
    const r = f.step(P(100, 100, 5100));
    expect(r.estado).toBe('ativo');
    expect(r.mensagem).toBeNull();
    expect(r.mostrarCursor).toBe(true);
  });

  it('exatamente no teto ainda segura — o limite é estrito', () => {
    const f = new GazeFallback();
    f.step(P(800, 400, 1000));
    expect(f.step(PERDIDO(1000 + FALLBACK_HOLD_MS)).estado).toBe('segurando');
  });
});

describe('o dwell é DESCARTADO na perda, não preservado', () => {
  it('pede o descarte no primeiro quadro da perda', () => {
    // Política oposta à do `blinkHold`, e de propósito. Lá, a pessoa continua
    // olhando para o alvo com o olho fechado, então preservar o progresso é
    // correto. Aqui o rosto sumiu: o olhar pode ter ido para a porta. Um
    // relógio de dwell sobrevivendo a isso completaria sobre um alvo que o
    // olhar já abandonou.
    const f = new GazeFallback();
    f.step(P(800, 400, 1000));
    expect(f.step(PERDIDO(1030)).zerarDwell).toBe(true);
  });

  it('é BORDA, não nível: só o primeiro quadro pede', () => {
    // Se fosse nível, o chamador não teria como distinguir "perda nova" de
    // "continuo perdido" — e não daria para contar perdas no diagnóstico.
    const f = new GazeFallback();
    f.step(P(800, 400, 1000));
    f.step(PERDIDO(1030));
    expect(f.step(PERDIDO(1060)).zerarDwell).toBe(false);
    expect(f.step(PERDIDO(5000)).zerarDwell).toBe(false);
  });

  it('uma nova perda pede de novo', () => {
    const f = new GazeFallback();
    f.step(P(800, 400, 1000));
    f.step(PERDIDO(1030));
    f.step(P(800, 400, 1060));
    expect(f.step(PERDIDO(1090)).zerarDwell).toBe(true);
  });
});

describe('perda antes de existir posição válida', () => {
  it('vai direto para `perdido` — não há o que segurar', () => {
    // App recém-aberto, ou calibração ainda não rodada. Segurar (0,0) por 2 s
    // desenharia um cursor no canto que ninguém colocou lá.
    const f = new GazeFallback();
    const r = f.step(PERDIDO(1000));
    expect(r.estado).toBe('perdido');
    expect(r.posicao).toBeNull();
    expect(r.mensagem).toBe(MENSAGEM_SEM_ROSTO);
  });

  it('e a mensagem aparece IMEDIATAMENTE, sem esperar 2 s', () => {
    const f = new GazeFallback();
    expect(f.step(PERDIDO(0)).mensagem).toBe(MENSAGEM_SEM_ROSTO);
  });
});

describe('perdidoHaMs alimenta o diagnóstico', () => {
  it('conta desde o primeiro quadro sem gaze', () => {
    const f = new GazeFallback();
    f.step(P(800, 400, 1000));
    expect(f.step(PERDIDO(1000)).perdidoHaMs).toBe(0);
    expect(f.step(PERDIDO(1500)).perdidoHaMs).toBe(500);
    expect(f.step(PERDIDO(9000)).perdidoHaMs).toBe(8000);
  });

  it('zera ao recuperar', () => {
    const f = new GazeFallback();
    f.step(P(800, 400, 1000));
    f.step(PERDIDO(3000));
    expect(f.step(P(800, 400, 3100)).perdidoHaMs).toBe(0);
  });
});

describe('reset', () => {
  it('esquece a última posição válida', () => {
    const f = new GazeFallback();
    f.step(P(800, 400, 1000));
    f.reset();
    expect(f.step(PERDIDO(1100)).estado).toBe('perdido');
  });
});

describe('holdMs é configurável', () => {
  it('respeita o teto injetado', () => {
    const f = new GazeFallback({ holdMs: 500 });
    f.step(P(800, 400, 1000));
    expect(f.step(PERDIDO(1400)).estado).toBe('segurando');
    expect(f.step(PERDIDO(1600)).estado).toBe('perdido');
  });
});
