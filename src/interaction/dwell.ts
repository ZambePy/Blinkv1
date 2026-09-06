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
   * Alvo de RECUPERAÇÃO (`data-recovery="true"`), aceito em `degraded` pelo
   * mesmo ramo do emergency: é o que torna o botão "Recalibre aqui"
   * acionável justamente quando o rastreamento degrada.
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
   * Multiplicador do dwell de RECUPERAÇÃO quando em `degraded`.
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
  // 2,5× → 3,75 s no dwell base de 1500 ms. Provisório até haver medição com
  // humano; acima do de emergência pelo motivo no comentário do campo.
  recoveryDegradedMult: 2.5,
  refractoryMs: 800,
  graceMs: 300,
  lostResetMs: 500,
};

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
   * Marca que o dwell está PAUSADO — `null` quando não está.
   *
   * Separado de `lastValidTs` de propósito: este mede a idade da perda (para
   * decidir entre pausar e zerar), aquele diz que houve interrupção (para o
   * frame de retomada não somar a lacuna como progresso). Codificar os dois
   * num campo só reduzia a tolerância efetiva de 500 ms a um único frame.
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
    // Pausa: mantém o alvo, o progresso e `lastValidTs` (zerá-lo faria o
    // frame seguinte ver `Infinity` e resetar tudo). Quem impede a lacuna de
    // contar como olhar é o `pausadoDesde`.
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
  // Em `degraded` passam DUAS classes de alvo: emergência (chamar ajuda) e
  // recuperação (consertar o rastreamento).
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
    // O primeiro frame após uma pausa não acrescenta tempo, só restabelece o
    // encadeamento — senão a lacuna inteira viraria progresso fantasma.
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
    // `exitTs` registra AGORA, simetricamente ao ramo `parar`: sair para um
    // alvo vizinho por um frame (jitter num teclado ocular) tem que preservar
    // o progresso tanto quanto sair para o vazio.
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
