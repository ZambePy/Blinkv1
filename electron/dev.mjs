import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { runBuild } from './build.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FRONTEND_DIR = path.join(__dirname, '..', 'frontend');
const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL || 'http://localhost:5173';

async function waitForDevServer(url, timeoutMs = 30000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    try {
      await fetch(url);
      return;
    } catch {
      await delay(300);
    }
  }
  throw new Error(`Servidor Vite não respondeu em ${url} após ${timeoutMs}ms`);
}

async function main() {
  console.log('[electron:dev] compilando electron main/preload (modo watch)...');
  await runBuild({ watch: true });

  console.log(`[electron:dev] iniciando servidor Vite em ${FRONTEND_DIR}...`);
  const vite = spawn('npx', ['vite'], { stdio: 'inherit', shell: true, cwd: FRONTEND_DIR });

  await waitForDevServer(DEV_SERVER_URL);
  console.log(`[electron:dev] servidor Vite pronto em ${DEV_SERVER_URL}, abrindo Electron...`);

  // ELECTRON_RUN_AS_NODE, se herdado do shell, faz o binário do Electron rodar
  // como Node puro (sem app/BrowserWindow) — precisa ficar fora do processo filho.
  const electronEnv = { ...process.env, VITE_DEV_SERVER_URL: DEV_SERVER_URL };
  delete electronEnv.ELECTRON_RUN_AS_NODE;

  const electronProcess = spawn('npx', ['electron', '.'], {
    stdio: 'inherit',
    shell: true,
    env: electronEnv,
  });

  const cleanup = (code) => {
    vite.kill();
    electronProcess.kill();
    process.exit(code ?? 0);
  };

  electronProcess.on('exit', (code) => cleanup(code));
  process.on('SIGINT', () => cleanup(0));
  process.on('SIGTERM', () => cleanup(0));
}

main().catch((err) => {
  console.error('[electron:dev]', err);
  process.exit(1);
});
