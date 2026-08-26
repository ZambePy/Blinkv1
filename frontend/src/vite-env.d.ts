/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_URL?: string;
  readonly VITE_WS_URL?: string;
  readonly VITE_CAREGIVER_PIN?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

// Ponte exposta pelo preload do Electron (electron/preload.ts). Presença
// é feature-detect: em browser puro `window.irisflowElectron` é undefined
// e o consumidor deve cair no fluxo de download.
interface Window {
  irisflowElectron?: {
    saveRecording: (
      jsonl: string,
      filename: string,
    ) => Promise<{ absPath: string; bytes: number }>;
  };
}
