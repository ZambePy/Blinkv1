import { describe, it, expect } from 'vitest';
import {
  screenDistanceNowCm,
  evaluateDistanceRange,
  applyDistanceRatioToPrediction,
  DELTA_OK_FAR_CM,
  DELTA_OK_NEAR_CM,
  MIN_RATIO,
  MAX_RATIO,
} from './distanceCompensation';

describe('screenDistanceNowCm — variação, não razão', () => {
  it('sem medição devolve null em vez de inventar', () => {
    expect(screenDistanceNowCm(null, 30, 60)).toBeNull();
    expect(screenDistanceNowCm(30, null, 60)).toBeNull();
    expect(screenDistanceNowCm(30, 30, null)).toBeNull();
  });

  it('mesma posição → mesma distância de tela', () => {
    expect(screenDistanceNowCm(30, 30, 60)).toBe(60);
  });

  it('aproximar 10 cm da câmera aproxima 10 cm da TELA', () => {
    // Aditivo. A câmera a 30 cm e a tela a 60 cm não têm a mesma distância,
    // mas quando a pessoa se move as DUAS mudam pelo mesmo tanto.
    expect(screenDistanceNowCm(20, 30, 60)).toBe(50);
  });

  it('NÃO usa a razão das distâncias de câmera', () => {
    // A razão daria 60 × (20/30) = 40 cm, que estaria errado sempre que a
    // câmera não estivesse junto da tela. O correto é 60 − 10 = 50.
    expect(screenDistanceNowCm(20, 30, 60)).not.toBe(40);
    expect(screenDistanceNowCm(20, 30, 60)).toBe(50);
  });

  it('rejeita distância de tela resultante negativa', () => {
    expect(screenDistanceNowCm(5, 60, 40)).toBeNull();
  });
});

describe('evaluateDistanceRange', () => {
  it('sem dados fica unknown e não compensa', () => {
    const r = evaluateDistanceRange(null, 30, 60);
    expect(r.status).toBe('unknown');
    expect(r.ratio).toBe(1);
    expect(r.message).toMatch(/campo de visão/);
  });

  it('mesma posição → ok, fator 1', () => {
    const r = evaluateDistanceRange(30, 30, 60);
    expect(r.status).toBe('ok');
    expect(r.ratio).toBeCloseTo(1, 10);
    expect(r.deltaCm).toBe(0);
    expect(r.message).toMatch(/mesma distância/);
  });

  it('dentro da faixa → ok e a mensagem diz que compensou', () => {
    const r = evaluateDistanceRange(35, 30, 60);   // +5 cm
    expect(r.status).toBe('ok');
    expect(r.deltaCm).toBe(5);
    expect(r.ratio).toBeCloseTo(65 / 60, 6);
    expect(r.message).toMatch(/compensado automaticamente/);
  });

  it('a faixa é ASSIMÉTRICA — aproximar aperta mais que afastar', () => {
    // Aproximar da tela exige mais excentricidade do olho, e é onde a
    // hipometria morde. A faixa reflete isso.
    expect(Math.abs(DELTA_OK_NEAR_CM)).toBeLessThan(DELTA_OK_FAR_CM);
    // −8 cm já sai do ok; +8 cm ainda está dentro.
    expect(evaluateDistanceRange(22, 30, 60).status).toBe('warn');
    expect(evaluateDistanceRange(38, 30, 60).status).toBe('ok');
  });

  it('fora da faixa → out, com instrução de recalibrar', () => {
    const r = evaluateDistanceRange(60, 30, 60);   // +30 cm
    expect(r.status).toBe('out');
    expect(r.message).toMatch(/fora da faixa/);
    expect(r.message).toMatch(/recalibra|refaça/i);
  });

  it('o fator é clampado mesmo com medição absurda', () => {
    const r = evaluateDistanceRange(300, 30, 60);
    expect(r.ratio).toBeLessThanOrEqual(MAX_RATIO);
    expect(r.ratio).toBeGreaterThanOrEqual(MIN_RATIO);
  });

  it('mais perto → fator menor que 1 (a tela cobre menos ângulo)', () => {
    expect(evaluateDistanceRange(25, 30, 60).ratio).toBeLessThan(1);
  });

  it('mais longe → fator maior que 1', () => {
    expect(evaluateDistanceRange(35, 30, 60).ratio).toBeGreaterThan(1);
  });
});

describe('applyDistanceRatioToPrediction', () => {
  const W = 1920, H = 1080;

  it('fator 1 é identidade', () => {
    expect(applyDistanceRatioToPrediction(480, 270, W, H, 1)).toEqual({ x: 480, y: 270 });
  });

  it('o CENTRO é ponto fixo — ângulo zero não depende de distância', () => {
    const r = applyDistanceRatioToPrediction(960, 540, W, H, 1.3);
    expect(r.x).toBeCloseTo(960, 10);
    expect(r.y).toBeCloseTo(540, 10);
  });

  it('afastar-se expande o alcance em torno do centro', () => {
    // A 1,25× de distância, o mesmo ângulo alcança 25% mais longe do centro.
    const r = applyDistanceRatioToPrediction(1440, 540, W, H, 1.25);
    expect(r.x).toBeCloseTo(960 + 480 * 1.25, 6);
  });

  it('aproximar-se comprime', () => {
    const r = applyDistanceRatioToPrediction(1440, 540, W, H, 0.8);
    expect(r.x).toBeCloseTo(960 + 480 * 0.8, 6);
  });

  it('escala em torno do centro, NÃO da origem', () => {
    // Escalar a partir do canto moveria o centro da tela, que é justamente o
    // ponto que não pode se mexer.
    const r = applyDistanceRatioToPrediction(0, 0, W, H, 2);
    expect(r.x).toBe(960 + (0 - 960) * 2);
    expect(r.x).not.toBe(0);
  });

  it('fator não-finito não corrompe a predição', () => {
    expect(applyDistanceRatioToPrediction(480, 270, W, H, NaN)).toEqual({ x: 480, y: 270 });
  });
});
