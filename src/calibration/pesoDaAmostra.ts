/**
 * Peso de qualidade por amostra de calibração (sprint S1).
 *
 * ## Por que peso, e não porteiro
 *
 * A calibração já teve gates de amostra e eles foram REMOVIDOS, por um motivo
 * que precisa continuar valendo depois desta mudança: com os gates ligados, os
 * alvos da linha inferior esgotavam as tentativas e eram PULADOS, e o modelo
 * passava a extrapolar a região inteira. Extrapolar é um modo de falha pior do
 * que treinar com quadro ruim.
 *
 * A decisão binária é que estava errada, não a intenção. Aqui a amostra ruim
 * continua entrando — com peso baixo. O alvo nunca fica sem amostra, e o ajuste
 * para de ser mandado por quadros onde o olho estava meio fechado.
 *
 * ## A armadilha que este módulo precisa evitar
 *
 * Qualidade de imagem correlaciona com a POSIÇÃO do alvo: olhando para baixo a
 * pálpebra cobre a íris, o crop escurece e todas as métricas pioram. Um peso
 * global daria menos peso justo à linha inferior — exatamente a região que já é
 * o problema — e o remédio viraria a doença.
 *
 * Por isso o peso bruto calculado aqui **nunca é usado direto**:
 * `normalizarPorGrupo` reescala cada alvo para média 1 antes do treino. O peso
 * decide quais amostras DAQUELE alvo mandam mais; ele não decide quanto aquele
 * alvo pesa contra os outros. Essa segunda decisão pertence ao
 * `balanceTargets`, que é outra chave e continua desligada.
 */

/** Campos que o `EyeQualityAnalyzer` mede por quadro. Todos opcionais: num
 *  canvas sem contexto 2d nenhum deles chega, e aí a amostra vale 1. */
export interface QualidadeDaAmostra {
  irisVisibilityPercentage?: number;
  detectorConfidence?: number;
  brightnessEstimate?: number;
  contrastEstimate?: number;
  blurEstimate?: number;
  specularRatio?: number;
}

export interface EntradaDePeso {
  qualidade?: QualidadeDaAmostra | null;
  /** O bloco angular do L2CS entrou zerado (leitura obsoleta ou implausível). */
  blocoZerado?: boolean;
  /** Confiança do decodificador do L2CS neste quadro, quando conhecida. */
  l2csConfianca?: number | null;
}

/**
 * Piso do peso. Nunca zero: peso zero é o porteiro de volta com outro nome, e
 * um alvo cujas amostras zerassem todas sairia do treino sem aparecer em
 * `targetsSkipped` — falha silenciosa, que é a pior categoria.
 */
export const PESO_MINIMO = 0.05;

/** Quanto o bloco angular zerado custa. Não é catastrófico: as quatro
 *  dimensões de íris continuam válidas, só o bloco do L2CS está em zero. */
export const FATOR_BLOCO_ZERADO = 0.35;

/**
 * Rampa linear entre dois valores, saturando fora do intervalo.
 * `emRuim` → 0, `emBom` → 1. Aceita `emRuim > emBom` (rampa descendente).
 */
function rampa(v: number, emRuim: number, emBom: number): number {
  if (!Number.isFinite(v)) return 1;
  const t = (v - emRuim) / (emBom - emRuim);
  return Math.min(1, Math.max(0, t));
}

const medido = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/**
 * Peso bruto de uma amostra, em (0, 1].
 *
 * Os pontos de quebra das rampas são os mesmos limiares do antigo gate, agora
 * como transição em vez de degrau: onde o gate rejeitava, a rampa chega a zero
 * e o piso segura em `PESO_MINIMO`. Onde o gate aceitava sem olhar, a rampa já
 * distingue o quadro ótimo do quadro medíocre.
 */
export function pesoDaAmostra(entrada: EntradaDePeso): number {
  const q = entrada.qualidade ?? null;
  let peso = 1;

  if (q) {
    // Pálpebra: 0,30 era o corte do gate; abaixo de 0,55 a íris já está
    // parcialmente coberta e o centro estimado escorrega para baixo.
    if (medido(q.irisVisibilityPercentage)) peso *= rampa(q.irisVisibilityPercentage, 0.30, 0.55);
    // Landmarks instáveis (movimento brusco).
    if (medido(q.detectorConfidence)) peso *= rampa(q.detectorConfidence, 0.40, 0.70);
    // Brilho tem dois lados: escuro demais e estourado.
    if (medido(q.brightnessEstimate)) {
      peso *= Math.min(rampa(q.brightnessEstimate, 0.08, 0.22), rampa(q.brightnessEstimate, 0.92, 0.75));
    }
    if (medido(q.contrastEstimate)) peso *= rampa(q.contrastEstimate, 0.02, 0.10);
    if (medido(q.blurEstimate)) peso *= rampa(q.blurEstimate, 0.85, 0.55);
    // Reflexo especular: 2% do crop saturado já é "há reflexo"; 8% é a mancha
    // cobrindo a íris. Não zera — óculos produzem reflexo o tempo todo.
    if (medido(q.specularRatio)) peso *= 0.4 + 0.6 * rampa(q.specularRatio, 0.08, 0.02);
  }

  if (entrada.blocoZerado) peso *= FATOR_BLOCO_ZERADO;
  else if (medido(entrada.l2csConfianca)) {
    // A confiança do L2CS vem da entropia da distribuição de bins. Ela é
    // informativa mas mal calibrada (é o achado comum da literatura de
    // incerteza), então entra como peso relativo suave, nunca como
    // probabilidade: no pior caso ainda vale 0,6 do peso.
    peso *= 0.6 + 0.4 * rampa(entrada.l2csConfianca, 0.15, 0.50);
  }

  return Math.min(1, Math.max(PESO_MINIMO, peso));
}

/**
 * Reescala os pesos para média 1 DENTRO de cada grupo (alvo).
 *
 * É o que impede o peso de virar um voto sobre quais alvos importam — ver o
 * bloco de abertura. Grupo cuja soma de pesos seja não-positiva ou não-finita
 * volta a peso 1, que é o comportamento de "sem informação".
 */
export function normalizarPorGrupo(
  pesos: readonly number[],
  grupos: readonly string[],
): number[] {
  if (pesos.length !== grupos.length) {
    throw new RangeError(
      `[peso] pesos (${pesos.length}) e grupos (${grupos.length}) precisam ter o mesmo comprimento`,
    );
  }
  const soma = new Map<string, number>();
  const conta = new Map<string, number>();
  for (let i = 0; i < pesos.length; i++) {
    const g = grupos[i];
    soma.set(g, (soma.get(g) ?? 0) + pesos[i]);
    conta.set(g, (conta.get(g) ?? 0) + 1);
  }
  return pesos.map((p, i) => {
    const g = grupos[i];
    const s = soma.get(g) ?? 0;
    const n = conta.get(g) ?? 1;
    const media = s / n;
    if (!Number.isFinite(media) || media <= 0) return 1;
    return p / media;
  });
}

/** Resumo dos pesos para o diagnóstico de ajuste. */
export function resumoDePesos(pesos: readonly number[]): {
  medio: number;
  minimo: number;
  fracaoAbaixoDeMeio: number;
} | null {
  if (pesos.length === 0) return null;
  let soma = 0;
  let minimo = Infinity;
  let abaixo = 0;
  for (const p of pesos) {
    soma += p;
    if (p < minimo) minimo = p;
    if (p < 0.5) abaixo++;
  }
  return {
    medio: soma / pesos.length,
    minimo,
    fracaoAbaixoDeMeio: abaixo / pesos.length,
  };
}
