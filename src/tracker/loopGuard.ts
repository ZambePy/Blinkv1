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

/** Evita inundar o console quando a falha é por frame. */
let lastLoggedErrorMs = 0;
const ERROR_LOG_THROTTLE_MS = 2000;

export function resetLoopErrorState(): void {
  loopErrorCount = 0;
  lastLoggedErrorMs = 0;
}

export function getLoopErrorCount(): number {
  return loopErrorCount;
}

/**
 * Executa o corpo de um frame e GARANTE o reagendamento do próximo.
 *
 * O reagendamento vai em `finally`: é o invariante que mantém o rastreamento
 * vivo. Uma exceção do próprio `schedule` também é contida — se o rAF estiver
 * indisponível não há o que fazer, mas derrubar a pilha do chamador não ajuda.
 */
export function runLoopBody(body: () => void, schedule: () => void): void {
  try {
    body();
  } catch (err) {
    loopErrorCount++;
    const agora = typeof performance !== 'undefined' ? performance.now() : Date.now();
    if (agora - lastLoggedErrorMs > ERROR_LOG_THROTTLE_MS) {
      lastLoggedErrorMs = agora;
      console.error(
        `[IrisFlow] exceção no loop de rastreamento (${loopErrorCount} no total). ` +
        `O loop foi reagendado; o cursor continua vivo.`,
        err,
      );
    }
  } finally {
    try {
      schedule();
    } catch (scheduleErr) {
      console.error('[IrisFlow] falha ao reagendar o frame:', scheduleErr);
    }
  }
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
