/**
 * Protocolo de medição do teste de precisão — os tempos que definem O QUE conta
 * como amostra válida em cada alvo.
 *
 * POR QUE É UM MÓDULO PRÓPRIO
 *
 * Estas duas constantes existiam duplicadas: uma em `accuracy.ts` (teste ao
 * vivo) e outra em `scripts/_replay_impl.ts`, esta última com um comentário
 * dizendo "espelha `ACCLIMATION_MS` em accuracy.ts". Espelho mantido à mão
 * diverge — e quando diverge, replay e teste ao vivo passam a medir coisas
 * diferentes em silêncio, que é exatamente o que os dois existem para poder
 * comparar. Agora há uma fonte só, e ela não pode sair de sincronia.
 *
 * O módulo é puro de propósito (sem imports, sem DOM): o replay roda em Node e
 * precisa dessas constantes sem arrastar junto o código de browser.
 */

/**
 * Janela descartada no início de CADA alvo: fase de sacada + acomodação, em ms.
 *
 * 400 → 600. Os 400 ms originais não cobriam a fase que se propunham a excluir.
 * Medido nas 30 amostras/ponto de `accuracy-report-1788225161304`, com cada
 * ponto normalizado pela própria mediana para os cantos não dominarem — erro
 * relativo por instante DENTRO da janela que era considerada útil:
 *
 *     t=400ms  2,03×      t=511ms  1,45×
 *     t=474ms  1,72×      t=585ms  1,03×   ← estabiliza
 *                         t>585ms  ~1,00×
 *
 * A métrica publicava como "fixação" um trecho em que o erro ainda valia o
 * DOBRO do regime estacionário. Efeito de mover o corte (erro por amostra /
 * dispersão): 400ms → 260,0/105,2 · 585ms → 230,3/33,5 · 696ms → 229,2/29,4.
 * O joelho é ~585 ms; daí em diante o ganho é marginal, e 600 é o redondo
 * imediatamente acima.
 *
 * A causa é fisiológica, não do filtro. Rodando a mesma sessão nos três presets
 * do OneEuro, o erro em regime estacionário varia 0,3% (132,6 / 132,7 / 133,0
 * px) e COM a acomodação incluída varia 4% (279,0 / 275,7 / 273,1) — triplicar
 * a responsividade quase não move o tempo de convergência, porque quem manda é
 * a sacada ocular. Não há ganho a procurar no filtro.
 *
 * MEDIÇÃO INDEPENDENTE (A1, do replay — motivou o valor original de 400 e
 * continua valendo). Erro mediano por posição dentro da janela de cada alvo, na
 * gravação de referência:
 *
 *   posição     0    1    2    3    4    5    6    7    8    9   10   11   12+
 *   mediana   452  451  450  450  450  454  456  456  304  150   97   90   ~50
 *
 * Plano em ~450 px por oito quadros e depois despenca. Sacada EM VOO daria
 * rampa; um platô é o olho ainda parado no alvo ANTERIOR — confirmado em 7 das
 * 8 transições, onde nesses quadros a predição está mais perto do alvo anterior
 * que do atual (num caso, 983 px do atual contra 103 px do anterior). O
 * argumento de que "o dot já está visível, logo o frame tem ground-truth
 * legítimo" não se sustenta: o dot estar visível não é o usuário estar olhando,
 * e a latência de sacada humana é ~250 ms.
 *
 * As duas medições contam a mesma história em escalas diferentes: ~0–264 ms o
 * olho ainda está no alvo anterior, ~264–400 ms é a sacada, e até ~585 ms é a
 * estabilização fina que o corte de 400 ms deixava passar.
 *
 * ⚠️ Isto corrige o INSTRUMENTO, não o produto: o número reportado melhora e o
 * app continua igual. Relatórios gerados antes desta mudança NÃO são
 * comparáveis com os de depois. É a mesma correção que `25b582f` aplicou ao
 * replay ("descarta a janela de acomodacao, que respondia por 58% do
 * baseline"); o teste ao vivo tinha ficado para trás.
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
