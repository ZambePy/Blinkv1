// Parâmetros de experimento ajustáveis SEM rebuild.
//
// Lidos de localStorage com fallback para o default de produção. Existem para
// permitir varredura A/B durante as sessões de medição (D2) sem recompilar.
// Em produção, nenhuma chave está setada → todos os defaults valem.
//
// Console:  __irisflowExp.set('expandFactor', 1.6)   → recarrega a página
//           __irisflowExp.reset()                     → volta aos defaults
//           __irisflowExp.dump()                      → estado atual (vai no relatório)

export interface ExperimentConfig {
  /** Fator de expansão da bbox facial antes do resize 448². Ver §E3. */
  expandFactor: number;
  /** Cadência de submissão ao worker L2CS, em ms. */
  l2csCadenceMs: number;
  /** Aplica o mapa RBF de correção derivado do teste de precisão.
   *  DEFAULT false — ver achado A2. Ligar só para comparação explícita. */
  applyGazeCorrection: boolean;
  /** Log de distância ao fecho convexo (caro: O(n·d) por frame). Ver A10. */
  enableDistanceLog: boolean;
  /** Janela de tolerância em que o dwell continua contando fora do alvo. Ver A8. */
  dwellGraceMs: number;
  /** Raio de snap magnético em px. 0 = desligado. */
  dwellSnapPx: number;
}

const DEFAULTS: ExperimentConfig = {
  expandFactor: 1.4,
  l2csCadenceMs: 100,
  applyGazeCorrection: false,
  enableDistanceLog: false,
  dwellGraceMs: 0,
  dwellSnapPx: 0,
};

const STORAGE_KEY = 'irisflow.experiment';

function load(): ExperimentConfig {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ExperimentConfig>) };
  } catch {
    return { ...DEFAULTS };
  }
}

// Snapshot único no boot — mudar no meio da sessão invalidaria a calibração
// já treinada (o vetor de features mudaria sob o modelo).
export const EXPERIMENT: ExperimentConfig = load();

export function experimentSnapshot(): ExperimentConfig {
  return { ...EXPERIMENT };
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__irisflowExp = {
    dump: () => ({ ...EXPERIMENT }),
    defaults: () => ({ ...DEFAULTS }),
    set(key: keyof ExperimentConfig, value: number | boolean) {
      const next = { ...load(), [key]: value };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      console.warn('[exp] gravado. RECARREGUE a página para aplicar.', next);
    },
    reset() {
      localStorage.removeItem(STORAGE_KEY);
      console.warn('[exp] limpo. RECARREGUE a página.');
    },
  };
}
