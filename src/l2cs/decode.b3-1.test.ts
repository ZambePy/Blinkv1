import { describe, it, expect } from 'vitest';
import { decodeAngleDeg, decodeAngleWithConfidence, decodeAngleCircularDeg } from './decode';
import { buildL2CSBlock, L2CS_CONFIDENCE_MIN } from './block';

// -----------------------------------------------------------------------------
// B3.1 — Expectativa LINEAR sobre bins CIRCULARES.
//
//   for (let i = 0; i < probs.length; i++) deg += probs[i] * (i*binWidth + binOffset);
//
// Os bins do Gaze360 cobrem −180°…+176°, que é um espaço CIRCULAR: o bin 0
// (−180°) e o bin 89 (+176°) são vizinhos, separados por 4°, não por 356°.
//
// Um crop degenerado (preto, congelado) produz distribuição difusa. Com massa
// nas duas pontas, a média linear dá `(−180 + 176)/2 = −2°` — um ângulo que
// passa em `isGazePlausible` como "olhando bem para o centro da tela". **Lixo
// vira feature plausível**, e nada a jusante consegue distinguir.
//
// O antídoto já está computado e descartado: `decodeAngleWithConfidence`
// devolve `1 − H/H_max`, e `types.ts` admite em comentário que ninguém usa.
// Uma distribuição difusa tem entropia alta ⇒ confiança baixa — exatamente o
// sinal que separa "olhando para o centro" de "não faço ideia".
//
// Correção: média CIRCULAR, e gate `confidence < τ → valid = false` em
// `buildL2CSBlock`.
// -----------------------------------------------------------------------------

const BIN_WIDTH = 4;
const BIN_OFFSET = -180;
const N_BINS = 90;

/** Logits com massa concentrada no bin `i`. */
function pico(i: number, n = N_BINS, forca = 30): number[] {
  const l = new Array<number>(n).fill(0);
  l[i] = forca;
  return l;
}

/** Logits com massa dividida entre dois bins. */
function doisPicos(a: number, b: number, n = N_BINS, forca = 30): number[] {
  const l = new Array<number>(n).fill(0);
  l[a] = forca;
  l[b] = forca;
  return l;
}

/** Ângulo do centro do bin `i`. */
const anguloDoBin = (i: number) => i * BIN_WIDTH + BIN_OFFSET;

describe('B3.1 — a média é circular, não linear', () => {
  it('um pico único devolve o ângulo daquele bin', () => {
    // Caso trivial: sem ambiguidade circular, as duas fórmulas coincidem.
    for (const i of [0, 22, 45, 67, 89]) {
      expect(decodeAngleCircularDeg(pico(i), BIN_WIDTH, BIN_OFFSET))
        .toBeCloseTo(anguloDoBin(i), 4);
    }
  });

  it('massa nas DUAS PONTAS do wrap devolve ~178°, não ~−2°', () => {
    // O coração do bug. Bin 0 = −180°, bin 89 = +176°. São VIZINHOS (4° de
    // distância), então o ponto médio circular é 178°/−178° — o oposto exato
    // do que a média linear produz.
    const logits = doisPicos(0, 89);

    const linear = decodeAngleDeg(logits, BIN_WIDTH, BIN_OFFSET);
    expect(linear).toBeCloseTo(-2, 0);          // o bug, reproduzido

    const circular = decodeAngleCircularDeg(logits, BIN_WIDTH, BIN_OFFSET);
    expect(Math.abs(circular)).toBeGreaterThan(170);
  });

  it('massa em dois bins vizinhos no meio da faixa cai entre eles', () => {
    // Regressão: a média circular não pode estragar o caso não-ambíguo.
    const circular = decodeAngleCircularDeg(doisPicos(44, 45), BIN_WIDTH, BIN_OFFSET);
    expect(circular).toBeCloseTo((anguloDoBin(44) + anguloDoBin(45)) / 2, 3);
  });

  it('o resultado fica sempre na faixa (−180, 180]', () => {
    for (let i = 0; i < N_BINS; i++) {
      const d = decodeAngleCircularDeg(pico(i), BIN_WIDTH, BIN_OFFSET);
      expect(d).toBeGreaterThan(-180.001);
      expect(d).toBeLessThanOrEqual(180.001);
    }
  });

  it('distribuição uniforme não produz um ângulo com aparência de medida', () => {
    // Uniforme = nenhuma direção preferida. Qualquer ângulo que sair daqui é
    // arbitrário — o que salva o pipeline é o GATE de confiança, testado
    // abaixo, não o valor do ângulo.
    const uniforme = new Array<number>(N_BINS).fill(0);
    const { confidence } = decodeAngleWithConfidence(uniforme, BIN_WIDTH, BIN_OFFSET);
    expect(confidence).toBeCloseTo(0, 6);
  });
});

describe('B3.1 — a confiança separa "centro" de "não sei"', () => {
  it('pico concentrado ⇒ confiança alta', () => {
    const { confidence } = decodeAngleWithConfidence(pico(45), BIN_WIDTH, BIN_OFFSET);
    expect(confidence).toBeGreaterThan(0.9);
  });

  it('distribuição difusa ⇒ confiança baixa', () => {
    // O crop preto: massa espalhada, nenhuma direção dominante.
    const difuso = Array.from({ length: N_BINS }, (_, i) => Math.sin(i * 0.05) * 0.3);
    const { confidence } = decodeAngleWithConfidence(difuso, BIN_WIDTH, BIN_OFFSET);
    expect(confidence).toBeLessThan(0.2);
  });

  it('o limiar do gate fica entre os dois regimes', () => {
    // Se o limiar caísse fora dessa faixa ele rejeitaria tudo ou nada.
    expect(L2CS_CONFIDENCE_MIN).toBeGreaterThan(0.05);
    expect(L2CS_CONFIDENCE_MIN).toBeLessThan(0.9);
  });
});

describe('B3.1 — buildL2CSBlock rejeita gaze de baixa confiança', () => {
  const DIST = 60;

  it('confiança abaixo do limiar ⇒ bloco ZERADO', () => {
    // A defesa mais barata do pipeline inteiro: um ângulo plausível vindo de
    // uma distribuição sem informação não pode alimentar `tan(yaw)`/`tan(pitch)`
    // como se fosse medida.
    const bloco = buildL2CSBlock(0.05, -0.02, true, DIST, L2CS_CONFIDENCE_MIN - 0.01);
    expect(bloco).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('confiança acima do limiar ⇒ bloco preenchido', () => {
    const bloco = buildL2CSBlock(0.15, -0.10, true, DIST, 0.85);
    expect(bloco.some((v) => v !== 0)).toBe(true);
  });

  it('confiança ausente mantém o comportamento anterior', () => {
    // Compatibilidade: gravações e chamadores antigos não passam confidence.
    // Rejeitar por ausência transformaria todo dado histórico em lixo.
    const bloco = buildL2CSBlock(0.15, -0.10, true, DIST);
    expect(bloco.some((v) => v !== 0)).toBe(true);
  });

  it('gaze inválido continua zerado, independente da confiança', () => {
    expect(buildL2CSBlock(0.15, -0.10, false, DIST, 0.99)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });

  it('o gate não salva ângulo implausível com confiança alta', () => {
    // As duas defesas são independentes: `isGazePlausible` pega o ângulo fora
    // da faixa fisiológica; o gate pega a distribuição sem informação. Um
    // modelo muito confiante sobre um ângulo impossível continua rejeitado.
    expect(buildL2CSBlock(-1.4315, 0, true, DIST, 0.99)).toEqual([0, 0, 0, 0, 0, 0, 0]);
  });
});
