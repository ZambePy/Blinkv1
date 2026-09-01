import { readdirSync } from 'node:fs';
import { resolve as resolvePath, join } from 'node:path';
import esbuild from 'esbuild';

const __dirname = resolvePath();
const replayEntry = join(__dirname, 'scripts', '_replay_impl.ts');

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

async function executeOne(jsonlPath, extraArgs = []) {
  const filename = jsonlPath.split(/[\\/]/).pop();
  const cliArgs = ['--jsonl', jsonlPath, '--filter', 'balanceado-v2', ...extraArgs];
  
  // Intercept stdout
  const origWrite = process.stdout.write;
  let captured = '';
  process.stdout.write = (chunk) => {
    captured += chunk;
    return true;
  };
  
  try {
    await replayMod.run(cliArgs);
  } finally {
    process.stdout.write = origWrite;
  }

  try {
    const report = JSON.parse(captured);
    const acc = report.accuracy;
    if (!acc) return { file: filename, error: 'No accuracy section' };

    // Separate inner vs edge points
    const innerPoints = acc.perPoint.filter(p => p.targetXPx > 200 && p.targetXPx < 1700 && p.targetYPx > 100 && p.targetYPx < 950);
    const edgePoints = acc.perPoint.filter(p => !(p.targetXPx > 200 && p.targetXPx < 1700 && p.targetYPx > 100 && p.targetYPx < 950));

    const meanInner = innerPoints.length > 0
      ? innerPoints.reduce((s, p) => s + p.meanErrorPx * p.count, 0) / innerPoints.reduce((s, p) => s + p.count, 0)
      : acc.meanErrorPx;

    const meanEdge = edgePoints.length > 0
      ? edgePoints.reduce((s, p) => s + p.meanErrorPx * p.count, 0) / edgePoints.reduce((s, p) => s + p.count, 0)
      : 0;

    return {
      file: filename,
      n: acc.n,
      meanPx: acc.meanErrorPx,
      medianPx: acc.medianErrorPx,
      p90Px: acc.p90ErrorPx,
      maxPx: acc.maxErrorPx,
      meanDeg: acc.meanErrorDeg,
      innerPx: meanInner,
      edgePx: meanEdge,
      looErrorPx: report.calibration?.looErrorPx ?? 0,
      condicao: report.calibration?.espectro?.condicao ?? 0,
    };
  } catch (e) {
    return { file: filename, error: e.message };
  }
}

export async function runAll(extraArgs = []) {
  const table = [];
  for (const f of recordingFiles) {
    const res = await executeOne(f, extraArgs);
    table.push(res);
  }
  return table;
}

const args = process.argv.slice(2);
const results = await runAll(args);

console.log('\n| Dataset | Mean (px) | Median (px) | Inner (px) | Edge (px) | Max (px) | Mean (deg) | LOO (px) | Cond. Matrix |');
console.log('|---|---|---|---|---|---|---|---|---|');
for (const r of results) {
  if (r.error) {
    console.log(`| ${r.file} | ERRO: ${r.error} | | | | | | | |`);
  } else {
    console.log(`| ${r.file} | ${r.meanPx.toFixed(1)} | ${r.medianPx.toFixed(1)} | ${r.innerPx.toFixed(1)} | ${r.edgePx > 0 ? r.edgePx.toFixed(1) : '-'} | ${r.maxPx.toFixed(1)} | ${r.meanDeg.toFixed(2)}° | ${r.looErrorPx.toFixed(1)} | ${Math.round(r.condicao)} |`);
  }
}
