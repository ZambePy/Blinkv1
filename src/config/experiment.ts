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
   * ⚠️ **NÃO ESTÁ LIGADO AO PIPELINE (B3.10).**
   *
   * O comentário anterior afirmava "elimina o freeze de UI de 1-3s durante
   * `completeCalibration()`". Isso nunca aconteceu: `createCalibrationClient`
   * só é chamado em teste, e `completeCalibration` treina de forma síncrona na
   * main thread independentemente do valor desta flag.
   *
   * Documentação que descreve comportamento inexistente é pior que ausência de
   * documentação, porque induz decisão errada — alguém lendo isto concluiria
   * que o freeze já foi resolvido.
   *
   * O que B3.10 fez: corrigiu o worker para que, QUANDO for ligado, ele treine
   * certo (a configuração estática do `RidgeRegressor` agora atravessa a
   * fronteira — antes `axisScale` valia o default lá dentro, subponderando o
   * eixo X em 3,16×). Ligar o caminho de fato é trabalho de sprint de
   * pipeline, com medição, não de correção de bug P2.
   *
   * DEFAULT true — preservado para não mudar nada; a flag simplesmente não é
   * consultada por ninguém em produção hoje.
   */
  calibrationWorker: boolean;

  // ── Sprint 4 — etapas 1 e 2 do pipeline (captura e pré-processamento) ──────
  //
  // Todas nascem `false`: o default é o comportamento de hoje, e quem troca é
  // o Sprint 8, com medição. Ligar qualquer uma delas sem o dado de `F8.4` é
  // trocar latência conhecida por precisão hipotética.

  /**
   * Ring buffer de captura com descarte do frame mais ANTIGO (`P4.1`).
   *
   * Sem isto o engine lê o vídeo por polling no rAF (`lastVideoTime !==
   * currentTime`), que não tem fila e portanto não tem política de descarte —
   * o atraso do consumidor simplesmente vira frame perdido sem contabilidade.
   * Com a flag, os descartes passam a ser contados e expostos em
   * `EngineDiagnostics.capture`.
   *
   * DEFAULT false — só rende de fato junto com `captureWorker`, que é quem
   * cria o produtor separado do consumidor.
   */
  captureRingBuffer: boolean;

  /**
   * Captura em worker dedicado via `MediaStreamTrackProcessor` (`P4.2`).
   *
   * ⚠️ NÃO é solução de latência. O gargalo é o L2CS (300+ ms), não a captura
   * (~1–2 ms). Isto reduz jitter de agendamento e libera o thread principal.
   * A casca do worker (`src/capture/capture.worker.ts`) nunca rodou em
   * navegador — a verificação é do Dia 7.
   *
   * DEFAULT false.
   */
  captureWorker: boolean;

  /**
   * CLAHE na região dos olhos antes da normalização (`P4.5`).
   *
   * Custo MEDIDO: 0,67 ms na região ocular, 5,93 ms no crop 448² inteiro —
   * contra a estimativa de ~1 ms da especificação. Ver o ADR de `P4.4` em
   * `docs/DECISOES_PIPELINE.md`, incluindo o conflito registrado sobre
   * equalizar só um retângulo do que o L2CS enxerga inteiro.
   *
   * DEFAULT false.
   */
  claheEyeRegion: boolean;

  /**
   * Correção de gama derivada do histograma, com histerese (`P4.6`).
   *
   * Custo MEDIDO: 2,67 ms por frame sobre 448².
   *
   * DEFAULT false.
   */
  dynamicGamma: boolean;

  /**
   * Execution provider do L2CS (`P5.5`, passo 2).
   *
   * `'wasm'` (default) é o caminho de hoje: bundle wasm-only, SIMD,
   * `numThreads = 1`. **Medido em navegador: 2319 ms por inferência em 448²,
   * 728 ms em 224²** — contra uma tolerância de staleness de 400 ms, o que
   * significa 100% de leituras obsoletas e bloco angular zerado em todo quadro.
   *
   * `'webgpu'` usa o bundle "all" com JSEP. **MEDIDO: 50 ms em 448², 32 ms em
   * 224², com staleness de 0%.** É 46× mais rápido que o WASM, e é o que faz o
   * bloco angular deixar de ser zerado — com `'wasm'`, o modelo roda com 4 das
   * 6 dimensões do vetor.
   *
   * O default continua `'wasm'` porque WebGPU depende de GPU e driver do posto,
   * e um default que falha na máquina do paciente é pior que um default lento.
   * A troca para `'webgpu'` como padrão é decisão de `F8.4`, junto com a
   * verificação de disponibilidade no hardware de destino.
   *
   * ⚠️ O worker registra o provider EFETIVAMENTE ativo, não o pedido. Um
   * fallback silencioso de `'webgpu'` para `'wasm'` faria a medição comparar
   * wasm contra wasm e o resultado seria lido como "a GPU não ajudou" — a
   * conclusão exatamente invertida. Ver `EngineDiagnostics.l2cs.executionProvider`.
   */
  l2csExecutionProvider: 'wasm' | 'webgpu';

  /**
   * Referência neutra DINÂMICA (`P5.8`).
   *
   * Quando ligada, a pose de referência da compensação passa a acompanhar
   * mudanças sustentadas de postura, via média móvel de 60 s com detecção de
   * deriva. Quando desligada (default), a referência é a da calibração e nunca
   * muda — o comportamento de hoje.
   *
   * ⚠️ Mexer na referência é mexer no que dá sentido a toda a compensação. As
   * três guardas estão em `ReferenciaNeutra`: nunca durante a calibração (a
   * referência dela é o ponto contra o qual o Ridge minimizou o erro — `B1.3`),
   * nunca durante deriva rápida, e toda troca é registrada com timestamp e
   * delta. Sem esse registro seria impossível explicar, no Dia 7, por que o
   * erro mudou no meio da sessão.
   *
   * DEFAULT false.
   */
  dynamicNeutralReference: boolean;

  /**
   * Modo de compensação de pose (`P5.7`).
   *
   * `'geometric'` (default) é o que existe hoje: desloca a PREDIÇÃO em pixels
   * por `d · tan(Δ)`, depois do Ridge. `'additive'` corrige o ÂNGULO antes de
   * entrar no Ridge, por `gaze + (head − ref)`.
   *
   * ⚠️ `'both'` NÃO soma os efeitos. As duas descrevem o mesmo fenômeno físico
   * em espaços diferentes; aplicar as duas compensaria a rotação da cabeça
   * duas vezes, e o erro resultante teria o sinal contrário — o cursor passaria
   * do alvo em vez de ficar aquém. `'both'` existe para MEDIR as duas em
   * paralelo: a geométrica atua e a aditiva alimenta o diagnóstico.
   */
  poseCompensationMode: 'geometric' | 'additive' | 'both';

  /**
   * Fonte da head pose (`P5.2`).
   *
   * `'matrix'` (default) usa a `facialTransformationMatrix` do MediaPipe,
   * ajustada sobre os 478 landmarks. `'pnp'` usa `solvePnP` sobre 6 pontos.
   *
   * ⚠️ O PnP NÃO substitui a matriz — entra como alternativa a ser MEDIDA no
   * Dia 7. A matriz é mais robusta a oclusão parcial: perder a boca atrás de
   * uma máscara ou de um suporte de cabeça degrada a matriz um pouco e derruba
   * um PnP de 6 pontos inteiro (33% dos pontos somem de uma vez).
   *
   * O valor do PnP é ser AUDITÁVEL: a matriz é caixa-preta e não há como
   * conferir de onde vem o yaw. Com os dois, uma discordância grande vira
   * informação — e ela é publicada em `EngineDiagnostics.pose.deltaPnpDeg`
   * mesmo com a flag em `'matrix'`, para o Dia 7 ter a série pronta.
   */
  headPoseSource: 'matrix' | 'pnp';

  /**
   * Lado do crop entregue ao L2CS, em pixels (`P5.5a`).
   *
   * O ONNX foi reexportado com eixos espaciais dinâmicos, então o MESMO binário
   * roda 224² e 448². Verificado por inferência real: os 110 tensores de peso
   * são byte-idênticos aos do modelo anterior (reexport, não retreino), e a
   * saída em 448² é bit-idêntica à de antes.
   *
   * O que muda entre os dois:
   *
   *   448 (default)  tamanho do export original (resolução de treino NÃO registrada)
   *   224            latência 21,4 ms · 3,66× mais rápido, 4× menos MACs
   *
   * ⚠️ **DEFAULT 448 de propósito.** A rede foi treinada em 448; rodar em 224
   * é deslocamento de distribuição, e o efeito na acurácia é desconhecido até
   * `F8.4` medir com humano. Trocar o default sem esse dado seria comprar
   * latência com precisão sem saber o preço.
   *
   * Antes desta flag existir, o tamanho estava fixo em dois lugares
   * independentes (`INPUT_SIZE` em `crop.ts` e `inputSize` no `meta.json`) —
   * agora o worker deduz o lado do próprio tensor e não há o que divergir.
   */
  l2csInputSize: number;

  /**
   * Reuso do crop facial quando a cabeça não mexeu (`P4.8`).
   *
   * A economia prometida pelo plano (40%) NÃO foi verificada e é
   * provavelmente muito menor: o crop custa ~1–2 ms contra 300+ ms do L2CS.
   * Quem responde é `T0.5` com a flag ligada e desligada.
   *
   * DEFAULT false.
   */
  dynamicRoiCache: boolean;
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
  // Sprint 4 — todas desligadas: o default é o comportamento atual, e quem
  // troca é o Sprint 8 com medição (ADR P4.4 em docs/DECISOES_PIPELINE.md).
  captureRingBuffer: false,
  captureWorker: false,
  claheEyeRegion: false,
  dynamicGamma: false,
  dynamicRoiCache: false,
  // P5.5a — 448 é o tamanho de TREINO da rede e o comportamento atual. 224
  // roda 3,66× mais rápido no mesmo binário, mas quem autoriza a troca é a
  // medição de acurácia do `F8.4`, não o ganho de latência sozinho.
  l2csInputSize: 448,
  // P5.2 — a matriz continua sendo a fonte; o PnP é candidato medido.
  headPoseSource: 'matrix',
  // P5.7 — a geométrica é o comportamento atual; a aditiva é candidata medida.
  poseCompensationMode: 'geometric',
  // P5.8 — a referência da calibração continua sendo a única, por default.
  dynamicNeutralReference: false,
  // P5.5 — wasm é o caminho medido; webgpu é o que falta medir.
  l2csExecutionProvider: 'wasm',
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
/**
 * Índice de chaves em MAIÚSCULAS → chave real do config.
 *
 * Existe por causa do Windows: lá os nomes de variável de ambiente são
 * case-insensitive, e o Node devolve a forma canônica em maiúsculas ao
 * enumerar `process.env`. Medido na máquina do projeto:
 *
 *     process.env.IRISFLOW_EXP_dynamicGamma  →  "true"     (acesso direto: ok)
 *     Object.keys(process.env)               →  ["IRISFLOW_EXP_DYNAMICGAMMA"]
 *
 * Sem este índice, a comparação era `'DYNAMICGAMMA' in DEFAULTS`, que é falso —
 * e **nenhuma** flag de chave camelCase, ou seja nenhuma flag, podia ser ligada
 * por env-var no Windows. Em silêncio.
 */
const CHAVES_POR_MAIUSCULA: ReadonlyMap<string, keyof ExperimentConfig> = new Map(
  Object.keys(DEFAULTS).map((k) => [k.toUpperCase(), k as keyof ExperimentConfig]),
);

export function loadEnvOverrides(env: EnvLike = getProcessEnvOrEmpty()): Partial<ExperimentConfig> {
  if (!env) return {};
  const overrides: Partial<ExperimentConfig> = {};
  const prefix = 'IRISFLOW_EXP_';
  for (const [envKey, rawValue] of Object.entries(env)) {
    if (!envKey.startsWith(prefix) || rawValue === undefined) continue;
    // Case-insensitive, porque o ambiente que nos entrega a chave também é.
    const key = CHAVES_POR_MAIUSCULA.get(envKey.slice(prefix.length).toUpperCase());
    if (!key) {
      // O silêncio de antes era a outra metade do bug. Quem escreve
      // `IRISFLOW_EXP_` na frente de alguma coisa está tentando ligar uma
      // flag; um typo aí custava uma rodada de medição inteira sem sintoma —
      // e no protocolo de ablação de `F8.4` isso vira conclusão invertida, não
      // só tempo perdido. Variáveis SEM o prefixo continuam ignoradas caladas,
      // que é o certo: `PATH` não é typo de flag nenhuma.
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
      // P5.2 — flags de string também precisam ser alcançáveis por env-var.
      // Sem isto, `headPoseSource` só poderia ser trocada por localStorage, e
      // a ablação de `F8.4` roda em linha de comando. A validação contra a
      // lista fechada acontece em `sanitizeExperiment`; aqui só coletamos.
      (overrides as Record<string, unknown>)[key] = rawValue;
    }
  }
  return overrides;
}

/**
 * Faixa aceitável de cada flag NUMÉRICA (B3.13).
 *
 * Existe porque `{...DEFAULTS, ...JSON.parse(raw) as Partial<ExperimentConfig>}`
 * é uma AFIRMAÇÃO de tipo, não uma verificação: o que estivesse no
 * localStorage entrava intacto. Dois casos alcançáveis pelo console que o
 * próprio módulo documenta:
 *
 *   `{"l2csCadenceMs": 0}`   → o throttle some. Crop 448² + `getImageData` +
 *                              `postMessage` a cada frame, ~5 ms/frame
 *                              queimados produzindo tensores descartados.
 *   `{"expandFactor": "x"}`  → `NaN` no crop, e `console.warn` uma vez por
 *                              frame, para sempre.
 */
/** Valores aceitos por flag de string (P5.2). Lista fechada: um valor
 *  desconhecido escolheria um caminho de pose em silêncio. */
export const VALORES_ACEITOS = {
  headPoseSource: ['matrix', 'pnp'],
  poseCompensationMode: ['geometric', 'additive', 'both'],
  l2csExecutionProvider: ['wasm', 'webgpu'],
} as const;

export const EXPERIMENT_RANGES = {
  /** Abaixo de 1,0 o crop corta o próprio rosto; acima de 3 é quase só fundo. */
  expandFactor: { min: 1.0, max: 3.0 },
  /** 33 ms ≈ 1 submissão por frame a 30 fps — o teto do que faz sentido.
   *  2000 ms é o piso de utilidade: acima disso o gaze chega velho demais. */
  l2csCadenceMs: { min: 33, max: 2000 },
  /**
   * Lado do crop do L2CS (P5.5a). A faixa é fechada nos dois tamanhos
   * VALIDADOS no grafo — 224 e 448.
   *
   * Não é uma faixa contínua de verdade: valores intermediários passariam pela
   * validação de faixa mas nem todos são múltiplos de 32 (o fator de redução da
   * ResNet-50). O `sanitize` genérico só sabe checar min/max; a checagem de
   * múltiplo de 32 vive em `L2CS_INPUT_SIZES` e no teste que a cobre. Quem
   * quiser varrer tamanhos intermediários precisa validar o grafo antes.
   */
  l2csInputSize: { min: 224, max: 448 },
} as const;

/**
 * Valida e normaliza uma configuração parcial contra `DEFAULTS` (B3.13).
 *
 * Regras: tipo errado, não-finito ou fora da faixa cai no default, **com
 * aviso**. Silenciar seria trocar um bug barulhento por um silencioso — quem
 * configurou algo pelo console precisa saber que foi ignorado.
 *
 * Um valor inválido nunca contamina os outros: cada chave é avaliada sozinha.
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

    // P5.2 — a única flag de STRING hoje. O `sanitize` genérico valida
    // booleano e número; para string a validação é por lista fechada, porque
    // um valor desconhecido aqui escolheria silenciosamente um caminho de pose.
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
      const faixa = EXPERIMENT_RANGES[chave as keyof typeof EXPERIMENT_RANGES];
      if (faixa && (v < faixa.min || v > faixa.max)) {
        console.warn(
          `[exp] '${k}' = ${v} fora da faixa [${faixa.min}, ${faixa.max}] — usando o default (${padrao}).`,
        );
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
    // B3.13 — o conteúdo do localStorage passa por validação antes de entrar.
    const doDisco = JSON.parse(raw) as unknown;
    return sanitizeExperiment({
      ...(doDisco && typeof doDisco === 'object' && !Array.isArray(doDisco) ? doDisco : {}),
      ...envOverrides,
    });
  } catch {
    return sanitizeExperiment(envOverrides);
  }
}

/**
 * Como `load()`, mas SEM os overrides de ambiente (B3.13).
 *
 * Usado por `set()`. A versão anterior persistia o resultado de `load()`, que
 * já inclui os `envOverrides` — então uma variável de ambiente usada uma vez
 * numa sessão de teste ficava **gravada no localStorage** e continuava valendo
 * nas sessões seguintes, sem nada indicando de onde tinha vindo.
 */
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
      // B3.13 — parte de `loadSemEnv()`, não de `load()`.
      //
      // `load()` já mescla os overrides de ambiente, então gravar o resultado
      // dele PERSISTIA uma env-var no localStorage: usada uma vez numa sessão
      // de teste, continuava valendo em todas as seguintes, sem nada indicando
      // a procedência.
      //
      // E o resultado passa por `sanitizeExperiment` antes de ir para o disco,
      // para que um valor absurdo digitado no console não sobreviva ao reload.
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
