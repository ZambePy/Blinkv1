import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
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
