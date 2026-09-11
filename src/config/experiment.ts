// Configuração do pipeline ajustável sem rebuild.
//
// Lida do localStorage (ou de variáveis de ambiente no Node) com fallback para
// o default de produção. Serve para as sessões de medição trocarem uma
// condição por vez sem recompilar. Em produção nenhuma chave está setada.
//
// Console:  __irisflowExp.set('filterMode', 'kalman')  → recarregue a página
//           __irisflowExp.reset()                       → volta aos defaults
//           __irisflowExp.dump()                        → estado atual (vai no relatório)
//
// A configuração é lida UMA vez, no boot. Trocar no meio da sessão mudaria o
// vetor de features ou o filtro sob um modelo já treinado.

export interface ExperimentConfig {
  /** Fator de expansão da bbox facial antes do recorte quadrado do L2CS. */
  expandFactor: number;
  /** Cadência mínima entre submissões ao worker L2CS, em ms. */
  l2csCadenceMs: number;
  /** Lado do recorte entregue ao L2CS (o ONNX aceita 224 e 448). */
  l2csInputSize: 224 | 448;
  /**
   * Onde o L2CS roda.
   *  - `auto`   tenta WebGPU e cai para WASM se a GPU não estiver disponível.
   *             O provider efetivo fica em `EngineDiagnostics.l2cs.executionProvider`
   *             e no relatório de precisão.
   *  - `webgpu` / `wasm`  forçam um provider (para medição). Sem fallback.
   *  - `off`    não inicia o worker; o modelo usa só as 4 features de íris.
   */
  l2cs: 'auto' | 'webgpu' | 'wasm' | 'off';
  /** Expansão polinomial de grau 2 das features antes do StandardScaler. */
  polynomialFeatures: boolean;
  /** Compensação geométrica de pose (d·tan Δ) na saída e nos alvos de treino. */
  geometricPoseCompensation: boolean;
  /** Compensação de translação lateral da cabeça. */
  lateralTranslationCompensation: boolean;
  /**
   * Correção contínua aprendida com os dwells concluídos (sprint S3).
   *
   * Ligada por padrão porque é o que segura a deriva no uso real. A flag existe
   * para a medição: comparar uma rodada com e outra sem, sob o MESMO modelo, é
   * o único jeito de saber quanto ela vale — e o protocolo de precisão, que
   * calibra e mede em seguida, não a exercita.
   */
  correcaoPorDwell: boolean;
  /** Filtro temporal. `oneEuro` é o de produção; os outros existem para o benchmark. */
  filterMode: 'oneEuro' | 'kalman' | 'kalmanEma';
  /**
   * Estabilizador por estado do olho (sprint S5): durante a fixação a saída
   * vira a média da janela de 200 ms; na sacada, volta a ser a amostra
   * filtrada.
   *
   * Ligado por padrão porque a M1 mediu razão de filtro 0,99 — o One Euro em
   * produção quase não suaviza, e esse espaço estava inteiro vazio. A flag
   * existe para a medição comparar com e sem, sob o mesmo modelo.
   */
  estabilizarFixacao: boolean;
  /**
   * Cancela o roll da cabeça no recorte do L2CS (sprint S6).
   *
   * DESLIGADA por padrão, e por um motivo específico: o ganho só existe se esta
   * normalização for a MESMA usada no treino do checkpoint empacotado.
   * Normalização diferente da do dataset piora em vez de melhorar, e este
   * projeto ainda não confirmou como o modelo foi treinado. Ligar isto é uma
   * condição de medição — duas sessões, uma com e outra sem, com a cadeira
   * reclinada uns 15°, que é onde o efeito existe.
   */
  normalizarRollNoCrop: boolean;
  /**
   * Usa as SETE dimensões do bloco angular do L2CS em vez de duas (sprint S7).
   *
   * Desligada por padrão: é uma ablação, e ela muda o `FEATURE_VECTOR_ID`, o
   * que invalida todo perfil salvo — proteção, não obstáculo, mas que precisa
   * de migração pensada antes de virar produção.
   */
  blocoL2csCompleto: boolean;
  /** Diâmetro do cursor de gaze, em px. */
  cursorSizePx: number;
  /** Anel de progresso do dwell desenhado ao redor do cursor. */
  dwellRingOnCursor: boolean;
  /**
   * Mantém o cursor visível DURANTE o teste de precisão.
   *
   * Desligada por default, e o default não é conservadorismo: vendo o cursor,
   * a pessoa tenta corrigi-lo e o número medido passa a ser o do loop de
   * perseguição, não o do modelo. Uma rodada com isto ligado **não é
   * comparável** com uma rodada sem — nem entre blocos da mesma sessão.
   *
   * Existe porque o operador precisa de um jeito de ver, ao vivo, se o cursor
   * acompanha o alvo: um erro de 3° e um mapeamento invertido produzem
   * relatórios parecidos e telas completamente diferentes. Use para
   * diagnóstico, não para medir; a flag vai no `pipeline.experiment` do
   * relatório, então a rodada fica marcada.
   */
  cursorNoTesteDePrecisao: boolean;
  /** Piscada longa como clique. Desligado por default: piscar é involuntário. */
  blinkClick: boolean;
  /** Varredura automática após alguns segundos sem gaze. */
  scanningMode: boolean;
  /** Ao perder o gaze: segura 2 s, depois esconde o cursor e avisa. */
  gazeLostFallback: boolean;
}

export const DEFAULTS: ExperimentConfig = {
  expandFactor: 1.4,
  l2csCadenceMs: 100,
  l2csInputSize: 448,
  l2cs: 'auto',
  polynomialFeatures: true,
  geometricPoseCompensation: true,
  lateralTranslationCompensation: false,
  correcaoPorDwell: true,
  filterMode: 'oneEuro',
  estabilizarFixacao: true,
  normalizarRollNoCrop: false,
  blocoL2csCompleto: false,
  cursorSizePx: 48,
  dwellRingOnCursor: false,
  cursorNoTesteDePrecisao: false,
  blinkClick: false,
  scanningMode: false,
  gazeLostFallback: true,
};

export const VALORES_ACEITOS = {
  l2cs: ['auto', 'webgpu', 'wasm', 'off'],
  filterMode: ['oneEuro', 'kalman', 'kalmanEma'],
} as const;

export const L2CS_INPUT_SIZES_ACEITOS = [224, 448] as const;

export const EXPERIMENT_RANGES = {
  cursorSizePx: { min: 24, max: 128 },
  expandFactor: { min: 1.0, max: 3.0 },
  l2csCadenceMs: { min: 33, max: 2000 },
} as const;

const STORAGE_KEY = 'irisflow.experiment';

type EnvLike = Record<string, string | undefined>;

function getProcessEnvOrEmpty(): EnvLike {
  const proc = (globalThis as { process?: { env?: EnvLike } }).process;
  return proc?.env ?? {};
}

// No Windows os nomes de variável de ambiente chegam em maiúsculas, então a
// busca é case-insensitive.
const CHAVES_POR_MAIUSCULA: ReadonlyMap<string, keyof ExperimentConfig> = new Map(
  Object.keys(DEFAULTS).map((k) => [k.toUpperCase(), k as keyof ExperimentConfig]),
);

/** Overrides `IRISFLOW_EXP_<chave>=<valor>` vindos do ambiente (Node). */
export function loadEnvOverrides(env: EnvLike = getProcessEnvOrEmpty()): Partial<ExperimentConfig> {
  if (!env) return {};
  const overrides: Partial<ExperimentConfig> = {};
  const prefix = 'IRISFLOW_EXP_';
  for (const [envKey, rawValue] of Object.entries(env)) {
    if (!envKey.startsWith(prefix) || rawValue === undefined) continue;
    const key = CHAVES_POR_MAIUSCULA.get(envKey.slice(prefix.length).toUpperCase());
    if (!key) {
      console.warn(
        `[exp] '${envKey}' tem o prefixo ${prefix} mas não corresponde a nenhuma flag — ignorada. ` +
        `Flags válidas: ${Object.keys(DEFAULTS).join(', ')}.`,
      );
      continue;
    }
    const defaultValue = DEFAULTS[key];
    if (typeof defaultValue === 'boolean') {
      const lower = rawValue.toLowerCase();
      (overrides as Record<string, unknown>)[key] = lower === 'true' || lower === '1';
    } else if (typeof defaultValue === 'number') {
      const n = Number(rawValue);
      if (!Number.isNaN(n)) (overrides as Record<string, unknown>)[key] = n;
    } else if (typeof defaultValue === 'string') {
      (overrides as Record<string, unknown>)[key] = rawValue;
    }
  }
  return overrides;
}

/**
 * Valida uma configuração parcial contra `DEFAULTS`. Tipo errado, valor
 * não-finito, fora da faixa ou fora da lista fechada cai no default, com
 * aviso. Cada chave é avaliada sozinha: um valor inválido não contamina os outros.
 */
export function sanitizeExperiment(bruto: unknown): ExperimentConfig {
  const out: ExperimentConfig = { ...DEFAULTS };
  if (!bruto || typeof bruto !== 'object' || Array.isArray(bruto)) return out;

  for (const [k, v] of Object.entries(bruto as Record<string, unknown>)) {
    if (!(k in DEFAULTS)) {
      console.warn(`[exp] chave desconhecida '${k}' ignorada.`);
      continue;
    }
    const chave = k as keyof ExperimentConfig;
    const padrao = DEFAULTS[chave];

    if (typeof padrao === 'boolean') {
      if (typeof v === 'boolean') {
        (out as unknown as Record<string, unknown>)[chave] = v;
      } else {
        console.warn(`[exp] '${k}' esperava booleano, recebeu ${typeof v} — usando o default (${padrao}).`);
      }
      continue;
    }

    if (typeof padrao === 'string') {
      const aceitos = VALORES_ACEITOS[chave as keyof typeof VALORES_ACEITOS];
      if (aceitos && typeof v === 'string' && (aceitos as readonly string[]).includes(v)) {
        (out as unknown as Record<string, unknown>)[chave] = v;
      } else {
        console.warn(`[exp] '${k}' esperava um de [${aceitos?.join(', ')}], recebeu ${JSON.stringify(v)} — usando o default (${padrao}).`);
      }
      continue;
    }

    if (typeof padrao === 'number') {
      if (typeof v !== 'number' || !Number.isFinite(v)) {
        console.warn(`[exp] '${k}' esperava número finito, recebeu ${JSON.stringify(v)} — usando o default (${padrao}).`);
        continue;
      }
      if (chave === 'l2csInputSize') {
        // Lista fechada, não faixa: a ResNet-50 reduz por 32, e um valor como
        // 244 rodaria sem erro medindo outra coisa.
        if (!(L2CS_INPUT_SIZES_ACEITOS as readonly number[]).includes(v)) {
          console.warn(
            `[exp] 'l2csInputSize' = ${v} não é um tamanho aceito ` +
            `(${L2CS_INPUT_SIZES_ACEITOS.join(', ')}) — usando o default (${padrao}).`,
          );
          continue;
        }
        (out as unknown as Record<string, unknown>)[chave] = v;
        continue;
      }
      const faixa = EXPERIMENT_RANGES[chave as keyof typeof EXPERIMENT_RANGES];
      if (faixa && (v < faixa.min || v > faixa.max)) {
        console.warn(`[exp] '${k}' = ${v} fora da faixa [${faixa.min}, ${faixa.max}] — usando o default (${padrao}).`);
        continue;
      }
      (out as unknown as Record<string, unknown>)[chave] = v;
    }
  }
  return out;
}

function load(): ExperimentConfig {
  const envOverrides = loadEnvOverrides();
  if (typeof localStorage === 'undefined') return sanitizeExperiment(envOverrides);
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return sanitizeExperiment(envOverrides);
    const doDisco = JSON.parse(raw) as unknown;
    return sanitizeExperiment({
      ...(doDisco && typeof doDisco === 'object' && !Array.isArray(doDisco) ? doDisco : {}),
      ...envOverrides,
    });
  } catch {
    return sanitizeExperiment(envOverrides);
  }
}

// Como `load()`, mas sem os overrides de ambiente — é o que `set()` persiste,
// para uma variável de ambiente usada uma vez não ficar gravada no disco.
function loadSemEnv(): ExperimentConfig {
  if (typeof localStorage === 'undefined') return { ...DEFAULTS };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULTS };
    return sanitizeExperiment(JSON.parse(raw) as unknown);
  } catch {
    return { ...DEFAULTS };
  }
}

export const EXPERIMENT: ExperimentConfig = load();

export function experimentSnapshot(): ExperimentConfig {
  return { ...EXPERIMENT };
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).__irisflowExp = {
    dump: () => ({ ...EXPERIMENT }),
    defaults: () => ({ ...DEFAULTS }),
    set(key: keyof ExperimentConfig, value: number | boolean | string) {
      const next = sanitizeExperiment({ ...loadSemEnv(), [key]: value });
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      console.warn('[exp] gravado. RECARREGUE a página para aplicar.', next);
    },
    reset() {
      localStorage.removeItem(STORAGE_KEY);
      console.warn('[exp] limpo. RECARREGUE a página.');
    },
  };
}
