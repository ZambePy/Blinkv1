/**
 * Dispatcher de dwell — política pura, testável, sem DOM e sem relógio próprio.
 *
 * Antes, esta lógica vivia dentro do callback de rAF do `GazeProvider`, mutando
 * sete `useRef` e chamando `document.elementFromPoint` direto. Não tinha um
 * único teste, e é o código que **clica em nome do usuário**: para alguém com
 * ELA, um clique indevido é uma ação que a pessoa não consegue desfazer.
 *
 * Três defeitos foram corrigidos ao extrair:
 *
 * - **C-07** — o dwell exigia só `hasFace`. Sem calibração, o cursor é o
 *   fallback do nariz (a ponta do nariz projetada na tela) e o app clicava em
 *   qualquer botão sob ele, inclusive no de emergência, com o cursor invisível.
 *   Agora `uncalibrated` bloqueia TUDO, inclusive emergência: sobre um sinal
 *   que não tem relação com o olhar, permitir emergência é disparar alarme por
 *   acaso.
 *
 * - **C-15** — o progresso era `now - dwellStartMs`, relógio de parede. Fechar
 *   os olhos 2 s sobre um botão clicava ao reabrir; e qualquer lacuna (rosto
 *   perdido, frame dropado, aba em segundo plano) contava como olhar fixo.
 *   Agora o progresso acumula APENAS o intervalo entre amostras válidas
 *   consecutivas, e uma lacuna PAUSA (congela) em vez de continuar correndo.
 *
 * - **C-23 (parte)** — o refratário era armado depois do `.click()`. Um handler
 *   React que lançasse deixava o refratário desarmado e os refs sujos. Aqui o
 *   estado da decisão é fechado ANTES de a ação ser executada pelo chamador.
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
  isDisabled: boolean;
}

export interface DwellConfig {
  /** Tempo base de dwell, do ajuste de velocidade do usuário. */
  dwellMs: number;
  /** Multiplicador do dwell de emergência quando em `degraded`. */
  emergencyDegradedMult: number;
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
    // Pausa (C-15): mantém o alvo e o progresso, apenas solta o encadeamento
    // temporal para que a lacuna não seja contabilizada como olhar.
    if (opts.preservarProgresso && state.targetKey !== null) {
      return {
        state: { ...state, lastValidTs: null },
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
      },
      effect: { type: 'none' },
      hoverKey: null,
      blockedBy,
    };
  };

  // C-07 — sem calibração o ponto é a ponta do nariz. Nada é clicável, nem
  // emergência: sobre um sinal que não acompanha o olhar, permitir emergência
  // é disparar alarme por acaso.
  if (sample.uncalibrated) return parar('uncalibrated', { preservarProgresso: false });

  // C-15 — rosto perdido por muito tempo zera; por pouco tempo apenas pausa.
  if (!sample.hasFace) {
    const perdidoHa = state.lastValidTs === null ? Infinity : now - state.lastValidTs;
    return parar('no-face', { preservarProgresso: perdidoHa < config.lostResetMs });
  }

  // C-15 — olhos fechados PAUSAM. Nunca completam um dwell, e nunca zeram:
  // uma piscada no meio de uma seleção não pode custar o progresso.
  if (sample.eyeState === 'closed') return parar('eyes-closed', { preservarProgresso: true });

  if (now < state.refractoryUntil) return parar('refractory', { preservarProgresso: false });

  if (!target) return parar('no-target', { preservarProgresso: false });
  if (target.isDisabled) return parar('disabled', { preservarProgresso: false });
  if (sample.degraded && !target.isEmergency) {
    return parar('degraded', { preservarProgresso: false });
  }

  const dwellMs =
    target.customDwellMs ??
    (sample.degraded && target.isEmergency
      ? config.dwellMs * config.emergencyDegradedMult
      : config.dwellMs);

  let next: DwellState;

  if (state.targetKey === target.key) {
    // Mesmo alvo: acumula só o intervalo entre amostras válidas consecutivas.
    // `lastValidTs === null` significa que houve pausa — o primeiro frame após
    // a retomada não acrescenta tempo, só restabelece o encadeamento.
    const delta =
      state.lastValidTs === null
        ? 0
        : Math.max(0, Math.min(now - state.lastValidTs, config.lostResetMs));
    next = { ...state, elapsedMs: state.elapsedMs + delta, lastValidTs: now };
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
    };
  } else {
    // Alvo novo: começa do zero. O frame de entrada não conta tempo.
    next = {
      ...state,
      targetKey: target.key,
      elapsedMs: 0,
      lastValidTs: now,
      lastTargetKey: state.targetKey ?? state.lastTargetKey,
      lastTargetElapsedMs: state.targetKey !== null ? state.elapsedMs : state.lastTargetElapsedMs,
      exitTs: null,
    };
  }

  if (next.elapsedMs >= dwellMs) {
    // C-23 — o refratário é armado AQUI, antes de o chamador executar o
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
