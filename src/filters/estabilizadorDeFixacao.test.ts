import { describe, expect, it } from 'vitest';
import {
  DESLOCAMENTO_MAX_DEG,
  EstabilizadorDeFixacao,
  JANELA_MS,
  LIMIAR_FIXACAO_DEG,
  LIMIAR_SACADA_DEG,
  MIN_AMOSTRAS,
} from './estabilizadorDeFixacao';
import { pixelsPorGrau, type GeometriaDeTela } from './angularVelocity';

/** A bancada de referência: 23,6" a 60 cm → ~111 px por grau. */
const geometria: GeometriaDeTela = {
  larguraPx: 1920,
  alturaPx: 1080,
  larguraCm: 52.25,
  distanciaCm: 60,
};
const PPG = pixelsPorGrau(geometria)!;

function fabricaDeRuido(semente: number): () => number {
  let estado = semente >>> 0;
  return () => {
    estado = (estado * 1664525 + 1013904223) >>> 0;
    return estado / 0xffffffff - 0.5;
  };
}

function alimentar(
  e: EstabilizadorDeFixacao,
  pontos: [number, number][],
  t0 = 1000,
  passoMs = 33,
) {
  let ultima = e.processar(pontos[0][0], pontos[0][1], t0);
  for (let i = 1; i < pontos.length; i++) {
    ultima = e.processar(pontos[i][0], pontos[i][1], t0 + i * passoMs);
  }
  return ultima;
}

describe('EstabilizadorDeFixacao', () => {
  it('sem geometria fica inativo e devolve a entrada intacta', () => {
    const e = new EstabilizadorDeFixacao(null);
    expect(e.ativo).toBe(false);
    const s = e.processar(500, 400, 1000);
    expect(s).toEqual({ x: 500, y: 400, estado: 'movendo', dispersaoDeg: null, amostrasNaMedia: 1 });
  });

  it('as primeiras amostras nunca são fixação — janela curta dispersa pouco por construção', () => {
    // Pontos DIFERENTES de propósito: com o mesmo ponto repetido o teste
    // passaria pela guarda de desvio zero, não pela de janela curta.
    const e = new EstabilizadorDeFixacao(geometria);
    const r = fabricaDeRuido(17);
    for (let i = 0; i < MIN_AMOSTRAS - 1; i++) {
      const s = e.processar(500 + r() * 10, 400 + r() * 10, 1000 + i * 33);
      expect(s.estado).toBe('movendo');
      expect(s.amostrasNaMedia).toBe(1);
    }
  });

  it('olhar parado com tremor vira média — é aqui que o ruído cai', () => {
    const e = new EstabilizadorDeFixacao(geometria);
    // Tremor de ±10 px, bem abaixo de 1° (~111 px).
    const pontos: [number, number][] = [
      [500, 400], [508, 396], [494, 405], [503, 399], [497, 402], [505, 398],
    ];
    const s = alimentar(e, pontos);
    expect(s.estado).toBe('fixando');
    expect(s.amostrasNaMedia).toBeGreaterThanOrEqual(MIN_AMOSTRAS);
    const mediaX = pontos.reduce((a, p) => a + p[0], 0) / pontos.length;
    expect(s.x).toBeCloseTo(mediaX, 6);
    // A saída está mais perto do centro verdadeiro do que a última amostra.
    expect(Math.abs(s.x - 500)).toBeLessThan(Math.abs(pontos[pontos.length - 1][0] - 500));
  });

  it('a média reduz a dispersão da saída em relação à entrada', () => {
    const e = new EstabilizadorDeFixacao(geometria);
    const saidas: number[] = [];
    const entradas: number[] = [];
    let semente = 12345;
    const r = () => {
      semente = (semente * 1664525 + 1013904223) >>> 0;
      return semente / 0xffffffff - 0.5;
    };
    for (let i = 0; i < 60; i++) {
      const x = 500 + r() * 30;
      const y = 400 + r() * 30;
      entradas.push(x);
      const s = e.processar(x, y, 1000 + i * 33);
      if (i > 10) saidas.push(s.x);
    }
    const dp = (v: number[]) => {
      const m = v.reduce((a, b) => a + b, 0) / v.length;
      return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
    };
    expect(dp(saidas)).toBeLessThan(dp(entradas.slice(11)) * 0.7);
  });

  it('sacada solta na hora: a saída é a amostra, não a média', () => {
    const e = new EstabilizadorDeFixacao(geometria);
    alimentar(e, [[500, 400], [502, 401], [499, 399], [501, 400], [500, 402]]);
    // Salto de 5° — muito acima do limiar.
    const s = e.processar(500 + 5 * PPG, 400, 1000 + 5 * 33 + 33);
    expect(s.estado).toBe('movendo');
    expect(s.x).toBeCloseTo(500 + 5 * PPG, 6);
    expect(s.amostrasNaMedia).toBe(1);
  });

  it('depois da sacada a janela recomeça limpa, sem arrastar a fixação antiga', () => {
    const e = new EstabilizadorDeFixacao(geometria);
    alimentar(e, [[500, 400], [502, 401], [499, 399], [501, 400], [500, 402]]);
    const destino = 500 + 5 * PPG;
    let t = 1000 + 6 * 33;
    e.processar(destino, 400, t);
    // Nova fixação no destino: a média não pode conter nada do ponto anterior.
    let fixou = false;
    for (let i = 0; i < 8; i++) {
      t += 33;
      const s = e.processar(destino + (i % 2 === 0 ? 3 : -3), 400, t);
      if (s.estado === 'fixando') {
        fixou = true;
        expect(Math.abs(s.x - destino)).toBeLessThan(10);
      }
    }
    // Sem isto o teste passaria com zero asserções caso a fixação não ocorresse.
    expect(fixou).toBe(true);
  });

  it('histerese: entra abaixo de 1,0° e só sai acima de 1,5°', () => {
    const e = new EstabilizadorDeFixacao(geometria);
    // Entra em fixação com dispersão baixa.
    alimentar(e, [[500, 400], [503, 400], [497, 400], [501, 400], [499, 400]]);
    // Dispersão entre os dois limiares: a janela desliza para ~1,2° em X.
    const meio = 1.2 * PPG;
    const s = e.processar(500 + meio, 400, 1000 + 6 * 33);
    expect(s.dispersaoDeg).toBeGreaterThan(LIMIAR_FIXACAO_DEG);
    expect(s.dispersaoDeg).toBeLessThan(LIMIAR_SACADA_DEG);
    // Continua fixando: sem histerese, este quadro teria virado sacada.
    expect(s.estado).toBe('fixando');
  });

  it('uma pausa maior que a janela recomeça em vez de acumular', () => {
    const e = new EstabilizadorDeFixacao(geometria);
    alimentar(e, [[500, 400], [502, 401], [499, 399], [501, 400], [500, 402]]);
    const s = e.processar(500, 400, 1000 + JANELA_MS * 10);
    expect(s.amostrasNaMedia).toBe(1);
    expect(s.estado).toBe('movendo');
  });

  it('relógio andando para trás não trava nem explode a janela', () => {
    const e = new EstabilizadorDeFixacao(geometria);
    alimentar(e, [[500, 400], [502, 401], [499, 399], [501, 400], [500, 402]]);
    const s = e.processar(500, 400, 500);
    expect(Number.isFinite(s.x)).toBe(true);
    expect(Number.isFinite(s.y)).toBe(true);
  });

  it('entrada não finita passa direto em vez de contaminar a média', () => {
    const e = new EstabilizadorDeFixacao(geometria);
    const s = e.processar(NaN, 400, 1000);
    expect(Number.isNaN(s.x)).toBe(true);
    expect(s.amostrasNaMedia).toBe(1);
    // E a janela não guardou o NaN: a fixação seguinte é limpa.
    const t = alimentar(e, [[500, 400], [502, 401], [499, 399], [501, 400], [500, 402]], 2000);
    expect(Number.isFinite(t.x)).toBe(true);
  });

  it('a saída nunca se afasta meio grau da amostra corrente', () => {
    // O modo de falha: olhar alternando entre dois quadrantes opostos com
    // dispersão ABAIXO do limiar de fixação. Sem o teto, a média cai no meio —
    // um lugar onde o olhar nunca esteve — e parada, o que faz o dwell
    // concluir num botão errado.
    const e = new EstabilizadorDeFixacao(geometria);
    const d = 0.36 * PPG; // dispersão total ~0,72°, abaixo de 1,0°
    let t = 1000;
    let ultima = { x: 0, y: 0 };
    for (let i = 0; i < 12; i++) {
      const x = 500 + (i % 2 === 0 ? -d : d);
      const y = 400 + (i % 2 === 0 ? -d : d);
      const s = e.processar(x, y, t);
      t += 33;
      ultima = { x: s.x - x, y: s.y - y };
      expect(Math.hypot(ultima.x, ultima.y)).toBeLessThanOrEqual(DESLOCAMENTO_MAX_DEG * PPG + 1e-6);
    }
  });

  it('o teto não estraga a média num tremor pequeno', () => {
    // Tremor de ±10 px (~0,09°): bem dentro do teto, então a média sai intacta.
    const e = new EstabilizadorDeFixacao(geometria);
    const pontos: [number, number][] = [
      [500, 400], [508, 396], [494, 405], [503, 399], [497, 402], [505, 398],
    ];
    const s = alimentar(e, pontos);
    const mediaX = pontos.reduce((a, p) => a + p[0], 0) / pontos.length;
    expect(s.x).toBeCloseTo(mediaX, 6);
  });

  it('reset volta ao estado inicial', () => {
    const e = new EstabilizadorDeFixacao(geometria);
    alimentar(e, [[500, 400], [502, 401], [499, 399], [501, 400], [500, 402]]);
    e.reset();
    const s = e.processar(800, 300, 5000);
    expect(s.amostrasNaMedia).toBe(1);
    expect(s.estado).toBe('movendo');
  });
});
