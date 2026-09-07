import { describe, it, expect } from 'vitest';
import { TARGET_IOD_FRACTION as ALVO_DO_TUNER, DEFAULT_TARGET } from './cameraTuner';
import {
  TARGET_IOD_FRACTION as ALVO_DA_PRONTIDAO,
  DISTANCIA_ALVO_CM,
  DISTANCIA_OK_MIN_CM,
  DISTANCIA_OK_MAX_CM,
  FOV_DE_REFERENCIA_DEG,
  iodFractionParaDistancia,
  estimateDistanceCm,
} from './setupReadiness';

// -----------------------------------------------------------------------------
// Os dois módulos declaravam `TARGET_IOD_FRACTION = 0.20` cada um, com o
// comentário de `setupReadiness` avisando que "os dois precisam concordar,
// senão a tela pede uma coisa e o ajuste automático persegue outra".
//
// Concordavam no número e discordavam do usuário: 0,20 significa sentar a
// ~32 cm da webcam. A tela mandava aproximar e o zoom automático perseguia o
// mesmo alvo apertado, os dois empurrando para uma distância que ninguém usa.
//
// Agora existe um valor só, derivado da faixa em centímetros. Duas constantes
// iguais por coincidência voltam a divergir no primeiro ajuste; uma derivada da
// outra não tem como.
// -----------------------------------------------------------------------------

describe('há um alvo só', () => {
  it('o tuner e a prontidão usam exatamente o mesmo número', () => {
    expect(ALVO_DO_TUNER).toBe(ALVO_DA_PRONTIDAO);
  });

  it('o alvo padrão do tuner carrega esse número', () => {
    expect(DEFAULT_TARGET.iodFraction).toBe(ALVO_DA_PRONTIDAO);
  });
});

describe('o alvo corresponde a uma distância que alguém de fato usa', () => {
  it('perseguir o alvo põe a pessoa na distância-alvo', () => {
    const iod = ALVO_DO_TUNER * 1920;
    const d = estimateDistanceCm(iod, 1920, FOV_DE_REFERENCIA_DEG)!;
    expect(d).toBeCloseTo(DISTANCIA_ALVO_CM, 6);
  });

  it('essa distância está dentro da faixa confortável', () => {
    const iod = ALVO_DO_TUNER * 1920;
    const d = estimateDistanceCm(iod, 1920, FOV_DE_REFERENCIA_DEG)!;
    expect(d).toBeGreaterThanOrEqual(DISTANCIA_OK_MIN_CM);
    expect(d).toBeLessThanOrEqual(DISTANCIA_OK_MAX_CM);
  });

  it('o alvo antigo de 0,20 ficava fora da faixa — a divergência que ninguém viu', () => {
    const d = estimateDistanceCm(0.2 * 1920, 1920, FOV_DE_REFERENCIA_DEG)!;
    expect(d).toBeLessThan(DISTANCIA_OK_MIN_CM);
  });

  it('o alvo é a derivação da distância-alvo, não um número escolhido', () => {
    expect(ALVO_DO_TUNER).toBeCloseTo(
      iodFractionParaDistancia(DISTANCIA_ALVO_CM, FOV_DE_REFERENCIA_DEG),
      10
    );
  });
});
