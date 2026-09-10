import { app, BrowserWindow, session, ipcMain, screen, safeStorage } from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildMonitorSizeQuery } from '../src/displayGeometry';
import { permitirPermissao, permitirNavegacao, CSP, CSP_DEV, cspComNuvem } from '../src/electronSecurity';
import { registrarModoComputador } from './computador/sessao';
import { registrarVoz } from './voz';

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL ?? 'http://localhost:5173';
const RAIZ_DO_PROJETO = path.join(__dirname, '..');

/** A janela do app. Só existe uma; o Modo Computador e a voz precisam achá-la. */
let janelaPrincipal: BrowserWindow | null = null;

// URL do Supabase do IrisFlow, para liberar a origem no cabeçalho de CSP do
// servidor de dev. No build empacotado a CSP vai como <meta> gerada pelo Vite,
// que lê a mesma variável em tempo de build — aqui só interessa em dev.
// Lê do ambiente e, se não houver, de `frontend/.env.local` / `frontend/.env`
// (sem depender de dotenv: só a chave que importa).
function lerVariavelDoFrontend(nome: string): string | undefined {
  if (process.env[nome]) return process.env[nome];
  if (app.isPackaged) return undefined;
  for (const arquivoEnv of ['.env.local', '.env']) {
    const arquivo = path.join(__dirname, '..', 'frontend', arquivoEnv);
    try {
      const linha = fs.readFileSync(arquivo, 'utf-8').split(/\r?\n/)
        .find((l) => new RegExp(`^\\s*${nome}\\s*=`).test(l));
      if (linha) return linha.split('=').slice(1).join('=').trim().replace(/^["']|["']$/g, '');
    } catch { /* arquivo ausente: segue */ }
  }
  return undefined;
}

// ---------------------------------------------------------------------
// Cofre local: token da sessão do Supabase e chave do computador.
//
// O renderer não guarda credenciais em localStorage (legível por qualquer
// coisa que abra o perfil do Chromium). Ele pede ao main, que cifra com
// `safeStorage` — DPAPI no Windows, Keychain no macOS — e grava em
// `userData/cloud-store.json`. Sem cifra disponível (Linux sem keyring, por
// exemplo) o valor é gravado em claro com aviso, para o app não ficar sem
// login em vez de sem segurança adicional.
// ---------------------------------------------------------------------
type Cofre = Record<string, { enc: boolean; v: string }>;
const COFRE_CHAVES_PERMITIDAS = /^irisflow\.[a-z0-9_.-]{1,64}$/i;

function caminhoDoCofre(): string {
  return path.join(app.getPath('userData'), 'cloud-store.json');
}
function lerCofre(): Cofre {
  try {
    const raw = fs.readFileSync(caminhoDoCofre(), 'utf-8');
    const parsed: unknown = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? (parsed as Cofre) : {};
  } catch {
    return {};
  }
}
function gravarCofre(c: Cofre): void {
  fs.mkdirSync(path.dirname(caminhoDoCofre()), { recursive: true });
  fs.writeFileSync(caminhoDoCofre(), JSON.stringify(c), { encoding: 'utf-8', mode: 0o600 });
}
function chaveValida(chave: unknown): chave is string {
  return typeof chave === 'string' && COFRE_CHAVES_PERMITIDAS.test(chave);
}

ipcMain.handle('irisflow:secure-get', (_e, chave: unknown): string | null => {
  if (!chaveValida(chave)) return null;
  const item = lerCofre()[chave];
  if (!item) return null;
  try {
    if (!item.enc) return item.v;
    if (!safeStorage.isEncryptionAvailable()) return null;
    return safeStorage.decryptString(Buffer.from(item.v, 'base64'));
  } catch (e) {
    console.warn('[cofre] não foi possível ler', chave, e);
    return null;
  }
});

ipcMain.handle('irisflow:secure-set', (_e, chave: unknown, valor: unknown): boolean => {
  // 2 MB: a fila offline pode acumular relatórios; safeStorage lida com isso.
  if (!chaveValida(chave) || typeof valor !== 'string' || valor.length > 2_000_000) return false;
  const cofre = lerCofre();
  if (safeStorage.isEncryptionAvailable()) {
    cofre[chave] = { enc: true, v: safeStorage.encryptString(valor).toString('base64') };
  } else {
    console.warn('[cofre] safeStorage indisponível neste sistema — gravando sem cifra');
    cofre[chave] = { enc: false, v: valor };
  }
  gravarCofre(cofre);
  return true;
});

ipcMain.handle('irisflow:secure-remove', (_e, chave: unknown): boolean => {
  if (!chaveValida(chave)) return false;
  const cofre = lerCofre();
  delete cofre[chave];
  gravarCofre(cofre);
  return true;
});

// Identidade do computador para o pareamento (nome exibido no app do cuidador).
ipcMain.handle('irisflow:app-info', () => ({
  version: app.getVersion(),
  hostname: os.hostname(),
  platform: process.platform,
  encryptionAvailable: safeStorage.isEncryptionAvailable(),
}));

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
      // No Modo Computador esta janela fica ESCONDIDA enquanto a câmera e o
      // motor continuam rodando nela. Sem isto o Chromium congela o
      // `requestAnimationFrame` de janela oculta e o olhar para de chegar à
      // sobreposição — o cursor sobre o Windows simplesmente trava.
      backgroundThrottling: false,
    },
  });
  janelaPrincipal = win;
  win.on('closed', () => { if (janelaPrincipal === win) janelaPrincipal = null; });

  // Zoom travado em 1: o Modo Computador converte px CSS do app em DIP da
  // tela, e um Ctrl+= acidental (menu padrão do Electron) desalinharia o
  // cursor sobre o Windows sem parecer erro de calibração.
  win.webContents.on('did-finish-load', () => {
    win.webContents.setZoomFactor(1);
    win.webContents.setVisualZoomLevelLimits(1, 1).catch(() => undefined);
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
  const politica = cspComNuvem(
    app.isPackaged ? CSP : CSP_DEV,
    lerVariavelDoFrontend('VITE_SUPABASE_URL'),
    lerVariavelDoFrontend('VITE_DESKTOP_SYNC_URL'),
  );
  session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': [politica],
      },
    });
  });

  // Modo Computador: cursor do IrisFlow sobre o sistema. A sobreposição é a
  // página `overlay.html` do mesmo build do frontend, com preload próprio.
  registrarModoComputador({
    janelaPrincipal: () => janelaPrincipal,
    preloadDaSobreposicao: path.join(__dirname, 'overlayPreload.cjs'),
    carregarSobreposicao: (janela) =>
      app.isPackaged
        ? janela.loadFile(path.join(__dirname, '..', 'frontend', 'dist', 'overlay.html'))
        : janela.loadURL(`${DEV_SERVER_URL}/overlay.html`),
  });

  // Voz clonada local (sidecar Python / executável em resources/voice-engine).
  const voz = registrarVoz({ raizDoProjeto: RAIZ_DO_PROJETO, janelaPrincipal: () => janelaPrincipal });
  app.on('before-quit', () => voz.encerrar());

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
