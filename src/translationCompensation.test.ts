import { describe, it, expect } from 'vitest';
import {
  deslocamentoCm, compensarTranslacao, centroDeReferencia,
  IOD_CM, SINAL_X, SINAL_Y,
} from './translationCompensation';

const escala = { iodPx: 100, videoWidth: 1280, videoHeight: 720 };
const PX_POR_CM = 36.76;   // 23,6" 1920×1080

describe('deslocamentoCm', () => {
  it('sem movimento, nada se desloca', () => {
    expect(deslocamentoCm({ x: 0.5, y: 0.6 }, { x: 0.5, y: 0.6 }, escala))
      .toEqual({ x: 0, y: 0 });
  });

  it('um deslocamento de exatamente 1 IOD vale IOD_CM', () => {
    // 100 px de IOD em 1280 px de largura = 0,078125 em normalizado.
    const umIod = escala.iodPx / escala.videoWidth;
    const d = deslocamentoCm({ x: 0.5 + umIod, y: 0.6 }, { x: 0.5, y: 0.6 }, escala);
    expect(d.x).toBeCloseTo(IOD_CM, 9);
  });

  it('o FOV não aparece: dobrar o IOD em px pela metade a distância', () => {
    // Aproximar-se da câmera dobra `iodPx`. O MESMO deslocamento normalizado
    // passa a representar metade dos centímetros — sem que FOV ou distância
    // entrem na conta em lugar nenhum.
    const perto = deslocamentoCm({ x: 0.55, y: 0.6 }, { x: 0.5, y: 0.6 }, { ...escala, iodPx: 200 });
    const longe = deslocamentoCm({ x: 0.55, y: 0.6 }, { x: 0.5, y: 0.6 }, escala);
    expect(perto.x).toBeCloseTo(longe.x / 2, 9);
  });

  it('Y usa a ALTURA do vídeo, não a largura', () => {
    // MediaPipe normaliza x por largura e y por altura; tratar as duas como a
    // mesma escala distorce o eixo vertical em 1,78× num vídeo 16:9.
    const d = deslocamentoCm({ x: 0.5, y: 0.7 }, { x: 0.5, y: 0.6 }, escala);
    expect(d.y).toBeCloseTo((IOD_CM * 0.1 * escala.videoHeight) / escala.iodPx, 9);
    expect(d.y).not.toBeCloseTo((IOD_CM * 0.1 * escala.videoWidth) / escala.iodPx, 3);
  });

  it('entrada faltando ou degenerada devolve zero, nunca NaN', () => {
    for (const caso of [
      deslocamentoCm(null, { x: 0.5, y: 0.5 }, escala),
      deslocamentoCm({ x: 0.5, y: 0.5 }, undefined, escala),
      deslocamentoCm({ x: 0.5, y: 0.5 }, { x: 0.4, y: 0.4 }, null),
      deslocamentoCm({ x: 0.5, y: 0.5 }, { x: 0.4, y: 0.4 }, { ...escala, iodPx: 0 }),
      deslocamentoCm({ x: NaN, y: 0.5 }, { x: 0.4, y: 0.4 }, escala),
    ]) {
      expect(caso).toEqual({ x: 0, y: 0 });
    }
  });
});

describe('compensarTranslacao', () => {
  it('é 1:1 — não escala por distância de tela, ao contrário de 1.3', () => {
    // O olho anda 1 cm, o ponto olhado anda 1 cm, esteja a tela perto ou longe.
    const umIod = escala.iodPx / escala.videoWidth;
    const r = compensarTranslacao(0.5, 0.5,
      { x: 0.5 + umIod, y: 0.6 }, { x: 0.5, y: 0.6 }, escala, PX_POR_CM, 1920, 1080);
    expect(r.x).toBeCloseTo(0.5 + (SINAL_X * IOD_CM * PX_POR_CM) / 1920, 6);
  });

  it('respeita os sinais da imagem não espelhada', () => {
    // Usuário desliza para a própria direita → nariz vai para x MENOR na
    // imagem → ponto olhado vai para X de tela MAIOR.
    const r = compensarTranslacao(0.5, 0.5,
      { x: 0.45, y: 0.6 }, { x: 0.5, y: 0.6 }, escala, PX_POR_CM, 1920, 1080);
    expect(r.x).toBeGreaterThan(0.5);
    // Usuário sobe → nariz vai para y MENOR → Y de tela MENOR.
    const s = compensarTranslacao(0.5, 0.5,
      { x: 0.5, y: 0.55 }, { x: 0.5, y: 0.6 }, escala, PX_POR_CM, 1920, 1080);
    expect(s.y).toBeLessThan(0.5);
    expect(SINAL_X).toBe(-1);
    expect(SINAL_Y).toBe(+1);
  });

  it('não faz clamp — correção exagerada tem que aparecer na medição', () => {
    const r = compensarTranslacao(0.95, 0.5,
      { x: 0.1, y: 0.6 }, { x: 0.5, y: 0.6 }, escala, PX_POR_CM, 1920, 1080);
    expect(r.x).toBeGreaterThan(1);
  });

  it('sem referência devolve a predição intacta', () => {
    expect(compensarTranslacao(0.3, 0.7, { x: 0.5, y: 0.5 }, null, escala, PX_POR_CM, 1920, 1080))
      .toEqual({ x: 0.3, y: 0.7 });
  });

  it('densidade de tela inválida não corrompe a predição', () => {
    expect(compensarTranslacao(0.3, 0.7,
      { x: 0.4, y: 0.5 }, { x: 0.5, y: 0.5 }, escala, 0, 1920, 1080))
      .toEqual({ x: 0.3, y: 0.7 });
  });
});

describe('centroDeReferencia', () => {
  it('é a média por eixo', () => {
    const r = centroDeReferencia([{ x: 0.4, y: 0.5 }, { x: 0.6, y: 0.7 }])!;
    expect(r.x).toBeCloseTo(0.5, 9);
    expect(r.y).toBeCloseTo(0.6, 9);
  });

  it('ignora entradas ausentes ou não-finitas', () => {
    const r = centroDeReferencia([{ x: 0.4, y: 0.5 }, null, { x: NaN, y: 0.5 }, { x: 0.6, y: 0.7 }])!;
    expect(r.x).toBeCloseTo(0.5, 9);
  });

  it('sem amostra útil devolve null em vez de um centro inventado', () => {
    expect(centroDeReferencia([])).toBeNull();
    expect(centroDeReferencia([null, undefined])).toBeNull();
  });
});
