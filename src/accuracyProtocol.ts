/**
 * Protocolo de medição do teste de precisão — os tempos que definem O QUE conta
 * como amostra válida em cada alvo.
 */

/**
 * Janela descartada no início de CADA alvo: fase de sacada + acomodação, em ms.
 *
 * Medido nas 30 amostras/ponto de uma sessão de referência, com cada ponto
 * normalizado pela própria mediana para os cantos não dominarem — erro
 * relativo por instante DENTRO da janela que era considerada útil:
 *
 *     t=400ms  2,03×      t=511ms  1,45×
 *     t=474ms  1,72×      t=585ms  1,03×   ← estabiliza
 *                         t>585ms  ~1,00×
 *
 * Um corte de 400 ms publicava como "fixação" um trecho em que o erro ainda
 * valia o DOBRO do regime estacionário. Efeito de mover o corte (erro por
 * amostra / dispersão): 400ms → 260,0/105,2 · 585ms → 230,3/33,5 · 696ms →
 * 229,2/29,4. O joelho é ~585 ms; daí em diante o ganho é marginal, e 600 é o
 * redondo imediatamente acima.
 *
 * A causa é fisiológica, não do filtro. Rodando a mesma sessão nos três presets
 * do OneEuro, o erro em regime estacionário varia 0,3% (132,6 / 132,7 / 133,0
 * px) e COM a acomodação incluída varia 4% (279,0 / 275,7 / 273,1) — triplicar
 * a responsividade quase não move o tempo de convergência, porque quem manda é
 * a sacada ocular. Não há ganho a procurar no filtro.
 */
export const ACCLIMATION_MS = 600;

/**
 * Duração total da coleta por alvo, em ms — acomodação + janela útil.
 *
 * 2000 ms é o valor do método de teste do Tobii e o que a literatura de
 * qualidade de dado converge a usar; com a acomodação de 600 ms sobram 1400 ms
 * úteis, ~42 amostras a 30 Hz. Com os 800 ms anteriores eram ~24 — pouco para
 * um desvio-padrão estável, e desvio-padrão é metade do que este teste mede.
 *
 * O custo é 13 alvos × 600 ms = 7,8 s a mais por rodada. Para um usuário com
 * ELA fadiga é real, então o teto da sessão inteira (calibração + duas
 * rodadas) continua sendo os 20 minutos que a literatura de ELA usa.
 */
export const COLLECTION_MS = 2000;

/**
 * Fração mínima de amostras válidas na janela útil para o ponto valer.
 *
 * 80% é o critério do Tobii e o mais citado. Abaixo disso o ponto entra no
 * relatório como medido-com-ressalva: o número existe, mas a dispersão foi
 * estimada sobre menos da metade dos quadros esperados.
 */
export const MIN_VALID_SAMPLE_RATIO = 0.8;

/** Quadros esperados na janela útil, dada a taxa efetiva de amostragem. */
export function quadrosEsperados(taxaHz: number): number {
  if (!Number.isFinite(taxaHz) || taxaHz <= 0) return 0;
  return Math.round((COLLECTION_MS - ACCLIMATION_MS) * taxaHz / 1000);
}
