import { describe, it, expect } from 'vitest';
import {
  BlinkDetector,
  extractCompactFeatures,
  EAR_THR_MIN,
  EAR_THR_MAX,
  EAR_CLOSED_ABSOLUTE,
} from './extractor';
import type { Point3D } from './extractor';

// Bootstrap do BlinkDetector na escala isotrópica do EAR. O limiar absoluto
// de olho fechado (0,18) vale só no BOOTSTRAP, antes de haver histórico; depois
// o limiar ADAPTATIVO aprende o repouso da pessoa — um corte fixo em 0,18
// deixaria quem tem ptose (repouso ~0,20) com margem de 0,02.

describe('as constantes na escala isotrópica', () => {
  it('0,18 é o limiar absoluto de olho fechado', () => {
    expect(EAR_CLOSED_ABSOLUTE).toBe(0.18);
  });

  it('a ordem thrMin < absoluto < thrMax faz sentido', () => {
    expect(EAR_THR_MIN).toBeLessThan(EAR_CLOSED_ABSOLUTE);
    expect(EAR_CLOSED_ABSOLUTE).toBeLessThan(EAR_THR_MAX);
  });

  it('o limiar adaptativo do repouso mediano cai dentro da faixa', () => {
    // Repouso isotrópico medido no repositório: 0,314. Com ratio 0,8 o alvo é
    // 0,251 — tem que caber entre thrMin e thrMax, senão o clamp trava a
    // adaptação e o `blinkRatio` deixa de ter efeito.
    const alvo = 0.314 * 0.8;
    expect(alvo).toBeGreaterThan(EAR_THR_MIN);
    expect(alvo).toBeLessThan(EAR_THR_MAX);
  });
});

describe('bootstrap — o detector não pode travar antes de aprender', () => {
  it('repouso abaixo de thrMax não trava o detector', () => {
    // Se o bootstrap usasse `thr = thrMax` (0,28), uma pessoa com repouso 0,25
    // teria todos os quadros marcados como piscada, o histórico (que só
    // acumula em quadros sem piscada) nunca encheria e o limiar ficaria em
    // 0,28 para sempre: o app rodaria e nunca rastrearia essa pessoa. Repouso
    // baixo (ptose) é comum em ELA, o público-alvo.
    const d = new BlinkDetector();
    const vereditos: boolean[] = [];
    for (let i = 0; i < 200; i++) vereditos.push(d.update(0.25, 1000 + i * 33));

    expect(vereditos.filter(Boolean).length).toBeLessThan(5);
    expect(d.nonBlinkCount).toBeGreaterThan(0);
    expect(d.restingEar).toBeCloseTo(0.25, 2);
  });

  it('o bootstrap usa o limiar absoluto, não o teto', () => {
    const d = new BlinkDetector();
    // Logo no primeiro quadro, antes de qualquer histórico:
    expect(d.update(0.20, 1000)).toBe(false);  // acima de 0,18 → aberto
    expect(d.update(0.10, 1033)).toBe(true);   // abaixo de 0,18 → fechado
  });

  it('ptose severa (repouso abaixo de 0,18) também não trava', () => {
    // Caso extremo: alguém cujo olho aberto fica abaixo do limiar absoluto.
    // Sem uma segunda guarda, o bootstrap por 0,18 repetiria o deadlock.
    // A resposta certa não é "essa pessoa está sempre piscando" — é concluir
    // que a premissa "0,18 = fechado" não vale para ela.
    const d = new BlinkDetector();
    for (let i = 0; i < 200; i++) d.update(0.14, 1000 + i * 33);
    expect(d.restingEar).not.toBeNull();
    expect(d.restingEar as number).toBeCloseTo(0.14, 2);
    // E depois de aprender, uma piscada de verdade continua sendo detectada.
    expect(d.update(0.03, 9000)).toBe(true);
  });

  it('olho de repouso normal segue detectando piscada normalmente', () => {
    const d = new BlinkDetector();
    for (let i = 0; i < 30; i++) d.update(0.31, 1000 + i * 33);
    expect(d.update(0.31, 2000)).toBe(false);
    expect(d.update(0.05, 2033)).toBe(true);
  });
});

describe('sequência aberto → fechando → fechado → abrindo', () => {
  it('a piscada é detectada no instante em que o olho cruza o limiar', () => {
    const d = new BlinkDetector();
    // 30 quadros de repouso em 0,32 → limiar adaptativo vira 0,32×0,8 = 0,256.
    for (let i = 0; i < 30; i++) d.update(0.32, 1000 + i * 33);

    const sequencia = [0.32, 0.30, 0.27, 0.24, 0.18, 0.08, 0.05, 0.09, 0.20, 0.28, 0.32];
    const vereditos = sequencia.map((ear, i) => d.update(ear, 5000 + i * 33));

    // Fecha quando cruza ~0,256: o quarto valor (0,24) é o primeiro abaixo.
    expect(vereditos.slice(0, 3)).toEqual([false, false, false]);
    expect(vereditos[3]).toBe(true);
    // Reabre quando volta a subir acima do limiar.
    expect(vereditos[vereditos.length - 1]).toBe(false);
  });

  it('conta UMA piscada por episódio, não uma por quadro', () => {
    const d = new BlinkDetector();
    for (let i = 0; i < 30; i++) d.update(0.32, 1000 + i * 33);
    for (let i = 0; i < 5; i++) d.update(0.05, 5000 + i * 33);
    for (let i = 0; i < 10; i++) d.update(0.32, 5200 + i * 33);
    expect(d.getBlinkRatePerMinute(60000, 5500)).toBeCloseTo(1, 6);
  });
});

// -----------------------------------------------------------------------------
// Invariância à resolução.
// -----------------------------------------------------------------------------

function rostoComOlho(alturaPx: number, larguraPx: number, W: number, H: number): Point3D[] {
  const p: Point3D[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5, z: 0 }));
  const meiaLargura = larguraPx / W / 2;
  const meiaAltura = alturaPx / H / 2;
  const olho = (cx: number, cy: number, e: number, d: number, c: number, b: number) => {
    p[e] = { x: cx - meiaLargura, y: cy, z: 0 };
    p[d] = { x: cx + meiaLargura, y: cy, z: 0 };
    p[c] = { x: cx, y: cy - meiaAltura, z: 0 };
    p[b] = { x: cx, y: cy + meiaAltura, z: 0 };
  };
  olho(0.40, 0.45, 33, 133, 159, 145);
  olho(0.60, 0.45, 362, 263, 386, 374);
  p[468] = { x: 0.40, y: 0.45, z: 0 };
  p[473] = { x: 0.60, y: 0.45, z: 0 };
  for (const i of [469, 470, 471, 472]) p[i] = { x: 0.40, y: 0.45, z: 0 };
  for (const i of [474, 475, 476, 477]) p[i] = { x: 0.60, y: 0.45, z: 0 };
  p[1] = { x: 0.5, y: 0.5, z: 0 };
  p[10] = { x: 0.5, y: 0.3, z: 0 };
  p[152] = { x: 0.5, y: 0.7, z: 0 };
  return p;
}

describe('invariância à resolução', () => {
  it('o MESMO olho físico dá o MESMO EAR em 1080p e em 720p', () => {
    // 12 px de altura e 34 px de largura são medidas FÍSICAS do sensor; em
    // resoluções diferentes elas ocupam frações normalizadas diferentes, e é
    // justamente isso que a correção de anisotropia desfaz.
    const r1080 = extractCompactFeatures(
      rostoComOlho(12, 34, 1920, 1080), undefined, null, new BlinkDetector(), 1920, 1080);
    const r720 = extractCompactFeatures(
      rostoComOlho(12 * (720 / 1080), 34 * (1280 / 1920), 1280, 720),
      undefined, null, new BlinkDetector(), 1280, 720);

    expect(r1080.leftEAR).toBeDefined();
    expect(r720.leftEAR).toBeDefined();
    expect(r720.leftEAR as number).toBeCloseTo(r1080.leftEAR as number, 6);
  });

  it('sem as dimensões do vídeo, o EAR volta cru em vez de chutar 16:9', () => {
    const comDims = extractCompactFeatures(
      rostoComOlho(12, 34, 1920, 1080), undefined, null, new BlinkDetector(), 1920, 1080);
    const semDims = extractCompactFeatures(
      rostoComOlho(12, 34, 1920, 1080), undefined, null, new BlinkDetector());
    // O cru é o isotrópico inflado por W/H = 1,78.
    expect((semDims.leftEAR as number) / (comDims.leftEAR as number)).toBeCloseTo(1920 / 1080, 3);
  });
});
