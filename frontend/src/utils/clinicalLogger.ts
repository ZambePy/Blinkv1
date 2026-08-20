export interface SpokenSentence {
  id: string;
  text: string;
  timestamp: string; // ISO string
}

export interface CalibrationLog {
  id: string;
  errorDeg: number;
  timestamp: string; // ISO string
}

export interface ClinicalData {
  sentences: SpokenSentence[];
  calibrations: CalibrationLog[];
}

const STORAGE_KEY = 'irisflow_clinical_data';
const CONSENT_KEY = 'irisflow_consent_clinical_data';

export const hasConsent = (): boolean => {
  return localStorage.getItem(CONSENT_KEY) === 'true';
};

export const setConsent = (consented: boolean): void => {
  localStorage.setItem(CONSENT_KEY, consented ? 'true' : 'false');
  if (!consented) {
    clearClinicalData();
  }
};

export const getClinicalData = (): ClinicalData => {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) {
    return { sentences: [], calibrations: [] };
  }
  try {
    return JSON.parse(saved);
  } catch {
    return { sentences: [], calibrations: [] };
  }
};

const saveClinicalData = (data: ClinicalData): void => {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
};

export const clearClinicalData = (): void => {
  localStorage.removeItem(STORAGE_KEY);
};

export const logSentence = (text: string): void => {
  if (!hasConsent() || !text.trim()) return;

  const data = getClinicalData();
  data.sentences.push({
    id: crypto.randomUUID(),
    text: text.trim(),
    timestamp: new Date().toISOString(),
  });
  saveClinicalData(data);
};

export const logCalibrationAccuracy = (errorDeg: number): void => {
  if (!hasConsent()) return;

  const data = getClinicalData();
  data.calibrations.push({
    id: crypto.randomUUID(),
    errorDeg,
    timestamp: new Date().toISOString(),
  });
  saveClinicalData(data);
};

// Estatísticas Agregadas
export const getMostUsedPhrases = (limit = 5) => {
  const data = getClinicalData();
  const counts: Record<string, number> = {};
  data.sentences.forEach((s) => {
    const t = s.text.trim();
    if (!t) return;
    counts[t] = (counts[t] || 0) + 1;
  });

  return Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([text, count]) => ({ text, count }));
};

export const getActivityByHour = (): number[] => {
  const data = getClinicalData();
  const hours = Array(24).fill(0);
  data.sentences.forEach((s) => {
    try {
      const date = new Date(s.timestamp);
      const hr = date.getHours();
      if (hr >= 0 && hr < 24) {
        hours[hr]++;
      }
    } catch {
      // Ignora datas corrompidas
    }
  });
  return hours;
};
