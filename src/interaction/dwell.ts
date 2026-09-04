/**
 * Dispatcher de dwell — política pura, testável, sem DOM e sem relógio próprio.
 *
 * Esta lógica clica em nome do usuário: para alguém com ELA, um clique
 * indevido é uma ação que a pessoa não consegue desfazer. Três invariantes
 * críticas:
 *
 * - Sem calibração o cursor é fallback do nariz — `uncalibrated` bloqueia
 *   TUDO, inclusive emergência (permitir emergência sobre sinal sem relação
 *   com o olhar é disparar alarme por acaso).
 * - Progresso acumula APENAS o intervalo entre amostras válidas consecutivas;
 *   fechar os olhos ou perder o rosto PAUSA (congela), não conta como olhar
 *   fixo.
 * - O refratário é armado ANTES de o callback do chamador executar, para que
 *   um handler que lança não deixe estado sujo re-disparando.
 */

/** Estado ocular vindo do engine. `unknown` = build antigo / sem informação. */
export type EyeState = 'open' | 'closed' | 'unknown';

export interface DwellSample {
  x: number;
  y: number;
  /** ms monotônicos (`performance.now()`), carimbados pelo engine. */
  timestamp: number;
  hasFace: boolean;
  /** Calibrado mas sem predição confiável — só emergência é permitida. */
  degraded: boolean;
  /** Nunca calibrado: o ponto é o fallback do nariz, não olhar. Bloqueia tudo. */
  uncalibrated: boolean;
  eyeState: EyeState;
}

/** O alvo sob o olhar, já resolvido pelo chamador (que é quem fala com o DOM). */
export interface DwellTarget {
  /** Identidade estável do elemento. O chamador usa o próprio nó. */
  readonly key: unknown;
  /** `data-dwell-ms`, quando presente e válido. */
  customDwellMs: number | null;
  isEmergency: boolean;
  /**
   * Alvo de RECUPERAÇÃO (`data-recovery="true"`) — B1.9.
   *
   * Aceito em `degraded` pelo mesmo ramo do emergency. Existe porque a única
   * saída oferecida ao paciente quando o rastreamento degrada era, por
   * construção, inalcançável: o banner "Recalibre aqui" só aparece em
   * `degraded`, e em `degraded` o dispatcher bloqueava todo alvo não-emergency.
   * O paciente ficava com um banner piscando e nada acionável — perda total de
   * autonomia para quem usa o olhar como único meio de entrada.
   *
   * Distinto de `isEmergency` de propósito: emergência chama ajuda humana,
   * recuperação conserta o rastreamento. Misturar os dois faria o botão de
   * recalibrar herdar a prioridade máxima do alarme.
   */
  isRecovery: boolean;
  isDisabled: boolean;
}

export interface DwellConfig {
  /** Tempo base de dwell, do ajuste de velocidade do usuário. */
  dwellMs: number;
  /** Multiplicador do dwell de emergência quando em `degraded`. */
  emergencyDegradedMult: number;
  /**
   * Multiplicador do dwell de RECUPERAÇÃO quando em `degraded` (B1.9).
   *
   * Maior que o de emergência de propósito: um alarme disparado por engano é
   * constrangedor mas reversível; uma recalibração disparada por engano custa
   * 1–2 min de sessão a um paciente com fadiga limitante, e acontece
   * justamente quando o cursor está instável.
   */
  recoveryDegradedMult: number;
  /** Bloqueio após um clique, para não re-disparar sob o mesmo olhar. */
  refractoryMs: number;
  /** Janela em que sair e voltar ao mesmo alvo preserva o progresso. */
  graceMs: number;
  /**
   * Lacuna de amostras válidas que ZERA o progresso (em vez de só pausar).
   * Abaixo disto o dwell congela e retoma de onde parou.
   */
  lostResetMs: number;
}

export const DEFAULT_DWELL_CONFIG: DwellConfig = {
  dwellMs: 1500,
  emergencyDegradedMult: 2,
  // 2,5× → 3,75 s no dwell base de 1500 ms. Provisório: o número certo sai da
  // medição com humano do Dia 7 (F8.5, métrica 7 — estabilidade do dwell).
  // Escolhido acima do de emergência pelo motivo no comentário do campo.
  recoveryDegradedMult: 2.5,
  refractoryMs: 800,
  graceMs: 300,
  lostResetMs: 500,
};

// ── P7.2 — a faixa de dwell por paciente ────────────────────────────────────
//
// O plano pede "faixa 0,8–1,5 s exposta por paciente". O app hoje oferece três
// presets: `fast` 800 ms, `normal` 1500 ms, `slow` 2500 ms.
//
// Os dois extremos do pedido batem com `fast` e `normal`. O `slow` NÃO cabe na
// faixa — e este módulo não o remove.
//
// O motivo é clínico, não de compatibilidade. Um paciente com ELA em fadiga
// avançada tem dificuldade de manter fixação por 1,5 s; para ele, 2,5 s é a
// diferença entre conseguir clicar e não conseguir. Estreitar a faixa para
// cumprir o número do plano retiraria a opção exatamente de quem tem menos
// alternativas — e a alternativa dele, se o dwell não funcionar, é não se
// comunicar.
//
// A resolução: a faixa do plano vira a faixa RECOMENDADA (o que a UI destaca e
// o que o `F8.5` mede), e a faixa PERMITIDA é maior. `dwellMsPorPaciente`
// devolve os dois fatos, para que a tela possa dizer "fora da faixa medida"
// sem impedir a escolha.
//
// Quem decide se o teto de 3 s fica é o Dia 7, com humano.

/** Faixa do plano — a que o `F8.5` mede e a que a UI destaca. */
export const DWELL_FAIXA_RECOMENDADA_MS = { min: 800, max: 1500 } as const;

/** Faixa aceita. Mais larga que a recomendada — ver a nota acima. */
export const DWELL_FAIXA_PERMITIDA_MS = { min: 400, max: 3000 } as const;

export interface DwellPorPaciente {
  /** Valor efetivo, já preso à faixa permitida. */
  ms: number;
  /** O valor pedido caiu fora da faixa recomendada pelo plano. */
  foraDaFaixaRecomendada: boolean;
  /** O valor pedido foi ajustado para caber na faixa permitida. */
  ajustado: boolean;
}

/**
 * Resolve o dwell escolhido para um paciente.
 *
 * Não rejeita: um valor absurdo vindo de um `localStorage` corrompido tem que
 * virar um dwell utilizável, porque sem dwell o paciente não chega à tela onde
 * consertaria o valor.
 */
export function dwellMsPorPaciente(pedido: number): DwellPorPaciente {
  const { min, max } = DWELL_FAIXA_PERMITIDA_MS;
  const ms = Number.isFinite(pedido)
    ? Math.min(max, Math.max(min, pedido))
    : DEFAULT_DWELL_CONFIG.dwellMs;
  return {
    ms,
    foraDaFaixaRecomendada:
      ms < DWELL_FAIXA_RECOMENDADA_MS.min || ms > DWELL_FAIXA_RECOMENDADA_MS.max,
    ajustado: !Number.isFinite(pedido) || ms !== pedido,
  };
}

export interface DwellState {
  /** Alvo atualmente acumulando progresso. */
  targetKey: unknown | null;
  /** ms de olhar VÁLIDO já acumulados sobre `targetKey`. */
  elapsedMs: number;
  /** timestamp da última amostra válida contabilizada. */
  lastValidTs: number | null;
  /** Último alvo abandonado, para a janela de tolerância. */
  lastTargetKey: unknown | null;
  lastTargetElapsedMs: number;
  exitTs: number | null;
  /** Enquanto `now < refractoryUntil`, nenhum dwell acumula. */
  refractoryUntil: number;
  /**
   * Marca que o dwell está PAUSADO — `null` quando não está (B2.5).
   *
   * Antes de B2.5, "está pausado" era codificado como `lastValidTs === null`.
   * Isso sobrecarregava um campo com duas responsabilidades incompatíveis:
   *
   *   - "quando foi o último olhar válido" — necessário para medir a idade da
   *     perda e decidir entre pausar e zerar;
   *   - "houve interrupção" — necessário para o frame de retomada não somar a
   *     lacuna inteira como progresso.
   *
   * Zerar `lastValidTs` para sinalizar o segundo destruía o primeiro: o frame
   * seguinte via `Infinity` e resetava tudo, reduzindo a tolerância efetiva de
   * 500 ms para **um único frame**. Separar os dois campos permite que as duas
   * invariantes coexistam.
   */
  pausadoDesde: number | null;
}

export function createDwellState(): DwellState {
  return {
    targetKey: null,
    elapsedMs: 0,
    lastValidTs: null,
    lastTargetKey: null,
    lastTargetElapsedMs: 0,
    exitTs: null,
    refractoryUntil: 0,
    pausadoDesde: null,
  };
}

export type DwellEffect =
  | { type: 'none' }
  /** Progresso mudou: o chamador pinta a barra. */
  | { type: 'progress'; targetKey: unknown; pct: number }
  /** Dwell completo: o chamador executa o clique. Refratário JÁ armado. */
  | { type: 'click'; targetKey: unknown };

export interface DwellOutcome {
  state: DwellState;
  effect: DwellEffect;
  /** Alvo que deve estar com realce agora (null = nenhum). */
  hoverKey: unknown | null;
  /**
   * Por que nada acumulou neste frame. Só para diagnóstico e UI; não altera
   * comportamento. `null` quando o dwell está progredindo normalmente.
   */
  blockedBy:
    | null
    | 'uncalibrated'
    | 'no-face'
    | 'eyes-closed'
    | 'refractory'
    | 'degraded'
    | 'disabled'
    | 'no-target';
}

/** Uma amostra conta para o dwell? */
function sampleIsValid(s: DwellSample): boolean {
  return s.hasFace && s.eyeState !== 'closed';
}

/**
 * Avança a máquina de dwell em um frame.
 *
 * Puro: não lê relógio, não toca no DOM, não muta `state`. O chamador resolve
 * o alvo (via `elementFromPoint`) e executa o efeito devolvido.
 */
export function stepDwell(
  state: DwellState,
  sample: DwellSample,
  target: DwellTarget | null,
  config: DwellConfig,
): DwellOutcome {
  const now = sample.timestamp;

  const parar = (
    blockedBy: DwellOutcome['blockedBy'],
    opts: { preservarProgresso: boolean },
  ): DwellOutcome => {
    // Pausa: mantém o alvo e o progresso, apenas solta o encadeamento
    // temporal para que a lacuna não seja contabilizada como olhar.
    //
    // B2.5 — `lastValidTs` é PRESERVADO. Antes ele era zerado aqui, e o efeito
    // era destruir a própria tolerância que este ramo existe para oferecer:
    //
    //   frame 1 sem rosto → pausa, e apaga lastValidTs
    //   frame 2 (33 ms)   → perdidoHa = Infinity → reset total
    //
    // A tolerância efetiva virava 1 frame, não os 500 ms de `lostResetMs`. O
    // teste antigo (`dwell.test.ts`) só exercitava um frame de perda, então
    // passava.
    //
    // A lacuna continua não sendo contada como olhar: quem faz isso é o
    // `pausadoDesde`, que o ramo de acumulação usa para saber que houve
    // interrupção e não somar o intervalo.
    if (opts.preservarProgresso && state.targetKey !== null) {
      return {
        state: {
          ...state,
          // Marca o início da pausa uma única vez — reentrar no ramo não pode
          // empurrar o relógio para frente, senão a perda nunca "envelhece".
          pausadoDesde: state.pausadoDesde ?? now,
        },
        effect: { type: 'none' },
        hoverKey: state.targetKey,
        blockedBy,
      };
    }
    return {
      state: {
        ...state,
        targetKey: null,
        elapsedMs: 0,
        lastValidTs: null,
        lastTargetKey: state.targetKey ?? state.lastTargetKey,
        lastTargetElapsedMs: state.targetKey !== null ? state.elapsedMs : state.lastTargetElapsedMs,
        exitTs: state.targetKey !== null ? now : state.exitTs,
        // Reset encerra a pausa: o próximo episódio começa a contar do zero.
        pausadoDesde: null,
      },
      effect: { type: 'none' },
      hoverKey: null,
      blockedBy,
    };
  };

  // Sem calibração o ponto é a ponta do nariz. Nada é clicável, nem
  // emergência: sobre um sinal que não acompanha o olhar, permitir emergência
  // é disparar alarme por acaso.
  if (sample.uncalibrated) return parar('uncalibrated', { preservarProgresso: false });

  // Rosto perdido por muito tempo zera; por pouco tempo apenas pausa.
  //
  // B2.5 — a FÓRMULA aqui sempre esteve certa; o que estava errado era o ramo
  // de pausa zerar `lastValidTs`, fazendo o frame seguinte ver `Infinity`.
  // Com `lastValidTs` preservado, "há quanto tempo foi o último olhar válido"
  // volta a ser mensurável ao longo de todo o episódio de perda — que é
  // exatamente o que `lostResetMs` quer decidir.
  if (!sample.hasFace) {
    const perdidoHa = state.lastValidTs === null ? Infinity : now - state.lastValidTs;
    return parar('no-face', { preservarProgresso: perdidoHa < config.lostResetMs });
  }

  // Olhos fechados PAUSAM. Nunca completam um dwell, e nunca zeram:
  // uma piscada no meio de uma seleção não pode custar o progresso.
  //
  // Diferente do rosto perdido de propósito: aqui o paciente ESTÁ olhando para
  // o alvo, só com os olhos fechados. Fadiga é a condição do público-alvo, e
  // punir fechamento prolongado com perda de progresso seria hostil a quem o
  // sistema serve. Decisão de design preexistente, mantida.
  if (sample.eyeState === 'closed') return parar('eyes-closed', { preservarProgresso: true });

  if (now < state.refractoryUntil) return parar('refractory', { preservarProgresso: false });

  if (!target) return parar('no-target', { preservarProgresso: false });
  if (target.isDisabled) return parar('disabled', { preservarProgresso: false });
  // B1.9 — em `degraded` passam DUAS classes de alvo: emergência (chamar
  // ajuda) e recuperação (consertar o rastreamento). Antes só a primeira
  // passava, e como o botão "Recalibre aqui" não é de emergência, a única
  // saída oferecida ao paciente era inacionável.
  if (sample.degraded && !target.isEmergency && !target.isRecovery) {
    return parar('degraded', { preservarProgresso: false });
  }

  const dwellMs =
    target.customDwellMs ??
    // Em degradado o cursor é sabidamente instável, então os alvos que ainda
    // aceitam clique pagam um dwell mais longo. Um `Math.max` em vez de somar
    // os multiplicadores: um alvo que seja emergência E recuperação usa o
    // maior dos dois, nunca o produto — senão o paciente ficaria 6 s olhando
    // para um botão de emergência.
    (sample.degraded && (target.isEmergency || target.isRecovery)
      ? config.dwellMs * Math.max(
          target.isEmergency ? config.emergencyDegradedMult : 1,
          target.isRecovery ? config.recoveryDegradedMult : 1,
        )
      : config.dwellMs);

  let next: DwellState;

  if (state.targetKey === target.key) {
    // Mesmo alvo: acumula só o intervalo entre amostras válidas consecutivas.
    //
    // B2.5 — a retomada é detectada por `pausadoDesde`, não mais por
    // `lastValidTs === null`. Como a pausa agora PRESERVA `lastValidTs` (para
    // poder medir a idade da perda), usá-lo como sinal de pausa somaria a
    // lacuna inteira como progresso fantasma — até `lostResetMs` de olhar que
    // nunca aconteceu.
    //
    // O primeiro frame após a retomada não acrescenta tempo, só restabelece o
    // encadeamento — mesma regra de antes, agora com o sinal certo.
    const retomando = state.pausadoDesde !== null;
    const delta =
      retomando || state.lastValidTs === null
        ? 0
        : Math.max(0, Math.min(now - state.lastValidTs, config.lostResetMs));
    next = {
      ...state,
      elapsedMs: state.elapsedMs + delta,
      lastValidTs: now,
      pausadoDesde: null,
    };
  } else if (
    state.lastTargetKey === target.key &&
    state.exitTs !== null &&
    now - state.exitTs < config.graceMs
  ) {
    // Reentrada dentro da tolerância: restaura o progresso de antes da saída.
    next = {
      ...state,
      targetKey: target.key,
      elapsedMs: state.lastTargetElapsedMs,
      lastValidTs: now,
      exitTs: null,
      pausadoDesde: null,
    };
  } else {
    // Alvo novo: começa do zero. O frame de entrada não conta tempo.
    //
    // B3.27 — `exitTs` registra AGORA, simetricamente ao ramo `parar`.
    //
    // Antes era `exitTs: null` aqui e `exitTs: now` no `parar`. A tolerância
    // `graceMs` funcionava ao sair para o VAZIO (que passa pelo `parar`) e
    // NÃO ao passar por um alvo vizinho (que passa por aqui):
    //
    //   A com 1400 ms → B por um frame → volta para A → A recomeça do zero
    //
    // Num teclado ocular, onde as teclas são vizinhas e o cursor tem jitter,
    // o paciente via a barra encher e zerar sem ter desviado o olhar de
    // propósito. Os dois caminhos de saída têm que custar a mesma coisa.
    next = {
      ...state,
      targetKey: target.key,
      elapsedMs: 0,
      lastValidTs: now,
      lastTargetKey: state.targetKey ?? state.lastTargetKey,
      lastTargetElapsedMs: state.targetKey !== null ? state.elapsedMs : state.lastTargetElapsedMs,
      exitTs: state.targetKey !== null ? now : state.exitTs,
      pausadoDesde: null,
    };
  }

  if (next.elapsedMs >= dwellMs) {
    // O refratário é armado AQUI, antes de o chamador executar o
    // clique. Se o handler React lançar, o estado já está consistente e o
    // dwell não re-dispara sob o mesmo olhar.
    return {
      state: {
        ...createDwellState(),
        refractoryUntil: now + config.refractoryMs,
      },
      effect: { type: 'click', targetKey: target.key },
      hoverKey: null,
      blockedBy: null,
    };
  }

  return {
    state: next,
    effect: {
      type: 'progress',
      targetKey: target.key,
      pct: Math.min(1, next.elapsedMs / dwellMs),
    },
    hoverKey: target.key,
    blockedBy: null,
  };
}

export const __testing = { sampleIsValid };
