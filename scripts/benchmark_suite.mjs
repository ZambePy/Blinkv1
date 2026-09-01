// Benchmark Suite para Avaliação Determinística de Precisão do Blink
// Executa o pipeline sobre todas as gravações disponíveis e reporta métricas completas.

import { readFile } from 'node:fs/promises';
import { readdirSync, existsSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import esbuild from 'esbuild';

const __dirname = resolvePath();
const replayEntry = join(__dirname, 'scripts', '_replay_impl.ts');

// Compila o bundle do replay em memória
const build = await esbuild.build({
  entryPoints: [replayEntry],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  write: false,
  external: ['node:*'],
  logLevel: 'error',
});

const code = build.outputFiles[0].text;
const dataUrl = 'data:text/javascript;base64,' + Buffer.from(code).toString('base64');
const replayMod = await import(dataUrl);

const fixturesDir = join(__dirname, 'fixtures', 'replay');
const recordingFiles = readdirSync(fixturesDir)
  .filter(f => f.endsWith('.jsonl'))
  .map(f => join(fixturesDir, f));

export async function runFullBenchmark(options = {}) {
  const results = [];

  for (const jsonlPath of recordingFiles) {
    const filename = jsonlPath.split(/[\\/]/).pop();
    try {
      const cliArgs = ['--jsonl', jsonlPath, '--filter', 'balanceado-v2'];
      if (options.featureSet) cliArgs.push('--feature-set', options.featureSet);
      if (options.poseCompensation) cliArgs.push('--pose-compensation');
      if (options.lambda) cliArgs.push('--lambda', String(options.lambda));

      // Captura a saída do replay executando o método do módulo
      const rep = await replayMod.executeReplayWithArgs(cliArgs);
      if (rep && rep.accuracy) {
        results.push({
          file: filename,
          report: rep,
        });
      }
    } catch (e) {
      console.warn(`[benchmark] Aviso para ${filename}:`, e?.message ?? e);
    }
  }

  return results;
}

// Se executado diretamente pelo terminal
if (process.argv[1]?.endsWith('benchmark_suite.mjs')) {
  console.log('=============================================================================');
  console.log('BLINK - SUÍTE DE BENCHMARK DE PRECISÃO E REGRESSÃO');
  console.log('=============================================================================\n');

  // Executa para cada dataset
  for (const jsonlPath of recordingFiles) {
    const filename = jsonlPath.split(/[\\/]/).pop();
    const cliArgs = ['--jsonl', jsonlPath, '--filter', 'balanceado-v2'];
    if (process.argv.includes('--feature-set')) {
      const idx = process.argv.indexOf('--feature-set');
      cliArgs.push('--feature-set', process.argv[idx + 1]);
    }
    if (process.argv.includes('--pose-compensation')) {
      cliArgs.push('--pose-compensation');
    }
    
    console.log(`\n--- Dataset: ${filename} ---`);
    await replayMod.run(cliArgs);
  }
}
