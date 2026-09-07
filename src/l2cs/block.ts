// Bloco de features L2CS (ver docs/L2CS-NET.md).
//
// 7 termos derivados de (yaw, pitch, dProxy) que entram como features
// adicionais no vetor por olho antes do Ridge.
//
// Por que a tangente antes do polinômio:
//   x_tela ≈ x_olho + d · tan(yaw)         (geometria de projeção)
//   tan(x) = x + x³/3 + 2x⁵/15 + …          (Taylor — expansão ímpar)
// Um PolynomialFeatures(degree=2) sobre o ângulo gera x², que não aparece
// nessa expansão. Aplicando tan primeiro, o termo de 1ª ordem já é exato e
// o grau 2 captura resíduo (tela plana, câmera não centrada).
//
// CLAMP obrigatório em ±π/4. tan() explode perto de ±π/2; um único frame
// de pose extrema envenena o StandardScaler.fit em cascata — média/desvio
// vão a infinito e o regressor inteiro degenera. Mesmo padrão do comentário
// anti-NaN de asin() no extractor.ts.

export const L2CS_BLOCK_DIM = 7;

// ±45°. Escolhido conservador: usos normais de gaze ficam bem dentro disto;
// valores fora são artefatos de pose extrema ou má detecção.
const CLAMP_RAD = Math.PI / 4;

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// Layout FIXO — a Ridge depende da ordem estável.
//   [0] tan(yaw)              1ª ordem, X
//   [1] tan(pitch)             1ª ordem, Y
//   [2] tan(yaw) · dProxy      paralaxe X
//   [3] tan(pitch) · dProxy    paralaxe Y
//   [4] tan(yaw)²              curvatura residual X
//   [5] tan(pitch)²            curvatura residual Y
//   [6] tan(yaw) · tan(pitch)  cruzado (rotação/skew da tela)
//
// Limite de plausibilidade físico. Quem olha para uma tela a 50-70 cm fica
// dentro de ~±30° em yaw e ~±20° em pitch. Um ângulo QUE ENCOSTA no clamp
// não é um olhar extremo: é sinal de que a rede recebeu lixo (crop
// degenerado, rosto ausente, imagem preta) e devolveu um valor arbitrário.
// Clampar silenciosamente transforma lixo em constante, e constante em
// feature — daí o gate por plausibilidade abaixo.
const PLAUSIBLE_RAD = 0.61;   // ~35°, folgado sobre o uso real

/** O ângulo é fisicamente compatível com alguém olhando para a tela? */
export function isGazePlausible(yaw: number, pitch: number): boolean {
  return (
    Number.isFinite(yaw) && Number.isFinite(pitch) &&
    Math.abs(yaw) <= PLAUSIBLE_RAD && Math.abs(pitch) <= PLAUSIBLE_RAD
  );
}

/**
 * Confiança mínima da softmax (`1 − H/H_max`) para o gaze entrar no vetor de
 * features.
 *
 * Um crop degenerado (preto, congelado) produz distribuição difusa cujo ângulo
 * decodificado é arbitrário mas pode cair dentro da faixa fisiológica —
 * `isGazePlausible` não pega isso. A entropia é o único sinal que distingue
 * "olhando para o centro" de "o modelo não faz ideia".
 *
 * 0,15 é conservador: bem abaixo do regime concentrado (>0,9 num pico) e bem
 * acima do uniforme (~0), então rejeita o crop quebrado sem descartar
 * inferência legítima em luz ruim. Valor provisório até medição em campo.
 */
export const L2CS_CONFIDENCE_MIN = 0.15;

/**
 * Por que o último bloco angular saiu zerado, e com que números.
 *
 * As três causas — leitura obsoleta, ângulo implausível e confiança baixa —
 * eram indistinguíveis para quem consome o vetor: todas viram sete zeros. A
 * calibração então contava tudo como um contador só e a tela dizia "o sistema
 * perdeu o olhar" mesmo quando a leitura chegou na hora e o problema era a
 * distribuição difusa da softmax. Culpar o olhar do paciente por um limiar do
 * modelo manda a pessoa se mexer, o que só piora.
 */
export interface DiagnosticoBloco {
  motivo: 'stale' | 'implausivel' | 'confianca' | null;
  yawDeg: number;
  pitchDeg: number;
  confidence: number | null;
}

let ultimoDiag: DiagnosticoBloco = { motivo: null, yawDeg: 0, pitchDeg: 0, confidence: null };

/** Diagnóstico do último `buildL2CSBlock`. Válido para o quadro corrente. */
export function ultimoDiagnosticoDoBloco(): DiagnosticoBloco {
  return ultimoDiag;
}

const GRAUS = 180 / Math.PI;

export function buildL2CSBlock(
  yaw: number,
  pitch: number,
  valid: boolean,
  dProxy: number,
  /** Confiança da softmax (`1 − H/H_max`). Ausente mantém o comportamento
   *  anterior — gravações e chamadores antigos não a fornecem, e rejeitar por
   *  ausência transformaria todo dado histórico em lixo. */
  confidence?: number,
): number[] {
  const conf = typeof confidence === 'number' ? confidence : null;
  const anotar = (motivo: DiagnosticoBloco['motivo']) => {
    ultimoDiag = { motivo, yawDeg: yaw * GRAUS, pitchDeg: pitch * GRAUS, confidence: conf };
  };

  // Ângulo implausível é tratado como inválido, não como extremo.
  if (valid && !isGazePlausible(yaw, pitch)) {
    anotar('implausivel');
    return [0, 0, 0, 0, 0, 0, 0];
  }
  // Gate de confiança, independente da plausibilidade acima: aquela pega o
  // ângulo impossível, esta pega a distribuição sem informação que produziu
  // um ângulo possível.
  if (valid && conf !== null && conf < L2CS_CONFIDENCE_MIN) {
    anotar('confianca');
    return [0, 0, 0, 0, 0, 0, 0];
  }
  // Degradação graciosa — quando o L2CS ainda não emitiu resultado, ou o cache
  // está stale, o Ridge continua operando com o comportamento pré-L2CS (as
  // dimensões novas ficam constantes em zero, não contribuem para a predição).
  if (!valid) {
    anotar('stale');
    return [0, 0, 0, 0, 0, 0, 0];
  }
  anotar(null);

  const y = clamp(yaw, -CLAMP_RAD, CLAMP_RAD);
  const p = clamp(pitch, -CLAMP_RAD, CLAMP_RAD);
  const ty = Math.tan(y);
  const tp = Math.tan(p);

  return [
    ty,
    tp,
    ty * dProxy,
    tp * dProxy,
    ty * ty,
    tp * tp,
    ty * tp,
  ];
}

/**
 * Vigia de saída CONSTANTE do L2CS.
 *
 * `isGazePlausible` pega ângulo fora da faixa fisiológica. Não pega o modo de
 * falha em que a inferência sobre imagem degenerada devolve um ângulo
 * perfeitamente plausível — só que sempre o MESMO.
 *
 * Um olho humano nunca fica exatamente parado: micro-sacadas e ruído do modelo
 * garantem variação. Saída idêntica bit a bit ao longo de segundos é hardware
 * ou pipeline quebrado, nunca fisiologia.
 */
export interface L2CSHealthOptions {
  /**
   * Por quanto TEMPO o yaw pode ficar idêntico antes de acusar travamento.
   *
   * Conta tempo, não quadros: `observe` roda no rAF sobre o valor EM CACHE,
   * então o mesmo resultado é observado várias vezes entre inferências. Um
   * limiar em quadros disparava falso positivo com uma única inferência lenta
   * (1–1,5 s em WASM single-thread).
   */
  janelaMs?: number;
}

const JANELA_PADRAO_MS = 6000;

export class L2CSHealthMonitor {
  private ultimoYaw: number | null = null;
  /** Instante em que o yaw atual apareceu pela primeira vez. */
  private desdeMs: number | null = null;
  private avisou = false;
  private acabouDeRecuperar = false;
  private readonly janelaMs: number;

  constructor(opts: L2CSHealthOptions = {}) {
    this.janelaMs = opts.janelaMs ?? JANELA_PADRAO_MS;
  }

  /**
   * Observa o gaze corrente. Devolve `true` no instante em que o travamento é
   * detectado (uma vez por episódio).
   *
   * `nowMs` é injetável para os testes rodarem com relógio virtual; em
   * produção o engine passa o `performance.now()` do frame.
   */
  observe(yaw: number, valid: boolean, nowMs: number = performance.now()): boolean {
    if (!valid || !Number.isFinite(yaw)) {
      // Worker aquecendo ou gaze stale: ausência de dado não é travamento,
      // mas também não é sinal de vida — a contagem fica como está. Zerar aqui
      // deixava o vigia inerte sempre que a inferência era mais lenta que a
      // tolerância, e fazia um stale isolado parecer "recuperação".
      this.acabouDeRecuperar = false;
      return false;
    }

    if (this.ultimoYaw === null || yaw !== this.ultimoYaw) {
      // O gaze variou — o pipeline está vivo. A recuperação é automática:
      // um latch de mão única deixaria a calibração bloqueada pelo resto da
      // sessão, e o público-alvo pode não conseguir recarregar a página.
      this.acabouDeRecuperar = this.avisou;
      this.avisou = false;
      this.ultimoYaw = yaw;
      this.desdeMs = nowMs;
      return false;
    }

    // Mesmo yaw. Quanto tempo faz?
    this.acabouDeRecuperar = false;
    if (this.desdeMs === null) {
      this.desdeMs = nowMs;
      return false;
    }
    if (nowMs - this.desdeMs >= this.janelaMs && !this.avisou) {
      this.avisou = true;
      return true;
    }
    return false;
  }

  /** Travamento detectado e ainda não recuperado. */
  get travado(): boolean {
    return this.avisou;
  }

  /** `true` no frame em que o gaze voltou a variar depois de um travamento.
   *  Permite ao engine devolver o status para 'ready' sem inferir a transição
   *  por conta própria. */
  get recuperou(): boolean {
    return this.acabouDeRecuperar;
  }

  reset(): void {
    this.ultimoYaw = null;
    this.desdeMs = null;
    this.avisou = false;
    this.acabouDeRecuperar = false;
  }
}
