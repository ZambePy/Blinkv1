import { app, BrowserWindow, session, ipcMain, screen } from 'electron';
import { execFile } from 'node:child_process';
import path from 'node:path';
import { buildMonitorSizeQuery } from '../src/displayGeometry';
import { permitirPermissao, permitirNavegacao, CSP } from '../src/electronSecurity';

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
        // B2.11 — a consulta vem de `src/displayGeometry.ts`, testada no CI.
        //
        // Antes ela era um literal aqui, com `-Namespace root\wmi`. Em string
        // JavaScript `\w` não é escape reconhecido: a barra sumia, o PowerShell
        // recebia `rootwmi`, errava sempre, e o handler devolvia lista vazia.
        // O EDID nunca foi lido uma única vez — e o comentário de "falha em
        // silêncio de propósito" logo acima fazia o sintoma parecer projetado.
        buildMonitorSizeQuery(),
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

  // B3.30 — navegação para fora do app é bloqueada.
  //
  // Sem isto, um link externo (num texto que o paciente compôs, por exemplo)
  // substituiria a aplicação inteira por uma página remota que herda o
  // contexto do processo.
  win.webContents.on('will-navigate', (event, url) => {
    if (!permitirNavegacao(url)) {
      event.preventDefault();
      console.warn(`[electron] navegação bloqueada para origem não confiável: ${url}`);
    }
  });

  // Nenhuma janela nova. O app é kiosk por natureza de uso.
  win.webContents.setWindowOpenHandler(({ url }) => {
    console.warn(`[electron] abertura de janela bloqueada: ${url}`);
    return { action: 'deny' };
  });

  if (!app.isPackaged) {
    win.loadURL(DEV_SERVER_URL);
    win.webContents.openDevTools({ mode: 'detach' });
    // Espelha logs do renderer no terminal (util para timing e diagnostico).
    //
    // B3.30 — a assinatura de `console-message` mudou no Electron recente: o
    // handler passou a receber UM objeto de evento com `{message, level,
    // lineNumber, sourceId}` em vez de `(event, level, message, ...)`. Com a
    // assinatura antiga, `message` chegava `undefined`, todos os `includes`
    // eram falsos, e o espelhamento não imprimia NADA — silenciosamente.
    //
    // O código abaixo aceita as duas formas, para não quebrar se a versão do
    // Electron for revertida.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (win.webContents as any).on('console-message', (...args: any[]) => {
      const message: string | undefined =
        typeof args[0]?.message === 'string' ? args[0].message   // Electron novo
        : typeof args[2] === 'string' ? args[2]                  // Electron antigo
        : undefined;
      if (!message) return;
      if (
        message.includes('[eyeCrop]') ||
        message.includes('[IrisFlow]') ||
        message.includes('[fusion]') ||
        message.includes('[calib]') ||
        message.includes('[comparison]') ||
        message.includes('[accuracy]')
      ) {
        console.log(`[renderer] ${message}`);
      }
    });
  } else {
    win.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'index.html'));
  }
}

app.whenReady().then(async () => {
  // B3.30 — a permissão passa a depender da ORIGEM, não só do tipo.
  //
  // O handler anterior descartava o `webContents` com `_` e concedia `media`
  // a qualquer origem carregada na janela. Combinado com a ausência de
  // `will-navigate` e de CSP, bastava uma navegação para fora para uma página
  // arbitrária pedir a webcam de um paciente com ELA e recebê-la.
  session.defaultSession.setPermissionRequestHandler((webContents, permission, callback) => {
    callback(permitirPermissao(permission, webContents?.getURL()));
  });

  // Alguns caminhos do Chromium consultam a permissão sem passar pelo fluxo de
  // REQUEST (por exemplo, ao reusar uma permissão já concedida). Sem este
  // handler, essas consultas caem no default do Chromium e escapam da política
  // acima.
  session.defaultSession.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return permitirPermissao(permission, requestingOrigin);
  });

  // Content-Security-Policy. Ver `src/electronSecurity.ts` para o racional de
  // cada diretiva — em especial por que `wasm-unsafe-eval` e `unsafe-inline`
  // (estilos) são necessários e por que `connect-src 'self'` é o que torna a
  // promessa de privacidade do README uma política de navegador, e não apenas
  // uma disciplina de código.
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [CSP],
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
