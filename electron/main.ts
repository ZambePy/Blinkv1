import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import { runEncoder, configureEncoderModelPath } from './inference/encoderRunner';

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
  } else {
    win.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
  }
}

app.whenReady().then(() => {
  configureEncoderModelPath(resolveModelPath());

  // getUserMedia (câmera) precisa de autorização explícita fora do Chromium padrão do browser.
  session.defaultSession.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === 'media');
  });

  ipcMain.handle('encoder:infer', async (_event, input: Float32Array) => {
    try {
      return await runEncoder(input);
    } catch (err) {
      console.error('[main] erro não tratado em encoder:infer', err);
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
