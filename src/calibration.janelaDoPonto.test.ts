import { describe, it, expect } from 'vitest';
import {
  CALIBRATION_ACCLIMATION_MS,
  duracaoTotalDoPonto,
  janelaUtilDoPonto,
  medianaDeDistancias,
} from './calibration';
import { getCollectionMsForPoint } from './calibration';

// Tempo de cada ponto de calibração: a janela de acomodação (400 ms) é SOMADA
// ao tempo de coleta útil, não subtraída dele; e a distância de referência do
// ponto é a mediana de vários quadros aceitos, não um único quadro replicado.

describe('a acomodação é somada ao tempo do ponto', () => {
  it('a janela útil é exatamente o tempo de coleta pedido', () => {
    for (const coleta of [1680, 2000, 2800]) {
      expect(janelaUtilDoPonto(coleta)).toBe(coleta);
    }
  });

  it('a duração total é coleta + acomodação', () => {
    for (const coleta of [1680, 2000, 2800]) {
      expect(duracaoTotalDoPonto(coleta)).toBe(coleta + CALIBRATION_ACCLIMATION_MS);
    }
  });

  it('a janela útil não é coleta − acomodação', () => {
    // 1680 − 400 = 1280 seria ~24% menos amostras que o documentado.
    expect(janelaUtilDoPonto(1680)).not.toBe(1680 - CALIBRATION_ACCLIMATION_MS);
  });

  it('a acomodação é uma constante nomeada, não um literal solto', () => {
    expect(CALIBRATION_ACCLIMATION_MS).toBeGreaterThan(0);
    expect(CALIBRATION_ACCLIMATION_MS).toBeLessThan(1000);
  });

  it('o budget de sessão continua dentro do teto de fadiga', () => {
    // Acima de ~40 s a fadiga do usuário-alvo (ELA) piora as fixações finais
    // e anula o ganho. Somar a acomodação acrescenta 9 × 400 ms = 3,6 s; a
    // conta precisa continuar fechando.
    const pontos = [
      [0.1, 0.1], [0.5, 0.1], [0.9, 0.1],
      [0.1, 0.5], [0.5, 0.5], [0.9, 0.5],
      [0.1, 0.9], [0.5, 0.9], [0.9, 0.9],
    ] as const;
    const totalMs = pontos.reduce(
      (s, [x, y]) => s + duracaoTotalDoPonto(getCollectionMsForPoint(x, y)),
      0,
    );
    expect(totalMs / 1000).toBeLessThan(40);
  });
});

describe('a mediana de distância vem de vários quadros', () => {
  it('a mediana de uma lista é a mediana, não o último valor', () => {
    expect(medianaDeDistancias([50, 51, 52, 53, 54])).toBeCloseTo(52, 6);
  });

  it('um outlier no fim não domina o resultado', () => {
    // O último frame visto pode ser um rejeitado pelo gate, ou um 800 ms
    // posterior vindo do hard timeout; ele não decide sozinho.
    const comOutlier = medianaDeDistancias([50, 50, 51, 51, 200]);
    expect(comOutlier).toBeLessThan(60);
  });

  it('lista com número par de elementos interpola', () => {
    expect(medianaDeDistancias([50, 52])).toBeCloseTo(51, 6);
  });

  it('lista vazia devolve null — não há mediana de nada', () => {
    // Fabricar um número aqui contaminaria `calibrationRefDistance`, que
    // governa a compensação de distância.
    expect(medianaDeDistancias([])).toBeNull();
  });

  it('valores não-finitos são descartados', () => {
    expect(medianaDeDistancias([50, NaN, 52, Infinity, 51])).toBeCloseTo(51, 6);
  });

  it('só valores não-finitos devolve null', () => {
    expect(medianaDeDistancias([NaN, Infinity])).toBeNull();
  });

  it('um único quadro ainda devolve esse valor', () => {
    expect(medianaDeDistancias([57.3])).toBeCloseTo(57.3, 6);
  });
});
