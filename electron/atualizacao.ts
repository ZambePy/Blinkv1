/**
 * Atualização automática.
 *
 * Sem isto, cada correção era "baixe o instalador de novo, clique em 'executar
 * assim mesmo' no SmartScreen, reinstale" — e uma família não faz isso duas
 * vezes. Na beta os bugs VÃO aparecer; o mecanismo de entregar a correção é
 * mais importante que a correção.
 *
 * Onde o app procura a versão nova é decidido FORA do código, de propósito:
 *
 *   - no app empacotado, em `resources/atualizacao.json` (`{ "url": ... }`),
 *     escrito por `package-app.mjs` a partir da variável IRISFLOW_UPDATE_URL
 *     no momento do empacotamento;
 *   - em desenvolvimento, na própria variável de ambiente.
 *
 * Sem endereço, o módulo não faz nada e diz isso no log. O servidor esperado
 * é o "generic" do electron-updater: um diretório HTTP com `latest.yml` e o
 * instalador — qualquer hospedagem estática serve, inclusive um bucket.
 *
 * Política: baixa sozinho, NUNCA reinicia sozinho. Reiniciar no meio de uma
 * frase de quem se comunica por fixação ocular é perder a frase. A instalação
 * acontece quando o cuidador aceita, ou ao fechar o app.
 */

import { app, ipcMain, type BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';

export type EstadoDaAtualizacao =
  | { fase: 'inativa'; motivo: string }
  | { fase: 'verificando' }
  | { fase: 'em_dia'; versao: string }
  | { fase: 'baixando'; versao: string; progresso: number }
  | { fase: 'pronta'; versao: string }
  | { fase: 'erro'; mensagem: string };

export const CANAIS_ATUALIZACAO = {
  estado: 'irisflow:atualizacao-estado',
  mudou: 'irisflow:atualizacao-mudou',
  instalar: 'irisflow:atualizacao-instalar',
  verificar: 'irisflow:atualizacao-verificar',
} as const;

/** Entre verificações. Seis horas: quem deixa o app aberto o dia inteiro vê a versão nova no mesmo dia. */
const INTERVALO_MS = 6 * 3600_000;

function lerUrl(): string | null {
  const daVariavel = process.env.IRISFLOW_UPDATE_URL?.trim();
  if (daVariavel) return daVariavel;
  if (!app.isPackaged) return null;
  try {
    const arquivo = path.join(process.resourcesPath, 'atualizacao.json');
    const cfg = JSON.parse(fs.readFileSync(arquivo, 'utf-8')) as { url?: unknown };
    return typeof cfg.url === 'string' && cfg.url.trim() ? cfg.url.trim() : null;
  } catch {
    return null;
  }
}

export function registrarAtualizacao(janela: () => BrowserWindow | null): void {
  let estado: EstadoDaAtualizacao = { fase: 'inativa', motivo: 'ainda não iniciado' };

  const publicar = (novo: EstadoDaAtualizacao) => {
    estado = novo;
    const w = janela();
    if (w && !w.isDestroyed()) w.webContents.send(CANAIS_ATUALIZACAO.mudou, estado);
  };

  const daJanela = (e: Electron.IpcMainInvokeEvent) => {
    const w = janela();
    return !!w && !w.isDestroyed() && e.sender === w.webContents;
  };

  ipcMain.handle(CANAIS_ATUALIZACAO.estado, (e) => (daJanela(e) ? estado : null));

  const url = lerUrl();
  if (!url) {
    publicar({ fase: 'inativa', motivo: 'sem endereço de atualização (IRISFLOW_UPDATE_URL / resources/atualizacao.json)' });
    console.log('[atualizacao] desligada:', (estado as { motivo: string }).motivo);
    ipcMain.handle(CANAIS_ATUALIZACAO.instalar, () => false);
    ipcMain.handle(CANAIS_ATUALIZACAO.verificar, () => false);
    return;
  }
  if (!app.isPackaged) {
    // Em desenvolvimento o updater não tem o que atualizar (não há app.asar),
    // e o electron-updater lança ao tentar. Registra o endereço e para.
    publicar({ fase: 'inativa', motivo: `desenvolvimento (endereço configurado: ${url})` });
    ipcMain.handle(CANAIS_ATUALIZACAO.instalar, () => false);
    ipcMain.handle(CANAIS_ATUALIZACAO.verificar, () => false);
    return;
  }

  // Import tardio: o módulo é pesado e só faz sentido empacotado.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');

  autoUpdater.setFeedURL({ provider: 'generic', url });
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.logger = null;

  autoUpdater.on('checking-for-update', () => publicar({ fase: 'verificando' }));
  autoUpdater.on('update-not-available', (info) => publicar({ fase: 'em_dia', versao: info.version }));
  autoUpdater.on('update-available', (info) => publicar({ fase: 'baixando', versao: info.version, progresso: 0 }));
  autoUpdater.on('download-progress', (p) => {
    if (estado.fase === 'baixando') publicar({ ...estado, progresso: Math.round(p.percent) });
  });
  autoUpdater.on('update-downloaded', (info) => publicar({ fase: 'pronta', versao: info.version }));
  autoUpdater.on('error', (err) => {
    // Erro de atualização nunca pode parecer erro do app: fica no log e no
    // estado, e o app segue funcionando com a versão que tem.
    console.warn('[atualizacao] falha:', err?.message ?? err);
    publicar({ fase: 'erro', mensagem: String(err?.message ?? err).slice(0, 200) });
  });

  const verificar = () => {
    autoUpdater.checkForUpdates().catch(() => undefined);
  };

  ipcMain.handle(CANAIS_ATUALIZACAO.verificar, (e) => {
    if (!daJanela(e)) return false;
    verificar();
    return true;
  });
  ipcMain.handle(CANAIS_ATUALIZACAO.instalar, (e) => {
    if (!daJanela(e) || estado.fase !== 'pronta') return false;
    // `isSilent=false, isForceRunAfter=true`: instala e reabre. Só chega aqui
    // por decisão do cuidador na tela.
    setImmediate(() => autoUpdater.quitAndInstall(false, true));
    return true;
  });

  // Primeira verificação um pouco depois da abertura: a câmera e o motor
  // estão subindo, e disputar rede/CPU nesse momento atrasa o que importa.
  setTimeout(verificar, 20_000).unref();
  setInterval(verificar, INTERVALO_MS).unref();
  console.log('[atualizacao] ligada:', url);
}
