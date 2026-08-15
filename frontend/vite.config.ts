import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Endpoint dev que grava o accuracy-report na raiz do projeto e apaga
// o(s) anterior(es) — evita acúmulo de JSONs em Downloads. Só existe no
// dev server; em build, accuracy.ts cai no fallback de download.
function saveAccuracyReportPlugin(): Plugin {
  const projectRoot = path.resolve(__dirname, '..');
  return {
    name: 'save-accuracy-report',
    configureServer(server) {
      server.middlewares.use('/__/save-accuracy-report', (req, res, next) => {
        if (req.method !== 'POST') { next(); return; }
        let body = '';
        req.on('data', (chunk) => { body += chunk; });
        req.on('end', () => {
          try {
            for (const f of fs.readdirSync(projectRoot)) {
              if (/^accuracy-report-.*\.json$/.test(f)) {
                fs.unlinkSync(path.join(projectRoot, f));
              }
            }
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
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), saveAccuracyReportPlugin()],
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
});
