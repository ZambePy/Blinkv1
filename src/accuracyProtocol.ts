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
 * Mantido em 1400 ao subir a acomodação: a janela útil cai de 1000 para 800 ms
 * (~24 amostras a 30 Hz), o que sobra depois da estabilização, e não acrescenta
 * tempo de sessão. Para um usuário com ELA, alongar a coleta é fadiga real, não
 * inconveniente — se um dia for preciso mais amostra útil, o custo de subir
 * este número é 13 alvos × Δ, e a conta tem de ser feita explicitamente.
 */
export const COLLECTION_MS = 1400;
