import { describe, it, expect } from 'vitest';
import { L2CSHealthMonitor, isGazePlausible } from './block';

// Modo de falha real do L2CS: crop entregando imagem preta e o modelo
// devolvendo sempre o mesmo ângulo. Na gravação de referência: 1563 quadros
// `valid`, yaw com um único valor distinto, −1,4315 rad.

const TRAVADO = -1.4315;   // o valor real medido na gravação

describe('isGazePlausible — o que ele pega e o que não pega', () => {
  it('pega o ângulo travado da gravação, por estar fora da faixa fisiológica', () => {
    expect(isGazePlausible(TRAVADO, 0)).toBe(false);
  });

  it('NÃO pegaria um travamento dentro da faixa — e nada garante que fique fora', () => {
    // Se a imagem preta produzisse 0,3 rad em vez de −1,43, a guarda de
    // plausibilidade aprovaria todos os quadros. É a lacuna que o monitor cobre.
    expect(isGazePlausible(0.3, 0.2)).toBe(true);
  });
});

// A API conta TEMPO com o mesmo valor, não quadros idênticos: o construtor
// recebe `{ janelaMs }` e `observe` recebe o relógio do frame. `observe` roda
// no rAF (~60 Hz) sobre o valor EM CACHE, então um limiar em quadros mediria a
// taxa de leitura do cache — não a saúde do worker. Ver health.janelaDeTempo.
describe('L2CSHealthMonitor', () => {
  /** Alimenta o monitor a 30 fps por `duracaoMs` e devolve se acusou. */
  const rodar = (m: L2CSHealthMonitor, yaw: number, duracaoMs: number, valid = true) => {
    let acusou = false;
    for (let t = 0; t <= duracaoMs; t += 1000 / 30) {
      if (m.observe(yaw, valid, t)) acusou = true;
    }
    return acusou;
  };

  it('acusa depois da janela de tempo com o mesmo valor', () => {
    const m = new L2CSHealthMonitor({ janelaMs: 500 });
    expect(m.observe(0.3, true, 0)).toBe(false);   // estabelece a referência
    expect(m.observe(0.3, true, 400)).toBe(false); // ainda dentro da janela
    expect(m.observe(0.3, true, 600)).toBe(true);  // passou de 500 ms
    expect(m.travado).toBe(true);
  });

  it('acusa UMA vez, não a cada quadro', () => {
    const m = new L2CSHealthMonitor({ janelaMs: 300 });
    let acusacoes = 0;
    for (let t = 0; t <= 3000; t += 100) if (m.observe(0.3, true, t)) acusacoes++;
    expect(acusacoes).toBe(1);
  });

  it('variação normal nunca acusa — olho humano não fica parado', () => {
    const m = new L2CSHealthMonitor({ janelaMs: 300 });
    for (let i = 0; i < 500; i++) {
      expect(m.observe(0.3 + Math.sin(i) * 1e-4, true, i * 33)).toBe(false);
    }
    expect(m.travado).toBe(false);
  });

  it('uma única variação reinicia a janela', () => {
    const m = new L2CSHealthMonitor({ janelaMs: 500 });
    m.observe(0.3, true, 0);
    m.observe(0.3, true, 400);
    m.observe(0.31, true, 450);                      // respirou: janela reinicia
    expect(m.observe(0.31, true, 800)).toBe(false);  // só 350 ms no valor novo
    expect(m.observe(0.31, true, 1000)).toBe(true);  // agora sim, 550 ms
  });

  it('quadro inválido não conta', () => {
    // Cache stale devolve o mesmo valor com valid=false. Isso é degradação
    // esperada, não travamento — contar seria falso positivo constante.
    const m = new L2CSHealthMonitor({ janelaMs: 500 });
    expect(rodar(m, TRAVADO, 5000, false)).toBe(false);
    expect(m.travado).toBe(false);
  });

  it('reset devolve ao estado inicial', () => {
    const m = new L2CSHealthMonitor({ janelaMs: 300 });
    rodar(m, 0.3, 2000);
    expect(m.travado).toBe(true);
    m.reset();
    expect(m.travado).toBe(false);
    expect(m.observe(0.5, true, 0)).toBe(false);
    expect(m.observe(0.5, true, 100)).toBe(false);
  });

  it('reproduz a gravação: yaw travado por dezenas de segundos é acusado', () => {
    // A gravação real tinha 1563 quadros no mesmo yaw. A 30 fps são ~52 s —
    // muito além da janela padrão de 6 s.
    const m = new L2CSHealthMonitor();
    let acusou = false;
    for (let i = 0; i < 1563; i++) {
      if (m.observe(TRAVADO, true, i * (1000 / 30))) acusou = true;
    }
    expect(acusou).toBe(true);
  });

  it('uma inferência lenta de ~1 s não acusa', () => {
    // Com um limiar de 60 quadros e leitura do cache a 60 Hz, este cenário
    // dispararia o alarme e bloquearia a calibração pelo resto da sessão.
    const m = new L2CSHealthMonitor();
    let acusou = false;
    for (let t = 0; t <= 1200; t += 1000 / 60) {
      if (m.observe(0.42, true, t)) acusou = true;
    }
    expect(acusou).toBe(false);
  });
});
