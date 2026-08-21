import { app, BrowserWindow, ipcMain, session } from 'electron';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';

// ── Controle real de brilho do monitor via WMI (Camada 3 do conforto visual)
//
// Windows expõe WmiMonitorBrightnessMethods para monitores internos (laptops)
// e monitores DDC/CI-compatíveis. Não é universal — muitos monitores externos
// USB não expõem; nesse caso o PowerShell retorna erro e o renderer cai no
// slider de brilho via CSS filter (funciona sempre).
//
// Executamos via `powershell -Command` porque:
//   - Sem dependência nativa (node-wmi/robotjs exigiriam rebuild por platform).
//   - Zero surface de segurança extra — só executamos comandos hardcoded.
//   - Falha graciosamente em macOS/Linux (execFile lança, catch retorna erro).
async function getMonitorBrightness(): Promise<number> {
  if (process.platform !== 'win32') {
    throw new Error('Monitor brightness control disponível apenas em Windows.');
  }
  const { stdout } = await execFileAsync(
    'powershell.exe',
    ['-NoProfile', '-Command', '(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightness).CurrentBrightness'],
    { timeout: 3000 },
  );
  const value = parseInt(stdout.trim(), 10);
  if (Number.isNaN(value) || value < 0 || value > 100) {
    throw new Error(`Valor inválido do WMI: "${stdout.trim()}"`);
  }
  return value;
}

async function setMonitorBrightness(pct: number): Promise<void> {
  if (process.platform !== 'win32') {
    throw new Error('Monitor brightness control disponível apenas em Windows.');
  }
  const clamped = Math.max(0, Math.min(100, Math.round(pct)));
  await execFileAsync(
    'powershell.exe',
    [
      '-NoProfile',
      '-Command',
      `(Get-WmiObject -Namespace root/WMI -Class WmiMonitorBrightnessMethods).WmiSetBrightness(1, ${clamped})`,
    ],
    { timeout: 3000 },
  );
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

  // Handlers de brilho — registrados uma vez, sobrevivem a reloads.
  // Retornam sempre { ok, value?, error? } para o renderer não precisar
  // distinguir "IPC ausente" (sem preload) de "IPC falhou" (driver não suporta).
  ipcMain.handle('brightness:get', async () => {
    try {
      const value = await getMonitorBrightness();
      return { ok: true, value };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });
  ipcMain.handle('brightness:set', async (_evt, pct: number) => {
    try {
      await setMonitorBrightness(pct);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
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
