// Bloco de features L2CS (E5 do L2CS-NET.md).
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
// ⚠️ CLAMP obrigatório em ±π/4. tan() explode perto de ±π/2; um único frame
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
 * Confiança mínima da softmax para o gaze entrar no vetor de features (B3.1).
 *
 * `confidence = 1 − H/H_max`: 0 é distribuição uniforme (incerteza total), 1 é
 * massa num único bin.
 *
 * Por que existe: um crop degenerado (preto, congelado) produz distribuição
 * difusa, e a decodificação devolve um ângulo. Com a média circular esse
 * ângulo deixa de ser sistematicamente ~0°, mas continua sendo **arbitrário** —
 * a resultante dos vetores tem norma quase nula e a direção vira ruído.
 * `isGazePlausible` não pega isso, porque o ângulo pode cair perfeitamente
 * dentro da faixa fisiológica.
 *
 * A entropia é o único sinal que distingue "o modelo diz que está olhando para
 * o centro" de "o modelo não faz ideia". Ela já era calculada e descartada —
 * `types.ts` admitia em comentário que ninguém consumia. Ligar o gate é a
 * defesa mais barata do pipeline inteiro.
 *
 * 0,15 é conservador de propósito: fica bem abaixo do regime concentrado
 * (>0,9 num pico) e bem acima do uniforme (~0), então rejeita o crop quebrado
 * sem descartar inferência legítima em condição ruim de luz. O valor definitivo
 * sai do `F8.4` no Dia 7.
 */
export const L2CS_CONFIDENCE_MIN = 0.15;

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
  // Ângulo implausível é tratado como inválido, não como extremo.
  if (valid && !isGazePlausible(yaw, pitch)) {
    return [0, 0, 0, 0, 0, 0, 0];
  }
  // B3.1 — gate de confiança. Independente da checagem de plausibilidade
  // acima: aquela pega o ângulo impossível, esta pega a distribuição sem
  // informação que produziu um ângulo possível.
  if (valid && typeof confidence === 'number' && confidence < L2CS_CONFIDENCE_MIN) {
    return [0, 0, 0, 0, 0, 0, 0];
  }
  // Degradação graciosa — quando o L2CS ainda não emitiu resultado, ou o cache
  // está stale, o Ridge continua operando com o comportamento pré-L2CS (as
  // dimensões novas ficam constantes em zero, não contribuem para a predição).
  if (!valid) {
    return [0, 0, 0, 0, 0, 0, 0];
  }

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
   * Conta tempo, não quadros observados (B2.2). O limiar antigo era de 60
   * repetições, com o comentário "a 10 Hz de submissão, 60 são ~6 s" — mas
   * `observe` roda no rAF (~60 Hz) sobre o valor EM CACHE, não a cada
   * inferência. O mesmo resultado era observado ~6 vezes antes de ser
   * substituído, então 60 repetições viravam ~1 s: erro de 6×.
   *
   * A consequência era um falso positivo garantido. Uma única inferência de
   * 1,0–1,5 s (plausível em WASM single-thread com ResNet-50 @448²) disparava
   * `setL2CSStatus('error')` com a mensagem "SAÍDA TRAVADA — o modelo está
   * inferindo sobre imagem inútil", que é falsa: o modelo está lento, não
   * quebrado.
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
      // Worker aquecendo ou gaze stale: ausência de dado não é travamento.
      // Contar como travamento acusaria todo boot.
      this.ultimoYaw = null;
      this.desdeMs = null;
      this.acabouDeRecuperar = false;
      return false;
    }

    if (this.ultimoYaw === null || yaw !== this.ultimoYaw) {
      // O gaze variou — o pipeline está vivo.
      //
      // B2.2 — RECUPERAÇÃO AUTOMÁTICA. Antes, `avisou` era latch de mão única
      // e `reset()` nunca era chamado em produção: nada devolvia o status
      // para 'ready'. `CalibrationCheck.tsx` bloqueava a calibração pelo resto
      // da sessão, e a única saída era recarregar a página — algo que o
      // público-alvo (ELA, uso possivelmente desacompanhado) pode não
      // conseguir fazer sozinho.
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
