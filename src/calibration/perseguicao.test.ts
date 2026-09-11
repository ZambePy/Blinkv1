import { describe, expect, it } from 'vitest';
import {
  LIMIAR_CORRELACAO,
  VELOCIDADE_MAX_DEG_POR_SEG,
  colher,
  pearson,
  posicaoNaTrajetoria,
  trechosSeguidos,
  velocidadeDegPorSeg,
  type AmostraDePerseguicao,
} from './perseguicao';

function ruidoDeterministico(semente: number) {
  let e = semente >>> 0;
  return () => {
    e = (e * 1664525 + 1013904223) >>> 0;
    return e / 0xffffffff - 0.5;
  };
}

/** Sessão de perseguição: o olhar segue o alvo com ganho, deslocamento e ruído. */
function sessao(opts: {
  n?: number;
  segue?: (i: number) => boolean;
  ruido?: number;
  semente?: number;
}): AmostraDePerseguicao[] {
  const n = opts.n ?? 120;
  const r = ruidoDeterministico(opts.semente ?? 7);
  const segue = opts.segue ?? (() => true);
  const amp = opts.ruido ?? 0.004;
  const out: AmostraDePerseguicao[] = [];
  for (let i = 0; i < n; i++) {
    const t = i * 33;
    const alvo = posicaoNaTrajetoria(t, n * 33);
    // Quem segue: olhar = alvo com ganho e deslocamento (é o que a calibração
    // existe para descobrir) mais ruído. Quem não segue: olha para o centro.
    const olhar = segue(i)
      ? { x: 0.15 + alvo.x * 0.8 + r() * amp, y: 0.1 + alvo.y * 0.9 + r() * amp }
      : { x: 0.5 + r() * amp, y: 0.5 + r() * amp };
    out.push({ olhar, alvo, t });
  }
  return out;
}

describe('pearson', () => {
  it('mede correlação linear', () => {
    expect(pearson([1, 2, 3, 4], [2, 4, 6, 8])!).toBeCloseTo(1, 9);
    expect(pearson([1, 2, 3, 4], [8, 6, 4, 2])!).toBeCloseTo(-1, 9);
  });

  it('série constante devolve null, não zero', () => {
    // Zero se lê como "não seguiu"; a causa real aqui é outra.
    expect(pearson([1, 1, 1, 1], [1, 2, 3, 4])).toBeNull();
    expect(pearson([1, 2], [3])).toBeNull();
  });
});

describe('trechosSeguidos', () => {
  it('quem segue o alvo o tempo todo vira um trecho longo', () => {
    const t = trechosSeguidos(sessao({}));
    expect(t.length).toBeGreaterThan(0);
    const cobertos = t.reduce((a, x) => a + (x.fim - x.ini), 0);
    expect(cobertos).toBeGreaterThan(100);
    for (const x of t) expect(x.correlacao).toBeGreaterThanOrEqual(LIMIAR_CORRELACAO);
  });

  it('quem olha para o centro não produz trecho nenhum', () => {
    const t = trechosSeguidos(sessao({ segue: () => false }));
    const cobertos = t.reduce((a, x) => a + (x.fim - x.ini), 0);
    expect(cobertos).toBe(0);
  });

  it('quem segue só em X é rejeitado nos trechos verticais', () => {
    // Nos trechos HORIZONTAIS este olhar está correto (o alvo também não se
    // move em Y), então eles são aceitos. Nos VERTICAIS, o alvo sobe e o olhar
    // não: rejeitados. O resultado é cobertura parcial, e é assim que a regra
    // "cada eixo vota quando tem o que dizer" deve se comportar.
    const base = sessao({});
    const soX = base.map((a) => ({ ...a, olhar: { x: a.olhar.x, y: 0.5 } }));
    const cobertos = trechosSeguidos(soX).reduce((a, x) => a + (x.fim - x.ini), 0);
    expect(cobertos).toBeGreaterThan(0);
    expect(cobertos).toBeLessThan(base.length * 0.7);
  });

  it('alvo parado não produz trecho — a janela não diz nada sobre perseguição', () => {
    const parado: AmostraDePerseguicao[] = Array.from({ length: 60 }, (_, i) => ({
      olhar: { x: 0.5, y: 0.5 },
      alvo: { x: 0.5, y: 0.5 },
      t: i * 33,
    }));
    expect(trechosSeguidos(parado)).toEqual([]);
  });

  it('série curta não inventa trecho', () => {
    expect(trechosSeguidos(sessao({ n: 3 }))).toEqual([]);
    expect(trechosSeguidos([])).toEqual([]);
  });
});

describe('colher', () => {
  it('devolve amostras rotuladas pelo alvo e uma fração alta quando a pessoa seguiu', () => {
    const r = colher(sessao({}));
    expect(r.amostras.length).toBeGreaterThan(100);
    expect(r.fracaoSeguida).toBeGreaterThan(0.8);
    expect(r.correlacaoMediana).not.toBeNull();
    // O rótulo é a posição do alvo, não a do olhar.
    for (const a of r.amostras) {
      expect(a.alvo.x).toBeGreaterThanOrEqual(0);
      expect(a.alvo.x).toBeLessThanOrEqual(1);
    }
  });

  it('quem não consegue perseguir sai com fração perto de zero — o sinal clínico', () => {
    // É o caso de ELA avançada e de algumas lesões de tronco: a perseguição
    // degrada ANTES da fixação, e o sistema precisa dizer "não deu" em vez de
    // treinar com o que sobrou.
    const r = colher(sessao({ segue: () => false }));
    expect(r.fracaoSeguida).toBeLessThan(0.05);
    expect(r.amostras.length).toBeLessThan(10);
  });

  it('perseguição parcial devolve só a parte boa', () => {
    const r = colher(sessao({ segue: (i) => i < 60 }));
    expect(r.fracaoSeguida).toBeGreaterThan(0.3);
    expect(r.fracaoSeguida).toBeLessThan(0.75);
  });

  it('não repete a mesma amostra em trechos que se sobrepõem', () => {
    const r = colher(sessao({}));
    const chaves = new Set(r.amostras.map((a) => `${a.olhar.x},${a.olhar.y}`));
    expect(chaves.size).toBe(r.amostras.length);
  });

  it('sessão vazia devolve zero sem dividir por zero', () => {
    const r = colher([]);
    expect(r).toEqual({ amostras: [], fracaoSeguida: 0, correlacaoMediana: null });
  });
});

describe('trajetória', () => {
  it('anda a velocidade constante — o lado curto leva menos tempo que o longo', () => {
    // Dividir o tempo em quatro partes iguais faria o lado horizontal (mais
    // longo em 16:9) correr 1,28× acima da média, estourando o limite
    // fisiológico fora do olhar de `velocidadeDegPorSeg`.
    const d = 10_000;
    const passo = 20;
    let anterior = posicaoNaTrajetoria(0, d);
    const velocidades: number[] = [];
    for (let t = passo; t <= d; t += passo) {
      const p = posicaoNaTrajetoria(t, d);
      // Distância em unidades de LARGURA (y pesa pela proporção da tela).
      velocidades.push(Math.hypot(p.x - anterior.x, (p.y - anterior.y) * (9 / 16)));
      anterior = p;
    }
    const media = velocidades.reduce((a, b) => a + b, 0) / velocidades.length;
    // Ignora os quadros que cruzam um canto (a mudança de direção encurta o
    // passo em linha reta), olhando o percentil alto: nenhum trecho corre
    // acima da média.
    const ordenadas = [...velocidades].sort((a, b) => a - b);
    const p95 = ordenadas[Math.floor(ordenadas.length * 0.95)];
    expect(p95).toBeLessThan(media * 1.05);
  });

  it('percorre os quatro cantos e fecha no ponto de partida', () => {
    const d = 8000;
    const inicio = posicaoNaTrajetoria(0, d);
    expect(posicaoNaTrajetoria(d, d).x).toBeCloseTo(inicio.x, 9);
    expect(posicaoNaTrajetoria(d, d).y).toBeCloseTo(inicio.y, 9);
    // Um quarto do tempo em cada lado.
    expect(posicaoNaTrajetoria(d / 4, d).x).toBeGreaterThan(inicio.x);
    expect(posicaoNaTrajetoria(d / 2, d).y).toBeGreaterThan(inicio.y);
  });

  it('fica dentro da tela e satura fora do intervalo de tempo', () => {
    for (const t of [-1000, 0, 4000, 8000, 99999]) {
      const p = posicaoNaTrajetoria(t, 8000);
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(1);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(1);
    }
  });

  it('dez segundos na bancada de referência ficam bem abaixo do limite fisiológico', () => {
    // 23,6" a 60 cm dão ~111 px/grau. Dez segundos é a duração do artigo, e o
    // resultado (~4°/s) cai na ponta LENTA da faixa que ele varreu (3,9 a
    // 23,3°/s) — que é onde ele mediu perseguição mais confiável.
    const v = velocidadeDegPorSeg(10_000, 1920, 1080, 111)!;
    expect(v).toBeGreaterThan(3);
    expect(v).toBeLessThan(VELOCIDADE_MAX_DEG_POR_SEG);
  });

  it('uma trajetória apressada estoura o limite, e o chamador precisa saber antes', () => {
    // Pouco mais de um segundo para dar a volta na tela: acima de 30°/s o olho
    // desiste de perseguir e passa a fazer sacadas de recuperação.
    expect(velocidadeDegPorSeg(1200, 1920, 1080, 111)!).toBeGreaterThan(VELOCIDADE_MAX_DEG_POR_SEG);
  });

  it('geometria impossível devolve null em vez de Infinity', () => {
    expect(velocidadeDegPorSeg(0, 1920, 1080, 111)).toBeNull();
    expect(velocidadeDegPorSeg(10_000, 1920, 1080, 0)).toBeNull();
  });
});
