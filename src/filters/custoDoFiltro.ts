/**
 * Função de custo para escolher filtro e parâmetros (sprint S5).
 *
 * ## Por que uma função de custo, e não o olho
 *
 * Filtro não melhora acurácia: ele troca tremor por atraso. Como a troca é
 * explícita, ela pode ser OTIMIZADA em vez de ajustada por sensação — e o
 * estado atual mostra por que isso importa. O preset "estável" do One Euro tem
 * constante de tempo de 7,96 s, o que não é suavização, é memória. E a M1
 * mediu razão de filtro **0,99**: em produção o One Euro praticamente não
 * suaviza. Os dois erros vêm de escolher parâmetro no olho.
 *
 * O artigo do JEMR que propõe esta função mediu o atraso adicionado por filtro:
 * 56 ms de base sem filtro, 2,0–3,1 ms para o triangular, 11,2 ms para o
 * Stampe, 13,6 ms para o Savitzky-Golay — e **0 ms para o Kalman em parâmetros
 * ótimos**, com precisão melhor que a do sinal cru. Quer dizer: existe um ponto
 * de operação onde não se paga nada pela suavização, e ele não se encontra
 * chutando.
 *
 * ## A conta
 *
 *     custo = wE · (dispersão filtrada / dispersão crua) + wL · (atraso / 100 ms)
 *
 * Os dois termos são adimensionais, o que permite somá-los. O primeiro é a
 * razão de filtro que o relatório já reporta (`jitterFilteredRMS / jitterRMS`);
 * o segundo põe o atraso na escala de 100 ms, que é a ordem de grandeza do que
 * uma pessoa percebe como "o cursor está lento".
 *
 * `wL = 3, wE = 1` é o par do artigo: **atraso pesa três vezes mais que
 * tremor**. Para este produto isso é ainda mais verdade do que para o estudo
 * original — quem se comunica por fixação paga o atraso em cada letra.
 */

export interface PesosDoCusto {
  /** Peso da precisão (razão de filtro). */
  wE: number;
  /** Peso do atraso. */
  wL: number;
}

/** O par do artigo: atraso pesa três vezes mais que tremor. */
export const PESOS_PADRAO: PesosDoCusto = { wE: 1, wL: 3 };

/** Escala do termo de atraso, em ms. Ver o bloco de abertura. */
export const ESCALA_DE_ATRASO_MS = 100;

export interface MedidaDoFiltro {
  /** Dispersão do sinal filtrado (RMS amostra-a-amostra, px). */
  dispersaoFiltrada: number;
  /** Dispersão do sinal cru, na mesma unidade. */
  dispersaoCrua: number;
  /** Atraso introduzido pelo filtro, em ms. */
  atrasoMs: number;
}

/**
 * Custo de um ponto de operação. Menor é melhor.
 *
 * `Infinity` quando a medida não permite decidir — dispersão crua não-positiva
 * ou valores não finitos. Devolver um número nesse caso faria a varredura
 * eleger um candidato por causa de um bug de instrumentação.
 */
export function custoDoFiltro(m: MedidaDoFiltro, pesos: PesosDoCusto = PESOS_PADRAO): number {
  const { dispersaoFiltrada, dispersaoCrua, atrasoMs } = m;
  if (!Number.isFinite(dispersaoFiltrada) || !Number.isFinite(dispersaoCrua)) return Infinity;
  if (!Number.isFinite(atrasoMs) || atrasoMs < 0) return Infinity;
  if (!(dispersaoCrua > 0)) return Infinity;
  const razao = dispersaoFiltrada / dispersaoCrua;
  return pesos.wE * razao + pesos.wL * (atrasoMs / ESCALA_DE_ATRASO_MS);
}

/**
 * Atraso de um filtro, medido por correlação cruzada com o sinal de entrada.
 *
 * Procura o deslocamento inteiro de amostras que melhor alinha a saída com a
 * entrada e converte para ms. É a medida honesta para um filtro qualquer:
 * derivar o atraso da constante de tempo só vale para o passa-baixa de primeira
 * ordem, e nem o Kalman nem o estabilizador de fixação são isso.
 *
 * Devolve `null` quando não há sinal suficiente (série curta ou entrada
 * constante, onde toda defasagem correlaciona igual).
 */
export function atrasoPorCorrelacao(
  entrada: readonly number[],
  saida: readonly number[],
  periodoMs: number,
  maxDeslocamento = 15,
): number | null {
  const n = Math.min(entrada.length, saida.length);
  if (n < 8 || !(periodoMs > 0)) return null;

  const media = (v: readonly number[], ini: number, fim: number) => {
    let s = 0;
    for (let i = ini; i < fim; i++) s += v[i];
    return s / (fim - ini);
  };

  // O COMPRIMENTO DA COMPARAÇÃO É O MESMO PARA TODO `d`.
  //
  // O caminho óbvio — comparar `n − d` amostras a cada deslocamento — enviesa o
  // resultado: correlação amostral cresce em janelas curtas, então `d` maior
  // ganharia vantagem e o atraso sairia superestimado. Como o custo pesa o
  // atraso três vezes mais que o tremor, esse viés escolheria o filtro errado.
  const dMax = Math.min(maxDeslocamento, n - 8);
  if (dMax < 0) return null;
  const comprimento = n - dMax;

  let melhor = { d: 0, r: -Infinity };
  for (let d = 0; d <= dMax; d++) {
    const fim = comprimento;
    const mE = media(entrada, 0, fim);
    const mS = media(saida, d, d + comprimento);
    let num = 0;
    let dE = 0;
    let dS = 0;
    for (let i = 0; i < fim; i++) {
      const a = entrada[i] - mE;
      const b = saida[i + d] - mS;
      num += a * b;
      dE += a * a;
      dS += b * b;
    }
    if (!(dE > 0) || !(dS > 0)) continue;
    const r = num / Math.sqrt(dE * dS);
    if (r > melhor.r) melhor = { d, r };
  }

  if (melhor.r === -Infinity) return null;
  return melhor.d * periodoMs;
}

/** RMS das diferenças sucessivas — a medida de tremor que não confunde deriva
 *  com ruído (a mesma `precisionS2S` do relatório). */
export function rmsAmostraAAmostra(v: readonly number[]): number | null {
  if (v.length < 2) return null;
  let soma = 0;
  let n = 0;
  for (let i = 1; i < v.length; i++) {
    const d = v[i] - v[i - 1];
    if (!Number.isFinite(d)) continue;
    soma += d * d;
    n++;
  }
  if (n === 0) return null;
  return Math.sqrt(soma / n) / Math.SQRT2;
}

export interface CandidatoAvaliado<T> {
  parametros: T;
  medida: MedidaDoFiltro;
  custo: number;
}

/**
 * Escolhe o melhor candidato de uma varredura.
 *
 * Empate fica com o de MENOR atraso: entre dois pontos de operação
 * indistinguíveis pelo custo, o que responde mais rápido é o que a pessoa
 * prefere. Devolve `null` quando nenhum candidato tem custo finito — situação
 * que precisa aparecer como "não decidi", nunca como uma escolha arbitrária.
 */
export function escolherMelhorCandidato<T>(
  candidatos: readonly CandidatoAvaliado<T>[],
): CandidatoAvaliado<T> | null {
  let melhor: CandidatoAvaliado<T> | null = null;
  for (const c of candidatos) {
    if (!Number.isFinite(c.custo)) continue;
    if (
      melhor === null ||
      c.custo < melhor.custo ||
      (c.custo === melhor.custo && c.medida.atrasoMs < melhor.medida.atrasoMs)
    ) {
      melhor = c;
    }
  }
  return melhor;
}
