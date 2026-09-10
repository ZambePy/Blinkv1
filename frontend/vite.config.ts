import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { CSP, cspComNuvem } from '../src/electronSecurity.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Endpoint que grava o accuracy-report na raiz do projeto. Registrado no
// dev server e no preview: o dia de medição roda no build de produção
// (`vite preview`), que representa o desempenho real.
function saveAccuracyReportPlugin(): Plugin {
  const projectRoot = path.resolve(__dirname, '..');
  const handler = (req: import('node:http').IncomingMessage,
                   res: import('node:http').ServerResponse,
                   next: () => void) => {
        if (req.method !== 'POST') { next(); return; }
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            // Nunca apagar relatórios anteriores: um dia de medição tem
            // dezenas, e o nome com `Date.now()` já evita colisão.
            const fname = `accuracy-report-${Date.now()}.json`;
            fs.writeFileSync(path.join(projectRoot, fname), body, 'utf-8');
            res.statusCode = 200;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ saved: fname }));
          } catch (e) {
            res.statusCode = 500;
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ error: String(e) }));
          }
        });
  };

  return {
    name: 'save-accuracy-report',
    configureServer(server) {
      server.middlewares.use('/__/save-accuracy-report', handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use('/__/save-accuracy-report', handler);
    },
  };
}

// No build empacotado o Electron carrega `file://`, sem cabeçalhos HTTP, então a
// CSP entra como `<meta>`. Só no build: em dev o plugin do React injeta um
// script inline que ela bloquearia. A origem do Supabase (login e mensagens do
// cuidador) entra em `connect-src` quando `VITE_SUPABASE_URL` existe no .env —
// é a única saída de rede além de localhost que o app tem.
function cspMetaPlugin(env: Record<string, string>): Plugin {
  return {
    name: 'csp-meta',
    apply: 'build',
    transformIndexHtml() {
      return [{ tag: 'meta', attrs: { 'http-equiv': 'Content-Security-Policy', content: cspComNuvem(CSP, env.VITE_SUPABASE_URL, env.VITE_DESKTOP_SYNC_URL) }, injectTo: 'head-prepend' }];
    },
  };
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => ({
  // Caminhos relativos: o Electron carrega o build via `file://`, onde `/assets`
  // apontaria para a raiz do disco.
  base: './',
  plugins: [react(), saveAccuracyReportPlugin(), cspMetaPlugin(loadEnv(mode, __dirname, 'VITE_'))],
  // Carimbo do build, desenhado num canto da tela de calibração.
  //
  // Três rodadas de depuração foram gastas com o navegador servindo um bundle
  // antigo em cache: o sintoma é idêntico ao do bug que se está caçando, e
  // nada na tela distingue os dois. Com o carimbo, uma foto já responde
  // "é o código novo?".
  define: {
    __BUILD_ID__: JSON.stringify(
      new Date().toISOString().slice(5, 16).replace('T', ' '),
    ),
  },
  envPrefix: 'VITE_',
  resolve: {
    alias: {
      '@tracker': path.resolve(__dirname, '../src'),
      // O worker do L2CS vive em ../src/l2cs/l2cs.worker.ts (fora do frontend/),
      // e o Rolldown resolve deps a partir do dir do arquivo. Alias explícito
      // pra `onnxruntime-web` (que só existe em frontend/node_modules) faz o
      // bundler achar. Mesma razão do path mapping em tsconfig.app.json.
      'onnxruntime-web': path.resolve(__dirname, 'node_modules/onnxruntime-web'),
    },
  },
  optimizeDeps: {
    exclude: ['onnxruntime-web']
  },
  assetsInclude: ['**/*.wasm', '**/ort-wasm-simd-threaded.mjs'],
  server: {
    // Só aceita conexões de localhost por padrão — evita expor dev server na rede
    host: '127.0.0.1',
    port: 5173,
    strictPort: false,
    fs: {
      allow: [path.resolve(__dirname, '..')],
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      // Duas páginas: o app (`index.html`) e a sobreposição do Modo Computador
      // (`overlay.html`), que o Electron abre numa janela transparente por
      // cima do Windows. Mesmo bundle, mesma CSP (o plugin acima injeta a
      // <meta> em todo HTML do build).
      input: {
        main: path.resolve(__dirname, 'index.html'),
        overlay: path.resolve(__dirname, 'overlay.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-router') || id.includes('/react/') || id.includes('/react-dom/')) {
              return 'react-vendor';
            }
            if (id.includes('i18next') || id.includes('react-i18next')) {
              return 'i18n';
            }
            if (id.includes('lucide-react')) {
              return 'icons';
            }
          }
        },
      },
    },
  },
}));
