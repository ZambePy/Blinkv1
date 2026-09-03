import { describe, it, expect } from 'vitest';
import { detectFlicker, inferPowerLineHz, binsCandidatos } from './flickerDetector';

// -----------------------------------------------------------------------------
// B3.15 — A varredura elege o bin de maior amplitude em TODA a banda.
//
//   for (let k = 1; k < maxK; k++) { ... if (amp > bestAmp) { bestK = k; } }
//
// Com n=96 a 30 fps, o bin 1 vale 0,31 Hz. Depois da remoção de tendência
// LINEAR sobra toda a variação lenta NÃO-linear do brilho — nuvem passando,
// alguém acendendo uma luz, o auto-exposure da câmera caçando. Essa energia
// cai nos primeiros bins, ganha o máximo, e passa de
// `AMPLITUDE_THRESHOLD = 0.03`.
//
// O usuário lê *"Cintilação de 0.6 Hz — troque a lâmpada"* sem haver
// cintilação alguma. E o conselho é caro: trocar lâmpada não é gratuito para a
// família de um paciente com ELA.
//
// Segundo defeito, no mesmo módulo: **60 Hz (Brasil) é indetectável por
// construção**. A 29,97 fps o batimento de 120 Hz é 0,12 Hz — abaixo do corte
// de 0,5 Hz que `inferPowerLineHz` aplica, e com período (8,3 s) maior que a
// janela de 3,2 s. O detector não pode achar o que não cabe na janela.
//
// Correção: restringir a varredura aos bins compatíveis com `alias(100)` e
// `alias(120)` ± tolerância. O que não é candidato a batimento de rede não
// pode ser reportado como cintilação de rede.
// -----------------------------------------------------------------------------

const FPS = 30;
const N = 96;

/** Série com uma senoide de `hz` sobre uma média, mais uma rampa opcional. */
function serie(hz: number, amplitude: number, media = 0.5, rampa = 0, curvatura = 0): number[] {
  return Array.from({ length: N }, (_, i) => {
    const t = i / FPS;
    return (
      media +
      amplitude * Math.sin(2 * Math.PI * hz * t) +
      rampa * (i / N) +
      curvatura * (i / N) ** 2
    );
  });
}

describe('B3.15 — só bins compatíveis com a rede são candidatos', () => {
  it('binsCandidatos exclui os primeiros bins a 30 fps', () => {
    // O bin 1 (0,31 Hz) e o bin 2 (0,62 Hz) são onde a variação lenta cai.
    // Nenhum dos dois pode ser candidato a batimento de rede.
    const c = binsCandidatos(N, FPS);
    expect(c).not.toContain(1);
    expect(c).not.toContain(2);
  });

  it('o bin de 10 Hz (rede 50 Hz a 30 fps) É candidato', () => {
    // `alias(100) = 100 mod 30 = 10 Hz`. O bin correspondente é
    // `10 · 96 / 30 = 32`.
    const c = binsCandidatos(N, FPS);
    expect(c).toContain(32);
  });

  it('a lista de candidatos é pequena — é uma janela, não a banda toda', () => {
    const c = binsCandidatos(N, FPS);
    expect(c.length).toBeGreaterThan(0);
    expect(c.length).toBeLessThan(N / 4);
  });
});

describe('B3.15 — variação lenta NÃO vira "cintilação"', () => {
  it('uma rampa não-linear de brilho não é reportada como cintilação', () => {
    // O falso positivo do bug: auto-exposure caçando, nuvem passando. A
    // remoção de tendência linear não elimina a curvatura, e a energia
    // residual cai nos primeiros bins.
    const s = serie(0, 0, 0.5, 0.10, 0.15);   // sem senoide, só deriva curva
    const r = detectFlicker(s, FPS);
    expect(r.detected).toBe(false);
  });

  it('uma oscilação lenta de 0,6 Hz não é reportada', () => {
    // Sombra em movimento, ventilador de teto, alguém andando na frente da
    // janela. Nada disso se resolve trocando lâmpada.
    const s = serie(0.6, 0.08);
    const r = detectFlicker(s, FPS);
    expect(r.detected).toBe(false);
  });

  it('uma oscilação de 3 Hz também não — não é alias de 50 nem de 60 Hz', () => {
    const s = serie(3, 0.08);
    expect(detectFlicker(s, FPS).detected).toBe(false);
  });
});

describe('B3.15 — o batimento real de 50 Hz continua sendo detectado', () => {
  it('senoide de 10 Hz com amplitude acima do limiar É detectada', () => {
    // Regressão: restringir a varredura não pode cegar o detector para o caso
    // que ele existe para pegar.
    const s = serie(10, 0.06);
    const r = detectFlicker(s, FPS);
    expect(r.detected).toBe(true);
    expect(r.dominantHz).toBeCloseTo(10, 0);
  });

  it('o batimento de 10 Hz é atribuído a 50 Hz', () => {
    expect(inferPowerLineHz(10, FPS)).toBe(50);
  });

  it('amplitude abaixo do limiar não dispara', () => {
    const s = serie(10, 0.005);
    expect(detectFlicker(s, FPS).detected).toBe(false);
  });

  it('a detecção sobrevive a uma deriva lenta somada ao batimento', () => {
    // Cenário realista: a lâmpada pisca E a exposição está caçando. O
    // batimento tem que continuar visível.
    const s = serie(10, 0.06, 0.5, 0.08, 0.10);
    expect(detectFlicker(s, FPS).detected).toBe(true);
  });
});

describe('B3.15 — 60 Hz a 30 fps é declarado INDETECTÁVEL, não ignorado', () => {
  it('inferPowerLineHz não atribui 60 Hz quando o alias cai em ~DC', () => {
    // `alias(120) = 120 mod 30 = 0`. Não há batimento para observar.
    expect(inferPowerLineHz(0.12, FPS)).toBeNull();
  });

  it('detectFlicker informa que 60 Hz não é observável nesta taxa', () => {
    // O ponto: o cuidador precisa saber que a AUSÊNCIA de detecção não é
    // prova de ausência de cintilação. Sem esse aviso, "nenhuma cintilação
    // detectada" numa rede de 60 Hz (Brasil) é uma afirmação falsa.
    const r = detectFlicker(serie(0, 0), FPS);
    expect(r.redeIndetectavel).toContain(60);
  });

  it('a 25 fps, 50 Hz é que fica indetectável', () => {
    // `alias(100) = 100 mod 25 = 0`. A simetria confirma que a regra é
    // geral, não um caso especial escrito à mão.
    const r = detectFlicker(serie(0, 0), 25);
    expect(r.redeIndetectavel).toContain(50);
  });

  it('a 24 fps as duas redes são observáveis', () => {
    // alias(100) = 100 mod 24 = 4 Hz; alias(120) = 0 → 60 Hz indetectável.
    // Já a 20 fps: alias(100)=0 e alias(120)=0, ambas cegas.
    const r = detectFlicker(serie(0, 0), 20);
    expect(r.redeIndetectavel).toEqual(expect.arrayContaining([50, 60]));
  });
});

describe('B3.15 — casos degenerados', () => {
  it('série curta demais não reporta detecção', () => {
    expect(detectFlicker([0.5, 0.5, 0.5], FPS).detected).toBe(false);
  });

  it('fps inválido não lança', () => {
    expect(() => detectFlicker(serie(10, 0.06), 0)).not.toThrow();
    expect(detectFlicker(serie(10, 0.06), 0).detected).toBe(false);
  });

  it('série constante não reporta cintilação', () => {
    expect(detectFlicker(new Array(N).fill(0.5), FPS).detected).toBe(false);
  });
});
