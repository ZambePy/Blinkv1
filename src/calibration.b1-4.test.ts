import { describe, it, expect } from 'vitest';
import { computeCalibrationTargets, eccentricityExtentFraction } from './calibration';
import { evaluateDistanceRange, screenDistanceNowCm } from './distanceCompensation';
import { resolveCalibrationDistances } from './calibrationDistances';

// -----------------------------------------------------------------------------
// B1.4 — Distância câmera→rosto usada como distância olho→tela.
//
//   const estimatedDistanceCm = calibration.getCurrentCameraDistanceCm?.() ?? null;
//   const distCm = estimatedDistanceCm ?? settings.viewingDistanceCm;
//   calibration.setCalibrationDistancesCm?.(estimatedDistanceCm, distCm);
//                                            └── câmera        └── mesma coisa!
//
// `getCurrentCameraDistanceCm()` é literalmente
// `estimateDistanceCm(iodPx, videoWidth, fov)` — distância até a CÂMERA. O
// cabeçalho de `distanceCompensation.ts` diz explicitamente que são grandezas
// diferentes, e que o setup RECOMENDADO PELO README é câmera perto / tela longe
// (`idealDistanceCm` com FOV 90° dá ~22,5 cm).
//
// Três efeitos, todos silenciosos, e só quando `cameraHorizontalFovDeg` está
// calibrado — o que torna o sintoma intermitente entre postos de uso:
//
//  (a) A grade de calibração ENCOLHE. `budgetCm = d·tan(16°)`. Com d=60 os
//      alvos ficam em 17%/83%; com d=25 a fração cai para 0,137, é clampada em
//      MIN_EXTENT_FRACTION=0,22, e os alvos vão para 28%/72%. O modelo treina
//      só nos 44% centrais e os pontos de validação em 25/75 viram
//      EXTRAPOLAÇÃO — a assinatura "erro dominado por ganho" do relatório.
//
//  (b) A compensação de distância fica com o DENOMINADOR errado. Câmera 25 /
//      tela 60, paciente 6 cm mais perto: ratio correto 0,90; aplicado 0,76.
//
//  (c) O erro angular do relatório mente por ~2,4×.
//
// Correção: `screenCm` volta a vir de `settings.viewingDistanceCm`. A distância
// de câmera serve apenas como VARIAÇÃO RELATIVA, que é o que
// `distanceCompensation.ts` prescreve.
// -----------------------------------------------------------------------------

/** Geometria da sessão de referência: 23,6" 16:9 em 1920×1080. */
const TELA = { screenWidthPx: 1920, screenHeightPx: 1080, screenDiagonalIn: 23.6 };

describe('B1.4 — a distância da TELA governa a grade de calibração', () => {
  it('a 60 cm da tela, os alvos ficam em ~17%/83% no eixo X', () => {
    // O número do critério de aceite. A 60 cm o orçamento de 16° cobre ±32,9%
    // a partir do centro → 17,1% e 82,9%.
    const alvos = computeCalibrationTargets({ ...TELA, viewingDistanceCm: 60 });
    const xs = [...new Set(alvos.map((a) => a.x))].sort((a, b) => a - b);
    expect(xs[0]).toBeCloseTo(0.171, 2);
    expect(xs[xs.length - 1]).toBeCloseTo(0.829, 2);
  });

  it('a 25 cm a grade COLAPSA para 28%/72% — o sintoma do bug', () => {
    // Reprodução direta de (a): quando a distância de câmera (25 cm num setup
    // câmera-perto) vaza para o lugar da distância de tela, a fração calculada
    // é 0,137, o piso de 0,22 a segura, e o modelo passa a treinar só nos 44%
    // centrais da tela.
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

describe('B1.4 — resolveCalibrationDistances separa as duas grandezas', () => {
  it('câmera 25 / tela configurada 60 ⇒ screenCm = 60, cameraCm = 25', () => {
    // O coração da correção. Antes, `screenCm` recebia os 25 cm da câmera.
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

  it('a distância de câmera NUNCA substitui a de tela, nem quando é a única medida', () => {
    // Este é o teste que falharia com o código antigo em qualquer configuração:
    // lá, `distCm = estimatedDistanceCm ?? settings.viewingDistanceCm` fazia a
    // medida de câmera ganhar sempre que existisse.
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

describe('B1.4 — o ratio de compensação usa o denominador certo', () => {
  it('câmera 25→19 com tela 60 dá ratio 0,90, não 0,76', () => {
    // Efeito (b) do bug, com os números do critério de aceite.
    // Correto:  screenNow = 60 + (19-25) = 54;  54/60 = 0,90.
    // Bugado:   screenAtCalibration valia 25 →  19/25 = 0,76.
    const r = evaluateDistanceRange(19, 25, 60);
    expect(r.ratio).toBeCloseTo(0.90, 3);
    expect(r.screenDistanceNowCm).toBeCloseTo(54, 5);
  });

  it('o ratio bugado (0,76) é o que sai quando screenCm recebe a câmera', () => {
    // Deixa explícito o tamanho do erro: num viewport de 1920, no alvo em
    // x=0,17 a diferença entre 0,90 e 0,76 vale ~90 px de deslocamento.
    const bugado = evaluateDistanceRange(19, 25, 25);
    expect(bugado.ratio).toBeCloseTo(0.76, 2);
    expect(Math.abs(bugado.ratio - 0.90)).toBeGreaterThan(0.10);
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
