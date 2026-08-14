// Compara dois relatórios de accuracy (baseline vs L2CS) do startAccuracyTest.
//
// Uso:
//   node scripts/l2cs_ab_compare.mjs <baseline.json> <l2cs.json>
//
// Fluxo A/B recomendado (mesmo usuário, condições consistentes, back-to-back):
//
//   Sessão A — baseline (L2CS off):
//     1. DevTools console:  localStorage.setItem('l2cs.enabled','false'); location.reload();
//     2. Calibrar normalmente
//     3. SettingsScreen → "Testar precisão" → JSON baixa em Downloads
//     4. Renomear para baseline.json
//
//   Sessão B — L2CS on:
//     5. DevTools console:  localStorage.setItem('l2cs.enabled','true'); location.reload();
//     6. Aguardar `[L2CS] worker ready` no console
//     7. Calibrar de novo (reload zerou a calibração em memória; ainda bem —
//        vetor mudou de 31 p/ 38 dims)
//     8. SettingsScreen → "Testar precisão" → JSON baixa
//     9. Renomear para l2cs.json
//
//   Comparação:
//     10. node scripts/l2cs_ab_compare.mjs baseline.json l2cs.json
//
// O script valida que os dois relatórios têm `pipeline.l2csEnabled` opostos
// (previne mistura acidental) e imprime deltas nas métricas-chave.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.length !== 2) {
  console.error('uso: node scripts/l2cs_ab_compare.mjs <baseline.json> <l2cs.json>');
  process.exit(2);
}

const [baselinePath, l2csPath] = args.map((p) => path.resolve(p));
const baseline = JSON.parse(await readFile(baselinePath, 'utf-8'));
const l2cs = JSON.parse(await readFile(l2csPath, 'utf-8'));

// Validação de metadados — os campos `pipeline` foram adicionados ao
// startAccuracyTest justamente para prevenir mislabel na comparação.
function pipeFlag(r, name) {
  if (!r.pipeline) {
    console.error(`⚠ ${name}: relatório sem campo 'pipeline'. Provavelmente foi gerado antes do auto-tag — impossível confirmar qual pipeline estava ativa.`);
    return null;
  }
  return r.pipeline.l2csEnabled;
}
const bFlag = pipeFlag(baseline, path.basename(baselinePath));
const lFlag = pipeFlag(l2cs, path.basename(l2csPath));
if (bFlag === true) console.error('⚠ baseline tem l2csEnabled=true — argumentos trocados?');
if (lFlag === false) console.error('⚠ l2cs tem l2csEnabled=false — argumentos trocados?');
if (bFlag !== null && lFlag !== null && bFlag === lFlag) {
  console.error(`✗ Ambos relatórios têm l2csEnabled=${bFlag}. Nada para comparar. Abortando.`);
  process.exit(1);
}

// Aviso de condições diferentes — comparação só faz sentido em condições
// comparáveis (mesmo usuário, mesma iluminação, mesma pose de cabeça).
function metaHash(r) {
  const m = r.meta ?? {};
  return `${m.iluminacao ?? '?'}|${m.oculos ? 'oc' : 'so'}|${m.movimentoCabeca ?? '?'}|${r.resolution ?? '?'}`;
}
const hb = metaHash(baseline), hl = metaHash(l2cs);
if (hb !== hl) {
  console.error(`⚠ Condições diferentes entre relatórios — comparação pode ser injusta:`);
  console.error(`  baseline: ${hb}`);
  console.error(`  l2cs    : ${hl}`);
}

// Formatação de linha da tabela
function fmt(baseVal, l2csVal, unit = 'px', lowerIsBetter = true) {
  const delta = l2csVal - baseVal;
  const pct = baseVal === 0 ? 0 : (delta / baseVal) * 100;
  const better = lowerIsBetter ? delta < 0 : delta > 0;
  const arrow = Math.abs(pct) < 1 ? '≈' : (better ? '↓' : '↑');
  const marker = Math.abs(pct) < 3 ? ' ' : (better ? '✓' : '✗');
  return {
    base: `${baseVal.toFixed(1)}${unit}`,
    l2cs: `${l2csVal.toFixed(1)}${unit}`,
    delta: `${delta >= 0 ? '+' : ''}${delta.toFixed(1)}${unit}`,
    pct: `${arrow} ${pct >= 0 ? '+' : ''}${pct.toFixed(1)}%`,
    marker,
  };
}

const br = baseline.result, lr = l2cs.result;

console.log('\n===== A/B: baseline vs L2CS =====');
console.log(`baseline: ${path.basename(baselinePath)}  ${baseline.timestamp}`);
console.log(`l2cs    : ${path.basename(l2csPath)}  ${l2cs.timestamp}`);
console.log(`condição: ${hb === hl ? hb : 'DIVERGE — ver acima'}`);
console.log(`pipeline: baseline=${bFlag}  l2cs=${lFlag}`);
console.log('');

const rows = [
  ['meanError',      fmt(br.meanError,   lr.meanError)],
  ['medianError',    fmt(br.medianError, lr.medianError)],
  ['p90Error',       fmt(br.p90Error,    lr.p90Error)],
  ['maxError',       fmt(br.maxError,    lr.maxError)],
  ['meanErrorX',     fmt(br.meanErrorX,  lr.meanErrorX)],
  ['meanErrorY',     fmt(br.meanErrorY,  lr.meanErrorY)],
  ['meanErrorDeg',   fmt(br.meanErrorDeg, lr.meanErrorDeg, '°')],
  ['jitterRMS',      fmt(br.jitterRMS,   lr.jitterRMS)],
];

const colW = { metric: 14, base: 12, l2cs: 12, delta: 12, pct: 12 };
const pad = (s, w) => String(s).padEnd(w);
console.log(pad('métrica', colW.metric) + pad('baseline', colW.base) + pad('l2cs', colW.l2cs) + pad('delta', colW.delta) + pad('%', colW.pct) + ' ');
console.log('─'.repeat(colW.metric + colW.base + colW.l2cs + colW.delta + colW.pct + 2));
for (const [name, f] of rows) {
  console.log(pad(name, colW.metric) + pad(f.base, colW.base) + pad(f.l2cs, colW.l2cs) + pad(f.delta, colW.delta) + pad(f.pct, colW.pct) + ' ' + f.marker);
}

// Ganho global (média simples das % de melhoria em meanError + p90 + jitter)
const gainPct = -(((lr.meanError - br.meanError) / br.meanError) + ((lr.p90Error - br.p90Error) / br.p90Error) + ((lr.jitterRMS - br.jitterRMS) / br.jitterRMS)) / 3 * 100;
console.log('');
console.log(`ganho médio (mean+p90+jitter): ${gainPct >= 0 ? '+' : ''}${gainPct.toFixed(1)}%  (positivo = L2CS melhor)`);

// Comparação por ponto — quais pioram, quais melhoram
console.log('\n===== por ponto =====');
if (baseline.diagnostics && l2cs.diagnostics && baseline.diagnostics.length === l2cs.diagnostics.length) {
  console.log(pad('ponto', 20) + pad('baseline', 12) + pad('l2cs', 12) + pad('delta', 12) + ' ');
  console.log('─'.repeat(58));
  let worse = 0, better = 0, same = 0;
  for (let i = 0; i < baseline.diagnostics.length; i++) {
    const b = baseline.diagnostics[i];
    const l = l2cs.diagnostics[i];
    const d = l.error - b.error;
    const marker = Math.abs(d) < 5 ? '  ' : (d < 0 ? ' ✓' : ' ✗');
    if (d < -5) better++;
    else if (d > 5) worse++;
    else same++;
    console.log(pad(b.name ?? `pt${i}`, 20) + pad(b.error.toFixed(1) + 'px', 12) + pad(l.error.toFixed(1) + 'px', 12) + pad((d >= 0 ? '+' : '') + d.toFixed(1) + 'px', 12) + marker);
  }
  console.log('─'.repeat(58));
  console.log(`melhoraram: ${better} | pioraram: ${worse} | ~iguais: ${same}  (limiar ±5 px)`);
} else {
  console.log('(diagnostics ausentes ou tamanhos diferentes — pulando)');
}

// Verdicto textual — heurística conservadora para produção
console.log('\n===== veredicto =====');
const meanImprovementPct = -((lr.meanError - br.meanError) / br.meanError) * 100;
const jitterImprovementPct = -((lr.jitterRMS - br.jitterRMS) / br.jitterRMS) * 100;
if (meanImprovementPct >= 10) {
  console.log(`✅ L2CS melhora meanError em ${meanImprovementPct.toFixed(1)}% — ganho substancial, promover flag para default vale a pena.`);
} else if (meanImprovementPct >= 3) {
  console.log(`~ L2CS melhora meanError em ${meanImprovementPct.toFixed(1)}% — ganho modesto. Rodar 2-3 sessões para confirmar antes de promover.`);
} else if (meanImprovementPct > -3) {
  console.log(`= L2CS empata (${meanImprovementPct.toFixed(1)}%) — não vale o custo de compute. Investigar: EXPAND_FACTOR, sinal do pitch, cadência do worker.`);
} else {
  console.log(`✗ L2CS piora meanError em ${(-meanImprovementPct).toFixed(1)}% — algo está errado. Ver §6 do L2CS-NET.md (falhas silenciosas): EXPAND_FACTOR fora da convenção, ordem yaw/pitch, mirror, decodificação, canal de cor.`);
}
if (Math.abs(jitterImprovementPct) > 15) {
  console.log(`  jitter: ${jitterImprovementPct >= 0 ? 'melhora' : 'piora'} ${Math.abs(jitterImprovementPct).toFixed(1)}% — considerar retunar One Euro (E8.2) antes de decidir.`);
}
