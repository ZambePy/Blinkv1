import { describe, it, expect } from 'vitest';
import { countDeadFeatures } from './calibration';

// A1-2 — countDeadFeatures conta dimensões cuja variância ENTRE as médias
// dos alvos é ~0 (dimensões que não carregam sinal de "onde o usuário olha").

describe('A1-2: countDeadFeatures', () => {
  it('feature perfeitamente correlacionada com o alvo NÃO é morta', () => {
    // 3 alvos, 2 amostras por alvo. dim 0 = screenX puro (varia entre alvos).
    const targets = [
      { screenX: 0.1, screenY: 0.5 }, { screenX: 0.1, screenY: 0.5 },
      { screenX: 0.5, screenY: 0.5 }, { screenX: 0.5, screenY: 0.5 },
      { screenX: 0.9, screenY: 0.5 }, { screenX: 0.9, screenY: 0.5 },
    ];
    const features = [
      [0.1], [0.1],
      [0.5], [0.5],
      [0.9], [0.9],
    ];
    const { deadCount, totalDims, deadIndices } = countDeadFeatures(features, targets);
    expect(totalDims).toBe(1);
    expect(deadCount).toBe(0);
    expect(deadIndices).toEqual([]);
  });

  it('feature constante entre alvos É morta (não distingue alvos)', () => {
    const targets = [
      { screenX: 0.1, screenY: 0.5 }, { screenX: 0.5, screenY: 0.5 }, { screenX: 0.9, screenY: 0.5 },
    ];
    // dim 0 varia entre alvos (não morta), dim 1 é sempre a mesma média por alvo (morta)
    const features = [
      [0.1, 42.0],
      [0.5, 42.0],
      [0.9, 42.0],
    ];
    const { deadCount, deadIndices } = countDeadFeatures(features, targets);
    expect(deadCount).toBe(1);
    expect(deadIndices).toEqual([1]);
  });

  it('ruído intra-alvo alto mas média igual entre alvos ainda é morta', () => {
    // Cada alvo tem 3 amostras muito ruidosas na dim 1, mas a MÉDIA por alvo
    // é sempre ~10. Isso é o cenário-tipo: uma dimensão que vibra muito
    // dentro do ponto (variância intra alta) mas não distingue alvos.
    const targets = [
      { screenX: 0.1, screenY: 0.5 }, { screenX: 0.1, screenY: 0.5 }, { screenX: 0.1, screenY: 0.5 },
      { screenX: 0.5, screenY: 0.5 }, { screenX: 0.5, screenY: 0.5 }, { screenX: 0.5, screenY: 0.5 },
      { screenX: 0.9, screenY: 0.5 }, { screenX: 0.9, screenY: 0.5 }, { screenX: 0.9, screenY: 0.5 },
    ];
    const features = [
      [0.1, 5], [0.1, 15], [0.1, 10],  // média dim1 = 10
      [0.5, 8], [0.5, 12], [0.5, 10],  // média dim1 = 10
      [0.9, 20], [0.9, 0], [0.9, 10],  // média dim1 = 10
    ];
    const { deadCount, deadIndices } = countDeadFeatures(features, targets);
    expect(deadCount).toBe(1);
    expect(deadIndices).toEqual([1]);
  });

  it('menos de 2 alvos únicos: não é possível medir variância entre-alvos', () => {
    const targets = [
      { screenX: 0.5, screenY: 0.5 }, { screenX: 0.5, screenY: 0.5 },
    ];
    const features = [[1, 2, 3], [1, 2, 3]];
    const { deadCount, totalDims } = countDeadFeatures(features, targets);
    expect(deadCount).toBe(0);
    expect(totalDims).toBe(3);
  });

  it('features vazias devolvem contadores zerados', () => {
    const { deadCount, totalDims, deadIndices } = countDeadFeatures([], []);
    expect(deadCount).toBe(0);
    expect(totalDims).toBe(0);
    expect(deadIndices).toEqual([]);
  });

  it('eps configurável distingue "quase-morto" de "morto"', () => {
    // Média por alvo varia por ~1e-4 → morta com eps=1e-6, viva com eps=1e-9
    const targets = [
      { screenX: 0.1, screenY: 0.5 }, { screenX: 0.5, screenY: 0.5 }, { screenX: 0.9, screenY: 0.5 },
    ];
    const features = [
      [1.0000],
      [1.0001],
      [1.0002],
    ];
    const strict = countDeadFeatures(features, targets, 1e-12);
    const loose = countDeadFeatures(features, targets, 1e-6);
    expect(strict.deadCount).toBe(0);
    expect(loose.deadCount).toBe(1);
  });

  it('cenário 9 pontos × 30 dims: apenas ~80% mortas dispara o portão de 30%', () => {
    // Simula 9 alvos com 5 amostras cada, 30 dims. Dims 0-5 correlacionam com
    // gx/gy (vivas); dims 6-29 são constantes (mortas). Espera 24/30 = 80%.
    const grid = [
      [0.1, 0.1], [0.5, 0.1], [0.9, 0.1],
      [0.1, 0.5], [0.5, 0.5], [0.9, 0.5],
      [0.1, 0.9], [0.5, 0.9], [0.9, 0.9],
    ];
    const targets: { screenX: number; screenY: number }[] = [];
    const features: number[][] = [];
    for (const [gx, gy] of grid) {
      for (let s = 0; s < 5; s++) {
        targets.push({ screenX: gx, screenY: gy });
        const row: number[] = [gx, gy, gx * gy, gx + gy, gx - gy, gx * 2];
        for (let d = 6; d < 30; d++) row.push(0.42); // constante entre alvos
        features.push(row);
      }
    }
    const { deadCount, totalDims } = countDeadFeatures(features, targets);
    expect(totalDims).toBe(30);
    expect(deadCount).toBe(24);
    expect(deadCount / totalDims).toBeGreaterThan(0.30);
  });
});
