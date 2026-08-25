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
  /**
   * A2-5 — correção de anisotropia de aspect ratio.
   * O MediaPipe normaliza x pela largura e y pela altura. Em 1920×1080 as
   * escalas diferem por 1.78×. Distâncias euclidianas misturando as duas
   * ficam distorcidas — `interEyeDistRaw` e o vetor inteiro ficam enviesados
   * quando a cabeça inclina, porque o vetor inter-ocular gira nesse espaço
   * anisotropico e muda de comprimento mesmo com distância física constante.
   *
   * Correção: multiplicar x (e z) por videoWidth/videoHeight antes de
   * qualquer cálculo de distância. Isso invalida perfis antigos (RECORDING_FORMAT_VERSION).
   * DEFAULT false — ligar só após medição confirmar melhora do 1°/111px.
   */
  isotropicLandmarks: boolean;
  /**
   * A2-6 — travar exposição da câmera após aquecimento de 2s.
   * Solicita `exposureMode/focusMode/whiteBalanceMode = 'manual'` via
   * ImageCapture API quando o driver suportar. Reduz variação de brilho
   * do crop (entrada direta do L2CS) e estabiliza o reflexo especular em
   * óculos ao longo de sessocões longas.
   * DEFAULT false — nem toda webcam exposes essas capabilities.
   */
  lockCameraExposure: boolean;
  /**
   * D5.2 (ROADMAP §5) — correção geométrica de distância câmera-rosto.
   *
   * `cameraDistanceEstimate` já é calculada em `extractor.ts` mas só alimenta
   * o bloco L2CS. Esta flag, quando LIGADA, escala as dims de offset de íris
   * do vetor de features por `(currentDistance / calibrationRefDistance)`
   * ANTES do StandardScaler.transformSingle — reduzindo a discrepância
   * quando o usuário se afasta/aproxima da câmera após calibrar.
   *
   * DEFAULT false. O ROADMAP prevê medição em cenário de movimento
   * controlado antes de ligar por default (regra 4). Quando desligada, a
   * função pura `applyDistanceCorrectionToFeatures` continua exportada e
   * testável, mas mapGaze passa direto sem tocar no vetor.
   */
  applyDistanceCorrection: boolean;
}

const DEFAULTS: ExperimentConfig = {
  expandFactor: 1.4,
  l2csCadenceMs: 100,
  applyGazeCorrection: false,
  enableDistanceLog: false,
  dwellGraceMs: 0,
  dwellSnapPx: 0,
  isotropicLandmarks: false,  // A2-5 — desligado até medição confirmar melhora
  lockCameraExposure: false,  // A2-6 — desligado por compatibilidade de hardware
  applyDistanceCorrection: false, // D5.2 — desligado até gravação com aproximação/afastamento comprovar ganho
};

const STORAGE_KEY = 'irisflow.experiment';

// D7.1 (ROADMAP §5) — override por env-var no ambiente Node.
//
// Motivação: `measure_baseline.mjs` precisa varrer a flag `isotropicLandmarks`
// entre variantes do replay para responder "isso melhora ou piora contra a
// mesma gravação?". Em browser, o override vem de localStorage (linha
// abaixo); em Node, localStorage não existe, então o sweep tem que ser
// resolvido antes deste módulo ser importado — logo, via env-var passada ao
// spawn do processo filho.
//
// Convenção: `IRISFLOW_EXP_<key>=<value>`. Booleans como "true"/"false" (ou
// "1"/"0"); números como decimais. Chaves desconhecidas são ignoradas em
// silêncio para não travar rodadas com typo em CLI.
//
// LIMITAÇÃO HONESTA (regra 3 do projeto): `lockCameraExposure` afeta APENAS
// a câmera ao vivo (`ImageCapture.applyConstraints`). O replay lê de JSONL
// gravado; sweepar essa flag em replay é NO-OP e o `measure_baseline` NÃO
// oferece essa variante. A decisão de ligar/desligar `lockCameraExposure`
// só pode vir de medição AO VIVO — pendência humana registrada no ROADMAP.
function loadEnvOverrides(): Partial<ExperimentConfig> {
  if (typeof process === 'undefined' || !process.env) return {};
  const overrides: Partial<ExperimentConfig> = {};
  const prefix = 'IRISFLOW_EXP_';
  for (const [envKey, rawValue] of Object.entries(process.env)) {
    if (!envKey.startsWith(prefix) || rawValue === undefined) continue;
    const key = envKey.slice(prefix.length) as keyof ExperimentConfig;
    if (!(key in DEFAULTS)) continue; // chave inválida — ignora sem quebrar
    const defaultValue = DEFAULTS[key];
    if (typeof defaultValue === 'boolean') {
      const lower = rawValue.toLowerCase();
      (overrides as Record<string, unknown>)[key] = lower === 'true' || lower === '1';
    } else if (typeof defaultValue === 'number') {
      const n = Number(rawValue);
      if (!Number.isNaN(n)) (overrides as Record<string, unknown>)[key] = n;
    }
  }
  return overrides;
}

function load(): ExperimentConfig {
  const envOverrides = loadEnvOverrides();
  if (typeof localStorage === 'undefined') return { ...DEFAULTS, ...envOverrides };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS, ...envOverrides };
    return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ExperimentConfig>), ...envOverrides };
  } catch {
    return { ...DEFAULTS, ...envOverrides };
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
