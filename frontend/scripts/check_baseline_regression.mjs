#!/usr/bin/env node
// D8.1 (ROADMAP §5) — gate de regressão de precisão.
//
// PARA QUE SERVE
// Sem gate automatizado, todo commit da semana passa livre pelo CI mesmo que
// aumente silenciosamente o erro médio do baseline (57 px / 0.9°). Este
// script recebe DOIS relatórios do `measure_baseline.mjs` — um snapshot
// baseline (committed em `fixtures/replay/*.report.json` como referência
// esperada) e o current (produzido na rodada corrente de CI) — e falha
// (exit 1) quando a variante-baseline do current excede o baseline por
// mais que a tolerância configurada.
//
// O QUE COMPARA
// Só a linha "baseline (balanceado-v2, features gravadas)" — a primeira
// variante default do `measure_baseline`. É a única que sempre existe e
// representa o pipeline em produção; comparar ablações/A2-flags entre
// rodadas é ruído (elas são exploratórias, não são "o que roda em prod").
// Métrica gate-ada: `meanErrorPx`. As outras (`medianErrorPx`, `p90ErrorPx`)
// são exibidas no log mas não bloqueiam — evita false-positive por outlier
// isolado inflando p90 sem mover a média.
//
// TOLERÂNCIA
// Default 15% acima do baseline (ex.: baseline 57 px → falha se current > 65.55 px).
// ⚠️ VALOR PRELIMINAR — o ROADMAP §5, riscos do D8, diz explicitamente
// "calibrar a tolerância com a variância real observada nos replays desta
// semana (D2), não com um número arbitrário escolhido a priori". 15% é
// chutado; precisa recalibrar quando houver histórico de N execuções da
// MESMA fixture com variância mensurada. Até lá, 15% protege contra
// regressões grandes (>20%) sem quebrar em ruído normal (<10%).
//
// USO
//   node frontend/scripts/check_baseline_regression.mjs \
//     --baseline fixtures/replay/2026-XX-XX_sem-oculos.baseline.report.json \
//     --current  fixtures/replay/2026-XX-XX_sem-oculos.current.report.json \
//     [--tolerance-pct 15]
//
// EXIT CODES
//   0 = sem regressão detectada (ou dentro da tolerância)
//   1 = regressão detectada (erro > baseline + tolerância)
//   2 = argumento inválido / arquivo faltando / relatório sem baseline

import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import {
  BASELINE_VARIANT_NAME,
  DEFAULT_TOLERANCE_PCT,
  decideRegression,
  findBaselineVariant,
} from './checkBaselineDecision.mjs';

function parseArgs(argv) {
  const args = { baseline: null, current: null, tolerancePct: DEFAULT_TOLERANCE_PCT };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--baseline') args.baseline = argv[++i];
    else if (a === '--current') args.current = argv[++i];
    else if (a === '--tolerance-pct') args.tolerancePct = Number(argv[++i]);
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else throw new Error(`Argumento desconhecido: ${a}. Use --help.`);
  }
  if (!args.baseline || !args.current) {
    printHelp();
    throw new Error('Faltam --baseline e --current (paths de relatórios do measure_baseline).');
  }
  if (!Number.isFinite(args.tolerancePct) || args.tolerancePct < 0) {
    throw new Error(`--tolerance-pct precisa ser número >= 0. Recebi ${args.tolerancePct}`);
  }
  return args;
}

function printHelp() {
  process.stdout.write(`
Uso:
  node frontend/scripts/check_baseline_regression.mjs \\
    --baseline <baseline.report.json> --current <current.report.json> \\
    [--tolerance-pct 15]

Compara o meanErrorPx da variante "${BASELINE_VARIANT_NAME}" entre
dois relatórios do measure_baseline. Falha (exit 1) se current > baseline
+ tolerância.

Exit codes:
  0 = OK (dentro da tolerância)
  1 = REGRESSÃO
  2 = erro de I/O ou entrada inválida
`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));

  const baselineAbs = resolvePath(args.baseline);
  const currentAbs = resolvePath(args.current);
  for (const p of [baselineAbs, currentAbs]) {
    if (!existsSync(p)) {
      process.stderr.write(`ERRO: arquivo não existe: ${p}\n`);
      return 2;
    }
  }

  const baselineReport = JSON.parse(await readFile(baselineAbs, 'utf8'));
  const currentReport = JSON.parse(await readFile(currentAbs, 'utf8'));

  const baselineVar = findBaselineVariant(baselineReport);
  const currentVar = findBaselineVariant(currentReport);
  if (!baselineVar) {
    process.stderr.write(
      `ERRO: relatório baseline não contém a variante "${BASELINE_VARIANT_NAME}".\n` +
      `      Regravar o baseline com o measure_baseline atual (sem --variants) ` +
      `para incluir essa linha.\n`,
    );
    return 2;
  }
  if (!currentVar) {
    process.stderr.write(
      `ERRO: relatório current não contém a variante "${BASELINE_VARIANT_NAME}".\n` +
      `      Este é o gate que corre em CI — o measure_baseline precisa rodar ` +
      `sem --variants (usa os defaults, que incluem a linha baseline).\n`,
    );
    return 2;
  }

  const decision = decideRegression({
    baselineMean: baselineVar.summary?.meanErrorPx,
    currentMean: currentVar.summary?.meanErrorPx,
    tolerancePct: args.tolerancePct,
  });

  process.stdout.write(
    `\n[check_baseline_regression]\n` +
    `  baseline: ${baselineAbs}\n` +
    `  current:  ${currentAbs}\n` +
    `  variante: "${BASELINE_VARIANT_NAME}"\n` +
    `  tolerância: ${args.tolerancePct}% acima do baseline\n\n` +
    `  baseline meanErrorPx: ${baselineVar.summary?.meanErrorPx?.toFixed(2) ?? '?'}\n` +
    `  current  meanErrorPx: ${currentVar.summary?.meanErrorPx?.toFixed(2) ?? '?'}\n`,
  );

  if (decision.verdict === 'invalid') {
    process.stderr.write(`ERRO: ${decision.reason}\n`);
    return 2;
  }

  process.stdout.write(
    `  delta:     ${decision.deltaPct >= 0 ? '+' : ''}${decision.deltaPct.toFixed(2)}% ` +
    `(threshold: ${decision.threshold.toFixed(2)} px)\n\n`,
  );

  if (decision.verdict === 'regression') {
    process.stderr.write(
      `❌ REGRESSÃO DETECTADA — meanErrorPx aumentou ${decision.deltaPct.toFixed(2)}%\n` +
      `   acima do baseline (limite: ${args.tolerancePct}%). Bloqueando merge.\n\n` +
      `   Ações possíveis:\n` +
      `   1. Rodar measure_baseline.mjs localmente com --ablation para localizar a origem.\n` +
      `   2. Se a regressão for esperada (mudança consciente de baseline), REGRAVAR\n` +
      `      o snapshot baseline com o novo número + documentar por quê no PR.\n` +
      `   3. Se for falso positivo por variância normal, considerar recalibrar\n` +
      `      --tolerance-pct com N execuções da mesma fixture.\n`,
    );
    return 1;
  }

  process.stdout.write(`✅ OK — dentro da tolerância.\n\n`);
  return 0;
}

// Só roda main quando executado direto (não em import de teste). Usa
// pathToFileURL para paridade cross-platform (Windows vs POSIX resolvem
// paths absolutos diferente na string, mas pathToFileURL(...).href
// canonicaliza para o mesmo formato que import.meta.url).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  main().then(
    (code) => process.exit(code),
    (e) => { process.stderr.write(`ERRO fatal: ${e.stack ?? e.message ?? e}\n`); process.exit(2); },
  );
}
