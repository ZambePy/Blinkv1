/**
 * Guardas do loop de rastreamento.
 *
 * O corpo do `loop()` do engine roda ~30×/s e toca MediaPipe (WASM), canvas,
 * o worker do L2CS e uma lista de subscribers que, no fim da cadeia, executa
 * handlers React (o dwell dispara `.click()` de verdade). Qualquer um deles
 * pode lançar. Sem estes guardas, uma exceção pulava o reagendamento e o loop
 * morria em silêncio, com `running === true` e estado `tracking` — cursor
 * congelado, sem erro visível e sem recuperação possível a não ser recarregar
 * o app.
 *
 * Estas funções vivem fora do `engine.ts` de propósito: o loop real depende de
 * vídeo, WASM e rAF, e não é testável. A política de resiliência é, e é ela que
 * precisa de teste.
 */

/** Frames que terminaram em exceção desde o último reset. Diagnóstico. */
let loopErrorCount = 0;

/**
 * Frames que terminaram em exceção SEGUIDOS, sem nenhum sucesso no meio.
 *
 * A distinção importa: 100 erros espalhados ao longo de uma hora são ruído
 * tolerável (um subscriber React que lançou aqui e ali); 100 erros seguidos
 * são o contexto WebGL morto — troca de GPU, sleep/wake do notebook — com
 * `detectForVideo` lançando em todo frame.
 *
 * No segundo caso o loop girava a 60 fps queimando CPU indefinidamente, com o
 * estado em `'tracking'`, o cursor congelado e uma linha de console a cada 2 s
 * como única evidência — que ninguém lê, porque o app roda em Electron em tela
 * cheia. Para o público-alvo isso é indistinguível de "o programa travou", e o
 * paciente não tem como reiniciar sozinho.
 */
let consecutiveLoopErrors = 0;

/** Já sinalizamos `fatal` para o surto corrente? Evita que o engine tente
 *  reinicializar o FaceLandmarker 60×/s — pior que o problema original. */
let fatalSignaled = false;

/**
 * Erros consecutivos a partir dos quais a falha é tratada como persistente.
 *
 * 15 frames a 30 fps ≈ 0,5 s. Alto o bastante para não disparar com uma
 * exceção esporádica; baixo o bastante para o cuidador ver a mensagem antes de
 * concluir que o equipamento quebrou.
 */
export const LOOP_ERROR_FATAL_THRESHOLD = 15;

/** Evita inundar o console quando a falha é por frame. */
let lastLoggedErrorMs = 0;
const ERROR_LOG_THROTTLE_MS = 2000;

export function resetLoopErrorState(): void {
  loopErrorCount = 0;
  consecutiveLoopErrors = 0;
  fatalSignaled = false;
  lastLoggedErrorMs = 0;
}

export function getLoopErrorCount(): number {
  return loopErrorCount;
}

/** Erros consecutivos no surto corrente. Zera no primeiro frame bem-sucedido. */
export function getConsecutiveLoopErrors(): number {
  return consecutiveLoopErrors;
}

/** Resultado de um frame do loop. */
export interface LoopBodyResult {
  /** O corpo lançou neste frame. */
  errored: boolean;
  /**
   * A falha é persistente e o chamador deve agir: transicionar para
   * estado de erro visível e tentar reinicializar o `FaceLandmarker`.
   *
   * `true` UMA vez por surto — não em todo frame subsequente.
   */
  fatal: boolean;
}

/**
 * Executa o corpo de um frame e GARANTE o reagendamento do próximo.
 *
 * O reagendamento vai em `finally`: é o invariante que mantém o rastreamento
 * vivo. Uma exceção do próprio `schedule` também é contida — se o rAF estiver
 * indisponível não há o que fazer, mas derrubar a pilha do chamador não ajuda.
 */
export function runLoopBody(body: () => void, schedule: () => void): LoopBodyResult {
  let errored = false;
  let fatal = false;
  try {
    body();
    // Sucesso encerra o surto. O total continua contando, para o
    // diagnóstico saber que houve turbulência.
    consecutiveLoopErrors = 0;
    fatalSignaled = false;
  } catch (err) {
    errored = true;
    loopErrorCount++;
    consecutiveLoopErrors++;
    // Sinaliza UMA vez por surto. Sem o latch, o engine tentaria
    // reinicializar o FaceLandmarker a cada frame, o que é pior que o
    // problema original.
    if (consecutiveLoopErrors >= LOOP_ERROR_FATAL_THRESHOLD && !fatalSignaled) {
      fatalSignaled = true;
      fatal = true;
      console.error(
        `[IrisFlow] ${consecutiveLoopErrors} exceções CONSECUTIVAS no loop. ` +
        `A falha é persistente (contexto WebGL perdido é a causa mais provável). ` +
        `O engine vai sinalizar erro e tentar reinicializar o detector.`,
        err,
      );
    }
    const agora = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (agora - lastLoggedErrorMs > ERROR_LOG_THROTTLE_MS) {
      lastLoggedErrorMs = agora;
      console.error(
        `[IrisFlow] exceção no loop de rastreamento (${loopErrorCount} no total, ` +
        `${consecutiveLoopErrors} consecutivas). ` +
        `O loop foi reagendado; o cursor continua vivo.`,
        err,
      );
    }
  } finally {
    // O reagendamento continua em `finally`, inclusive no frame fatal: o loop
    // nunca pode morrer por conta de uma exceção. Quem decide parar é o
    // engine, com estado visível — não um `return` esquecido aqui.
    try {
      schedule();
    } catch (scheduleErr) {
      console.error('[IrisFlow] falha ao reagendar o frame:', scheduleErr);
    }
  }
  return { errored, fatal };
}

/**
 * Entrega uma amostra a todos os subscribers, isolando cada um.
 *
 * `gazeSubscribers.forEach(cb => cb(sample))` fazia o primeiro subscriber que
 * lançasse abortar a entrega para todos os seguintes E derrubar o frame. Como
 * o dispatcher de dwell é um subscriber e ele chama `.click()` — executando
 * código React arbitrário —, essa era a rota mais provável para matar o loop.
 */
export function emitToSubscribers<T>(
  subscribers: Iterable<(sample: T) => void>,
  sample: T,
): void {
  for (const cb of subscribers) {
    try {
      cb(sample);
    } catch (err) {
      console.error('[IrisFlow] subscriber de gaze lançou; os demais seguem:', err);
    }
  }
}
