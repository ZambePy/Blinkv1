// Bootstrap do replay determinístico (Fase 0.2 do SPRINTSELA.MD).
//
// Rodar diretamente `_replay_impl.ts` com Node não funciona: os módulos de
// src/ importam entre si sem extensão (`from './types'`), e Node ESM nativo
// exige extensão explícita. Refatorar todos os imports de src/ seria muito
// invasivo. Solução: bundlar em memória com esbuild (já é devDep) e importar
// via data URL. Zero artefatos no disco, zero mudança em src/.

import esbuild from 'esbuild';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const entry = path.resolve(__dirname, '_replay_impl.ts');

let build;
try {
  build = await esbuild.build({
    entryPoints: [entry],
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    write: false,
    // Node builtins (node:fs/promises, node:path, node:url) NÃO devem ir para
    // o bundle — esbuild resolveria a versão do Node externa.
    external: ['node:*'],
    logLevel: 'error',
  });
} catch (e) {
  process.stderr.write(`ERRO: falha ao compilar replay: ${e?.message ?? e}\n`);
  process.exit(2);
}

const code = build.outputFiles[0].text;
// data URL import: o bundle inteiro entra como um único módulo ESM em memória.
// Rota mais robusta que gravar em tmpfile (evita corridas em CI e não deixa
// lixo se o processo morrer).
const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const mod = await import(dataUrl);
if (typeof mod.run !== 'function') {
  process.stderr.write(`ERRO: bundle não exportou run().\n`);
  process.exit(2);
}
const code_ = await mod.run(process.argv.slice(2));
process.exit(code_);
