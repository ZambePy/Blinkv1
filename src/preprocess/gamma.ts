// P4.6 — correção de gama dinâmica, derivada do histograma do frame.
//
// ── Convenção ────────────────────────────────────────────────────────────────
//
//     saida = 255 · (entrada / 255)^γ
//
// Com essa convenção **γ < 1 clareia** e γ > 1 escurece. A especificação diz
// "subexposto (γ < 0,8) aumenta, superexposto (γ > 1,2) diminui", o que se lê
// como: numa imagem subexposta o γ escolhido cai abaixo de 0,8, e o efeito é
// aumentar o brilho. É a leitura que deixa a faixa [0,6; 1,4] simétrica em
// torno de 1,0 — a outra leitura tornaria a faixa assimétrica sem motivo.
//
// ── Como o γ é derivado ──────────────────────────────────────────────────────
//
// Se a média normalizada da imagem é `m` e queremos que vá para `alvo`, então
// `alvo = m^γ` resolve para `γ = ln(alvo) / ln(m)`. É correção de UM parâmetro
// a partir de UMA estatística — não pretende ser mapeamento ótimo de tons, e
// não deve ser vendida como tal.
//
// ── Onde isto NÃO ajuda ──────────────────────────────────────────────────────
//
// Gama redistribui os tons que existem. Não recupera informação que o sensor
// perdeu por sub ou superexposição: um crop estourado continua estourado, só
// que mais escuro. A ordem certa de tentativa está no ADR de `P4.4` — sensor
// primeiro (`cameraTuner`), software depois, aviso ao cuidador por último.
//
// ── Histerese ────────────────────────────────────────────────────────────────
//
// O histograma treme com ruído de sensor mesmo com a cena parada. Sem
// histerese, γ oscila entre frames vizinhos e o crop que alimenta o L2CS muda
// de aparência sem que nada tenha mudado — ruído injetado bem na entrada do
// modelo, que é o oposto do que o pré-processamento existe para fazer. O ganho
// de não reconstruir a LUT é secundário; o principal é a estabilidade do sinal.

/** Piso e teto do γ. Fora disso a correção deixa de ser sutil e vira efeito. */
export const GAMMA_MIN = 0.6;
export const GAMMA_MAX = 1.4;

/**
 * Variação mínima de γ para valer uma troca. 0,05 sobre uma faixa de 0,8
 * (1,4 − 0,6) é ~6% — acima do que ruído de sensor produz num histograma de
 * dezenas de milhares de pixels, e abaixo do que uma mudança real de
 * iluminação produz.
 */
export const GAMMA_HYSTERESIS = 0.05;

/**
 * Média-alvo normalizada. Igual ao `TARGET_BRIGHTNESS` do `cameraTuner`
 * (0,45): os dois estágios perseguem o MESMO alvo, um no sensor e outro em
 * software. Alvos diferentes fariam um desfazer o trabalho do outro, e o
 * sintoma seria a malha de câmera nunca convergir.
 */
export const GAMMA_TARGET_MEAN = 0.45;

/** Histograma de 256 bins de um plano de 8 bits. */
export function histogramFromGray(gray: Uint8ClampedArray | Uint8Array): Int32Array {
  const h = new Int32Array(256);
  for (let i = 0; i < gray.length; i++) h[gray[i]]++;
  return h;
}

/**
 * γ que leva a média do histograma para `alvo`, limitado à faixa.
 *
 * Total zero devolve 1,0 (identidade): sem pixel não há o que corrigir, e
 * qualquer outro valor seria uma correção inventada a partir de nada.
 */
export function gammaFromHistogram(
  hist: ArrayLike<number>,
  alvo: number = GAMMA_TARGET_MEAN,
): number {
  let total = 0;
  let soma = 0;
  for (let i = 0; i < 256; i++) {
    total += hist[i];
    soma += i * hist[i];
  }
  if (total <= 0) return 1.0;

  const media = soma / total / 255;
  // Pisos em ambos os lados do logaritmo: média 0 (imagem toda preta) ou 1
  // (toda branca) levaria a ln(0) = −∞ e a um γ NaN, que viraria uma LUT
  // inteira de NaN e um crop preto entregue ao L2CS — falha silenciosa.
  const m = Math.min(0.999, Math.max(0.001, media));
  const a = Math.min(0.999, Math.max(0.001, alvo));
  const g = Math.log(a) / Math.log(m);
  if (!Number.isFinite(g)) return 1.0;
  return Math.min(GAMMA_MAX, Math.max(GAMMA_MIN, g));
}

export interface GammaOptions {
  target?: number;
  hysteresis?: number;
  min?: number;
  max?: number;
}

/**
 * Corretor com estado: guarda o γ vigente, a LUT, e só reconstrói quando a
 * mudança passa da histerese.
 */
export class GammaCorrector {
  private readonly target: number;
  private readonly hysteresis: number;
  private readonly min: number;
  private readonly max: number;
  private gammaAtual = 1.0;
  private tabela: Uint8ClampedArray | null = null;
  private reconstrucoes = 0;

  constructor(opts: GammaOptions = {}) {
    this.target = opts.target ?? GAMMA_TARGET_MEAN;
    this.hysteresis = Math.max(0, opts.hysteresis ?? GAMMA_HYSTERESIS);
    this.min = opts.min ?? GAMMA_MIN;
    this.max = opts.max ?? GAMMA_MAX;
  }

  /** γ vigente. */
  get gamma(): number {
    return this.gammaAtual;
  }

  /** Quantas vezes a LUT foi construída. Diagnóstico: um número que cresce
   *  junto com a contagem de frames significa histerese ineficaz. */
  get lutRebuilds(): number {
    return this.reconstrucoes;
  }

  /**
   * Alimenta um histograma e devolve o γ que passa a valer. Só troca quando a
   * diferença passa da histerese.
   */
  update(hist: ArrayLike<number>): number {
    const proposto = Math.min(this.max, Math.max(this.min, gammaFromHistogram(hist, this.target)));
    if (Math.abs(proposto - this.gammaAtual) > this.hysteresis) {
      this.gammaAtual = proposto;
      this.tabela = null; // invalida; a LUT é construída sob demanda
    }
    return this.gammaAtual;
  }

  /** LUT de 256 entradas do γ vigente. Construída sob demanda e memorizada. */
  lut(): Uint8ClampedArray {
    if (!this.tabela) {
      const t = new Uint8ClampedArray(256);
      const g = this.gammaAtual;
      for (let i = 0; i < 256; i++) {
        t[i] = Math.round(255 * Math.pow(i / 255, g));
      }
      this.tabela = t;
      this.reconstrucoes++;
    }
    return this.tabela;
  }

  /**
   * Aplica a LUT sobre RGBA. Alfa passa intacto — corrigir gama de
   * transparência não significa nada e estragaria a composição.
   *
   * Puro em relação à entrada: devolve buffer novo.
   */
  applyRGBA(rgba: Uint8ClampedArray | Uint8Array): Uint8ClampedArray {
    if (rgba.length % 4 !== 0) {
      throw new Error(`[gamma] buffer RGBA precisa ser múltiplo de 4, recebeu ${rgba.length}.`);
    }
    const lut = this.lut();
    const out = new Uint8ClampedArray(rgba.length);
    for (let i = 0; i < rgba.length; i += 4) {
      out[i] = lut[rgba[i]];
      out[i + 1] = lut[rgba[i + 1]];
      out[i + 2] = lut[rgba[i + 2]];
      out[i + 3] = rgba[i + 3];
    }
    return out;
  }

  /** Volta ao estado neutro. Chamado quando a sessão reinicia — γ herdado de
   *  outra iluminação é pior que nenhum. */
  reset(): void {
    this.gammaAtual = 1.0;
    this.tabela = null;
    this.reconstrucoes = 0;
  }
}
