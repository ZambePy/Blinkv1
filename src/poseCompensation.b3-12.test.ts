import { describe, it, expect } from 'vitest';
import { deslocamentoPorPose, DELTA_POSE_MAX_RAD } from './poseCompensation';

// -----------------------------------------------------------------------------
// B3.12 — `Math.tan(dyaw)` sem clamp.
//
//   dx: SINAL_YAW_X * distanciaPx * Math.tan(dyaw)
//
// `yaw` vem de `atan2(...)`, que salta de sinal quando a cabeça vira de perfil
// ou quando a matriz de transformação degenera. Nesses instantes `dyaw` se
// aproxima de ±π/2 e `tan` **explode**: `tan(π/2 − 0,001) ≈ 1000`, e com
// `distanciaPx = 2000` isso vira **2 milhões de pixels** de deslocamento.
//
// O `softClamp` do caller segura o valor FINAL, então o cursor não vai parar
// em outro planeta. Mas o pico já entrou no buffer temporal e no filtro One
// Euro antes do clamp — e o filtro leva vários frames para decair, produzindo
// um salto visível que dura bem mais que o frame ruim que o causou.
//
// `block.ts` já faz isso certo, com `CLAMP_RAD = π/4`. É a mesma classe de
// proteção, aplicada num módulo e esquecida no outro.
// -----------------------------------------------------------------------------

const DIST = 2000;

describe('B3.12 — Δpose extremo não explode o deslocamento', () => {
  it('Δyaw perto de π/2 não produz deslocamento astronômico', () => {
    // Sem clamp: tan(1.5698) ≈ 10000 → dx ≈ 20 milhões de px.
    const r = deslocamentoPorPose(
      { yaw: 1.5698, pitch: 0, roll: 0 },
      { yaw: 0, pitch: 0, roll: 0 },
      DIST,
    );
    expect(Math.abs(r.dx)).toBeLessThan(DIST * 2);
  });

  it('Δpitch perto de π/2 também é contido', () => {
    const r = deslocamentoPorPose(
      { yaw: 0, pitch: -1.5698, roll: 0 },
      { yaw: 0, pitch: 0, roll: 0 },
      DIST,
    );
    expect(Math.abs(r.dy)).toBeLessThan(DIST * 2);
  });

  it('Δ exatamente π/2 não devolve Infinity nem NaN', () => {
    const r = deslocamentoPorPose(
      { yaw: Math.PI / 2, pitch: Math.PI / 2, roll: 0 },
      { yaw: 0, pitch: 0, roll: 0 },
      DIST,
    );
    expect(Number.isFinite(r.dx)).toBe(true);
    expect(Number.isFinite(r.dy)).toBe(true);
  });

  it('salto de sinal do atan2 (yaw de +π para −π) não explode', () => {
    // O modo de falha concreto: `atan2` salta de +3,14 para −3,14 quando a
    // cabeça cruza o perfil. `dyaw` vira ~6,28 — muito além de qualquer
    // rotação física entre dois frames.
    const r = deslocamentoPorPose(
      { yaw: -Math.PI + 0.01, pitch: 0, roll: 0 },
      { yaw: Math.PI - 0.01, pitch: 0, roll: 0 },
      DIST,
    );
    expect(Number.isFinite(r.dx)).toBe(true);
    expect(Math.abs(r.dx)).toBeLessThan(DIST * 2);
  });
});

describe('B3.12 — fora da faixa plausível, a compensação ZERA', () => {
  it('Δ além do limite devolve zero, não o valor clampado', () => {
    // A escolha de projeto: um Δpose de 60° entre dois frames não é rotação da
    // cabeça, é matriz degenerada. Compensar por um valor que sabemos ser lixo
    // — mesmo clampado — seria fabricar correção. Zerar é o mesmo que dizer
    // "não sei compensar este frame", e o frame seguinte volta ao normal.
    const r = deslocamentoPorPose(
      { yaw: 1.2, pitch: 0, roll: 0 },   // ~69°, muito além de π/6
      { yaw: 0, pitch: 0, roll: 0 },
      DIST,
    );
    expect(r.dx).toBe(0);
  });

  it('os eixos são zerados INDEPENDENTEMENTE', () => {
    // Um yaw absurdo não pode descartar um pitch perfeitamente plausível.
    const r = deslocamentoPorPose(
      { yaw: 1.2, pitch: 0.1, roll: 0 },
      { yaw: 0, pitch: 0, roll: 0 },
      DIST,
    );
    expect(r.dx).toBe(0);
    expect(Math.abs(r.dy)).toBeGreaterThan(0);
  });

  it('o limite declarado é da ordem de π/6', () => {
    // π/6 = 30°. Uma cabeça que girou 30° em relação à calibração já está
    // muito além do que a compensação geométrica modela bem.
    expect(DELTA_POSE_MAX_RAD).toBeGreaterThan(Math.PI / 8);
    expect(DELTA_POSE_MAX_RAD).toBeLessThanOrEqual(Math.PI / 4);
  });
});

describe('B3.12 — a faixa normal de operação não muda', () => {
  it('Δ pequeno produz o mesmo valor de antes', () => {
    // Regressão: o clamp não pode alterar o caminho saudável. Δ = 0,1 rad
    // (~5,7°) é o regime típico de deriva postural numa sessão.
    const r = deslocamentoPorPose(
      { yaw: 0.1, pitch: -0.05, roll: 0 },
      { yaw: 0, pitch: 0, roll: 0 },
      DIST,
    );
    expect(r.dx).toBeCloseTo(-DIST * Math.tan(0.1), 9);
    expect(r.dy).toBeCloseTo(-DIST * Math.tan(0.05), 9);
  });

  it('Δ zero continua devolvendo zero sem -0', () => {
    const r = deslocamentoPorPose(
      { yaw: 0.3, pitch: 0.3, roll: 0 },
      { yaw: 0.3, pitch: 0.3, roll: 0 },
      DIST,
    );
    expect(Object.is(r.dx, 0)).toBe(true);
    expect(Object.is(r.dy, 0)).toBe(true);
  });

  it('pose ausente continua devolvendo zero', () => {
    expect(deslocamentoPorPose(null, { yaw: 0, pitch: 0, roll: 0 }, DIST)).toEqual({ dx: 0, dy: 0 });
    expect(deslocamentoPorPose({ yaw: 0, pitch: 0, roll: 0 }, null, DIST)).toEqual({ dx: 0, dy: 0 });
  });

  it('NaN na pose continua devolvendo zero', () => {
    const r = deslocamentoPorPose(
      { yaw: NaN, pitch: 0, roll: 0 },
      { yaw: 0, pitch: 0, roll: 0 },
      DIST,
    );
    expect(r).toEqual({ dx: 0, dy: 0 });
  });
});
