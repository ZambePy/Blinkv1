import { describe, it, expect } from 'vitest';
import { detectFlicker, inferPowerLineHz, binsCandidatos } from './flickerDetector';

// A varredura espectral do detector de cintilação só considera os bins
// compatíveis com `alias(100)` e `alias(120)` ± tolerância. Varrer a banda toda
// deixaria a variação lenta não-linear do brilho (nuvem, auto-exposure) vencer
// nos primeiros bins e virar "cintilação de 0,6 Hz — troque a lâmpada". E
// quando o alias cai em ~DC (60 Hz a 30 fps) a rede é declarada INDETECTÁVEL.

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

describe('só bins compatíveis com a rede são candidatos', () => {
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

describe('variação lenta não vira "cintilação"', () => {
  it('uma rampa não-linear de brilho não é reportada como cintilação', () => {
    // Auto-exposure caçando, nuvem passando. A remoção de tendência linear
    // não elimina a curvatura, e a energia residual cai nos primeiros bins.
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

describe('o batimento real de 50 Hz continua sendo detectado', () => {
  it('senoide de 10 Hz com amplitude acima do limiar É detectada', () => {
    // Restringir a varredura não pode cegar o detector para o caso que ele
    // existe para pegar.
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

describe('60 Hz a 30 fps é declarado indetectável, não ignorado', () => {
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

describe('casos degenerados', () => {
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
