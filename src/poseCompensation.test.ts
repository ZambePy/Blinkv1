import { describe, it, expect } from 'vitest';
import {
  deslocamentoPorPose, compensarPredicao, poseDeReferencia,
  SINAL_YAW_X, SINAL_PITCH_Y,
} from './poseCompensation';

const p = (yaw: number, pitch = 0, roll = 0) => ({ yaw, pitch, roll });
const graus = (d: number) => (d * Math.PI) / 180;
const DIST_PX = 2268;               // 60 cm a 96 DPI, mesma constante do harness
const GANHO = DIST_PX * Math.tan(graus(1));   // 39,6 px por grau

describe('deslocamentoPorPose', () => {
  it('pose igual à referência não desloca nada', () => {
    expect(deslocamentoPorPose(p(0.1, 0.2, 0.3), p(0.1, 0.2, 0.3), DIST_PX))
      .toEqual({ dx: 0, dy: 0 });
  });

  it('1° de yaw vale o ganho geométrico em X', () => {
    const d = deslocamentoPorPose(p(graus(1)), p(0), DIST_PX);
    expect(Math.abs(d.dx)).toBeCloseTo(GANHO, 3);
    expect(d.dy).toBe(0);
  });

  it('o ganho é o MESMO nos dois eixos — pixels são quadrados', () => {
    // É esta igualdade que tornou conclusiva a medição de 1.2: o coeficiente
    // ajustado pelo Ridge diferia entre eixos por 7×.
    const emX = deslocamentoPorPose(p(graus(3)), p(0), DIST_PX);
    const emY = deslocamentoPorPose(p(0, graus(3)), p(0, 0), DIST_PX);
    expect(Math.abs(emX.dx)).toBeCloseTo(Math.abs(emY.dy), 6);
  });

  it('respeita os sinais derivados da convenção do extractor', () => {
    // yaw↑ (nariz para a esquerda do usuário) ⟹ X de tela menor.
    expect(Math.sign(deslocamentoPorPose(p(graus(1)), p(0), DIST_PX).dx)).toBe(SINAL_YAW_X);
    // pitch↑ (nariz para baixo) ⟹ Y de tela maior.
    expect(Math.sign(deslocamentoPorPose(p(0, graus(1)), p(0, 0), DIST_PX).dy)).toBe(SINAL_PITCH_Y);
  });

  it('usa tan e não a aproximação linear — aos 10° elas já divergem 1%', () => {
    const d = deslocamentoPorPose(p(graus(10)), p(0), DIST_PX);
    const linear = DIST_PX * graus(10);
    expect(Math.abs(d.dx)).toBeCloseTo(DIST_PX * Math.tan(graus(10)), 6);
    expect(Math.abs(d.dx)).not.toBeCloseTo(linear, 1);
  });

  it('roll não desloca o ponto — rolar gira a imagem, não translada o raio', () => {
    expect(deslocamentoPorPose(p(0, 0, graus(15)), p(0, 0, 0), DIST_PX))
      .toEqual({ dx: 0, dy: 0 });
  });

  it('entrada faltando ou degenerada devolve zero, nunca NaN', () => {
    // Um NaN aqui contamina o filtro temporal e trava o cursor.
    for (const caso of [
      deslocamentoPorPose(null, p(0), DIST_PX),
      deslocamentoPorPose(p(0), undefined, DIST_PX),
      deslocamentoPorPose(p(0.1), p(0), 0),
      deslocamentoPorPose(p(0.1), p(0), -5),
      deslocamentoPorPose(p(NaN), p(0), DIST_PX),
    ]) {
      expect(caso).toEqual({ dx: 0, dy: 0 });
    }
  });
});

describe('compensarPredicao', () => {
  it('converte o deslocamento para espaço normalizado por eixo', () => {
    const r = compensarPredicao(0.5, 0.5, p(0, graus(1)), p(0, 0), DIST_PX, 1920, 1080);
    expect(r.x).toBeCloseTo(0.5, 9);
    expect(r.y).toBeCloseTo(0.5 + GANHO / 1080, 6);
  });

  it('cada eixo usa a SUA dimensão — 16:9 não é uma grandeza só', () => {
    const emX = compensarPredicao(0.5, 0.5, p(graus(2)), p(0), DIST_PX, 1920, 1080);
    const emY = compensarPredicao(0.5, 0.5, p(0, graus(2)), p(0, 0), DIST_PX, 1920, 1080);
    // Mesmo deslocamento em px vira frações diferentes: 1080 < 1920.
    expect(Math.abs(emY.y - 0.5)).toBeGreaterThan(Math.abs(emX.x - 0.5));
  });

  it('não faz clamp — compensação exagerada tem que aparecer na medição', () => {
    const r = compensarPredicao(0.9, 0.9, p(0, graus(30)), p(0, 0), DIST_PX, 1920, 1080);
    expect(r.y).toBeGreaterThan(1);
  });

  it('sem pose devolve a predição intacta', () => {
    expect(compensarPredicao(0.3, 0.7, null, p(0), DIST_PX, 1920, 1080))
      .toEqual({ x: 0.3, y: 0.7 });
  });
});

describe('poseDeReferencia', () => {
  it('é a média por eixo — o centróide do ajuste, não um frame escolhido', () => {
    const r = poseDeReferencia([p(0, 0), p(2, 4), p(4, 8)])!;
    expect(r.yaw).toBeCloseTo(2, 9);
    expect(r.pitch).toBeCloseTo(4, 9);
  });

  it('ignora entradas ausentes ou não-finitas', () => {
    const r = poseDeReferencia([p(1), null, undefined, p(3), p(NaN)])!;
    expect(r.yaw).toBeCloseTo(2, 9);
  });

  it('sem amostra útil devolve null em vez de uma referência inventada', () => {
    expect(poseDeReferencia([])).toBeNull();
    expect(poseDeReferencia([null, p(NaN)])).toBeNull();
  });
});
