import { app, BrowserWindow, ipcMain, session } from 'electron';
import { promises as fs } from 'node:fs';
import path from 'node:path';

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';

// Raiz do projeto: dist-electron/ fica um nível abaixo. Em produção
// (app.isPackaged), main.cjs mora em resources/app.asar/dist-electron/ e
// escrever "na raiz do projeto" não faz sentido; cai em userData. Em dev
// é o repo mesmo.
function resolveSaveDir(): string {
  if (app.isPackaged) return app.getPath('userData');
  return path.resolve(__dirname, '..');
}

// Aceita só nome de arquivo (sem separador de path). Bloqueia traversal
// e mantém a promessa "salva na raiz do projeto".
function isSafeFilename(name: string): boolean {
  if (!name || typeof name !== 'string') return false;
  if (name.includes('/') || name.includes('\\')) return false;
  if (name.startsWith('.')) return false;
  if (!name.endsWith('.jsonl')) return false;
  return true;
}

ipcMain.handle(
  'irisflow:saveRecording',
  async (_event, payload: { jsonl?: unknown; filename?: unknown }) => {
    const jsonl = typeof payload?.jsonl === 'string' ? payload.jsonl : '';
    const filename = typeof payload?.filename === 'string' ? payload.filename : '';
    if (!jsonl) throw new Error('jsonl vazio');
    if (!isSafeFilename(filename)) throw new Error(`filename inválido: ${filename}`);
    const dir = resolveSaveDir();
    const absPath = path.join(dir, filename);
    await fs.writeFile(absPath, jsonl, 'utf8');
    const bytes = Buffer.byteLength(jsonl, 'utf8');
    console.log(`[irisflow:saveRecording] escreveu ${bytes} bytes em ${absPath}`);
    return { absPath, bytes };
  },
);

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1280,
    height: 800,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  });

  if (!app.isPackaged) {
    win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
    // Espelha logs do renderer no terminal (util para timing e diagnostico).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (win.webContents as any).on('console-message', (_e: unknown, _level: number, message: string) => {
      if (
        message?.includes('[eyeCrop]') ||
        message?.includes('[IrisFlow]') ||
        message?.includes('[fusion]') ||
        message?.includes('[calib]') ||
        message?.includes('[comparison]') ||
        message?.includes('[accuracy]')
      ) {
        console.log(`[renderer] ${message}`);
      }
    });
  } else {
    win.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
  }
}

app.whenReady().then(async () => {
  // getUserMedia (camera) precisa de autorizacao explicita fora do Chromium padrao.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
