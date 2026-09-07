import { describe, it, expect } from 'vitest';
import {
  evaluateReadiness,
  estimateDistanceCm,
  idealDistanceCm,
  iodFractionParaDistancia,
  DISTANCIA_ALVO_CM,
  DISTANCIA_OK_MIN_CM,
  DISTANCIA_OK_MAX_CM,
  FOV_DE_REFERENCIA_DEG,
  TARGET_IOD_FRACTION,
  CANTHAL_DISTANCE_CM,
  type ReadinessSnapshot,
} from './setupReadiness';

// -----------------------------------------------------------------------------
// A checagem de distância bandeava em `iodFraction` — a fração da largura do
// frame ocupada pelo rosto. Convertendo aquela faixa para centímetros com o FOV
// padrão de 69,7° e a distância cantal de 9,0 cm:
//
//   iodFraction 0,32 (limite "perto demais")  →  20 cm
//   iodFraction 0,20 (o ALVO perseguido)      →  32 cm
//   iodFraction 0,13 (limite "longe demais")  →  50 cm
//
// A janela inteira de "ok" era 20–50 cm. Quem media a 50–70 cm — a faixa
// confortável de uso real — estava FORA dela o tempo todo, e a tela mandava
// aproximar. Não era ajuste fino: o alvo significava sentar a 32 cm da webcam.
//
// Ninguém tinha feito essa conta porque o número em centímetros nunca chegava à
// tela: nenhum chamador de produção passava o FOV para `evaluateReadiness`.
// -----------------------------------------------------------------------------

function snapA(distanciaCm: number, fovDeg = FOV_DE_REFERENCIA_DEG): ReadinessSnapshot {
  const videoWidth = 1920;
  const iod = iodFractionParaDistancia(distanciaCm, fovDeg) * videoWidth;
  return {
    hasFace: true,
    iod,
    videoWidth,
    videoHeight: 1080,
    faceCenter: { x: 0.5, y: 0.5 },
    pose: { yaw: 0.01, pitch: -0.02, roll: 0.005 },
    brightness: 0.45,
    contrast: 0.2,
    detectorConfidence: 0.99,
    specularRatio: 0,
  };
}

const distanciaEm = (cm: number, fov: number | null = FOV_DE_REFERENCIA_DEG) =>
  evaluateReadiness(snapA(cm), { horizontalFovDeg: fov }).checks.find((c) => c.id === 'distance')!;

describe('a faixa confortável é a medida em uso, não uma herdada de iodFraction', () => {
  it('50 a 70 cm', () => {
    expect(DISTANCIA_OK_MIN_CM).toBe(50);
    expect(DISTANCIA_OK_MAX_CM).toBe(70);
  });

  it('o alvo é o meio da faixa', () => {
    expect(DISTANCIA_ALVO_CM).toBe(60);
  });
});

describe('iodFractionParaDistancia — a conversão que faltava', () => {
  it('é a inversa de estimateDistanceCm', () => {
    const f = iodFractionParaDistancia(60, FOV_DE_REFERENCIA_DEG);
    const voltou = estimateDistanceCm(f * 1920, 1920, FOV_DE_REFERENCIA_DEG);
    expect(voltou).toBeCloseTo(60, 4);
  });

  it('mais longe produz rosto menor no frame', () => {
    expect(iodFractionParaDistancia(70, FOV_DE_REFERENCIA_DEG)).toBeLessThan(
      iodFractionParaDistancia(50, FOV_DE_REFERENCIA_DEG)
    );
  });
});

describe('o alvo do zoom automático é derivado da faixa, não escolhido à parte', () => {
  it('TARGET_IOD_FRACTION corresponde à distância-alvo', () => {
    // O `cameraTuner` persegue este número. Enquanto ele era um 0,20 escolhido
    // à parte, o zoom mirava 32 cm e a tela pedia 60 — a divergência que o
    // próprio comentário do módulo alertava.
    expect(TARGET_IOD_FRACTION).toBeCloseTo(
      iodFractionParaDistancia(DISTANCIA_ALVO_CM, FOV_DE_REFERENCIA_DEG),
      6
    );
  });

  it('o alvo antigo de 0,20 punha a pessoa a ~32 cm — bem fora da faixa', () => {
    const d = (CANTHAL_DISTANCE_CM / 0.2) / (2 * Math.tan((FOV_DE_REFERENCIA_DEG / 2) * (Math.PI / 180)));
    expect(d).toBeLessThan(DISTANCIA_OK_MIN_CM);
  });

  it('idealDistanceCm passa a apontar para dentro da faixa', () => {
    const ideal = idealDistanceCm(FOV_DE_REFERENCIA_DEG)!;
    expect(ideal).toBeGreaterThanOrEqual(DISTANCIA_OK_MIN_CM);
    expect(ideal).toBeLessThanOrEqual(DISTANCIA_OK_MAX_CM);
  });
});

describe('com FOV conhecido, a checagem banda em centímetros', () => {
  it('60 cm está ok', () => {
    expect(distanciaEm(60).status).toBe('ok');
  });

  it('50 cm — a borda de perto — está ok', () => {
    expect(distanciaEm(50).status).toBe('ok');
  });

  it('70 cm — a borda de longe — está ok', () => {
    expect(distanciaEm(70).status).toBe('ok');
  });

  it('45 cm avisa que está perto demais', () => {
    expect(distanciaEm(45).status).toBe('warn');
  });

  it('80 cm avisa que está longe demais', () => {
    expect(distanciaEm(80).status).toBe('warn');
  });

  it('25 cm reprova', () => {
    expect(distanciaEm(25).status).toBe('fail');
  });

  it('120 cm reprova', () => {
    expect(distanciaEm(120).status).toBe('fail');
  });

  it('a mensagem cita a distância medida em cm', () => {
    // O usuário precisa saber ONDE está, não só que está errado. A tela dizia
    // "aproxime-se" sem número nenhum.
    expect(distanciaEm(80).message).toMatch(/80\s*cm/);
  });

  it('a mensagem cita a faixa alvo', () => {
    expect(distanciaEm(80).message).toMatch(/50/);
    expect(distanciaEm(80).message).toMatch(/70/);
  });
});

describe('sem FOV, cai no critério antigo em vez de inventar centímetros', () => {
  it('não lança nem vira unknown', () => {
    const c = distanciaEm(60, null);
    expect(['ok', 'warn', 'fail']).toContain(c.status);
  });

  it('a mensagem não promete centímetros que ninguém mediu', () => {
    // Uma distância inventada alimentaria a conversão do erro para graus.
    expect(distanciaEm(60, null).message).not.toMatch(/~\d+\s*cm/);
  });
});
