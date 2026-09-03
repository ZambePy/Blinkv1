import { describe, it, expect } from 'vitest';
import { FrameRing, RING_DEFAULT_CAPACITY } from './frameRing';

// P4.1 — buffer circular de 3 frames com descarte do MAIS ANTIGO.
//
// A regra que dá sentido ao módulo inteiro: quando o processamento atrasa, quem
// morre é o frame velho, nunca o novo. O cursor tem que refletir onde o olho
// está AGORA — um frame de 200 ms atrás entregue com precisão perfeita continua
// sendo a resposta errada.
//
// Os números do aceite: produtor a 30 Hz, consumidor a 10 Hz. São 3 frames
// entrando para cada 1 consumido, então 2 de cada 3 têm que ser descartados, e
// o que o consumidor recebe tem que ser sempre o mais recente dos 3.

describe('FrameRing — capacidade e descarte', () => {
  it('nasce vazio, com a capacidade default de 3', () => {
    const ring = new FrameRing<number>();
    expect(RING_DEFAULT_CAPACITY).toBe(3);
    const s = ring.stats();
    expect(s.capacity).toBe(3);
    expect(s.occupancy).toBe(0);
    expect(ring.takeLatest()).toBeNull();
  });

  it('descarta o MAIS ANTIGO no overflow, nunca o mais recente', () => {
    const ring = new FrameRing<string>(3);
    ring.push('a', 0);
    ring.push('b', 33);
    ring.push('c', 66);
    // O quarto empurra o 'a' para fora.
    const r = ring.push('d', 99);
    expect(r.evicted?.payload).toBe('a');
    expect(ring.stats().occupancy).toBe(3);
    // O mais recente sobreviveu, e é ele que o consumidor recebe.
    expect(ring.peekLatest()?.payload).toBe('d');
    expect(ring.takeLatest()?.payload).toBe('d');
  });

  it('takeOldest devolve em ordem FIFO, para quem precisar da sequência', () => {
    const ring = new FrameRing<string>(3);
    ring.push('a', 0);
    ring.push('b', 33);
    expect(ring.takeOldest()?.payload).toBe('a');
    expect(ring.takeOldest()?.payload).toBe('b');
    expect(ring.takeOldest()).toBeNull();
  });

  it('carimba sequência monotônica e a hora de captura', () => {
    const ring = new FrameRing<number>(3);
    ring.push(10, 100);
    ring.push(20, 133);
    const f = ring.takeLatest()!;
    expect(f.seq).toBe(1);          // 0-based: segundo frame empurrado
    expect(f.tCaptureMs).toBe(133);
    expect(f.payload).toBe(20);
  });
});

describe('FrameRing — produtor 30 Hz contra consumidor 10 Hz (aceite de P4.1)', () => {
  /**
   * Simula 1 s: 30 frames entrando, 10 consumos. Entre consumos entram 3
   * frames, então o consumidor tem que receber sempre o 3º de cada trio.
   */
  function rodar1s(capacidade: number, empurrarPorConsumo: number) {
    const ring = new FrameRing<number>(capacidade);
    const recebidos: number[] = [];
    let ocupacaoMaxima = 0;
    let idx = 0;
    const consumos = 30 / empurrarPorConsumo;
    for (let c = 0; c < consumos; c++) {
      for (let k = 0; k < empurrarPorConsumo; k++) {
        ring.push(idx, idx * (1000 / 30));
        idx++;
        ocupacaoMaxima = Math.max(ocupacaoMaxima, ring.stats().occupancy);
      }
      const f = ring.takeLatest();
      if (f) recebidos.push(f.payload);
    }
    return { ring, recebidos, ocupacaoMaxima };
  }

  it('o consumidor sempre recebe o frame mais recente', () => {
    const { recebidos } = rodar1s(3, 3);
    // Trios (0,1,2), (3,4,5), … → o consumidor fica com 2, 5, 8, …
    expect(recebidos).toEqual([2, 5, 8, 11, 14, 17, 20, 23, 26, 29]);
  });

  it('a ocupação nunca passa de 3', () => {
    const { ocupacaoMaxima } = rodar1s(3, 3);
    expect(ocupacaoMaxima).toBeLessThanOrEqual(3);
  });

  it('droppedFrames bate com a diferença de taxas', () => {
    const { ring } = rodar1s(3, 3);
    const s = ring.stats();
    expect(s.pushed).toBe(30);
    expect(s.taken).toBe(10);
    // 30 entraram, 10 saíram: 20 descartados, e a conta tem que fechar
    // exatamente — é isso que separa "descarte controlado" de "vazamento".
    expect(s.dropped).toBe(20);
    expect(s.droppedOverflow + s.droppedStale).toBe(s.dropped);
    // Com 3 cabendo em 3, nada transborda: todo descarte é por obsolescência.
    expect(s.droppedOverflow).toBe(0);
    expect(s.droppedStale).toBe(20);
    expect(s.occupancy).toBe(0);
  });

  it('consumidor mais lento que a capacidade: o excedente sai por overflow', () => {
    // 6 frames por consumo, ring de 3: 3 transbordam e 2 ficam obsoletos.
    const { ring, recebidos, ocupacaoMaxima } = rodar1s(3, 6);
    const s = ring.stats();
    expect(ocupacaoMaxima).toBe(3);
    expect(recebidos).toEqual([5, 11, 17, 23, 29]); // sempre o mais recente
    expect(s.pushed).toBe(30);
    expect(s.taken).toBe(5);
    expect(s.dropped).toBe(25);
    expect(s.droppedOverflow).toBe(15); // 3 por ciclo × 5 ciclos
    expect(s.droppedStale).toBe(10);    // 2 por ciclo × 5 ciclos
  });

  it('highWaterMark registra a pior ocupação vista, mesmo depois de esvaziar', () => {
    const { ring } = rodar1s(3, 6);
    expect(ring.stats().highWaterMark).toBe(3);
    ring.clear();
    expect(ring.stats().occupancy).toBe(0);
    expect(ring.stats().highWaterMark).toBe(3);
  });
});

describe('FrameRing — ciclo de vida', () => {
  it('clear esvazia sem apagar os contadores da sessão', () => {
    const ring = new FrameRing<number>(3);
    ring.push(1, 0);
    ring.push(2, 33);
    ring.clear();
    const s = ring.stats();
    expect(s.occupancy).toBe(0);
    expect(s.pushed).toBe(2);
    // Os 2 que estavam dentro no clear contam como descartados: sumiram sem
    // serem consumidos, e um contador que ignorasse isso mentiria sobre a
    // fração de frames que chegou ao modelo.
    expect(s.dropped).toBe(2);
  });

  it('resetStats zera os contadores — é o que o start() do engine precisa (B1.7)', () => {
    const ring = new FrameRing<number>(3);
    ring.push(1, 0);
    ring.takeLatest();
    ring.resetStats();
    const s = ring.stats();
    expect(s.pushed).toBe(0);
    expect(s.taken).toBe(0);
    expect(s.dropped).toBe(0);
    expect(s.highWaterMark).toBe(0);
  });

  it('capacidade inválida cai no default em vez de criar um ring degenerado', () => {
    expect(new FrameRing<number>(0).stats().capacity).toBe(RING_DEFAULT_CAPACITY);
    expect(new FrameRing<number>(-1).stats().capacity).toBe(RING_DEFAULT_CAPACITY);
    expect(new FrameRing<number>(2.7).stats().capacity).toBe(2); // trunca, não arredonda para cima
  });

  it('não vaza referência: o frame consumido sai do buffer', () => {
    const ring = new FrameRing<{ big: number[] }>(3);
    ring.push({ big: [1, 2, 3] }, 0);
    ring.takeLatest();
    expect(ring.stats().occupancy).toBe(0);
    expect(ring.peekLatest()).toBeNull();
  });
});
