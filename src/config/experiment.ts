// Parâmetros de experimento ajustáveis SEM rebuild.
//
// Lidos de localStorage com fallback para o default de produção. Existem para
// permitir varredura A/B durante as sessões de medição sem recompilar.
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
   *  DEFAULT false — ligar só para comparação explícita. */
  applyGazeCorrection: boolean;
  /** Log de distância ao fecho convexo (caro: O(n·d) por frame). */
  enableDistanceLog: boolean;
  /**
   * Correção de anisotropia de aspect ratio.
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
   * Travar exposição da câmera após aquecimento de 2s.
   * Solicita `exposureMode/focusMode/whiteBalanceMode = 'manual'` via
   * ImageCapture API quando o driver suportar. Reduz variação de brilho
   * do crop (entrada direta do L2CS) e estabiliza o reflexo especular em
   * óculos ao longo de sessocões longas.
   * DEFAULT false — nem toda webcam exposes essas capabilities.
   */
  lockCameraExposure: boolean;
  /**
   * Compensação geométrica de pose na saída (`src/poseCompensation.ts`).
   *
   * Desloca a predição por `d · tan(Δ)` contra a pose média da calibração. Não
   * há coeficiente ajustado: o ganho vem da geometria, então não há o que
   * memorizar — dar a pose ao Ridge como feature falhava por memorização.
   *
   * DEFAULT true — sem pose comp o erro explode quando a pose de teste
   * diverge da calibração; drift monotônico de pitch durante calibração
   * (visto em gravações reais) contamina os dados de treino.
   */
  geometricPoseCompensation: boolean;
  /**
   * Compensação de TRANSLAÇÃO lateral da cabeça
   * (`src/translationCompensation.ts`).
   *
   * Independente da compensação geométrica: aquela corrige a cabeça girando,
   * esta a cabeça deslizando. A correção é 1:1 em centímetros e não depende
   * do FOV — ele cancela na álgebra, ver o módulo.
   *
   * DEFAULT false. Não por medir pior, mas por não haver o que medir: na
   * gravação de referência o rosto translada 0,25 cm durante o teste inteiro,
   * ou ~9 px de tela contra 144,6 px de erro.
   */
  lateralTranslationCompensation: boolean;
  /**
   * Liga o caminho do L2CS-Net (worker ONNX + crop 448²).
   *
   * O crop tinha um bug (`sourceDimensions`, corrigido) que fazia a inferência
   * rodar sobre imagem preta. Ligar esta flag com `--feature-set` incluindo o
   * bloco angular é como o L2CS ganha caminho até o modelo.
   */
  enableL2CS: boolean;
  /**
   * Expansão polinomial de grau 2 nas features antes do StandardScaler.
   *
   * 77% do erro em baseline é não-linear (affine.explainedFraction=0.226).
   * Ridge linear satura. Grau 2 sobre 8 dims → 44 features, ainda seguro contra
   * overfitting com ~270 amostras + CV LOO do Ridge escolhendo λ.
   *
   * DEFAULT true — mudança do comportamento linear puro para curvatura.
   */
  polynomialFeatures: boolean;
  /**
   * Treino da calibração via Web Worker.
   *
   * Elimina o freeze de UI de 1-3s durante `completeCalibration()`. Predict
   * continua main-thread e síncrono. Se `false`, treino é síncrono (antigo).
   *
   * DEFAULT true.
   */
  calibrationWorker: boolean;
}

const DEFAULTS: ExperimentConfig = {
  expandFactor: 1.4,
  l2csCadenceMs: 100,
  applyGazeCorrection: false,
  enableDistanceLog: false,
  isotropicLandmarks: false,  // desligado até medição confirmar melhora
  lockCameraExposure: false,  // desligado por compatibilidade de hardware
  geometricPoseCompensation: true, // habilitado por default; SEM pose comp o erro explode (361px vs 150px) quando pose de teste diverge da calibração. Y offset +165 tem outra causa.
  lateralTranslationCompensation: false, // desligado: efeito abaixo do ruído na base atual
  // LIGADO em conjunto com `ACTIVE_FEATURE_SET = 'irisCore+l2cs'`. Antes deste
  // par a flag ficava true sozinha e o bloco angular era projetado para fora do
  // vetor — 91 MB de ONNX, `getImageData` de 448² e um worker por quadro sem
  // efeito no modelo. Agora as duas dims mais informativas do L2CS (tan yaw,
  // tan pitch) entram como features [4] e [5] do vetor de 6 dims. Os bugs
  // históricos (crop preto de `sourceDimensions`, yaw travado) já foram
  // corrigidos e há `L2CSHealthMonitor` vigiando saída constante.
  enableL2CS: true,
  polynomialFeatures: true,
  calibrationWorker: true,
};

const STORAGE_KEY = 'irisflow.experiment';

// Override por env-var no ambiente Node.
//
// Convenção: `IRISFLOW_EXP_<key>=<value>`. Booleans como "true"/"false" (ou
// "1"/"0"); números como decimais. Chaves desconhecidas são ignoradas em
// silêncio para não travar rodadas com typo em CLI.
//
// Ambiente do consumidor: Node passa `process.env`; browser passa `{}`
// (localStorage é a via de override lá). Tipagem explícita sem depender de
// @types/node — o frontend tsconfig NÃO inclui esse pacote, então referenciar
// `NodeJS.ProcessEnv` aqui quebra `npm run build` do frontend.
type EnvLike = Record<string, string | undefined>;

// Guard defensivo: em Node há `process`; em browser não. Fazemos cast via
// `globalThis` para escapar da falta de @types/node no ambiente do frontend.
function getProcessEnvOrEmpty(): EnvLike {
  const proc = (globalThis as { process?: { env?: EnvLike } }).process;
  return proc?.env ?? {};
}

// Exportado para permitir teste unitário sem `vi.resetModules()` (o snapshot
// `EXPERIMENT` é resolvido em module-load, então testar variação de env exige
// reimport do módulo; testar essa função pura tem o mesmo alcance sem o custo
// de pool que o resetModules impõe sobre outros testes concorrentes).
export function loadEnvOverrides(env: EnvLike = getProcessEnvOrEmpty()): Partial<ExperimentConfig> {
  if (!env) return {};
  const overrides: Partial<ExperimentConfig> = {};
  const prefix = 'IRISFLOW_EXP_';
  for (const [envKey, rawValue] of Object.entries(env)) {
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
