import { app, BrowserWindow, session, ipcMain, screen } from 'electron';
import { execFile } from 'node:child_process';
import path from 'node:path';

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';

// Tamanho FÍSICO da tela, lido do EDID via WMI.
//
// Nenhuma API de browser (nem do Electron) expõe centímetros: `screen` dá
// pixels e scaleFactor. O EDID carrega as dimensões da área ativa, e o
// Windows publica isso em `root\wmi : WmiMonitorBasicDisplayParams`
// (MaxHorizontalImageSize / MaxVerticalImageSize, em CENTÍMETROS).
//
// Por que importa: a diagonal entra no erro angular do relatório e no
// posicionamento dos alvos de calibração. Depender do cuidador digitar o
// valor funciona até ele trocar de monitor — e aí os relatórios passam a
// mentir sem nenhum sinal.
//
// Falha em silêncio de propósito: fora do Windows, com EDID ausente ou driver
// genérico, devolve lista vazia e o app segue com o valor configurado à mão.
function readMonitorSizes(): Promise<{ widthCm: number; heightCm: number }[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      [
        '-NoProfile', '-NonInteractive', '-Command',
        'Get-CimInstance -Namespace root\wmi -ClassName WmiMonitorBasicDisplayParams | ' +
        'Select-Object MaxHorizontalImageSize,MaxVerticalImageSize | ConvertTo-Json -Compress',
      ],
      { timeout: 5000, windowsHide: true },
      (err, stdout) => {
        if (err || !stdout?.trim()) { resolve([]); return; }
        try {
          const parsed: unknown = JSON.parse(stdout);
          const rows = Array.isArray(parsed) ? parsed : [parsed];
          const out: { widthCm: number; heightCm: number }[] = [];
          for (const r of rows) {
            if (!r || typeof r !== 'object') continue;
            const o = r as Record<string, unknown>;
            const w = o.MaxHorizontalImageSize;
            const h = o.MaxVerticalImageSize;
            if (typeof w === 'number' && typeof h === 'number') out.push({ widthCm: w, heightCm: h });
          }
          resolve(out);
        } catch {
          resolve([]);
        }
      },
    );
  });
}

ipcMain.handle('irisflow:monitor-sizes', () => readMonitorSizes());

// Resolução e escala da tela, do SO.
//
// `window.screen` do renderer já dá a resolução em px CSS, mas NÃO expõe o
// fator de escala do Windows (125%, 150%). Com escala em 150%, 1920 px
// físicos viram 1280 px CSS — e a conversão px→cm que o erro angular usa
// fica errada por 1,5× se ninguém contar isso. Aqui vem o número de verdade.
ipcMain.handle('irisflow:display-info', () => {
  const d = screen.getPrimaryDisplay();
  return {
    widthPx: d.size.width,
    heightPx: d.size.height,
    scaleFactor: d.scaleFactor,
    // `size` já vem em px CSS; multiplicado pela escala dá o pixel físico real.
    physicalWidthPx: Math.round(d.size.width * d.scaleFactor),
    physicalHeightPx: Math.round(d.size.height * d.scaleFactor),
  };
});

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
