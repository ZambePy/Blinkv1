/**
 * Cofre do renderer.
 *
 * No Electron, tudo passa pelo `irisflowCloud` do preload e é cifrado no
 * processo principal com `safeStorage` (DPAPI no Windows). Fora do Electron
 * (Vite no navegador, testes), cai em `localStorage` com o mesmo prefixo — o
 * suficiente para desenvolver, e explícito: nada finge estar cifrado.
 *
 * Chaves aceitas pelo main: `irisflow.<algo>`.
 */
interface CofreIPC {
  secureGet: (chave: string) => Promise<string | null>;
  secureSet: (chave: string, valor: string) => Promise<boolean>;
  secureRemove: (chave: string) => Promise<boolean>;
  appInfo: () => Promise<{ version: string; hostname: string; platform: string; encryptionAvailable: boolean }>;
}

function ipc(): CofreIPC | null {
  return (window as unknown as { irisflowCloud?: CofreIPC }).irisflowCloud ?? null;
}

export const CHAVES = {
  sessaoSupabase: 'irisflow.supabase.session',
  vinculo: 'irisflow.vinculo',
  licenca: 'irisflow.licenca',
  filaDeEnvio: 'irisflow.fila',
} as const;

export const cofre = {
  async ler(chave: string): Promise<string | null> {
    const bridge = ipc();
    if (bridge) return bridge.secureGet(chave);
    try { return localStorage.getItem(chave); } catch { return null; }
  },
  /** Falso quando não foi possível persistir (cofre recusou ou quota estourou). */
  async gravar(chave: string, valor: string): Promise<boolean> {
    const bridge = ipc();
    if (bridge) {
      const ok = await bridge.secureSet(chave, valor);
      if (!ok) console.warn(`[cofre] gravação recusada: ${chave} (${valor.length} chars)`);
      return ok;
    }
    try { localStorage.setItem(chave, valor); return true; } catch { return false; }
  },
  async remover(chave: string): Promise<void> {
    const bridge = ipc();
    if (bridge) { await bridge.secureRemove(chave); return; }
    try { localStorage.removeItem(chave); } catch { /* idem */ }
  },
  async lerJson<T>(chave: string): Promise<T | null> {
    const raw = await this.ler(chave);
    if (!raw) return null;
    try { return JSON.parse(raw) as T; } catch { return null; }
  },
  async gravarJson(chave: string, valor: unknown): Promise<boolean> {
    return this.gravar(chave, JSON.stringify(valor));
  },
  /** Cifrado de verdade (safeStorage) ou só localStorage? Para a tela de conta dizer a verdade. */
  cifrado(): boolean {
    return ipc() !== null;
  },
};

/** Identidade deste computador para o pareamento. Fora do Electron, inventa algo legível. */
export async function infoDoApp(): Promise<{ version: string; hostname: string; platform: string }> {
  const bridge = ipc();
  if (bridge) {
    try {
      const i = await bridge.appInfo();
      return { version: i.version, hostname: i.hostname, platform: i.platform };
    } catch { /* cai no padrão */ }
  }
  return { version: 'dev', hostname: 'navegador', platform: navigator.platform || 'web' };
}
