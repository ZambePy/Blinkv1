import { describe, it, expect } from 'vitest';
import { L2CSHealthMonitor } from './block';

// `L2CSHealthMonitor` conta TEMPO de gaze não-variante, não frames observados:
// `observe` roda no rAF (~60 Hz) sobre o valor em cache, então um limiar em
// frames mediria a taxa de leitura do cache e uma inferência lenta de ~1 s
// viraria "saída travada". E o travamento se recupera sozinho quando o gaze
// volta a variar, em vez de bloquear a calibração até recarregar a página.

describe('a detecção conta tempo, não frames observados', () => {
  it('observar o mesmo valor a 60 Hz por 1 s não acusa travamento', () => {
    // O engine lê o cache a 60 Hz enquanto uma inferência lenta não retorna:
    // são 60 observações do mesmo número em 1 s.
    const m = new L2CSHealthMonitor({ janelaMs: 6000 });
    let acusou = false;
    for (let i = 0; i < 60; i++) {
      if (m.observe(0.42, true, i * (1000 / 60))) acusou = true;
    }
    expect(acusou).toBe(false);
    expect(m.travado).toBe(false);
  });

  it('o mesmo valor por mais que a janela acusa travamento', () => {
    // O verdadeiro positivo continua funcionando: crop preto ou congelado
    // produz o mesmo yaw por muitos segundos.
    const m = new L2CSHealthMonitor({ janelaMs: 6000 });
    let acusou = false;
    for (let t = 0; t <= 7000; t += 1000 / 60) {
      if (m.observe(0.42, true, t)) acusou = true;
    }
    expect(acusou).toBe(true);
    expect(m.travado).toBe(true);
  });

  it('acusa UMA vez só, não a cada frame subsequente', () => {
    const m = new L2CSHealthMonitor({ janelaMs: 1000 });
    let vezes = 0;
    for (let t = 0; t <= 5000; t += 100) {
      if (m.observe(0.42, true, t)) vezes++;
    }
    expect(vezes).toBe(1);
  });

  it('a taxa de observação não altera o veredito', () => {
    // Observar a 10 Hz ou a 60 Hz tem que dar o mesmo resultado: o que
    // importa é há quanto TEMPO o valor não muda, não quantas vezes alguém
    // olhou para ele.
    const rodar = (hz: number) => {
      const m = new L2CSHealthMonitor({ janelaMs: 3000 });
      let acusou = false;
      for (let t = 0; t <= 2500; t += 1000 / hz) {
        if (m.observe(0.42, true, t)) acusou = true;
      }
      return acusou;
    };
    expect(rodar(10)).toBe(false);
    expect(rodar(60)).toBe(false);
    expect(rodar(120)).toBe(false);
  });
});

describe('recuperação automática', () => {
  it('gaze voltando a variar limpa o travamento sem reset manual', () => {
    // Um latch de mão única deixaria o paciente com a calibração bloqueada
    // até recarregar a página.
    const m = new L2CSHealthMonitor({ janelaMs: 1000 });

    for (let t = 0; t <= 2000; t += 100) m.observe(0.42, true, t);
    expect(m.travado).toBe(true);

    // O worker volta a produzir valores diferentes.
    m.observe(0.31, true, 2100);
    expect(m.travado).toBe(false);
  });

  it('a recuperação é sinalizada para o caller poder voltar o status', () => {
    const m = new L2CSHealthMonitor({ janelaMs: 1000 });
    for (let t = 0; t <= 2000; t += 100) m.observe(0.42, true, t);
    expect(m.travado).toBe(true);

    m.observe(0.31, true, 2100);
    // `recuperou` permite ao engine chamar `setL2CSStatus('ready')` sem ter
    // que inferir a transição por conta própria.
    expect(m.recuperou).toBe(true);
  });

  it('depois de recuperar, um novo travamento pode ser acusado de novo', () => {
    // Sem isto a proteção valeria uma vez por sessão.
    const m = new L2CSHealthMonitor({ janelaMs: 1000 });

    for (let t = 0; t <= 2000; t += 100) m.observe(0.42, true, t);
    expect(m.travado).toBe(true);
    m.observe(0.31, true, 2100);
    expect(m.travado).toBe(false);

    let acusouDeNovo = false;
    for (let t = 2200; t <= 4500; t += 100) {
      if (m.observe(0.77, true, t)) acusouDeNovo = true;
    }
    expect(acusouDeNovo).toBe(true);
  });
});

describe('entradas inválidas não contam', () => {
  it('gaze inválido zera a contagem em vez de acumular', () => {
    // Worker aquecendo emite `valid:false`. Isso não é travamento — é
    // ausência de dado, e contar como travamento acusaria todo boot.
    const m = new L2CSHealthMonitor({ janelaMs: 500 });
    let acusou = false;
    for (let t = 0; t <= 3000; t += 100) {
      if (m.observe(0, false, t)) acusou = true;
    }
    expect(acusou).toBe(false);
  });

  it('NaN não trava nem acusa', () => {
    const m = new L2CSHealthMonitor({ janelaMs: 500 });
    let acusou = false;
    for (let t = 0; t <= 3000; t += 100) {
      if (m.observe(NaN, true, t)) acusou = true;
    }
    expect(acusou).toBe(false);
  });

  it('reset() volta ao estado inicial', () => {
    const m = new L2CSHealthMonitor({ janelaMs: 500 });
    for (let t = 0; t <= 2000; t += 100) m.observe(0.42, true, t);
    expect(m.travado).toBe(true);
    m.reset();
    expect(m.travado).toBe(false);
    expect(m.recuperou).toBe(false);
  });
});
