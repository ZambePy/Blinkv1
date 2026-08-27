import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import path from 'node:path';

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Precisa espelhar o alias de `vite.config.ts`. Faltava aqui: enquanto
      // só havia `import type { ... } from '@tracker/...'` no código testado,
      // o TypeScript apagava o import e o vitest nunca precisava resolvê-lo.
      // O primeiro import de VALOR que cruzou a fronteira (Etapa 1,
      // `displayGeometry` no SettingsContext) quebrou duas suítes de uma vez.
      '@tracker': path.resolve(__dirname, '../src'),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    css: true,
  },
});
