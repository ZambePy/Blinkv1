import { describe, it, expect, beforeEach } from 'vitest';
import {
  hasConsent,
  setConsent,
  getClinicalData,
  clearClinicalData,
  logSentence,
  logCalibrationAccuracy,
  getMostUsedPhrases,
  getActivityByHour,
} from './clinicalLogger';

describe('clinicalLogger — Telemetria Clínica Local', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('deve iniciar sem consentimento e ignorar logs se não autorizado', () => {
    expect(hasConsent()).toBe(false);

    logSentence('Olá');
    logCalibrationAccuracy(0.85);

    const data = getClinicalData();
    expect(data.sentences.length).toBe(0);
    expect(data.calibrations.length).toBe(0);
  });

  it('deve registrar sentenças e calibrações após consentimento', () => {
    setConsent(true);
    expect(hasConsent()).toBe(true);

    logSentence('Olá, bom dia');
    logSentence('Preciso de água');
    logCalibrationAccuracy(1.12);

    const data = getClinicalData();
    expect(data.sentences.length).toBe(2);
    expect(data.calibrations.length).toBe(1);

    expect(data.sentences[0].text).toBe('Olá, bom dia');
    expect(data.calibrations[0].errorDeg).toBe(1.12);
  });

  it('deve calcular corretamente as frases mais frequentes', () => {
    setConsent(true);

    logSentence('Água');
    logSentence('Água');
    logSentence('Frio');
    logSentence('Água');
    logSentence('Frio');
    logSentence('Obrigado');

    const top = getMostUsedPhrases(3);
    expect(top.length).toBe(3);

    expect(top[0]).toEqual({ text: 'Água', count: 3 });
    expect(top[1]).toEqual({ text: 'Frio', count: 2 });
    expect(top[2]).toEqual({ text: 'Obrigado', count: 1 });
  });

  it('deve agrupar atividade por período horário', () => {
    setConsent(true);

    const data = getClinicalData();
    // Simula registros em diferentes horas
    const now = new Date();

    const t1 = new Date(now);
    t1.setHours(8, 30, 0); // Manhã (08h)
    
    const t2 = new Date(now);
    t2.setHours(15, 10, 0); // Tarde (15h)

    data.sentences.push({ id: 's1', text: 'Bom dia', timestamp: t1.toISOString() });
    data.sentences.push({ id: 's2', text: 'Boa tarde', timestamp: t2.toISOString() });
    localStorage.setItem('irisflow_clinical_data', JSON.stringify(data));

    const hours = getActivityByHour();
    expect(hours[8]).toBe(1);
    expect(hours[15]).toBe(1);
    expect(hours[12]).toBe(0); // Outros horários permanecem 0
  });

  it('deve limpar os logs imediatamente se o consentimento for revogado', () => {
    setConsent(true);
    logSentence('Dados confidenciais');
    expect(getClinicalData().sentences.length).toBe(1);

    // Revoga consentimento
    setConsent(false);
    expect(hasConsent()).toBe(false);
    expect(getClinicalData().sentences.length).toBe(0); // Logs excluídos efetivamente!
  });
});
