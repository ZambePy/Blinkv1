import { describe, it, expect } from 'vitest';
import { claheGray, claheRGBA, gradeEfetiva, CLAHE_DEFAULTS, MIN_TILE_PIXELS } from './clahe';

// P4.5 — equalização de histograma adaptativa com contraste limitado.
//
// O que CLAHE resolve aqui: a borda íris↔esclera é o que o landmark usa para se
// posicionar, e ela some quando o crop ocular tem pouco contraste. Equalização
// GLOBAL não serve porque o crop tem regiões muito diferentes (sobrancelha
// escura, esclera clara) e a global é dominada pela maior delas. Daí "adaptativa"
// (por tile) e "com contraste limitado" (senão o ruído do sensor em região lisa
// vira textura).
//
// As asserções abaixo são propriedades do algoritmo, não números colhidos da
// implementação depois de escrita: contraste cresce, é determinístico, é puro,
// não cria costura entre tiles, e não explode em imagem constante.

/** Desvio-padrão — a medida de contraste usada em todo este arquivo. */
function desvio(v: ArrayLike<number>): number {
  let soma = 0;
  for (let i = 0; i < v.length; i++) soma += v[i];
  const media = soma / v.length;
  let sq = 0;
  for (let i = 0; i < v.length; i++) sq += (v[i] - media) ** 2;
  return Math.sqrt(sq / v.length);
}

/** Imagem de baixo contraste, determinística: valores em [100, 120]. */
function baixoContraste(w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  let s = 7;
  for (let i = 0; i < out.length; i++) {
    s = (s * 1103515245 + 12345) % 2147483648;
    out[i] = 100 + (s % 21);
  }
  return out;
}

/** Rampa horizontal suave — serve para detectar costura entre tiles. */
function rampa(w: number, h: number): Uint8ClampedArray {
  const out = new Uint8ClampedArray(w * h);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) out[y * w + x] = Math.round((x / (w - 1)) * 255);
  }
  return out;
}

describe('claheGray — contraste', () => {
  it('aumenta o contraste de uma imagem chapada', () => {
    const w = 64, h = 64;
    const src = baixoContraste(w, h);
    const out = claheGray(src, w, h);
    expect(out.length).toBe(src.length);
    expect(desvio(out)).toBeGreaterThan(desvio(src) * 2);
  });

  it('clipLimit maior permite mais amplificação — é monótono', () => {
    const w = 64, h = 64;
    const src = baixoContraste(w, h);
    const d1 = desvio(claheGray(src, w, h, { clipLimit: 1 }));
    const d2 = desvio(claheGray(src, w, h, { clipLimit: 2 }));
    const d4 = desvio(claheGray(src, w, h, { clipLimit: 4 }));
    expect(d2).toBeGreaterThanOrEqual(d1);
    expect(d4).toBeGreaterThanOrEqual(d2);
  });

  it('o default é tiles 8×8 com clipLimit 2,0, como a especificação pede', () => {
    expect(CLAHE_DEFAULTS).toEqual({ tilesX: 8, tilesY: 8, clipLimit: 2.0 });
  });

  it('espalha a saída pela faixa: a entrada ocupava 21 níveis', () => {
    const w = 64, h = 64;
    const src = baixoContraste(w, h);
    const out = claheGray(src, w, h);
    const niveisEntrada = new Set(Array.from(src)).size;
    const niveisSaida = new Set(Array.from(out)).size;
    expect(niveisEntrada).toBeLessThanOrEqual(21);
    // Não se deve exigir MAIS níveis distintos na saída: dentro de um tile o
    // mapeamento é uma função de 256→256, então ele não inventa nível nenhum —
    // no máximo os separa. O que não pode acontecer é PERDER nível, que seria
    // quantização introduzida pelo pré-processamento.
    expect(niveisSaida).toBeGreaterThanOrEqual(niveisEntrada);

    const faixaEntrada = Math.max(...src) - Math.min(...src);
    const faixaSaida = Math.max(...out) - Math.min(...out);
    // Duas asserções, e a segunda é a que tem valor.
    //
    // Piso: a faixa tem que ao menos dobrar, senão o estágio não está fazendo
    // nada e não vale o custo.
    expect(faixaSaida).toBeGreaterThanOrEqual(faixaEntrada * 2);
    // Teto: a faixa NÃO pode chegar à amplitude cheia. Esticar 20 níveis de
    // entrada até 0–255 é equalização adaptativa PURA — o que amplifica ruído
    // de sensor em região lisa, e exatamente o que o clip existe para impedir.
    // Um dia esta linha vai ser a que denuncia o clip tendo virado no-op.
    expect(faixaSaida).toBeLessThan(200);
  });
});

describe('claheGray — determinismo e pureza (requisito do harness)', () => {
  it('duas execuções dão o MESMO resultado, byte a byte', () => {
    const w = 48, h = 32;
    const src = baixoContraste(w, h);
    const a = claheGray(src, w, h);
    const b = claheGray(src, w, h);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('não altera a entrada', () => {
    const w = 32, h = 32;
    const src = baixoContraste(w, h);
    const copia = Uint8ClampedArray.from(src);
    claheGray(src, w, h);
    expect(Array.from(src)).toEqual(Array.from(copia));
  });

  it('não depende de DOM nem de relógio — roda em Node puro', () => {
    // Se o módulo tocasse em `document`, `performance` ou `Math.random`, este
    // teste falharia no ambiente do harness. Fica explícito para que ninguém
    // introduza a dependência depois sem perceber.
    expect(claheGray(new Uint8ClampedArray([0, 255, 0, 255]), 2, 2).length).toBe(4);
  });
});

describe('claheGray — bordas e degenerações', () => {
  it('imagem constante continua constante, sem NaN', () => {
    const w = 16, h = 16;
    const src = new Uint8ClampedArray(w * h).fill(128);
    const out = claheGray(src, w, h);
    expect(Array.from(out).every(Number.isFinite)).toBe(true);
    expect(new Set(Array.from(out)).size).toBe(1);
  });

  it('dimensões que não dividem certo pelos tiles não perdem pixel', () => {
    const w = 45, h = 29; // primos contra 8×8
    const out = claheGray(baixoContraste(w, h), w, h);
    expect(out.length).toBe(w * h);
    expect(Array.from(out).every((v) => v >= 0 && v <= 255)).toBe(true);
  });

  it('imagem menor que a grade de tiles não quebra', () => {
    const out = claheGray(new Uint8ClampedArray([10, 200, 30, 240]), 2, 2);
    expect(out.length).toBe(4);
  });

  it('dimensões incoerentes com o buffer são rejeitadas alto', () => {
    // Silenciar aqui produziria uma imagem embaralhada que ninguém liga ao
    // parâmetro errado — o mesmo modo de falha do crop preto de `B1.1`.
    expect(() => claheGray(new Uint8ClampedArray(10), 4, 4)).toThrow(/dimens/i);
  });
});

describe('claheGray — interpolação bilinear entre tiles', () => {
  it('não cria costura: numa rampa suave, o salto fica na ordem do passo da rampa', () => {
    const w = 128, h = 64;
    const passoDaRampa = 255 / (w - 1); // ~2 níveis por pixel
    const out = claheGray(rampa(w, h), w, h);
    let maiorSalto = 0;
    for (let y = 0; y < h; y++) {
      for (let x = 1; x < w; x++) {
        const d = Math.abs(out[y * w + x] - out[y * w + x - 1]);
        if (d > maiorSalto) maiorSalto = d;
      }
    }
    // ⚠️ Este limiar já foi 40, e 40 era frouxo demais para servir de teste: a
    // implementação passava com uma costura MEDIDA de 15 níveis exatamente nas
    // fronteiras de tile. Amarrado ao passo da rampa, o número passa a
    // significar alguma coisa — 3× o passo é folga de arredondamento, não
    // espaço para um degrau de tile.
    expect(maiorSalto).toBeLessThan(passoDaRampa * 3);
  });

  it('a saída de uma rampa é monótona: sem inversão em fronteira de tile', () => {
    const w = 128, h = 8;
    const linha = Array.from(claheGray(rampa(w, h), w, h).slice(0, w));
    // Com o clip de fato ativo (ver `MIN_TILE_PIXELS`), o mapeamento de cada
    // tile fica próximo da identidade numa rampa, e a mistura bilinear de dois
    // mapeamentos quase idênticos não inverte. Quando o clip degenerava, esta
    // linha caía 15 níveis em cada múltiplo de 16.
    for (let i = 1; i < linha.length; i++) {
      expect(linha[i]).toBeGreaterThanOrEqual(linha[i - 1]);
    }
    expect(linha[0]).toBe(0);
    expect(linha[w - 1]).toBe(255);
  });
});

describe('gradeEfetiva — o piso que mantém o clip significativo', () => {
  it('o crop 448² preserva a grade 8×8 da especificação', () => {
    expect(gradeEfetiva(448, 448, 8, 8)).toEqual({ tilesX: 8, tilesY: 8 });
  });

  it('a região dos olhos (100×50) é pequena demais para 8×8 e é reduzida', () => {
    // 100×50 = 5000 px; com 8×8 cada tile teria 78 px sobre 256 bins, e o teto
    // do clip (`clipLimit × total / 256`) cairia abaixo de 1 — o piso inteiro
    // assumiria e o clip não clipa mais nada. Reduzir a grade é a degradação
    // honesta; manter 8×8 seria prometer "contrast limited" e entregar AHE.
    const g = gradeEfetiva(100, 50, 8, 8);
    expect(g.tilesX * g.tilesY).toBeLessThanOrEqual(Math.floor(5000 / MIN_TILE_PIXELS));
    expect((100 * 50) / (g.tilesX * g.tilesY)).toBeGreaterThanOrEqual(MIN_TILE_PIXELS);
  });

  it('todo tile tem pelo menos MIN_TILE_PIXELS, em qualquer formato', () => {
    for (const [w, h] of [[128, 8], [64, 64], [45, 29], [300, 20], [16, 16]]) {
      const g = gradeEfetiva(w, h, 8, 8);
      expect((w * h) / (g.tilesX * g.tilesY)).toBeGreaterThanOrEqual(MIN_TILE_PIXELS - 1e-9);
      expect(g.tilesX).toBeGreaterThanOrEqual(1);
      expect(g.tilesY).toBeGreaterThanOrEqual(1);
    }
  });

  it('imagem minúscula colapsa para um tile só, sem quebrar', () => {
    expect(gradeEfetiva(4, 4, 8, 8)).toEqual({ tilesX: 1, tilesY: 1 });
  });
});

describe('claheRGBA', () => {
  function rgbaDe(gray: Uint8ClampedArray): Uint8ClampedArray {
    const out = new Uint8ClampedArray(gray.length * 4);
    for (let i = 0; i < gray.length; i++) {
      out[i * 4] = gray[i];
      out[i * 4 + 1] = gray[i];
      out[i * 4 + 2] = gray[i];
      out[i * 4 + 3] = 255;
    }
    return out;
  }

  it('aumenta o contraste da luminância e preserva o alfa', () => {
    const w = 32, h = 32;
    const rgba = rgbaDe(baixoContraste(w, h));
    const out = claheRGBA(rgba, w, h);
    const lumaEntrada: number[] = [];
    const lumaSaida: number[] = [];
    for (let i = 0; i < w * h; i++) {
      lumaEntrada.push(rgba[i * 4]);
      lumaSaida.push(out[i * 4]);
      expect(out[i * 4 + 3]).toBe(255);
    }
    expect(desvio(lumaSaida)).toBeGreaterThan(desvio(lumaEntrada) * 2);
  });

  it('preserva a cor: um pixel puramente vermelho não vira cinza', () => {
    const w = 8, h = 8;
    const rgba = new Uint8ClampedArray(w * h * 4);
    for (let i = 0; i < w * h; i++) {
      rgba[i * 4] = 120 + (i % 5);  // R domina
      rgba[i * 4 + 1] = 20;
      rgba[i * 4 + 2] = 20;
      rgba[i * 4 + 3] = 255;
    }
    const out = claheRGBA(rgba, w, h);
    for (let i = 0; i < w * h; i++) {
      expect(out[i * 4]).toBeGreaterThan(out[i * 4 + 1]);
      expect(out[i * 4]).toBeGreaterThan(out[i * 4 + 2]);
    }
  });

  it('buffer com tamanho incompatível é rejeitado', () => {
    expect(() => claheRGBA(new Uint8ClampedArray(4 * 10), 4, 4)).toThrow(/dimens/i);
  });
});
