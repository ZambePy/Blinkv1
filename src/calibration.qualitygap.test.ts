import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  clearCalibration, startCalibrationMode, startCollectingPoint, feedRawData,
  consumeLastSampleDecision,
} from './calibration';

// A ausência de medida de qualidade não pode passar como medida boa: comparar
// `undefined < 0.3` dá false, então o gate precisa de guarda de tipo explícita
// para `irisVisibilityPercentage` e `detectorConfidence` ausentes.

const base = { yaw: 0.1, pitch: -0.05, roll: 0.01 };
const v = () => [0.1, 0.2, 0.3, 0.4];

function decisaoCom(quality: Record<string, unknown>) {
  startCalibrationMode();
  startCollectingPoint(0.5, 0.5, () => {});
  for (let i = 0; i < 12; i++) {
    feedRawData(v(), v(), { ...base, ...quality });
    const d = consumeLastSampleDecision();
    if (d && d.reason !== 'acclimation') return d;
  }
  return consumeLastSampleDecision();
}

const COMPLETA = {
  irisVisibilityPercentage: 1, detectorConfidence: 0.99,
  brightnessEstimate: 0.24, contrastEstimate: 0.09, blurEstimate: 0,
};

describe('gate de qualidade — ausência vs. medida ruim', () => {
  let relogio = 0;
  beforeEach(() => {
    clearCalibration();
    relogio = 0;
    vi.spyOn(performance, 'now').mockImplementation(() => (relogio += 80));
  });
  afterEach(() => { vi.restoreAllMocks(); });

  it('qualidade completa e boa é aceita', () => {
    expect(decisaoCom(COMPLETA)?.accepted).toBe(true);
  });

  it('cada critério medido e ruim rejeita', () => {
    const ruins: [string, Record<string, unknown>][] = [
      ['íris quase oculta', { irisVisibilityPercentage: 0.2 }],
      ['landmarks instáveis', { detectorConfidence: 0.3 }],
      ['olho quase preto', { brightnessEstimate: 0.05 }],
      ['super-exposto', { brightnessEstimate: 0.95 }],
      ['sem estrutura', { contrastEstimate: 0.01 }],
      ['fora de foco', { blurEstimate: 0.9 }],
    ];
    for (const [nome, campo] of ruins) {
      const d = decisaoCom({ ...COMPLETA, ...campo });
      expect(d?.accepted, nome).toBe(false);
      expect(d?.reason, nome).toBe('quality');
    }
  });

  it('qualidade AUSENTE é aceita, mas avisa uma vez — não passa em silêncio', () => {
    const avisos: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((m: unknown) => { avisos.push(String(m)); });
    // Nada medido: é o que o analisador devolve quando o canvas não tem
    // contexto 2d. Aceitar é a escolha certa (rejeitar tudo deixaria o app
    // inutilizável para quem não tem como contornar), mas tem que ser visível.
    const d = decisaoCom({});
    expect(d?.accepted).toBe(true);
    const gate = avisos.filter((m) => m.includes('qualidade não medida'));
    expect(gate.length).toBe(1);
    expect(gate[0]).toContain('detectorConfidence');
    expect(gate[0]).toContain('brightnessEstimate');
  });

  it('o aviso sai UMA vez por sessão, não a 30 Hz', () => {
    const avisos: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((m: unknown) => { avisos.push(String(m)); });
    startCalibrationMode();
    startCollectingPoint(0.5, 0.5, () => {});
    for (let i = 0; i < 60; i++) feedRawData(v(), v(), { ...base });
    expect(avisos.filter((m) => m.includes('qualidade não medida')).length).toBe(1);
  });

  it('medida parcial usa o que existe e ignora o que falta', () => {
    // Brilho ausente, contraste presente e ruim → rejeita pelo contraste.
    const d = decisaoCom({ detectorConfidence: 0.99, contrastEstimate: 0.01 });
    expect(d?.reason).toBe('quality');
    // Brilho ausente, resto bom → aceita, sem inventar um brilho.
    expect(decisaoCom({ detectorConfidence: 0.99, contrastEstimate: 0.09 })?.accepted).toBe(true);
  });

  it('NaN conta como não medido, não como zero', () => {
    // `NaN < 0.3` é false, então um NaN passaria pelo gate como se fosse bom.
    const avisos: string[] = [];
    vi.spyOn(console, 'warn').mockImplementation((m: unknown) => { avisos.push(String(m)); });
    decisaoCom({ ...COMPLETA, contrastEstimate: NaN });
    expect(avisos.some((m) => m.includes('qualidade não medida') && m.includes('contrastEstimate'))).toBe(true);
  });
});
