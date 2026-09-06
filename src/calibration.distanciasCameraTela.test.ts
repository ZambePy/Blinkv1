import { describe, it, expect } from 'vitest';
import { computeCalibrationTargets, eccentricityExtentFraction } from './calibration';
import { evaluateDistanceRange, screenDistanceNowCm } from './distanceCompensation';
import { resolveCalibrationDistances } from './calibrationDistances';

// Distância câmera→rosto e distância olho→tela são grandezas diferentes (setup
// recomendado: câmera perto, tela longe). A grade de calibração e o ratio de
// compensação usam a distância da TELA; a de câmera entra só como variação
// relativa. Confundi-las encolhe a grade (17/83 → 28/72) e erra o ratio.

/** Geometria da sessão de referência: 23,6" 16:9 em 1920×1080. */
const TELA = { screenWidthPx: 1920, screenHeightPx: 1080, screenDiagonalIn: 23.6 };

describe('a distância da tela governa a grade de calibração', () => {
  it('a 60 cm da tela, os alvos ficam em ~17%/83% no eixo X', () => {
    // A 60 cm o orçamento de 16° cobre ±32,9% a partir do centro → 17,1% e 82,9%.
    const alvos = computeCalibrationTargets({ ...TELA, viewingDistanceCm: 60 });
    const xs = [...new Set(alvos.map((a) => a.x))].sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(0.171, 2);
    expect(xs[xs.length - 1]).toBeCloseTo(0.829, 2);
  });

  it('a 25 cm a grade colapsa para 28%/72%', () => {
    // Se a distância de câmera (25 cm num setup câmera-perto) vazar para o
    // lugar da distância de tela, a fração calculada é 0,137, o piso de 0,22 a
    // segura, e o modelo passa a treinar só nos 44% centrais da tela.
    const alvos = computeCalibrationTargets({ ...TELA, viewingDistanceCm: 25 });
    const xs = [...new Set(alvos.map((a) => a.x))].sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(0.28, 2);
    expect(xs[xs.length - 1]).toBeCloseTo(0.72, 2);
  });

  it('a fração a 25 cm é clampada pelo piso, não calculada', () => {
    // Evidência de que o valor veio do clamp: sem o piso a fração seria 0,137.
    const diagPx = Math.hypot(1920, 1080);
    const pxPerCm = diagPx / (23.6 * 2.54);
    const fracao = eccentricityExtentFraction(1920, pxPerCm, 25, 16);
    expect(fracao).toBeCloseTo(0.22, 3); // piso MIN_EXTENT_FRACTION
  });
});

describe('resolveCalibrationDistances separa as duas grandezas', () => {
  it('câmera 25 / tela configurada 60 ⇒ screenCm = 60, cameraCm = 25', () => {
    const d = resolveCalibrationDistances({
      measuredCameraDistanceCm: 25,
      configuredViewingDistanceCm: 60,
    });
    expect(d.cameraCm).toBe(25);
    expect(d.screenCm).toBe(60);
  });

  it('sem medição de câmera, cameraCm é null e a tela mantém o configurado', () => {
    // `cameraHorizontalFovDeg` não calibrado: não há medida de câmera. A tela
    // continua vindo do que o cuidador configurou — nunca de um palpite.
    const d = resolveCalibrationDistances({
      measuredCameraDistanceCm: null,
      configuredViewingDistanceCm: 60,
    });
    expect(d.cameraCm).toBeNull();
    expect(d.screenCm).toBe(60);
  });

  it('a distância de câmera nunca substitui a de tela, nem quando é a única medida', () => {
    for (const camera of [15, 25, 40, 80]) {
      const d = resolveCalibrationDistances({
        measuredCameraDistanceCm: camera,
        configuredViewingDistanceCm: 60,
      });
      expect(d.screenCm).toBe(60);
    }
  });

  it('distância de tela não-positiva ou não-finita cai no default seguro', () => {
    // Configuração corrompida no localStorage não pode produzir uma grade
    // degenerada — `computeCalibrationTargets` com distância 0 devolveria o
    // teto de excentricidade e alvos em 5%/95%, fora do alcance do olho.
    for (const ruim of [0, -10, NaN, Infinity]) {
      const d = resolveCalibrationDistances({
        measuredCameraDistanceCm: 25,
        configuredViewingDistanceCm: ruim,
      });
      expect(d.screenCm).toBe(60); // DEFAULT_VIEWING_DISTANCE_CM
    }
  });
});

describe('o ratio de compensação usa o denominador certo', () => {
  it('câmera 25→19 com tela 60 dá ratio 0,90, não 0,76', () => {
    // screenNow = 60 + (19-25) = 54;  54/60 = 0,90.
    // Se screenAtCalibration valesse 25 (câmera): 19/25 = 0,76.
    const r = evaluateDistanceRange(19, 25, 60);
    expect(r.ratio).toBeCloseTo(0.90, 3);
    expect(r.screenDistanceNowCm).toBeCloseTo(54, 5);
  });

  it('o ratio errado (0,76) é o que sai quando screenCm recebe a câmera', () => {
    // Num viewport de 1920, no alvo em x=0,17 a diferença entre 0,90 e 0,76
    // vale ~90 px de deslocamento.
    const errado = evaluateDistanceRange(19, 25, 25);
    expect(errado.ratio).toBeCloseTo(0.76, 2);
    expect(Math.abs(errado.ratio - 0.90)).toBeGreaterThan(0.10);
  });

  it('sem variação de distância o ratio é exatamente 1', () => {
    const r = evaluateDistanceRange(25, 25, 60);
    expect(r.ratio).toBe(1);
    expect(r.status).toBe('ok');
  });

  it('screenDistanceNowCm é aditivo, não proporcional', () => {
    // O cabeçalho de distanceCompensation.ts é explícito sobre isso: o eixo
    // câmera→rosto e o eixo olho→tela não são a mesma reta, então a variação
    // se soma, não se multiplica.
    expect(screenDistanceNowCm(31, 25, 60)).toBeCloseTo(66, 5);
    expect(screenDistanceNowCm(19, 25, 60)).toBeCloseTo(54, 5);
  });
});
