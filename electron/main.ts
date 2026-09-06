import { app, BrowserWindow, session, ipcMain, screen } from 'electron';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { buildMonitorSizeQuery } from '../src/displayGeometry';
import { permitirPermissao, permitirNavegacao, CSP, CSP_DEV } from '../src/electronSecurity';

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';

// Tamanho físico da tela, lido do EDID via WMI (Windows).
//
// Nenhuma API de browser expõe centímetros: `screen` dá pixels e escala. O
// EDID carrega a área ativa, e o Windows publica isso em
// `root\wmi : WmiMonitorBasicDisplayParams` (MaxHorizontal/VerticalImageSize,
// em cm). A diagonal entra no erro angular dos relatórios; depender do
// cuidador digitar o valor funciona até ele trocar de monitor.
//
// Fora do Windows, sem EDID ou com driver genérico devolve lista vazia e o
// app segue com o valor configurado à mão.
function readMonitorSizes(): Promise<{ widthCm: number; heightCm: number }[]> {
  if (process.platform !== 'win32') return Promise.resolve([]);
  return new Promise((resolve) => {
    execFile(
      'powershell.exe',
      // A consulta vem de `src/displayGeometry.ts` (testada) — um literal aqui
      // já perdeu a barra de `root\wmi` uma vez por escape de string.
      ['-NoProfile', '-NonInteractive', '-Command', buildMonitorSizeQuery()],
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

// Resolução e escala da tela primária. `window.screen` do renderer não expõe
// o fator de escala do Windows (125%, 150%), e a conversão px→cm do erro
// angular precisa dele.
ipcMain.handle('irisflow:display-info', () => {
  const d = screen.getPrimaryDisplay();
  return {
    widthPx: d.size.width,
    heightPx: d.size.height,
    scaleFactor: d.scaleFactor,
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

  // Um link externo (num texto que o paciente compôs, por exemplo) não pode
  // substituir o app por uma página remota.
  win.webContents.on('will-navigate', (event, url) => {
    if (!permitirNavegacao(url)) {
      event.preventDefault();
      console.warn(`[electron] navegação bloqueada para origem não confiável: ${url}`);
    }
  });

  // Nenhuma janela nova: o app é usado como quiosque.
  win.webContents.setWindowOpenHandler(({ url }) => {
    console.warn(`[electron] abertura de janela bloqueada: ${url}`);
    return { action: 'deny' };
  });

  if (!app.isPackaged) {
    win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });

    // Espelha no terminal os logs do renderer que têm prefixo entre colchetes
    // ([calib], [L2CS], [accuracy]...). A assinatura de `console-message`
    // mudou no Electron recente (um objeto de evento em vez de argumentos
    // posicionais); as duas formas são aceitas.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (win.webContents as any).on('console-message', (...args: any[]) => {
      const message: string | undefined =
        typeof args[0]?.message === 'string' ? args[0].message
        : typeof args[2] === 'string' ? args[2]
        : undefined;
      if (message && /^\[[A-Za-z0-9 _-]+\]/.test(message)) {
        console.log(`[renderer] ${message}`);
      }
    });
  } else {
    win.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
  }
}

app.whenReady().then(async () => {
  // A permissão depende da origem, não só do tipo: só `media`, só para
  // origem local. O check handler cobre os caminhos do Chromium que
  // consultam a permissão sem passar pelo fluxo de request.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permitirPermissao(permission, webContents?.getURL()));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return permitirPermissao(permission, requestingOrigin);
  });

  // CSP como cabeçalho (servidor de dev). No build empacotado, carregado via
  // `file://`, não há cabeçalhos: a mesma política vai como `<meta>` no
  // `index.html`, injetada pelo Vite. Em dev vale `CSP_DEV`: o preâmbulo do
  // Fast Refresh é um script inline e a política de produção o bloquearia.
  const politica = app.isPackaged ? CSP : CSP_DEV;
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [politica],
      },
    });
  });

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
