import { describe, it, expect } from 'vitest';
import { L2CSHealthMonitor } from './block';

// -----------------------------------------------------------------------------
// B2.2 — `L2CSHealthMonitor` observado a 60 Hz com limiar dimensionado para
//        10 Hz, e o erro é irreversível.
//
// O comentário do `limite = 60` dizia "a 10 Hz de submissão, 60 são ~6 s". Mas
// `l2csHealth.observe(g.yaw, g.valid)` roda no rAF (~60 Hz) sobre o valor EM
// CACHE, não a cada inferência. O mesmo resultado do worker é observado ~6
// vezes seguidas antes de ser substituído. 60 repetições viram **~1 s**, não
// 6 s — erro de 6×.
//
// Uma única inferência de 1,0–1,5 s (plausível em WASM single-thread) disparava
// `setL2CSStatus('error')` com a mensagem "SAÍDA TRAVADA — o modelo está
// inferindo sobre imagem inútil", que é FALSA: o modelo está apenas lento.
//
// Pior: `avisou` é latch de mão única, `l2csHealth.reset()` nunca era chamado
// em produção, e nada devolvia o status para `'ready'`. `CalibrationCheck.tsx`
// (`l2csFailed`) então BLOQUEAVA A CALIBRAÇÃO PELO RESTO DA SESSÃO — a única
// saída era recarregar a página.
//
// Correção: contar por TEMPO de gaze não-variante, não por frames observados;
// e recuperar automaticamente quando o gaze voltar a variar.
// -----------------------------------------------------------------------------

describe('B2.2 — a detecção conta tempo, não frames observados', () => {
  it('observar o mesmo valor a 60 Hz por 1 s NÃO acusa travamento', () => {
    // O cenário do falso positivo: o engine lê o cache a 60 Hz enquanto uma
    // inferência lenta não retorna. São 60 observações do mesmo número em 1 s.
    const m = new L2CSHealthMonitor({ janelaMs: 6000 });
    let acusou = false;
    for (let i = 0; i < 60; i++) {
      if (m.observe(0.42, true, i * (1000 / 60))) acusou = true;
    }
    expect(acusou).toBe(false);
    expect(m.travado).toBe(false);
  });

  it('o mesmo valor por mais que a janela ACUSA travamento', () => {
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
    // A propriedade central da correção: observar a 10 Hz ou a 60 Hz tem que
    // dar o mesmo resultado, porque o que importa é há quanto TEMPO o valor
    // não muda — não quantas vezes alguém olhou para ele.
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

describe('B2.2 — recuperação automática', () => {
  it('gaze voltando a variar limpa o travamento sem reset manual', () => {
    // `avisou` era latch de mão única e `reset()` nunca era chamado em
    // produção. O paciente ficava com a calibração bloqueada até recarregar.
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

describe('B2.2 — entradas inválidas não contam', () => {
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
