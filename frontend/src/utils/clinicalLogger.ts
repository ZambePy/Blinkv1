export interface SpokenSentence {
  id: string;
  text: string;
  timestamp: string; // ISO string
}

export interface CalibrationLog {
  id: string;
  errorDeg: number;
  timestamp: string; // ISO string
  /**
   * Veio do histórico GLOBAL, de antes da separação por paciente.
   *
   * A atribuição pode estar errada: se houve mais de um paciente nesta máquina
   * antes da separação, estas medições não são todas dele. A marca existe para
   * a tela poder dizer isso, em vez de apresentar tudo como sendo do perfil
   * ativo — num produto clínico, curva de dois pacientes misturada é pior que
   * curva nenhuma, porque parece um acompanhamento e não é.
   */
  herdado?: boolean;
}

export interface ClinicalData {
  sentences: SpokenSentence[];
  calibrations: CalibrationLog[];
}

/** Chave de antes da separação por paciente. Preservada — ver `migrar`. */
export const CHAVE_GLOBAL_LEGADA = 'irisflow_clinical_data';

export const chaveDoPerfil = (profileId: string) => `irisflow_clinical_data_${profileId}`;

/** Marca de que o global já foi migrado, para não duplicar num segundo perfil. */
const CHAVE_MIGRACAO = 'irisflow_clinical_migrado';

/**
 * Perfil ativo.
 *
 * Estado de módulo, como `setCameraFovDeg` faz na calibração: passar o perfil
 * em toda chamada obrigaria cada tela que registra uma frase a conhecer o
 * `AuthContext`, e são várias.
 */
let perfilAtivo: string | null = null;

export const definirPerfilAtivo = (profileId: string | null): void => {
  perfilAtivo = profileId;
};

const VAZIO = (): ClinicalData => ({ sentences: [], calibrations: [] });

/**
 * Leva o histórico global para o perfil ativo, uma vez só.
 *
 * A chave global NÃO é apagada: se a atribuição estiver errada, o dado original
 * precisa continuar existindo para ser reatribuído à mão.
 */
function migrarSePreciso(profileId: string): void {
  try {
    if (localStorage.getItem(CHAVE_MIGRACAO)) return;
    // Migrar para um segundo perfil duplicaria as medições e inflaria as duas
    // curvas — por isso a marca é global, e não por perfil.
    localStorage.setItem(CHAVE_MIGRACAO, profileId);

    const bruto = localStorage.getItem(CHAVE_GLOBAL_LEGADA);
    if (!bruto) return;

    const antigo = JSON.parse(bruto) as Partial<ClinicalData>;
    const destino = localStorage.getItem(chaveDoPerfil(profileId));
    const atual: ClinicalData = destino ? (JSON.parse(destino) as ClinicalData) : VAZIO();

    atual.calibrations = [
      ...(antigo.calibrations ?? []).map((c) => ({ ...c, herdado: true })),
      ...atual.calibrations,
    ];
    atual.sentences = [...(antigo.sentences ?? []), ...atual.sentences];

    localStorage.setItem(chaveDoPerfil(profileId), JSON.stringify(atual));
  } catch {
    // Histórico ilegível não pode derrubar a tela que o mostra.
  }
}
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
  // Sem perfil não há a quem atribuir. Devolver o global aqui misturaria
  // pacientes pela porta dos fundos.
  if (perfilAtivo === null) return VAZIO();

  migrarSePreciso(perfilAtivo);

  try {
    const saved = localStorage.getItem(chaveDoPerfil(perfilAtivo));
    if (!saved) return VAZIO();
    const d = JSON.parse(saved) as Partial<ClinicalData>;
    return { sentences: d.sentences ?? [], calibrations: d.calibrations ?? [] };
  } catch {
    return VAZIO();
  }
};

const saveClinicalData = (data: ClinicalData): void => {
  if (perfilAtivo === null) return;
  try {
    localStorage.setItem(chaveDoPerfil(perfilAtivo), JSON.stringify(data));
  } catch {
    /* quota estourada não pode derrubar a UI */
  }
};

export const clearClinicalData = (): void => {
  if (perfilAtivo === null) return;
  localStorage.removeItem(chaveDoPerfil(perfilAtivo));
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
