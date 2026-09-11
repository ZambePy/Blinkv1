/**
 * Calibração por perseguição suave (sprint S8).
 *
 * ## O que é
 *
 * Em vez de nove pontos parados, um alvo que percorre a tela devagar. A
 * correspondência entre olhar e alvo sai da correlação de Pearson numa janela
 * deslizante: se o coeficiente passa do limiar nos dois eixos, a pessoa estava
 * seguindo, e cada instante daquele trecho vira uma amostra com rótulo.
 *
 * Pfeuffer e colegas (UIST 2013) chegaram a menos de 1° com dez segundos de
 * perseguição — equivalente ao procedimento de cinco pontos de um Tobii, que
 * leva dezenove. Sete segundos já bastavam.
 *
 * ## Por que vale para ESTE produto
 *
 * Duas razões, e a segunda é a que importa mais.
 *
 * A primeira é a cobertura: nove alvos dão nove aglomerados de amostras, e o
 * Ridge extrapola entre eles — foi isso que a M1 mostrou com LOO de 67,8 px
 * contra treino de 21,3 px. Uma varredura contínua cobre a tela inteira.
 *
 * A segunda é quem consegue fazer. Fixar um ponto parado exige controle
 * voluntário sustentado, e há trabalho específico mostrando que a perseguição
 * resolve justamente os participantes difíceis de calibrar. Mais: o jogo
 * `FollowTarget` já é uma sessão de perseguição com rótulo conhecido a cada
 * quadro — dá para colher calibração de dentro da brincadeira, sem chamar de
 * calibração e sem gastar um minuto a mais do paciente.
 *
 * ## O limite clínico, que não é detalhe
 *
 * Perseguição suave depende de via oculomotora preservada, e em ELA avançada e
 * em algumas lesões de tronco ela degrada ANTES da fixação. Para essas pessoas
 * este método é pior que o de pontos — e em silêncio, que é o problema. O
 * limiar de correlação é a proteção: correlação baixa significa que a pessoa
 * não seguiu, e nesse caso `colher` devolve pouca ou nenhuma amostra. Quem
 * chama precisa tratar isso como "não deu", cair para o método de pontos e
 * dizer isso na tela — nunca treinar com o que sobrou.
 */

export interface AmostraDePerseguicao {
  /** Posição do olhar (unidades quaisquer, consistentes entre si). */
  olhar: { x: number; y: number };
  /** Posição do alvo no mesmo instante, em fração de tela (0..1). */
  alvo: { x: number; y: number };
  /** Relógio em ms. */
  t: number;
}

/**
 * Velocidade máxima do alvo, em graus por segundo.
 *
 * Acima de ~30°/s o olho não sustenta a perseguição e passa a fazer sacadas de
 * recuperação — o sinal deixa de ser perseguição e vira uma escada. É limite
 * fisiológico, não escolha de projeto.
 */
export const VELOCIDADE_MAX_DEG_POR_SEG = 30;

/**
 * Janela de correlação, em ms.
 *
 * O artigo indica 80–160 ms — mas ele mede com um rastreador de centenas de Hz,
 * onde isso são dezenas de amostras. A **30 Hz**, 160 ms dão CINCO amostras, e
 * com cinco amostras uma correlação acima de 0,6 acontece por puro acaso em
 * 14% das janelas (simulado, ruído contra rampa). O critério aceitaria quase
 * metade de uma sessão em que a pessoa nem olhou para o alvo — foi exatamente
 * o que o teste mostrou.
 *
 * 400 ms dão doze amostras e derrubam o acaso para 2%. É o mesmo limiar do
 * artigo com a mesma estatística por trás; o que muda é a taxa de amostragem
 * deste pipeline.
 */
export const JANELA_MS = 400;

/**
 * Duração mínima de um trecho aceito, em ms.
 *
 * Segunda barreira contra o acaso: mesmo a 2% por janela, uma sessão longa tem
 * muitas janelas, e as que passam por sorte aparecem isoladas. Perseguição de
 * verdade produz trechos longos e contíguos — meio segundo é o piso do que
 * merece o nome.
 */
export const MIN_DURACAO_DO_TRECHO_MS = 500;

/**
 * Limiar da correlação de Pearson, por eixo.
 *
 * O artigo varre de 0,3 a 0,7 conforme a aplicação. 0,6 aqui: o custo de
 * aceitar um trecho em que a pessoa NÃO seguiu é treinar com rótulo errado, e
 * este produto não tem como perceber isso depois.
 */
export const LIMIAR_CORRELACAO = 0.6;

/** Amostras mínimas numa janela para a correlação significar alguma coisa. */
export const MIN_AMOSTRAS_NA_JANELA = 8;

/**
 * Deslocamento mínimo do ALVO num eixo, em fração de tela, para aquele eixo
 * ter voto na janela.
 *
 * Numa trajetória retangular há trechos em que o alvo só se move em X — e ali
 * a correlação em Y é ruído dividido por ruído. Exigir correlação num eixo
 * parado rejeitaria justamente os trechos retos, que são a maior parte do
 * percurso. Meio por cento de tela é pequeno o bastante para não descartar
 * nada útil e grande o bastante para não deixar ruído votar.
 */
export const MOVIMENTO_MINIMO_DO_ALVO = 0.005;

/**
 * Correlação de Pearson entre duas séries.
 *
 * `null` quando alguma delas não varia: com o alvo parado ou o olhar
 * congelado, toda defasagem correlaciona igual e o coeficiente não tem
 * significado. Devolver 0 ali seria pior — 0 se lê como "não seguiu", e a
 * causa real é outra.
 */
export function pearson(a: readonly number[], b: readonly number[]): number | null {
  const n = Math.min(a.length, b.length);
  if (n < 2) return null;
  let sa = 0;
  let sb = 0;
  for (let i = 0; i < n; i++) {
    sa += a[i];
    sb += b[i];
  }
  const ma = sa / n;
  const mb = sb / n;
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < n; i++) {
    const x = a[i] - ma;
    const y = b[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (!(da > 0) || !(db > 0)) return null;
  const r = num / Math.sqrt(da * db);
  return Number.isFinite(r) ? r : null;
}

export interface TrechoSeguido {
  /** Índice inicial (inclusivo) e final (exclusivo) na série de entrada. */
  ini: number;
  fim: number;
  /** A menor das duas correlações do trecho — a que decidiu. */
  correlacao: number;
}

/**
 * Encontra os trechos em que a pessoa de fato seguiu o alvo.
 *
 * Percorre a série com uma janela deslizante de `JANELA_MS` e aceita a janela
 * quando a correlação passa do limiar em TODO EIXO EM QUE O ALVO SE MOVEU.
 *
 * A regra tem essa forma por um motivo concreto: numa trajetória retangular,
 * durante um trecho horizontal o alvo não se move em Y, e ali a correlação
 * vertical é ruído dividido por ruído. Exigir os dois eixos sempre rejeitaria
 * os trechos retos — que são quase todo o percurso — e sobrariam só os cantos.
 * Exigir só um eixo, no outro extremo, aceitaria alguém que segue em X e
 * ignora Y. Cobrar de cada eixo apenas quando ele tem o que cobrar é o que
 * pega o segundo caso sem perder o primeiro: nos trechos VERTICAIS, esse
 * mesmo alguém é rejeitado.
 *
 * As janelas aceitas e contíguas são fundidas, para o resultado descrever
 * "trechos de perseguição" e não "janelas".
 */
export function trechosSeguidos(
  amostras: readonly AmostraDePerseguicao[],
  opcoes?: { janelaMs?: number; limiar?: number; minDuracaoMs?: number },
): TrechoSeguido[] {
  const janelaMs = opcoes?.janelaMs ?? JANELA_MS;
  const limiar = opcoes?.limiar ?? LIMIAR_CORRELACAO;
  const out: TrechoSeguido[] = [];
  if (amostras.length < MIN_AMOSTRAS_NA_JANELA) return out;

  let ini = 0;
  for (let fim = MIN_AMOSTRAS_NA_JANELA; fim <= amostras.length; fim++) {
    // Encolhe pela esquerda até a janela caber no tempo.
    while (ini < fim - MIN_AMOSTRAS_NA_JANELA &&
           amostras[fim - 1].t - amostras[ini].t > janelaMs) {
      ini++;
    }
    const trecho = amostras.slice(ini, fim);
    if (trecho.length < MIN_AMOSTRAS_NA_JANELA) continue;

    const amplitude = (v: number[]) => Math.max(...v) - Math.min(...v);
    const alvoX = trecho.map((a) => a.alvo.x);
    const alvoY = trecho.map((a) => a.alvo.y);

    const rs: number[] = [];
    let algumEixoVotou = false;
    if (amplitude(alvoX) >= MOVIMENTO_MINIMO_DO_ALVO) {
      algumEixoVotou = true;
      const r = pearson(trecho.map((a) => a.olhar.x), alvoX);
      if (r === null) continue;
      rs.push(r);
    }
    if (amplitude(alvoY) >= MOVIMENTO_MINIMO_DO_ALVO) {
      algumEixoVotou = true;
      const r = pearson(trecho.map((a) => a.olhar.y), alvoY);
      if (r === null) continue;
      rs.push(r);
    }
    // Alvo parado nos dois eixos: a janela não diz nada sobre perseguição.
    if (!algumEixoVotou) continue;

    const menor = Math.min(...rs);
    if (menor < limiar) continue;

    const ultimo = out[out.length - 1];
    if (ultimo && ini <= ultimo.fim) {
      ultimo.fim = fim;
      ultimo.correlacao = Math.min(ultimo.correlacao, menor);
    } else {
      out.push({ ini, fim, correlacao: menor });
    }
  }

  // Descarta os trechos curtos: são as janelas que passaram por sorte. Ver
  // `MIN_DURACAO_DO_TRECHO_MS`.
  const minMs = opcoes?.minDuracaoMs ?? MIN_DURACAO_DO_TRECHO_MS;
  return out.filter((t) => amostras[t.fim - 1].t - amostras[t.ini].t >= minMs);
}

export interface AmostraColhida {
  /**
   * Posição da amostra na série de ENTRADA.
   *
   * O casamento é por índice, e não por identidade do objeto `olhar`, porque
   * identidade se perde no primeiro `structuredClone`, `JSON.parse` ou
   * espalhamento que alguém escrever no caminho — e o modo de falha seria
   * silencioso: nenhuma amostra casaria, a sessão inteira seria descartada
   * como se a pessoa não tivesse conseguido perseguir.
   */
  indice: number;
  olhar: { x: number; y: number };
  /** O alvo naquele instante — vira o rótulo de treino. */
  alvo: { x: number; y: number };
}

/**
 * Lado da célula usada para agrupar amostras de perseguição, em fração de tela.
 *
 * O rótulo de treino continua sendo a posição CONTÍNUA do alvo — é isso que dá
 * à perseguição a cobertura que nove pontos não têm. A célula existe só para a
 * validação cruzada ter grupos com muitas amostras: sem ela, cada quadro seria
 * um grupo, o leave-one-target-out viraria leave-one-sample-out e o treino
 * custaria o quadrado do número de quadros.
 *
 * Um quinto de tela dá uma grade de 5×5 — mais grupos que os nove alvos da
 * grade estática, e cada um com dezenas de amostras.
 */
export const LADO_DA_CELULA = 0.2;

/** Chave do grupo de validação cruzada de uma posição de alvo. */
export function celulaDoAlvo(alvo: { x: number; y: number }): string {
  const c = (v: number) => Math.min(4, Math.max(0, Math.floor(v / LADO_DA_CELULA)));
  return `perseguicao:${c(alvo.x)},${c(alvo.y)}`;
}

export interface ResultadoDaColheita {
  amostras: AmostraColhida[];
  /** Fração das amostras de entrada que caiu em trecho seguido. */
  fracaoSeguida: number;
  /** Correlação típica dos trechos aceitos. `null` sem nenhum trecho. */
  correlacaoMediana: number | null;
}

/**
 * Colhe as amostras utilizáveis de uma sessão de perseguição.
 *
 * `fracaoSeguida` é o número que decide se a sessão vale: perto de zero
 * significa que a pessoa não conseguiu perseguir, e aí o resultado precisa ser
 * descartado inteiro — não usado "porque alguma coisa veio".
 */
export function colher(
  amostras: readonly AmostraDePerseguicao[],
  opcoes?: { janelaMs?: number; limiar?: number; minDuracaoMs?: number },
): ResultadoDaColheita {
  const trechos = trechosSeguidos(amostras, opcoes);
  const out: AmostraColhida[] = [];
  const usada = new Set<number>();
  for (const t of trechos) {
    for (let i = t.ini; i < t.fim; i++) {
      if (usada.has(i)) continue;
      usada.add(i);
      out.push({ indice: i, olhar: amostras[i].olhar, alvo: amostras[i].alvo });
    }
  }
  const rs = trechos.map((t) => t.correlacao).sort((a, b) => a - b);
  return {
    amostras: out,
    fracaoSeguida: amostras.length > 0 ? usada.size / amostras.length : 0,
    correlacaoMediana: rs.length > 0 ? rs[rs.length >> 1] : null,
  };
}

/**
 * Trajetória retangular pelas bordas, a VELOCIDADE CONSTANTE.
 *
 * Devolve a posição do alvo em fração de tela para um instante `tMs` desde o
 * início. O retângulo é o do artigo.
 *
 * A parametrização é por COMPRIMENTO DE ARCO, não por lado. Dividir o tempo em
 * quatro trechos iguais parece natural e está errado: numa tela 16:9 o lado
 * horizontal é 1,8 vez mais longo que o vertical, então percorrê-los no mesmo
 * tempo faria o alvo correr 1,28 vez acima da média nos trechos horizontais.
 * Uma trajetória "medida" em 25°/s picaria em 32°/s — acima do limite
 * fisiológico que `velocidadeDegPorSeg` existe justamente para respeitar, e
 * fora do olhar da função que a verifica.
 *
 * `proporcaoDaTela` é a razão altura/largura em PIXELS: sem ela não há como
 * saber quanto cada lado mede de verdade. O default 9/16 cobre a tela comum.
 */
export function posicaoNaTrajetoria(
  tMs: number,
  duracaoMs: number,
  margem = 0.12,
  proporcaoDaTela = 9 / 16,
): { x: number; y: number } {
  const a = margem;
  const b = 1 - margem;
  const cantos = [
    { x: a, y: a }, { x: b, y: a }, { x: b, y: b }, { x: a, y: b }, { x: a, y: a },
  ];

  // Comprimento de cada lado em unidades de LARGURA de tela: o lado vertical
  // vale (b−a)·proporção, porque uma fração da altura é fisicamente menor.
  const lado = b - a;
  const comprimentos = [lado, lado * proporcaoDaTela, lado, lado * proporcaoDaTela];
  const perimetro = comprimentos.reduce((s, c) => s + c, 0);

  const total = Math.max(1, duracaoMs);
  const percorrido = Math.min(1, Math.max(0, tMs / total)) * perimetro;

  let restante = percorrido;
  for (let i = 0; i < 4; i++) {
    if (restante <= comprimentos[i] || i === 3) {
      const f = comprimentos[i] > 0 ? Math.min(1, restante / comprimentos[i]) : 0;
      return {
        x: cantos[i].x + (cantos[i + 1].x - cantos[i].x) * f,
        y: cantos[i].y + (cantos[i + 1].y - cantos[i].y) * f,
      };
    }
    restante -= comprimentos[i];
  }
  return { ...cantos[4] };
}

/**
 * Velocidade angular da trajetória, em graus por segundo.
 *
 * Com a parametrização por comprimento de arco de `posicaoNaTrajetoria`, a
 * velocidade é constante — então esta é a velocidade, não uma média que
 * esconde picos.
 *
 * Serve para o chamador checar o limite fisiológico ANTES de mostrar o alvo:
 * uma trajetória rápida demais não produz perseguição, produz uma escada de
 * sacadas — e o resultado seria descartado depois por correlação baixa, com o
 * paciente já cansado.
 */
export function velocidadeDegPorSeg(
  duracaoMs: number,
  larguraPx: number,
  alturaPx: number,
  pxPorGrau: number,
  margem = 0.12,
): number | null {
  if (!(duracaoMs > 0) || !(pxPorGrau > 0)) return null;
  const l = (1 - 2 * margem) * larguraPx;
  const a = (1 - 2 * margem) * alturaPx;
  const perimetroPx = 2 * (l + a);
  return (perimetroPx / pxPorGrau) / (duracaoMs / 1000);
}
