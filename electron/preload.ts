import { contextBridge, ipcRenderer } from 'electron';

// Ponte mínima do Electron pro renderer. Só o que existe hoje: salvar uma
// gravação `.jsonl` diretamente na raiz do projeto (ver electron/main.ts,
// handler `irisflow:saveRecording`). Renderer detecta a presença dessa
// ponte via `window.irisflowElectron`; se ausente, cai no fluxo de
// download do browser.
//
// Contexto isolado (contextIsolation: true, sandbox: true) — expor por
// contextBridge é a forma segura; nada de Node no window direto.
contextBridge.exposeInMainWorld('irisflowElectron', {
  saveRecording: (jsonl: string, filename: string) =>
    ipcRenderer.invoke('irisflow:saveRecording', { jsonl, filename }),
});
