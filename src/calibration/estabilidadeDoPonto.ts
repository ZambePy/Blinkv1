/**
 * Critério de parada da coleta de um alvo (sprint S2).
 *
 * ## O problema
 *
 * A janela de coleta é cega: 1680 ms no centro, 2800 ms nos cantos, tenha a
 * pessoa fixado em 300 ms ou nunca fixado. Quem estabilizou cedo paga o tempo
 * inteiro — e o orçamento de fadiga de um paciente com ELA tem teto de ~40 s
 * para a calibração toda. Quem NÃO estabilizou contamina o treino com a sacada
 * de aproximação, que é rótulo errado com aparência de rótulo bom.
 *
 * Nyström e colegas compararam aceitação automática por tempo, aceitação pelo
 * operador e aceitação pelo participante: a automática por tempo foi a PIOR das
 * três, em acurácia e em precisão.
 *
 * ## O critério, e por que ele não tem unidade
 *
 * A tentação é comparar a dispersão contra um limiar em graus. Isso exigiria
 * converter deslocamento de íris em ângulo, o que depende do raio do globo
 * ocular — um número que este projeto não mede e não deveria chutar.
 *
 * São duas perguntas, ambas **relativas e sem unidade**, e a janela só é
 * declarada estável quando as duas concordam:
 *
 *  1. **A média andou?** Parte-se a janela ao meio e pergunta-se se a média se
 *     moveu mais do que o ruído explicaria:
 *
 *         z = |média(metade nova) − média(metade velha)| / (desvio / √(k/2))
 *
 *  2. **A dispersão é ruído ou é deriva?** É a mesma distinção que a §1.1 de
 *     `docs/MEDICOES.md` já usa para ler um relatório: STD alto com RMS-S2S
 *     baixo significa que o olhar escorregou, não que tremeu. Aqui vira
 *
 *         R = desvio / (RMS das diferenças sucessivas / √2)
 *
 *     que fica perto de 1 em ruído branco e cresce com deriva lenta.
 *
 * As duas juntas porque nenhuma basta sozinha: o z satura — uma rampa pura dá
 * z ≈ 4,2 qualquer que seja o tamanho da deriva, porque a rampa infla o
 * denominador junto com o numerador — e a razão R é cega a um degrau no meio
 * da janela. Uma pega o que a outra deixa passar.
 *
 * Desvio praticamente zero **não** conta como estável: landmark congelado
 * (reflexo travando a íris) produziria z indefinido e passaria como a fixação
 * mais perfeita já vista. Nesse caso o ponto vai até o teto de tempo e o
 * diagnóstico de features mortas cuida do resto.
 *
 * ## O que este critério NÃO resolve
 *
 * Olhar parado no lugar ERRADO é indistinguível de olhar parado no lugar certo
 * — nenhuma estatística de dentro da janela sabe onde o alvo está. Esse caso
 * pertence a `detectOutlierPoints`, que compara o ponto com os outros oito.
 */

/** Amostras na janela deslizante. Par, para partir ao meio sem sobra. */
export const JANELA = 12;

/**
 * Limiares, escolhidos por simulação e não por gosto.
 *
 * Com doze amostras, `max(z)` sobre os dois eixos tem p95 ≈ 3,07 sob ruído
 * branco e `max(R)` tem p95 ≈ 1,43. Varrendo os pares, o ponto de operação
 * escolhido aceita **93% das janelas realmente paradas** e reconhece uma
 * acomodação exponencial de 6σ em **94%** das vezes (12σ em 100%).
 *
 * Os dois erros não são simétricos, e é isso que decide o par:
 *
 *   - **Falso negativo** (fixou e o critério não viu) custa alguns décimos de
 *     segundo: o ponto vai ao teto, que é exatamente o comportamento de hoje.
 *   - **Falso positivo** (fechar com o olho ainda chegando) custa um rótulo
 *     errado no treino, que é caro e invisível.
 *
 * Uma acomodação pequena (3σ) escapa em pouco mais da metade das vezes. É
 * aceito de propósito: 3σ de resíduo é pequeno perto do espaçamento entre
 * alvos, e apertar o limiar para pegá-la derrubaria a aceitação do caso normal.
 */
export const Z_ESTAVEL = 3.0;

/** Limiar da razão STD/RMS-S2S. Ver o bloco acima. */
export const RAZAO_ESTAVEL = 1.5;

function media(v: readonly number[]): number {
  let s = 0;
  for (const x of v) s += x;
  return s / v.length;
}

/** Desvio-padrão amostral (N−1). Zero quando todas as amostras são idênticas. */
function desvio(v: readonly number[], m: number): number {
  if (v.length < 2) return 0;
  let s = 0;
  for (const x of v) s += (x - m) ** 2;
  return Math.sqrt(s / (v.length - 1));
}

/**
 * Piso RELATIVO abaixo do qual o desvio é considerado zero.
 *
 * Não dá para testar `desvio > 0`: doze cópias do mesmo número não somam
 * exatamente doze vezes ele em ponto flutuante, e o desvio de uma série
 * literalmente constante sai em ~1e-17 em vez de 0. Com esse resto, z vira
 * 0/1e-17 = 0 e o landmark CONGELADO passa como a fixação mais perfeita já
 * medida — que é exatamente o caso que esta guarda existe para pegar.
 */
const PISO_RELATIVO_DO_DESVIO = 1e-9;

/** O desvio é grande o bastante para o sinal ser sinal, e não resto de soma? */
function desvioUtil(s: number, escala: number): boolean {
  return s > PISO_RELATIVO_DO_DESVIO * Math.max(1, Math.abs(escala));
}

export interface VeredictoDeEstabilidade {
  estavel: boolean;
  /** O maior z entre os dois eixos. `null` sem janela cheia ou com desvio zero. */
  z: number | null;
  /** A maior razão STD/RMS-S2S entre os dois eixos, na mesma condição. */
  razao: number | null;
  amostras: number;
}

/**
 * Acumula a janela deslizante de um alvo e responde se o olhar já parou.
 *
 * O sinal esperado é o deslocamento da íris — as duas primeiras dimensões do
 * vetor de features, que são justamente `offsetX`/`offsetY`. Qualquer par de
 * números proporcional à direção do olhar serve: o critério é relativo.
 */
export class EstabilidadeDoPonto {
  private readonly xs: number[] = [];
  private readonly ys: number[] = [];

  registrar(x: number, y: number): void {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.xs.push(x);
    this.ys.push(y);
    if (this.xs.length > JANELA) {
      this.xs.shift();
      this.ys.shift();
    }
  }

  reiniciar(): void {
    this.xs.length = 0;
    this.ys.length = 0;
  }

  get tamanho(): number {
    return this.xs.length;
  }

  /** z e razão de um eixo, ou `null` com desvio degenerado. */
  private medidasDoEixo(v: readonly number[]): { z: number; razao: number } | null {
    const meio = v.length >> 1;
    const m = media(v);
    const s = desvio(v, m);
    if (!desvioUtil(s, m)) return null;

    const mVelha = media(v.slice(0, meio));
    const mNova = media(v.slice(meio));
    const erroPadrao = s / Math.sqrt(meio);
    if (!(erroPadrao > 0)) return null;

    // RMS das diferenças sucessivas, dividido por √2 para virar uma estimativa
    // do desvio por amostra: a diferença de duas amostras independentes tem
    // variância dobrada. Cega à deriva lenta de propósito — é a comparação com
    // o desvio total que revela a deriva.
    let somaDif = 0;
    for (let i = 1; i < v.length; i++) somaDif += (v[i] - v[i - 1]) ** 2;
    const s2s = Math.sqrt(somaDif / (v.length - 1)) / Math.SQRT2;
    if (!desvioUtil(s2s, m)) return null;

    return { z: Math.abs(mNova - mVelha) / erroPadrao, razao: s / s2s };
  }

  avaliar(): VeredictoDeEstabilidade {
    const n = this.xs.length;
    if (n < JANELA) return { estavel: false, z: null, razao: null, amostras: n };
    const mx = this.medidasDoEixo(this.xs);
    const my = this.medidasDoEixo(this.ys);
    // Um eixo degenerado (desvio zero) é motivo para NÃO declarar estável:
    // landmark congelado é falha, não fixação perfeita.
    if (!mx || !my) return { estavel: false, z: null, razao: null, amostras: n };
    const z = Math.max(mx.z, my.z);
    const razao = Math.max(mx.razao, my.razao);
    return { estavel: z < Z_ESTAVEL && razao < RAZAO_ESTAVEL, z, razao, amostras: n };
  }
}

export interface DecisaoDeFechamento {
  fechar: boolean;
  motivo: 'estavel' | 'teto' | 'coletando';
}

/**
 * Junta o critério de estabilidade às três condições que não são negociáveis:
 * tempo mínimo cumprido, amostras suficientes e teto de tempo.
 *
 * Pura de propósito — é a regra que decide quanto tempo um paciente com ELA
 * passa olhando para um ponto, e merece teste próprio.
 */
export function decidirFechamento(entrada: {
  decorridoUtilMs: number;
  minUtilMs: number;
  maxUtilMs: number;
  amostrasAceitas: number;
  minAmostras: number;
  estavel: boolean;
}): DecisaoDeFechamento {
  const { decorridoUtilMs, minUtilMs, maxUtilMs, amostrasAceitas, minAmostras, estavel } = entrada;
  // O teto vem primeiro: passou do teto, fecha, mesmo sem amostra e sem
  // estabilidade. Quem trata a falta de amostra é `processStaticPoint`.
  if (decorridoUtilMs >= maxUtilMs) return { fechar: true, motivo: 'teto' };
  if (decorridoUtilMs < minUtilMs) return { fechar: false, motivo: 'coletando' };
  if (amostrasAceitas < minAmostras) return { fechar: false, motivo: 'coletando' };
  if (estavel) return { fechar: true, motivo: 'estavel' };
  return { fechar: false, motivo: 'coletando' };
}
