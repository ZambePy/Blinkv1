// Sumariza um relatório de accuracy (saída do startAccuracyTest).
//
// Uso:
//   node scripts/l2cs_report_summarize.mjs <accuracy-report.json>
//
// Fluxo:
//   1. Rodar o app (npm --prefix frontend run dev)
//   2. Calibrar (aguardando [L2CS] worker ready no console antes de calibrar)
//   3. SettingsScreen → "Testar precisão" → JSON baixa em Downloads/
//   4. node scripts/l2cs_report_summarize.mjs Downloads/accuracy-report-<ts>.json
//
// Substitui l2cs_ab_compare.mjs. Como L2CS agora é o único pipeline, não há
// baseline "sem L2CS" para comparar — a métrica útil é acurácia absoluta.

import { readFile } from 'node:fs/promises';
import path from 'node:path';

const args = process.argv.slice(2);
if (args.length !== 1) {
  console.error('uso: node scripts/l2cs_report_summarize.mjs <accuracy-report.json>');
  process.exit(2);
}

const reportPath = path.resolve(args[0]);
const report = JSON.parse(await readFile(reportPath, 'utf-8'));

if (!report.pipeline || report.pipeline.variant !== 'l2cs+ridge') {
  console.error(
    `⚠ ${path.basename(reportPath)}: pipeline.variant="${report.pipeline?.variant ?? 'ausente'}" ` +
    `(esperado "l2cs+ridge"). Relatório provavelmente antigo (pré-consolidação L2CS) — as métricas absolutas ainda valem, mas o campo pipeline está fora do formato atual.`,
  );
}

const r = report.result;
const meta = report.meta ?? {};

console.log(`\n===== accuracy report =====`);
console.log(`arquivo   : ${path.basename(reportPath)}`);
console.log(`timestamp : ${report.timestamp}`);
console.log(`resolução : ${report.resolution}`);
console.log(`pipeline  : ${report.pipeline?.variant ?? '?'} (regressor=${report.pipeline?.regressor ?? '?'})`);
console.log(`condição  : ilum=${meta.iluminacao ?? '?'} | óculos=${meta.oculos ? 'sim' : 'não'} | cabeça=${meta.movimentoCabeca ?? '?'} | ${meta.minutosDeSessao ?? '?'} min`);
if (meta.usuario) console.log(`usuário   : ${meta.usuario}`);
if (meta.observacoes) console.log(`obs       : ${meta.observacoes}`);
console.log('');

const rows = [
  ['meanError',      r.meanError,    'px'],
  ['medianError',    r.medianError,  'px'],
  ['p90Error',       r.p90Error,     'px'],
  ['maxError',       r.maxError,     'px'],
  ['meanErrorX',     r.meanErrorX,   'px'],
  ['meanErrorY',     r.meanErrorY,   'px'],
  ['meanErrorDeg',   r.meanErrorDeg, '°'],
  ['errorPct',       r.errorPct,     '%'],
  ['jitterRMS',      r.jitterRMS,    'px'],
];

const pad = (s, w) => String(s).padEnd(w);
console.log(pad('métrica', 16) + pad('valor', 12));
console.log('─'.repeat(28));
for (const [name, val, unit] of rows) {
  console.log(pad(name, 16) + pad(`${val.toFixed(1)}${unit}`, 12));
}

console.log('');
console.log(`classificação: ${r.score}`);

// Referência qualitativa (mesmos thresholds de finishTest em src/accuracy.ts).
console.log('  < 30 px = Excelente | < 60 px = Bom | < 100 px = Regular | ≥ 100 px = Ruim');

// Comparação por ponto — mostra dispersão espacial (útil pra identificar
// bordas com bias sistemático).
if (report.diagnostics && report.diagnostics.length > 0) {
  console.log('\n===== por ponto =====');
  console.log(pad('ponto', 8) + pad('erro', 12) + pad('jitter', 12) + pad('errX', 10) + pad('errY', 10));
  console.log('─'.repeat(52));
  for (const d of report.diagnostics) {
    const flag = d.error > 100 ? ' ✗' : d.error > 60 ? ' ~' : '';
    console.log(
      pad(d.name, 8) +
      pad(`${d.error.toFixed(1)}px`, 12) +
      pad(`${d.jitterRMS.toFixed(1)}px`, 12) +
      pad(`${d.errorX.toFixed(0)}px`, 10) +
      pad(`${d.errorY.toFixed(0)}px`, 10) +
      flag,
    );
  }
}

// Se meanError > 100 ou jitter alto, orienta rumo aos suspeitos silenciosos
// documentados em §6 do L2CS-NET.md — o script serve como triagem inicial.
console.log('\n===== triagem =====');
if (r.meanError > 100) {
  console.log(`✗ meanError=${r.meanError.toFixed(0)}px alto. Investigar (§6 do L2CS-NET.md):`);
  console.log(`  • EXPAND_FACTOR fora da convenção de treino (varredura [1.0..2.0])`);
  console.log(`  • Ordem yaw/pitch trocada (rodar l2cs_axis_validation.mjs)`);
  console.log(`  • Sinal do pitch invertido (foto look_down)`);
  console.log(`  • BGR/RGB trocado (offset sistemático em look_center)`);
} else if (r.meanError > 60) {
  console.log(`~ meanError=${r.meanError.toFixed(0)}px marginal. Se cabeça estava livre, aceitável;`);
  console.log(`  se estava parada, considerar retunar One Euro (E8) ou revisar EXPAND_FACTOR.`);
} else {
  console.log(`✓ meanError=${r.meanError.toFixed(0)}px dentro do esperado.`);
}

if (r.jitterRMS > 30) {
  console.log(`✗ jitter=${r.jitterRMS.toFixed(0)}px alto — considerar preset "estavel" (mincutoff menor, buffer on)`);
} else if (r.jitterRMS < 5 && r.meanError > 200) {
  console.log(`⚠ jitter=${r.jitterRMS.toFixed(1)}px MUITO baixo com erro alto — provável colapso de calibração`);
  console.log(`  (predições coladas no mesmo ponto da tela). Recalibrar do zero.`);
}
