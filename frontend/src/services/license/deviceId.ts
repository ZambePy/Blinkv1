import type { DeviceBinding } from './types';

/**
 * Identidade desta máquina para o vínculo da licença.
 *
 * ⚠️ **Limitação conhecida, registrada no §9 do spec.** Este id é um UUID no
 * `localStorage`, não o GUID da máquina. Limpar os dados do app faz o mesmo
 * computador parecer outro e consome uma ativação do plano. A correção é ler o
 * machine GUID pelo IPC do Electron, o que exigiria ampliar o `preload.ts` —
 * fora do escopo do Bloco 1, que não toca no processo principal.
 */

export const DEVICE_ID_KEY = 'irisflow_device_id';

/** Vale só para o processo atual: usado quando o storage está indisponível. */
let idEmMemoria: string | null = null;

function novoId(): string {
  // `crypto.randomUUID` exige contexto seguro. `file://` é tratado como seguro
  // no Chromium, mas o fallback custa três linhas e evita um boot quebrado num
  // ambiente que não previmos.
  const c = globalThis.crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `dev-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export function getDeviceId(): string {
  try {
    const gravado = localStorage.getItem(DEVICE_ID_KEY);
    if (gravado && gravado.trim() !== '') return gravado;

    const id = idEmMemoria ?? novoId();
    idEmMemoria = id;
    localStorage.setItem(DEVICE_ID_KEY, id);
    return id;
  } catch {
    // Storage indisponível (modo privado, política de grupo, disco cheio).
    // Um throw aqui derrubaria o boot antes de qualquer tela aparecer; o app
    // segue com um id válido para esta execução.
    idEmMemoria = idEmMemoria ?? novoId();
    return idEmMemoria;
  }
}

export function getDeviceName(): string {
  const ua = typeof navigator === 'undefined' ? '' : navigator.userAgent;
  if (/Windows/i.test(ua)) return 'Computador com Windows';
  if (/Mac OS X|Macintosh/i.test(ua)) return 'Computador com macOS';
  if (/Linux|X11/i.test(ua)) return 'Computador com Linux';
  return 'Este computador';
}

export function getDeviceBinding(): DeviceBinding {
  return {
    deviceId: getDeviceId(),
    deviceName: getDeviceName(),
    boundAt: new Date().toISOString(),
  };
}
