// Modo desenvolvedor: esconde o cursor de gaze e desliga o dwell para quem está
// operando com mouse. Fica em sessionStorage para sobreviver a um F5 e morrer
// com a aba; a mudança é avisada por evento para o provider reagir na hora.

const KEY = 'irisflow_dev_mode';
const EVENT = 'irisflow:devmode';

export function isDevMode(): boolean {
  try {
    return sessionStorage.getItem(KEY) === 'true';
  } catch {
    return false;
  }
}

export function setDevMode(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(KEY, 'true');
    else sessionStorage.removeItem(KEY);
  } catch { /* sessionStorage indisponível */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: on }));
}

export function onDevModeChange(cb: (on: boolean) => void): () => void {
  const handler = (e: Event) => cb(Boolean((e as CustomEvent).detail));
  window.addEventListener(EVENT, handler);
  return () => window.removeEventListener(EVENT, handler);
}
