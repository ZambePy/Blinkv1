import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clearCalibration, startCalibrationMode, startCollectingPoint, feedRawData,
  setCurrentFrameGeometry, setCameraFovDeg, setCalibrationDistancesCm,
  getCalibrationDistancesCm, measuredCalibrationDistanceCm,
  measuredCalibrationDistanceSamples, completeCalibration,
} from './calibration';

// 2.1 — a distância de calibração vinha de UM quadro, lido na janela de preparo
// antes de qualquer alvo. Ela é a referência de toda a compensação de distância
// da sessão, então descrever o instante do clique em vez dos 15 s de coleta é
// uma escolha ruim mesmo quando o usuário fica parado.

const q = () => ({
  yaw: 0.1, pitch: -0.05, roll: 0.01,
  irisVisibilityPercentage: 1, detectorConfidence: 1,
  brightnessEstimate: 0.5, contrastEstimate: 0.3, blurEstimate: 0,
});
const v = (n = 8) => Array.from({ length: n }, (_, i) => Math.sin(i));

/** Coleta um ponto inteiro com um IOD fixo — IOD maior = rosto mais perto. */
function coletarPonto(x: number, y: number, iodPx: number, n = 40) {
  setCurrentFrameGeometry(iodPx, 1280, 720, { x: 0.5, y: 0.6 });
  startCollectingPoint(x, y, () => {});
  for (let i = 0; i < n; i++) {
    const f = Array.from({ length: 8 }, (_, d) => Math.sin(d * 1.7) * x + Math.cos(d * 2.3) * y);
    feedRawData(f, f.slice(), q());
  }
}

describe('distância de calibração medida sobre os quadros aceitos', () => {
  let relogio = 0;
  beforeEach(() => {
    clearCalibration();
    relogio = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (relogio += 80));
    setCameraFovDeg(90);
  });
  afterEach(() => { setCameraFovDeg(null); vi.restoreAllMocks(); });

  it('não há medição antes de qualquer ponto', () => {
    startCalibrationMode();
    expect(measuredCalibrationDistanceCm()).toBeNull();
    expect(measuredCalibrationDistanceSamples()).toBe(0);
  });

  it('acumula uma entrada por amostra aceita, não uma por ponto', () => {
    // Pontos com mais amostras têm que pesar mais: um alvo que reteve 60
    // quadros descreve a postura melhor que um que reteve 20.
    startCalibrationMode();
    coletarPonto(0.3, 0.3, 120);
    const apos1 = measuredCalibrationDistanceSamples();
    coletarPonto(0.7, 0.7, 120);
    expect(apos1).toBeGreaterThan(1);
    expect(measuredCalibrationDistanceSamples()).toBeGreaterThan(apos1);
  });

  it('é a MEDIANA — um ponto com o rosto ocluído não desloca a referência', () => {
    // IOD despencando simula oclusão parcial: o rosto parece longe demais.
    startCalibrationMode();
    coletarPonto(0.2, 0.2, 120);
    coletarPonto(0.5, 0.5, 120);
    coletarPonto(0.8, 0.8, 40);   // o intruso
    const mediana = measuredCalibrationDistanceCm()!;
    setCurrentFrameGeometry(120, 1280, 720, null);
    // A mediana tem que ficar junto dos dois pontos normais, longe do intruso.
    startCalibrationMode();
    coletarPonto(0.2, 0.2, 120);
    coletarPonto(0.5, 0.5, 120);
    expect(mediana).toBeCloseTo(measuredCalibrationDistanceCm()!, 5);
  });

  it('recomeçar a calibração zera a medição', () => {
    startCalibrationMode();
    coletarPonto(0.3, 0.3, 120);
    expect(measuredCalibrationDistanceSamples()).toBeGreaterThan(0);
    startCalibrationMode();
    expect(measuredCalibrationDistanceSamples()).toBe(0);
  });

  it('completeCalibration substitui o quadro único pela mediana medida', () => {
    startCalibrationMode();
    // O que a UI congela hoje: um valor qualquer, do instante do clique.
    setCalibrationDistancesCm(999, 60);
    for (const [x, y] of [[0.2, 0.2], [0.5, 0.5], [0.8, 0.8], [0.2, 0.8]]) {
      coletarPonto(x, y, 120);
    }
    completeCalibration();
    const { cameraCm } = getCalibrationDistancesCm();
    expect(cameraCm).not.toBe(999);
    expect(cameraCm).toBeCloseTo(measuredCalibrationDistanceCm()!, 5);
  });

  it('sem FOV calibrado não há medição, e o valor da UI é preservado', () => {
    // `getCurrentCameraDistanceCm` devolve null sem FOV. Nesse caso o valor
    // configurado pelo cuidador é o melhor disponível e não pode ser perdido.
    setCameraFovDeg(null);
    startCalibrationMode();
    setCalibrationDistancesCm(57, 60);
    for (const [x, y] of [[0.2, 0.2], [0.5, 0.5], [0.8, 0.8], [0.2, 0.8]]) {
      coletarPonto(x, y, 120);
    }
    completeCalibration();
    expect(measuredCalibrationDistanceCm()).toBeNull();
    expect(getCalibrationDistancesCm().cameraCm).toBe(57);
  });

  it('IOD maior mede distância menor — o sinal da relação', () => {
    startCalibrationMode();
    coletarPonto(0.3, 0.3, 200);
    const perto = measuredCalibrationDistanceCm()!;
    startCalibrationMode();
    coletarPonto(0.3, 0.3, 100);
    expect(measuredCalibrationDistanceCm()!).toBeGreaterThan(perto);
  });
});
