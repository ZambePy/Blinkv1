import { describe, expect, it } from 'vitest';
import { matrizDoRecorte, type MatrizDoRecorte, type SquareBBox } from './crop';

/**
 * A matriz do recorte compõe escala, espelhamento e cancelamento de roll — e a
 * combinação dos dois últimos é exatamente onde um sinal errado degrada a
 * acurácia sem sintoma visível. Estes testes mapeiam pontos conhecidos.
 */

const bbox: SquareBBox = { x: 100, y: 60, side: 200 };
const SIZE = 448;
const centro = { x: bbox.x + bbox.side / 2, y: bbox.y + bbox.side / 2 };

function aplicar(m: MatrizDoRecorte, p: { x: number; y: number }) {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

describe('matrizDoRecorte', () => {
  it('o centro da bbox cai no centro do canvas, em qualquer configuração', () => {
    for (const espelho of [false, true]) {
      for (const roll of [0, 0.3, -0.5]) {
        const p = aplicar(matrizDoRecorte(bbox, SIZE, espelho, roll), centro);
        expect(p.x).toBeCloseTo(SIZE / 2, 6);
        expect(p.y).toBeCloseTo(SIZE / 2, 6);
      }
    }
  });

  it('sem roll e sem espelho, é o recorte de sempre', () => {
    const m = matrizDoRecorte(bbox, SIZE, false, 0);
    // O canto superior esquerdo da bbox vai para (0,0) e o oposto para (size,size).
    const canto = aplicar(m, { x: bbox.x, y: bbox.y });
    expect(canto.x).toBeCloseTo(0, 6);
    expect(canto.y).toBeCloseTo(0, 6);
    const oposto = aplicar(m, { x: bbox.x + bbox.side, y: bbox.y + bbox.side });
    expect(oposto.x).toBeCloseTo(SIZE, 6);
    expect(oposto.y).toBeCloseTo(SIZE, 6);
  });

  it('espelhado sem roll troca esquerda por direita e preserva o eixo vertical', () => {
    const m = matrizDoRecorte(bbox, SIZE, true, 0);
    const esquerda = aplicar(m, { x: bbox.x, y: centro.y });
    const direita = aplicar(m, { x: bbox.x + bbox.side, y: centro.y });
    expect(esquerda.x).toBeCloseTo(SIZE, 6);
    expect(direita.x).toBeCloseTo(0, 6);
    expect(esquerda.y).toBeCloseTo(SIZE / 2, 6);
  });

  it('a rotação endireita a linha dos olhos — o teste que pega o sinal errado', () => {
    // Uma "linha dos olhos" inclinada de `roll` no vídeo: o olho direito está
    // mais baixo que o esquerdo. Depois da normalização os dois têm de sair na
    // MESMA altura, com ou sem espelho.
    const roll = 0.35; // ~20°
    const meia = 40;
    const olhoA = {
      x: centro.x - meia * Math.cos(roll),
      y: centro.y - meia * Math.sin(roll),
    };
    const olhoB = {
      x: centro.x + meia * Math.cos(roll),
      y: centro.y + meia * Math.sin(roll),
    };

    for (const espelho of [false, true]) {
      const m = matrizDoRecorte(bbox, SIZE, espelho, roll);
      const a = aplicar(m, olhoA);
      const b = aplicar(m, olhoB);
      expect(a.y).toBeCloseTo(b.y, 6);
      // E continuam separados na horizontal: a rotação não colapsou a face.
      expect(Math.abs(a.x - b.x)).toBeGreaterThan(1);
    }
  });

  it('roll negativo também endireita — não é só um sinal que funciona por acaso', () => {
    const roll = -0.42;
    const meia = 50;
    const olhoA = { x: centro.x - meia * Math.cos(roll), y: centro.y - meia * Math.sin(roll) };
    const olhoB = { x: centro.x + meia * Math.cos(roll), y: centro.y + meia * Math.sin(roll) };
    for (const espelho of [false, true]) {
      const m = matrizDoRecorte(bbox, SIZE, espelho, roll);
      expect(aplicar(m, olhoA).y).toBeCloseTo(aplicar(m, olhoB).y, 6);
    }
  });

  it('a rotação não muda a escala — a face ocupa o mesmo tamanho', () => {
    const semRoll = matrizDoRecorte(bbox, SIZE, false, 0);
    const comRoll = matrizDoRecorte(bbox, SIZE, false, 0.4);
    const escala = (m: MatrizDoRecorte) => Math.hypot(m.a, m.b);
    expect(escala(comRoll)).toBeCloseTo(escala(semRoll), 9);
    // Determinante: mesma área, sinal invertido só pelo espelho.
    const det = (m: MatrizDoRecorte) => m.a * m.d - m.b * m.c;
    expect(Math.abs(det(comRoll))).toBeCloseTo(Math.abs(det(semRoll)), 9);
    expect(det(matrizDoRecorte(bbox, SIZE, true, 0.4))).toBeCloseTo(-det(comRoll), 9);
  });

  it('roll ausente ou não finito é tratado como zero, não como NaN', () => {
    const referencia = matrizDoRecorte(bbox, SIZE, false, 0);
    for (const ruim of [null, undefined, NaN, Infinity]) {
      expect(matrizDoRecorte(bbox, SIZE, false, ruim)).toEqual(referencia);
    }
  });
});
