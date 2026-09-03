import { describe, it, expect } from 'vitest';
import { Kalman2D, KALMAN_DEFAULTS } from './kalman2d';

// -----------------------------------------------------------------------------
// P6.1 — Kalman 2D.
//
// O aceite pede duas coisas, e a segunda é a que dá trabalho:
//
//   1. Trajetória de velocidade constante + ruído gaussiano de σ conhecido:
//      variância da saída menor que a da entrada, e atraso de fase previsto.
//   2. **O trade-off da predição precisa estar VISÍVEL no teste**: predizer 1
//      quadro reduz o erro em movimento e o AUMENTA em repouso.
//
// A segunda existe para impedir que alguém "melhore" uma metade esquecendo a
// outra. Não há escolha grátis aqui, e o teste é o que registra isso.
// -----------------------------------------------------------------------------

/** PRNG determinístico com distribuição aproximadamente normal (Box-Muller). */
function ruidoGaussiano(seed: number) {
  let s = seed;
  const uniforme = () => {
    s = (s * 1103515245 + 12345) % 2147483648;
    return (s + 1) / 2147483649;
  };
  return (sigma: number) => {
    const u1 = uniforme(), u2 = uniforme();
    return sigma * Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
  };
}

function variancia(v: number[]): number {
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  return v.reduce((a, b) => a + (b - m) ** 2, 0) / v.length;
}

const DT = 1 / 30;

describe('parâmetros da especificação', () => {
  it('Q = 0,01 e R = 0,1, com predição de 1 quadro', () => {
    expect(KALMAN_DEFAULTS.processVariance).toBe(0.01);
    expect(KALMAN_DEFAULTS.measurementVariance).toBe(0.1);
    expect(KALMAN_DEFAULTS.predictAheadFrames).toBe(1);
  });
});

describe('suavização — ruído sobre alvo parado', () => {
  it('a variância da SAÍDA é menor que a da ENTRADA', () => {
    const gauss = ruidoGaussiano(42);
    const k = new Kalman2D({ predictAheadFrames: 0 });
    const entrada: number[] = [];
    const saida: number[] = [];
    for (let i = 0; i < 400; i++) {
      const medido = 500 + gauss(10);
      const out = k.filter(medido, 300, DT);
      // Descarta o transiente inicial: o filtro parte da primeira medição e
      // leva alguns quadros para a covariância assentar.
      if (i > 100) { entrada.push(medido); saida.push(out.x); }
    }
    expect(variancia(saida)).toBeLessThan(variancia(entrada));
    // E a redução tem que ser substancial, não marginal.
    expect(variancia(saida)).toBeLessThan(variancia(entrada) * 0.5);
  });

  it('R maior suaviza mais — o parâmetro tem o efeito documentado', () => {
    const rodar = (r: number) => {
      const gauss = ruidoGaussiano(7);
      const k = new Kalman2D({ measurementVariance: r, predictAheadFrames: 0 });
      const out: number[] = [];
      for (let i = 0; i < 400; i++) {
        const v = k.filter(500 + gauss(10), 300, DT);
        if (i > 100) out.push(v.x);
      }
      return variancia(out);
    };
    expect(rodar(1.0)).toBeLessThan(rodar(0.05));
  });
});

describe('velocidade constante — o modelo do filtro', () => {
  it('aprende a velocidade e acompanha sem viés crescente', () => {
    const k = new Kalman2D({ predictAheadFrames: 0 });
    const velocidade = 300; // px/s
    let erroFinal = 0;
    for (let i = 0; i < 300; i++) {
      const verdadeiro = 100 + velocidade * i * DT;
      const out = k.filter(verdadeiro, 300, DT);
      if (i > 200) erroFinal = Math.abs(out.x - verdadeiro);
    }
    // Sem ruído e com o modelo certo, o erro em regime tem que ser pequeno.
    expect(erroFinal).toBeLessThan(5);
    // E a velocidade estimada tem que convergir para a real.
    expect(k.state.vx).toBeCloseTo(velocidade, -1);
  });

  it('o atraso de fase existe e é da ordem prevista pelo ganho', () => {
    // Sem predição, um filtro que confia no modelo fica ATRÁS de um alvo em
    // movimento. É o custo da suavização, e ele precisa ser mensurável.
    const k = new Kalman2D({ predictAheadFrames: 0 });
    const velocidade = 300;
    let atraso = 0;
    for (let i = 0; i < 200; i++) {
      const verdadeiro = 100 + velocidade * i * DT;
      const out = k.filter(verdadeiro, 300, DT);
      if (i === 199) atraso = (verdadeiro - out.x) / velocidade; // em segundos
    }
    // Atraso positivo (está atrás) e menor que um quadro.
    expect(atraso).toBeGreaterThanOrEqual(0);
    expect(atraso).toBeLessThan(DT);
  });
});

describe('o TRADE-OFF da predição (aceite explícito)', () => {
  /**
   * Erro médio contra a posição VERDADEIRA NO INSTANTE ATUAL.
   *
   * ⚠️ `atrasoQuadros` é o que torna este teste honesto. O sensor deste
   * pipeline NÃO mede o instante atual: MediaPipe (~19 ms) + crop (~12 ms) +
   * inferência do L2CS (32–50 ms com WebGPU) somam 2 a 3 quadros a 30 fps. A
   * medição que chega descreve onde o olho ESTAVA.
   *
   * A primeira versão deste teste media contra um sensor instantâneo, e com
   * isso a predição só podia piorar — não havia latência para compensar. Medido
   * assim, os números eram:
   *
   *     sem atraso:      pa=0 → 0,80   pa=1 → 13,62   (predição atrapalha)
   *     atraso de 2 q.:  pa=0 → 26,39  pa=1 → 13,05   pa=2 → 0,89
   *
   * Ou seja: a predição não "melhora o movimento" por mágica — ela **cancela
   * latência**, e o horizonte ótimo é igual à latência.
   */
  function erroMedio(
    predictAhead: number,
    emMovimento: boolean,
    sigma: number,
    atrasoQuadros: number,
  ): number {
    const gauss = ruidoGaussiano(99);
    const k = new Kalman2D({ predictAheadFrames: predictAhead });
    const velocidade = emMovimento ? 400 : 0;
    let soma = 0, n = 0;
    for (let i = 0; i < 400; i++) {
      const verdadeiroAgora = 100 + velocidade * i * DT;
      const oQueOSensorViu = 100 + velocidade * (i - atrasoQuadros) * DT;
      const out = k.filter(oQueOSensorViu + gauss(sigma), 300, DT);
      if (i > 100) { soma += Math.abs(out.x - verdadeiroAgora); n++; }
    }
    return soma / n;
  }

  it('EM MOVIMENTO com a latência real do pipeline: a predição REDUZ o erro', () => {
    const ATRASO = 2; // quadros — a latência medida do pipeline
    expect(erroMedio(1, true, 3, ATRASO)).toBeLessThan(erroMedio(0, true, 3, ATRASO));
  });

  it('EM REPOUSO: a predição AUMENTA o erro', () => {
    // Em fixação a velocidade estimada é ruído, e projetar ruído adiante só
    // espalha o cursor. Vale COM ou SEM latência: parado, não há o que
    // antecipar. Este teste existe para o trade-off não ficar escondido —
    // quem "melhorar" a predição sem olhar para cá vai quebrar isto.
    expect(erroMedio(1, false, 3, 2)).toBeGreaterThan(erroMedio(0, false, 3, 2));
    expect(erroMedio(1, false, 3, 0)).toBeGreaterThan(erroMedio(0, false, 3, 0));
  });

  it('o horizonte ÓTIMO é igual à latência, não maior nem menor', () => {
    // É a conclusão que decide o valor default, e ela não é óbvia: predizer
    // demais ultrapassa o alvo tanto quanto predizer de menos fica atrás.
    const ATRASO = 2;
    const e0 = erroMedio(0, true, 3, ATRASO);
    const e1 = erroMedio(1, true, 3, ATRASO);
    const e2 = erroMedio(2, true, 3, ATRASO);
    const e4 = erroMedio(4, true, 3, ATRASO);
    expect(e2).toBeLessThan(e1);
    expect(e2).toBeLessThan(e0);
    expect(e4).toBeGreaterThan(e2);
  });

  it('SEM latência, qualquer predição piora — o caso que expôs o erro do teste', () => {
    expect(erroMedio(1, true, 3, 0)).toBeGreaterThan(erroMedio(0, true, 3, 0));
  });
});

describe('guardas', () => {
  it('a primeira medição INICIALIZA, não é filtrada', () => {
    // Sem isto o filtro parte de (0,0) e leva vários quadros para alcançar o
    // cursor — deslize visível no começo de cada sessão.
    const k = new Kalman2D();
    expect(k.filter(800, 600, DT)).toEqual({ x: 800, y: 600 });
    expect(k.ready).toBe(true);
  });

  it('dt = 0 não degenera a covariância (lição de B3.5)', () => {
    const k = new Kalman2D();
    k.filter(100, 100, DT);
    for (let i = 0; i < 50; i++) k.filter(110, 100, 0);
    expect(Number.isFinite(k.state.x)).toBe(true);
    expect(Number.isFinite(k.state.vx)).toBe(true);
  });

  it('dt enorme é clampado — aba em segundo plano não joga o cursor fora', () => {
    const k = new Kalman2D();
    k.filter(100, 100, DT);
    k.filter(200, 100, DT);
    const out = k.filter(210, 100, 30); // 30 segundos
    expect(Math.abs(out.x)).toBeLessThan(10000);
    expect(Number.isFinite(out.x)).toBe(true);
  });

  it('medição não-finita é ignorada, sem contaminar o estado', () => {
    const k = new Kalman2D();
    k.filter(100, 100, DT);
    const antes = k.state;
    k.filter(NaN, 100, DT);
    expect(k.state).toEqual(antes);
  });

  it('reset volta ao estado não inicializado', () => {
    const k = new Kalman2D();
    k.filter(500, 400, DT);
    k.reset();
    expect(k.ready).toBe(false);
    expect(k.filter(123, 456, DT)).toEqual({ x: 123, y: 456 });
  });

  it('é determinístico', () => {
    const rodar = () => {
      const k = new Kalman2D();
      const g = ruidoGaussiano(5);
      let ultimo = { x: 0, y: 0 };
      for (let i = 0; i < 100; i++) ultimo = k.filter(500 + g(5), 300 + g(5), DT);
      return ultimo;
    };
    expect(rodar()).toEqual(rodar());
  });
});

describe('predict e step — o que o hold on blink (P6.3) usa', () => {
  it('predict projeta sem consumir medição', () => {
    const k = new Kalman2D({ predictAheadFrames: 0 });
    for (let i = 0; i < 100; i++) k.filter(100 + 300 * i * DT, 300, DT);
    const antes = k.state;
    const p = k.predict(3, DT);
    // O estado NÃO muda — é só uma projeção.
    expect(k.state).toEqual(antes);
    // E a projeção anda no sentido da velocidade.
    expect(p.x).toBeGreaterThan(antes.x);
    expect(p.x - antes.x).toBeCloseTo(antes.vx * 3 * DT, 6);
  });

  it('step avança no tempo e AUMENTA a incerteza', () => {
    // A incerteza crescente é o que faz o filtro voltar a aceitar medição
    // rapidamente quando o olho reabre. Sem isso, o cursor demoraria para
    // reengatar depois de uma piscada longa.
    const k = new Kalman2D({ predictAheadFrames: 0 });
    for (let i = 0; i < 60; i++) k.filter(100 + 300 * i * DT, 300, DT);
    const posAntes = k.state.x;
    for (let i = 0; i < 10; i++) k.step(DT);
    expect(k.state.x).toBeGreaterThan(posAntes);

    // Depois do hold, uma medição distante é absorvida rápido.
    const salto = k.filter(k.state.x + 200, 300, DT);
    expect(salto.x - posAntes).toBeGreaterThan(100);
  });

  it('step antes da inicialização é no-op', () => {
    const k = new Kalman2D();
    k.step(DT);
    expect(k.ready).toBe(false);
  });
});
