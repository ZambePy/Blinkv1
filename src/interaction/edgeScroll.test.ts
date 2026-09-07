import { describe, it, expect } from 'vitest';
import {
  FAIXA_PX,
  ATRASO_MS,
  VELOCIDADE_MAX_PX_S,
  estadoInicialDeBorda,
  velocidadeDaBorda,
  type EstadoDeBorda,
} from './edgeScroll';

// -----------------------------------------------------------------------------
// Rolagem por olhar nas bordas.
//
// O erro clássico deste tipo de código é o SINAL: faixa de cima rolando para
// baixo. Passa despercebido em revisão porque o código "parece certo" — e o
// usuário-alvo não tem como reclamar de forma útil ("a tela vai pro lado
// errado" descreve o sintoma, não o eixo).
//
// O segundo erro é o atraso ausente: sem ele, um olhar de relance para a borda
// rola a tela, e quem está lendo perde o lugar sem entender por quê.
// -----------------------------------------------------------------------------

const ALTURA = 1080;

/** Sequência de amostras, para exercitar a máquina como ela roda de verdade. */
function correr(
  amostras: { y: number; t: number }[],
  inicial: EstadoDeBorda = estadoInicialDeBorda(),
): { estado: EstadoDeBorda; velocidades: number[] } {
  let estado = inicial;
  const velocidades: number[] = [];
  for (const a of amostras) {
    const r = velocidadeDaBorda(estado, a.y, ALTURA, a.t);
    estado = r.estado;
    velocidades.push(r.velocidadePxS);
  }
  return { estado, velocidades };
}

const ultima = (amostras: { y: number; t: number }[]) => correr(amostras).velocidades.at(-1)!;

describe('fora das faixas', () => {
  it('o meio da tela não rola', () => {
    expect(
      ultima([
        { y: 540, t: 0 },
        { y: 540, t: 5000 },
      ]),
    ).toBe(0);
  });

  it('logo abaixo da faixa de cima não rola', () => {
    expect(
      ultima([
        { y: FAIXA_PX + 1, t: 0 },
        { y: FAIXA_PX + 1, t: 5000 },
      ]),
    ).toBe(0);
  });

  it('logo acima da faixa de baixo não rola', () => {
    const y = ALTURA - FAIXA_PX - 1;
    expect(
      ultima([
        { y, t: 0 },
        { y, t: 5000 },
      ]),
    ).toBe(0);
  });
});

describe('o sinal — o erro que passa despercebido', () => {
  it('faixa de CIMA rola para CIMA (velocidade negativa)', () => {
    expect(
      ultima([
        { y: 10, t: 0 },
        { y: 10, t: ATRASO_MS + 100 },
      ]),
    ).toBeLessThan(0);
  });

  it('faixa de BAIXO rola para BAIXO (velocidade positiva)', () => {
    const y = ALTURA - 10;
    expect(
      ultima([
        { y, t: 0 },
        { y, t: ATRASO_MS + 100 },
      ]),
    ).toBeGreaterThan(0);
  });

  it('as duas bordas têm sinais opostos na mesma profundidade', () => {
    const cima = ultima([
      { y: 20, t: 0 },
      { y: 20, t: ATRASO_MS + 100 },
    ]);
    const baixo = ultima([
      { y: ALTURA - 20, t: 0 },
      { y: ALTURA - 20, t: ATRASO_MS + 100 },
    ]);
    expect(Math.sign(cima)).toBe(-Math.sign(baixo));
    expect(Math.abs(cima)).toBeCloseTo(Math.abs(baixo), 5);
  });
});

describe('o atraso de 300 ms', () => {
  it('não rola no primeiro instante na faixa', () => {
    // Um olhar de relance para a borda não pode mover a tela de quem está lendo.
    expect(ultima([{ y: 10, t: 0 }])).toBe(0);
  });

  it('ainda não rola um instante antes do prazo', () => {
    expect(
      ultima([
        { y: 10, t: 0 },
        { y: 10, t: ATRASO_MS - 1 },
      ]),
    ).toBe(0);
  });

  it('rola a partir do prazo', () => {
    expect(
      ultima([
        { y: 10, t: 0 },
        { y: 10, t: ATRASO_MS },
      ]),
    ).not.toBe(0);
  });

  it('sair da faixa REINICIA o prazo', () => {
    // Sem o reset, olhar 200 ms, desviar, e voltar 200 ms somaria 400 ms e
    // rolaria — sem ninguém ter ficado olhando para a borda.
    const { velocidades } = correr([
      { y: 10, t: 0 },
      { y: 10, t: 200 },
      { y: 540, t: 250 }, // saiu
      { y: 10, t: 300 }, // voltou: o prazo recomeça aqui
      { y: 10, t: 450 }, // 150 ms desde a volta
    ]);
    expect(velocidades.at(-1)).toBe(0);
  });

  it('trocar de borda também reinicia o prazo', () => {
    // Atravessar a tela de uma borda à outra não pode herdar o tempo acumulado
    // na primeira e rolar na direção oposta de imediato.
    const { velocidades } = correr([
      { y: 10, t: 0 },
      { y: 10, t: ATRASO_MS + 100 },
      { y: ALTURA - 10, t: ATRASO_MS + 150 },
    ]);
    expect(velocidades.at(-1)).toBe(0);
  });
});

describe('a aceleração', () => {
  const vel = (y: number) =>
    Math.abs(
      ultima([
        { y, t: 0 },
        { y, t: ATRASO_MS + 100 },
      ]),
    );

  it('mais fundo na faixa rola mais rápido', () => {
    expect(vel(5)).toBeGreaterThan(vel(FAIXA_PX - 5));
  });

  it('é monotônica ao longo da faixa', () => {
    const amostras = [FAIXA_PX - 5, FAIXA_PX / 2, 5].map(vel);
    expect(amostras[1]).toBeGreaterThan(amostras[0]);
    expect(amostras[2]).toBeGreaterThan(amostras[1]);
  });

  it('nunca passa do teto', () => {
    // Um olhar fora da tela (y negativo) não pode virar rolagem infinita.
    expect(vel(0)).toBeLessThanOrEqual(VELOCIDADE_MAX_PX_S);
    expect(vel(-50)).toBeLessThanOrEqual(VELOCIDADE_MAX_PX_S);
  });

  it('a borda exata da faixa rola devagar, não em salto', () => {
    // Descontinuidade na entrada da faixa faria a tela pular no instante em que
    // o olhar cruza a linha.
    expect(vel(FAIXA_PX - 1)).toBeLessThan(VELOCIDADE_MAX_PX_S * 0.2);
  });
});

describe('entradas degeneradas', () => {
  it('altura zero não rola nem lança', () => {
    let estado = estadoInicialDeBorda();
    expect(() => {
      estado = velocidadeDaBorda(estado, 10, 0, 0).estado;
    }).not.toThrow();
    expect(velocidadeDaBorda(estado, 10, 0, ATRASO_MS + 100).velocidadePxS).toBe(0);
  });

  it('y NaN não rola', () => {
    // Uma amostra de olhar inválida não pode virar rolagem descontrolada.
    const r = correr([
      { y: Number.NaN, t: 0 },
      { y: Number.NaN, t: ATRASO_MS + 100 },
    ]);
    expect(r.velocidades.at(-1)).toBe(0);
  });

  it('tela mais baixa que duas faixas não rola nas duas direções ao mesmo tempo', () => {
    // Numa janela de 100 px as duas faixas se sobrepõem. Sem tratamento, o
    // mesmo ponto pediria rolagem para cima E para baixo.
    let estado = estadoInicialDeBorda();
    const r1 = velocidadeDaBorda(estado, 50, 100, 0);
    const r2 = velocidadeDaBorda(r1.estado, 50, 100, ATRASO_MS + 100);
    expect(r2.velocidadePxS).toBe(0);
  });
});
