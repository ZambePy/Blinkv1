import { describe, it, expect } from 'vitest';
import {
  AdaptiveEma,
  alphaPorVelocidade,
  ALPHA_LENTO,
  ALPHA_RAPIDO,
  VELOCIDADE_LENTA_DEG_S,
  VELOCIDADE_RAPIDA_DEG_S,
  DEAD_ZONE_DEG,
  DEAD_ZONE_JANELA_MS,
} from './adaptiveEma';
import {
  pixelsPorGrau,
  pixelsParaGraus,
  velocidadeAngularDegPorSeg,
  geometriaDeDiagonal,
  type GeometriaDeTela,
} from './angularVelocity';

// -----------------------------------------------------------------------------
// P6.2 — α por velocidade angular. P6.4 — zona morta.
//
// O aceite de `P6.2` pede três coisas: α monotônico na velocidade, respeitando
// os limites, e **a conversão px→°/s batendo com a geometria declarada** — que
// é o ponto onde a dependência de `B2.9`/`B2.10` aparece.
//
// O aceite de `P6.4` pede ruído sub-limiar (saída constante), movimento de 0,5°
// (saída acompanha), e **sem "grudar" perceptível ao sair da zona**.
// -----------------------------------------------------------------------------

/** Setup de referência do projeto: 23,6" 16:9 a 60 cm, 1920×1080. */
const TELA: GeometriaDeTela = {
  larguraPx: 1920,
  alturaPx: 1080,
  larguraCm: 52.25,
  distanciaCm: 60,
};

describe('conversão px ↔ grau (a base de P6.2 e P6.4)', () => {
  it('bate com a geometria declarada do posto de referência', () => {
    // 1920 px / 52,25 cm = 36,75 px/cm. Um grau a 60 cm cobre
    // 60 · tan(1°) = 1,047 cm → 36,75 × 1,047 = 38,5 px/grau.
    //
    // ⚠️ Não são os "111 px por grau" que aparecem no repositório: aquele
    // número é de outra geometria (tela maior ou distância maior). O ponto do
    // teste é justamente que o valor SAI da geometria, em vez de ser constante.
    const ppg = pixelsPorGrau(TELA)!;
    expect(ppg).toBeCloseTo(38.5, 0);
  });

  it('tela maior à mesma distância dá MAIS pixels por grau', () => {
    const maior = pixelsPorGrau({ ...TELA, larguraCm: 88, larguraPx: 1920 })!;
    expect(maior).toBeLessThan(pixelsPorGrau(TELA)!);
    // (menos px por cm → menos px por grau; a checagem inversa:)
    const maisDensa = pixelsPorGrau({ ...TELA, larguraPx: 3840 })!;
    expect(maisDensa).toBeCloseTo(pixelsPorGrau(TELA)! * 2, 1);
  });

  it('mais longe dá MAIS pixels por grau', () => {
    expect(pixelsPorGrau({ ...TELA, distanciaCm: 120 })!)
      .toBeCloseTo(pixelsPorGrau(TELA)! * 2, 1);
  });

  it('geometria degenerada devolve null, nunca Infinity', () => {
    expect(pixelsPorGrau({ ...TELA, distanciaCm: 0 })).toBeNull();
    expect(pixelsPorGrau({ ...TELA, larguraCm: 0 })).toBeNull();
    expect(pixelsPorGrau({ ...TELA, larguraPx: 0 })).toBeNull();
    expect(pixelsPorGrau({ ...TELA, distanciaCm: NaN })).toBeNull();
  });

  it('velocidade angular: 38,5 px em 1 s dá ~1°/s nesta tela', () => {
    const ppg = pixelsPorGrau(TELA)!;
    expect(velocidadeAngularDegPorSeg(0, 0, ppg, 0, 1, TELA)).toBeCloseTo(1, 6);
  });

  it('dt não-positivo devolve null em vez de velocidade infinita', () => {
    // Infinito aqui empurraria α para o extremo responsivo — o oposto do certo
    // num quadro duplicado.
    expect(velocidadeAngularDegPorSeg(0, 0, 100, 0, 0, TELA)).toBeNull();
    expect(velocidadeAngularDegPorSeg(0, 0, 100, 0, -1, TELA)).toBeNull();
  });

  it('geometriaDeDiagonal usa a razão de aspecto REAL, não 16:9 assumido', () => {
    // Uma janela 1000×1000 numa tela de 24" tem geometria diferente da que
    // sairia se assumíssemos 16:9 — e assumir seria errado em ultrawide ou
    // fora de tela cheia.
    const g = geometriaDeDiagonal(1000, 1000, 24, 60)!;
    const diagPx = Math.hypot(1000, 1000);
    expect(g.larguraCm).toBeCloseTo((1000 * 24 * 2.54) / diagPx, 4);
  });

  it('geometriaDeDiagonal com entrada inválida devolve null', () => {
    expect(geometriaDeDiagonal(0, 1080, 24, 60)).toBeNull();
    expect(geometriaDeDiagonal(1920, 1080, 0, 60)).toBeNull();
    expect(geometriaDeDiagonal(1920, 1080, 24, 0)).toBeNull();
  });
});

describe('P6.2 — α por velocidade', () => {
  it('os limites são os da especificação', () => {
    expect(ALPHA_LENTO).toBe(0.08);
    expect(ALPHA_RAPIDO).toBe(0.35);
    expect(VELOCIDADE_LENTA_DEG_S).toBe(5);
    expect(VELOCIDADE_RAPIDA_DEG_S).toBe(15);
  });

  it('abaixo de 5°/s vale o α lento; acima de 15°/s, o rápido', () => {
    expect(alphaPorVelocidade(0)).toBe(ALPHA_LENTO);
    expect(alphaPorVelocidade(4.9)).toBe(ALPHA_LENTO);
    expect(alphaPorVelocidade(15)).toBe(ALPHA_RAPIDO);
    expect(alphaPorVelocidade(100)).toBe(ALPHA_RAPIDO);
  });

  it('é MONOTÔNICO na velocidade', () => {
    let anterior = -Infinity;
    for (let v = 0; v <= 25; v += 0.25) {
      const a = alphaPorVelocidade(v);
      expect(a).toBeGreaterThanOrEqual(anterior);
      anterior = a;
    }
  });

  it('nunca sai da faixa [lento, rápido]', () => {
    for (let v = -10; v <= 50; v += 0.5) {
      const a = alphaPorVelocidade(v);
      expect(a).toBeGreaterThanOrEqual(ALPHA_LENTO);
      expect(a).toBeLessThanOrEqual(ALPHA_RAPIDO);
    }
  });

  it('no meio da faixa, α fica no meio', () => {
    expect(alphaPorVelocidade(10)).toBeCloseTo((ALPHA_LENTO + ALPHA_RAPIDO) / 2, 9);
  });

  it('velocidade não-finita cai no α lento — é medição quebrada, não movimento', () => {
    // `Infinity` NÃO é tratado como "muito rápido". Uma velocidade infinita só
    // aparece com dt = 0, isto é, dois quadros no mesmo instante de relógio —
    // um quadro duplicado, onde o cursor não se moveu. Interpretar isso como
    // sacada empurraria α para o extremo responsivo exatamente quando não há
    // movimento. (O caminho normal nem chega aqui: `velocidadeAngularDegPorSeg`
    // devolve `null` para dt ≤ 0.)
    expect(alphaPorVelocidade(NaN)).toBe(ALPHA_LENTO);
    expect(alphaPorVelocidade(Infinity)).toBe(ALPHA_LENTO);
    expect(alphaPorVelocidade(-Infinity)).toBe(ALPHA_LENTO);
  });
});

describe('AdaptiveEma — comportamento', () => {
  const ppg = pixelsPorGrau(TELA)!;
  /** Sem zona morta, para isolar o comportamento do α. */
  const semZona = () => new AdaptiveEma({ geometria: TELA, deadZoneDeg: 0 });

  it('a primeira medição passa direto', () => {
    const f = semZona();
    const r = f.filter(500, 300, 0);
    expect(r).toMatchObject({ x: 500, y: 300, velocidadeDegPorSeg: null });
  });

  it('movimento rápido usa α rápido; fixação usa α lento', () => {
    const rapido = semZona();
    rapido.filter(0, 300, 0);
    // 40°/s → 40 × 38,5 px = 1540 px em 1 s; em 33 ms são ~51 px.
    const r1 = rapido.filter(40 * ppg * 0.033, 300, 33);
    expect(r1.velocidadeDegPorSeg!).toBeGreaterThan(VELOCIDADE_RAPIDA_DEG_S);
    expect(r1.alpha).toBe(ALPHA_RAPIDO);

    const lento = semZona();
    lento.filter(500, 300, 0);
    const r2 = lento.filter(500 + 1 * ppg * 0.033, 300, 33); // 1°/s
    expect(r2.velocidadeDegPorSeg!).toBeLessThan(VELOCIDADE_LENTA_DEG_S);
    expect(r2.alpha).toBe(ALPHA_LENTO);
  });

  it('a velocidade sai da medição CRUA, não da saída filtrada', () => {
    // Medir sobre a saída realimentaria o filtro: mais suavização → velocidade
    // menor → α menor → mais suavização. Travaria no lento para sempre.
    const f = semZona();
    f.filter(0, 300, 0);
    let ultima = f.filter(0, 300, 33);
    for (let i = 2; i < 30; i++) {
      // Movimento constante e rápido.
      ultima = f.filter(i * 40 * ppg * 0.033, 300, i * 33);
    }
    expect(ultima.alpha).toBe(ALPHA_RAPIDO);
  });

  it('suaviza: a saída fica entre a anterior e a medição', () => {
    const f = semZona();
    f.filter(0, 0, 0);
    const r = f.filter(1000, 0, 33);
    expect(r.x).toBeGreaterThan(0);
    expect(r.x).toBeLessThan(1000);
  });

  it('medição não-finita não contamina o estado', () => {
    const f = semZona();
    f.filter(500, 300, 0);
    const r = f.filter(NaN, 300, 33);
    expect(r.x).toBe(500);
  });
});

describe('P6.4 — zona morta', () => {
  const ppg = pixelsPorGrau(TELA)!;
  const comZona = () => new AdaptiveEma({ geometria: TELA });

  it('os limites são os da especificação: 0,3° em 200 ms', () => {
    expect(DEAD_ZONE_DEG).toBe(0.3);
    expect(DEAD_ZONE_JANELA_MS).toBe(200);
  });

  it('RUÍDO sub-limiar: a saída fica CONSTANTE', () => {
    const f = comZona();
    f.filter(500, 300, 0);
    // Tremor de ±0,1° (bem abaixo de 0,3°), por 1 segundo.
    const tremor = 0.1 * ppg;
    let saida = { x: 0, y: 0 };
    const amostras: number[] = [];
    for (let t = 33; t <= 1000; t += 33) {
      saida = f.filter(500 + (t % 66 === 0 ? tremor : -tremor), 300, t);
      if (t > 300) amostras.push(saida.x);
    }
    // Depois da janela de 200 ms, a saída congela: todas as amostras iguais.
    expect(new Set(amostras).size).toBe(1);
  });

  it('MOVIMENTO real de 0,5°: a saída acompanha', () => {
    const f = comZona();
    f.filter(500, 300, 0);
    let r = f.filter(500, 300, 100);
    r = f.filter(500 + 0.5 * ppg, 300, 200);
    expect(r.naZonaMorta).toBe(false);
    expect(r.x).toBeGreaterThan(500);
  });

  it('a zona morta mede contra a ÂNCORA, não contra o quadro anterior', () => {
    // Uma deriva lenta e constante, com cada passo abaixo do limiar, escaparia
    // de uma zona morta medida frame a frame: o cursor escorregaria sem nunca
    // "se mover". Medindo contra a âncora, a deriva acumulada rompe a zona.
    const f = comZona();
    f.filter(500, 300, 0);
    const passo = 0.05 * ppg; // 0,05° por quadro
    let saiu = false;
    for (let i = 1; i <= 20; i++) {
      const r = f.filter(500 + i * passo, 300, i * 33);
      if (!r.naZonaMorta && i > 8) saiu = true;
    }
    expect(saiu).toBe(true);
  });

  it('NÃO gruda ao sair da zona: o salto de retomada é pequeno', () => {
    // O risco de uma zona morta é o cursor "colar" e depois pular para
    // alcançar. Como a saída congelada continua sendo o EMA (que nunca ficou
    // longe da medição), a retomada é suave.
    const f = comZona();
    f.filter(500, 300, 0);
    for (let t = 33; t <= 400; t += 33) f.filter(500, 300, t);  // congela
    const congelado = f.filter(500, 300, 433).x;
    const retomada = f.filter(500 + 1 * ppg, 300, 466);          // move 1°
    // O primeiro quadro de retomada anda uma fração do caminho (α), não um
    // salto para o destino nem um degrau acumulado.
    const avanco = retomada.x - congelado;
    expect(avanco).toBeGreaterThan(0);
    expect(avanco).toBeLessThan(1 * ppg);
  });

  it('a zona só ativa DEPOIS da janela de 200 ms', () => {
    const f = comZona();
    f.filter(500, 300, 0);
    // 100 ms parado: ainda não congelou.
    expect(f.filter(500, 300, 100).naZonaMorta).toBe(false);
    // 250 ms: congelou.
    expect(f.filter(500, 300, 250).naZonaMorta).toBe(true);
  });

  it('deadZoneDeg = 0 desliga a zona', () => {
    const f = new AdaptiveEma({ geometria: TELA, deadZoneDeg: 0 });
    f.filter(500, 300, 0);
    for (let t = 33; t <= 600; t += 33) {
      expect(f.filter(500, 300, t).naZonaMorta).toBe(false);
    }
  });

  it('reset volta ao estado inicial', () => {
    const f = comZona();
    f.filter(500, 300, 0);
    f.reset();
    expect(f.filter(123, 456, 0)).toMatchObject({ x: 123, y: 456 });
  });
});

describe('sem geometria utilizável', () => {
  it('cai no α lento em vez de escolher a partir de uma velocidade inventada', () => {
    const f = new AdaptiveEma({
      geometria: { larguraPx: 1920, alturaPx: 1080, larguraCm: 0, distanciaCm: 60 },
      deadZoneDeg: 0,
    });
    f.filter(0, 0, 0);
    const r = f.filter(1000, 0, 33);
    expect(r.velocidadeDegPorSeg).toBeNull();
    expect(r.alpha).toBe(ALPHA_LENTO);
  });

  it('e a zona morta também não dispara sem geometria', () => {
    const f = new AdaptiveEma({
      geometria: { larguraPx: 1920, alturaPx: 1080, larguraCm: 0, distanciaCm: 60 },
    });
    f.filter(500, 300, 0);
    for (let t = 33; t <= 600; t += 33) {
      expect(f.filter(500, 300, t).naZonaMorta).toBe(false);
    }
  });
});

describe('pixelsParaGraus', () => {
  it('é o inverso de pixelsPorGrau', () => {
    const ppg = pixelsPorGrau(TELA)!;
    expect(pixelsParaGraus(ppg * 3, TELA)).toBeCloseTo(3, 9);
  });

  it('devolve null sem geometria', () => {
    expect(pixelsParaGraus(100, { ...TELA, distanciaCm: 0 })).toBeNull();
  });
});
