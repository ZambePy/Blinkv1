import { contextBridge, ipcRenderer } from 'electron';

// Camada 3 do conforto visual — brilho real do monitor via IPC.
// Expõe superfície mínima: só get/set com clamp e validação no main.
// O renderer usa `window.electronBrightness` e cai em fallback (CSS filter
// da Camada 2) quando este preload não está disponível (dev browser puro).
contextBridge.exposeInMainWorld('electronBrightness', {
  get: () => ipcRenderer.invoke('brightness:get') as Promise<{
    ok: boolean;
    value?: number;
    error?: string;
  }>,
  set: (pct: number) => ipcRenderer.invoke('brightness:set', pct) as Promise<{
    ok: boolean;
    error?: string;
  }>,
});
