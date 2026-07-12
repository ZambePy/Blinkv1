import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import {
  configureEncoderModelPath,
  ensureSession,
  runEncoderInference,
  type EncoderInput,
} from './inference/encoderRunner';

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';

function resolveModelPath(): string {
  return app.isPackaged
    ? path.join(process.resourcesPath, 'models', 'gaze_encoder.onnx')
    : path.join(app.getAppPath(), 'resources', 'models', 'gaze_encoder.onnx');
}

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
        message?.includes('[IPC]') ||
        message?.includes('[calib]') ||
        message?.includes('[comparison]') ||
        message?.includes('[accuracy]')
      ) {
        console.log(`[renderer] ${message}`);
      }
    });
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(async () => {
  configureEncoderModelPath(resolveModelPath());

  // Carrega a sessao ONNX no boot, nao na primeira chamada de inferencia.
  // Isso garante latencia previsivel na primeira inferencia real.
  const bootStart = Date.now();
  await ensureSession();
  console.log(`[main] sessao ONNX carregada no boot em ${Date.now() - bootStart} ms`);

  // getUserMedia (camera) precisa de autorizacao explicita fora do Chromium padrao.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  ipcMain.handle('encoder:infer', async (_event, input: EncoderInput) => {
    try {
      const result = await runEncoderInference(input);
      // Float32Array não sobrevive ao boundary IPC+contextBridge com sandbox:true —
      // serializamos como number[] e o preload reconstrói Float32Array no renderer.
      return result ? Array.from(result) : null;
    } catch (err) {
      console.error('[main] erro nao tratado em encoder:infer', err);
      return null;
    }
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
