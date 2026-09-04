// P7.3 — piscada como clique.
//
// ── Por que este módulo é o mais perigoso do sprint ─────────────────────────
//
// Piscar é **involuntário**. Uma pessoa pisca 15 a 20 vezes por minuto sem
// decidir nada, e o público-alvo tem ELA — onde a piscada pode ser um dos
// poucos movimentos voluntários restantes, mas continua acontecendo sozinha o
// tempo todo.
//
// Um clique acidental num teclado ocular escreve uma letra errada. Num botão de
// emergência, chama socorro. A especificação do plano é explícita sobre isso:
// *"para ELA, um clique acidental num botão de emergência é um evento sério"*.
//
// Por isso o módulo é construído em torno das GUARDAS, não do gatilho:
//
//   1. **Desligado por default.** A flag `blinkClick` nasce `false`. Nenhum
//      paciente ganha isto sem alguém decidir que ele quer.
//   2. **Gaze estável sobre um alvo.** Piscar olhando para o nada não faz
//      nada. Exige um alvo e exige que o olhar já esteja parado nele.
//   3. **Duração mínima E máxima.** Piscada espontânea dura 100–150 ms; a
//      voluntária é mais longa. Abaixo do piso, ignora. E há um TETO: acima
//      dele é olho fechado (descanso, espasmo), não intenção.
//   4. **Período refratário.** Depois de um clique, uma janela em que
//      nenhum outro é aceito — senão uma rajada de piscadas vira uma rajada
//      de cliques.
//   5. **Nunca em alvo de emergência.** Este é o único que não é
//      configurável. O custo de um falso positivo ali é grande demais, e o
//      dwell longo continua sendo o caminho para a emergência.

/** Duração mínima da piscada para contar como intenção, em ms. */
export const BLINK_CLICK_MIN_MS = 150;

/**
 * Duração MÁXIMA, em ms.
 *
 * Acima disto o olho está fechado, não piscando. Sem teto, um paciente
 * descansando os olhos por três segundos dispararia um clique ao reabrir.
 */
export const BLINK_CLICK_MAX_MS = 800;

/** Tempo que o olhar precisa estar parado no alvo antes de a piscada valer. */
export const BLINK_CLICK_ESTABILIDADE_MS = 300;

/** Janela após um clique em que nenhum outro é aceito. */
export const BLINK_CLICK_REFRATARIO_MS = 1000;

export interface EntradaBlinkClick {
  /** O detector de piscada acusou este quadro. Vem do `BlinkDetector`, que já
   *  tem o limiar adaptativo por pessoa (`P5.4`) — duplicar o critério aqui
   *  daria duas respostas para a mesma pergunta. */
  piscando: boolean;
  nowMs: number;
  /** Alvo sob o cursor, ou `null`. Identidade estável (o próprio nó). */
  alvo: unknown | null;
  /** O alvo é de emergência. Piscada NUNCA aciona emergência. */
  alvoEhEmergencia: boolean;
}

export interface EstadoBlinkClick {
  /** Início do episódio de piscada corrente, ou `null`. */
  piscandoDesde: number | null;
  /** Alvo em que o olhar está parado, e desde quando. */
  alvoEstavel: unknown | null;
  alvoEstavelDesde: number | null;
  /** Enquanto `now < refratarioAte`, nenhum clique é aceito. */
  refratarioAte: number;
}

export interface ResultadoBlinkClick {
  estado: EstadoBlinkClick;
  /** Alvo clicado neste quadro, ou `null`. */
  clicou: unknown | null;
  /**
   * Por que NÃO clicou, quando havia uma piscada terminando. `null` quando não
   * havia piscada ou quando clicou.
   *
   * Existe para o diagnóstico: sem isto, "a piscada não funcionou" é
   * indistinguível de "a piscada não foi detectada", e o cuidador não tem como
   * ajudar o paciente a acertar o gesto.
   */
  motivoRejeicao: MotivoRejeicao | null;
}

export type MotivoRejeicao =
  | 'curta-demais'
  | 'longa-demais'
  | 'sem-alvo'
  | 'alvo-instavel'
  | 'alvo-de-emergencia'
  | 'refratario';

export interface OpcoesBlinkClick {
  minMs?: number;
  maxMs?: number;
  estabilidadeMs?: number;
  refratarioMs?: number;
}

export function criarEstadoBlinkClick(): EstadoBlinkClick {
  return {
    piscandoDesde: null,
    alvoEstavel: null,
    alvoEstavelDesde: null,
    refratarioAte: 0,
  };
}

/**
 * Um quadro da máquina de estados. Pura: recebe o estado, devolve o novo.
 *
 * O clique é emitido no FIM da piscada (transição piscando → aberto), não no
 * começo. Duas razões: só no fim se conhece a duração, que é o critério que
 * separa intenção de reflexo; e disparar no começo tornaria impossível
 * cancelar um gesto acidental.
 */
export function stepBlinkClick(
  estado: EstadoBlinkClick,
  entrada: EntradaBlinkClick,
  opts: OpcoesBlinkClick = {},
): ResultadoBlinkClick {
  const minMs = opts.minMs ?? BLINK_CLICK_MIN_MS;
  const maxMs = opts.maxMs ?? BLINK_CLICK_MAX_MS;
  const estabilidadeMs = opts.estabilidadeMs ?? BLINK_CLICK_ESTABILIDADE_MS;
  const refratarioMs = opts.refratarioMs ?? BLINK_CLICK_REFRATARIO_MS;

  const novo: EstadoBlinkClick = { ...estado };

  // ── Estabilidade do alvo ────────────────────────────────────────────────
  //
  // Rastreada SEMPRE, inclusive durante a piscada. Se zerasse ao piscar, a
  // guarda seria inútil: com o olho fechado não há gaze, então o alvo
  // "sumiria" e nenhuma piscada jamais passaria.
  if (entrada.alvo !== null && entrada.alvo === novo.alvoEstavel) {
    // Continua no mesmo alvo — o relógio segue correndo.
  } else if (entrada.alvo !== null) {
    novo.alvoEstavel = entrada.alvo;
    novo.alvoEstavelDesde = entrada.nowMs;
  } else if (estado.piscandoDesde === null && !entrada.piscando) {
    // Perdeu o alvo FORA de uma piscada: zera. Durante a piscada, preserva.
    //
    // ⚠️ A condição precisa olhar `entrada.piscando`, não só
    // `estado.piscandoDesde`. No PRIMEIRO quadro da piscada o estado ainda não
    // registrou o episódio (ele é marcado mais abaixo nesta mesma função),
    // então checar só o estado limpava a âncora justo no quadro em que o alvo
    // some — e nenhuma piscada jamais passava pela guarda de estabilidade.
    //
    // A guarda mataria a funcionalidade inteira em vez de protegê-la, e o
    // sintoma seria "piscada como clique não funciona", sem pista de por quê.
    novo.alvoEstavel = null;
    novo.alvoEstavelDesde = null;
  }

  // ── Borda de subida: começou a piscar ───────────────────────────────────
  if (entrada.piscando) {
    if (novo.piscandoDesde === null) novo.piscandoDesde = entrada.nowMs;
    return { estado: novo, clicou: null, motivoRejeicao: null };
  }

  // ── Borda de descida: terminou a piscada ────────────────────────────────
  if (estado.piscandoDesde === null) {
    return { estado: novo, clicou: null, motivoRejeicao: null };
  }

  const duracao = entrada.nowMs - estado.piscandoDesde;
  novo.piscandoDesde = null;

  const rejeitar = (motivo: MotivoRejeicao): ResultadoBlinkClick =>
    ({ estado: novo, clicou: null, motivoRejeicao: motivo });

  if (entrada.nowMs < estado.refratarioAte) return rejeitar('refratario');
  if (duracao < minMs) return rejeitar('curta-demais');
  if (duracao > maxMs) return rejeitar('longa-demais');

  const alvo = novo.alvoEstavel;
  if (alvo === null) return rejeitar('sem-alvo');
  if (entrada.alvoEhEmergencia) return rejeitar('alvo-de-emergencia');

  const estavelPor = novo.alvoEstavelDesde === null
    ? 0
    : estado.piscandoDesde - novo.alvoEstavelDesde;
  if (estavelPor < estabilidadeMs) return rejeitar('alvo-instavel');

  novo.refratarioAte = entrada.nowMs + refratarioMs;
  return { estado: novo, clicou: alvo, motivoRejeicao: null };
}
