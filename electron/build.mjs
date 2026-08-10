import { build as esbuildBuild, context } from 'esbuild';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Compila o processo main + preload do Electron (TypeScript -> CJS).
const options = {
  entryPoints: [path.join(__dirname, 'main.ts'), path.join(__dirname, 'preload.ts')],
  outdir: path.join(__dirname, '..', 'dist-electron'),
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node20',
  external: ['electron'],
  sourcemap: true,
  logLevel: 'info',
};

export async function runBuild({ watch = false } = {}) {
  if (watch) {
    const ctx = await context(options);
    await ctx.watch();
    console.log('[electron:build] observando electron/ para recompilar automaticamente...');
    return ctx;
  }
  await esbuildBuild(options);
  console.log('[electron:build] build concluído em dist-electron/');
  return null;
}

const isMain = process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const watch = process.argv.includes('--watch');
  await runBuild({ watch });
  if (!watch) process.exit(0);
}
