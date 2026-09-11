/**
 * Veredito da checagem de retomada.
 *
 * ## O que esta checagem NÃO faz
 *
 * Não mede precisão. Com três alvos o ruído é grande demais para separar 2,5°
 * de 3,2°. O que ela detecta é **mudança grosseira**: pessoa diferente, monitor
 * movido, paciente 20 cm mais longe, perfil trocado.
 *
 * A tela diz isso com todas as letras. Um número de três pontos apresentado
 * como medição vira dado ruim no acompanhamento clínico, e depois ninguém
 * consegue distingui-lo de uma medição de verdade.
 *
 * ## Por que o veredito é relativo
 *
 * As seis sessões reais do repositório dão erro entre 1,86° e 3,74°, todas de
 * um setup só. Um limiar absoluto não seria honesto com isso: "reprovar acima
 * de 3°" reprovaria metade delas, e "acima de 4°" nunca dispararia.
 *
 * A comparação é com a **primeira checagem feita contra a mesma calibração** —
 * mesma grandeza, medida do mesmo jeito, no mesmo posto de uso.
 */

/**
 * Quanto o erro pode crescer antes de virar aviso.
 *
 * Derivado do ruído esperado de três pontos, não de sessões em que a
 * calibração de fato estragou — essas não existem no repositório. ⚠️ Precisa de
 * revisão quando houver.
 */
export const FATOR_DE_ALERTA = 1.6;

/**
 * Fração do teto da correção por dwell acima da qual o deslocamento acumulado
 * deixa de ser deriva normal (sprint S3 / macete B2).
 *
 * A correção por dwell persegue o deslocamento sozinha e, enquanto ela dá
 * conta, ninguém precisa recalibrar. O sinal de que ela NÃO está dando conta é
 * o deslocamento colado no próprio teto: significa que a correção está pedindo
 * mais do que pode entregar, e o que mudou não é deriva — é a cadeira, a luz ou
 * a distância. É esse o momento de pedir recalibração, e não o relógio.
 *
 * 0,75 do teto: perto o bastante para avisar antes de saturar, longe o bastante
 * para não disparar num dia de uso normal.
 */
export const FRACAO_DO_TETO_QUE_ALERTA = 0.75;

export type VeredictoDaChecagem = 'seguir' | 'atencao' | 'recalibrar';

export interface EntradaDaChecagem {
  /** Erro medido nos três alvos, em graus. `null` = não deu para medir. */
  erroDeg: number | null;
  /** Erro da primeira checagem contra esta calibração. `null` = é a primeira. */
  referenciaDeg: number | null;
  rostoEnquadrado: boolean;
  distanciaNaFaixa: boolean;
  /**
   * Deslocamento que a correção por dwell precisou acumular, como fração do
   * teto dela (0..1). `null` quando a correção está desligada ou nunca
   * aprendeu nada — e aí este critério simplesmente não opina.
   */
  fracaoDoTetoDaCorrecao?: number | null;
}

export interface ResultadoDoVeredicto {
  veredicto: VeredictoDaChecagem;
  /** Sufixo da chave i18n do motivo. `null` quando não há o que explicar. */
  motivo: string | null;
}

export function veredictoDaChecagem(e: EntradaDaChecagem): ResultadoDoVeredicto {
  // 1. A POSIÇÃO VEM ANTES DA MEDIDA. Não adianta medir o olhar de quem não
  //    está no lugar: o erro mediria a posição, não a calibração — e um erro
  //    bom com a posição errada está certo por acaso.
  if (!e.rostoEnquadrado) return { veredicto: 'recalibrar', motivo: 'posicaoRosto' };
  if (!e.distanciaNaFaixa) return { veredicto: 'recalibrar', motivo: 'posicaoDistancia' };

  // 2. Sem medição não há aprovação: seguir aqui seria aprovar no escuro.
  if (e.erroDeg === null || !Number.isFinite(e.erroDeg)) {
    return { veredicto: 'recalibrar', motivo: 'semMedicao' };
  }

  // 3. A PRIMEIRA CHECAGEM NUNCA REPROVA — ela estabelece a referência. Não há
  //    com o que comparar, e reprovar aqui reprovaria uma calibração
  //    recém-feita, jogando o cuidador num laço de recalibrar sem fim.
  //
  //    Referência ausente, zero ou negativa cai no mesmo caso: uma referência
  //    de 0° é implausível, e comparar contra ela reprovaria tudo para sempre.
  const temReferencia =
    e.referenciaDeg !== null && Number.isFinite(e.referenciaDeg) && e.referenciaDeg > 0;
  if (!temReferencia) return { veredicto: 'seguir', motivo: null };

  // 4. O deslocamento acumulado saturou? Vem ANTES da comparação de erro
  //    porque é um sinal independente e mais específico: o erro de três alvos
  //    pode estar bom justamente PORQUE a correção está segurando a barra, e
  //    nesse caso o critério de baixo aprovaria uma situação que já está no
  //    limite. Só opina quando há número.
  const fracao = e.fracaoDoTetoDaCorrecao;
  if (typeof fracao === 'number' && Number.isFinite(fracao) && fracao >= FRACAO_DO_TETO_QUE_ALERTA) {
    return { veredicto: 'atencao', motivo: 'deslocamentoAcumulado' };
  }

  // 5. Piorou o bastante para avisar. `atencao` e não `recalibrar`: reprovar
  //    sozinho tiraria a decisão do cuidador, que sabe coisas que o software
  //    não sabe. O que muda com "muito pior" é a ênfase, não o poder.
  if (e.erroDeg > (e.referenciaDeg as number) * FATOR_DE_ALERTA) {
    return { veredicto: 'atencao', motivo: 'piorou' };
  }

  return { veredicto: 'seguir', motivo: null };
}
