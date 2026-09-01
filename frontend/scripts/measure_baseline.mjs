#!/usr/bin/env node
// D2 (ROADMAP.md §5, tarefa 3) — mede o baseline de erro sobre uma gravação
// fixture, sob diferentes configurações do pipeline, sem exigir recalibração
// humana a cada execução.
//
// POR QUE EXISTE
// Sem este script, comparar "ligar isotropicLandmarks" ou "trocar o preset do
// filtro" contra o baseline exige: (1) uma nova calibração humana, (2) uma
// nova sessão de accuracy test, (3) esperança de que iluminação e postura
// tenham sido iguais aos da rodada anterior. As três coisas são caras e não
// determinísticas. Este script substitui isso por: (1) rodar `replay.mjs` sob
// cada variante, (2) comparar os números lado a lado, (3) determinístico
// sobre a mesma gravação — a fonte de variância aleatória some.
//
// O QUE NÃO FAZ
// - **Não** aciona câmera nem faz calibração ao vivo. Isso é o ponto — o
//   custo humano é zero.
// - **Não** varre flags de `EXPERIMENT` em runs separados ainda (não altera
//   `isotropicLandmarks` ou `expandFactor`). O motivo: `EXPERIMENT` é
//   carregado do `localStorage` no import de `experiment.ts` e não temos
//   `localStorage` em Node. Adicionar um override por env-var é escopo do
//   D3 (que já é o consumidor natural do sweep de `expandFactor`) — este
//   script deixa a infraestrutura pronta para receber o env-var quando D3
//   vier, mas por ora varia apenas o que o replay já expõe via CLI: o preset
//   do `OneEuroFilter` (`--filter`) e o recompute-de-features (`--recompute-features`).
// - **Não** reporta `poseDrift` (o replay ainda não expõe esse número —
//   é output do `accuracy.ts` do runtime, não da versão simplificada do
//   replay). Ver §8 do ROADMAP, "Automação completa da curva de deriva",
//   backlog não escondido.
//
// USO
//   node frontend/scripts/measure_baseline.mjs --jsonl fixtures/replay/<arquivo>.jsonl
//   node frontend/scripts/measure_baseline.mjs --jsonl <path> --out relatorio.json
//   node frontend/scripts/measure_baseline.mjs --jsonl <path> --variants estavel-v2,balanceado-v2,responsivo-v2
//
// SAÍDA
// Uma tabela em stdout comparando por variante:
//   meanErrorPx | medianErrorPx | p90ErrorPx | meanErrorDeg | frames
// E opcionalmente um JSON em `--out` com todos os relatórios agregados.

import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { resolve as resolvePath, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { DEFAULT_DRIFT_WINDOWS_MIN, buildDriftCurveVariants } from './driftWindows.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolvePath(__dirname, '..', '..');
const REPLAY_MJS = resolvePath(REPO_ROOT, 'scripts', 'replay.mjs');

// Variantes padrão.
//
// D3.2 (ROADMAP §5) — replay agora aceita presets v2 (espaço normalizado). O
// baseline default foi promovido a v2 (`balanceado-v2`) que casa com o
// default do engine desde D1-1. Isso torna os números comparáveis 1:1 com o
// accuracy test ao vivo (mesma matemática de filtro), não só entre si.
//
// ⚠️ LIMITAÇÃO EXPANDFACTOR (ainda não resolvida, ver §8 do ROADMAP)
// O sweep de `expandFactor ∈ {1.0, 1.2, 1.4, 1.6, 1.8, 2.0}` pedido pelo D3
// exigiria re-executar o L2CS com um crop diferente. Mas o gravador NÃO
// persiste pixels do vídeo (privacidade + tamanho — ver comentário em
// `src/telemetry/types.ts`); o JSONL só carrega o *resultado* do L2CS
// (`yaw`/`pitch`/`valid`/`confidence`) que foi calculado ao vivo com o
// `expandFactor` da sessão. Consequência: o sweep tem que ser feito ao vivo
// (gravar uma sessão POR valor de `expandFactor`) ou aguardar uma extensão
// futura do gravador que persista thumbnails compactos suficientes para
// re-cropar. Enquanto isso, este script varre só o que o replay expõe:
// preset do filtro e recompute-features.
const DEFAULT_VARIANTS = [
  { name: 'baseline (balanceado-v2, features gravadas)', filter: 'balanceado-v2', recomputeFeatures: false },
  { name: 'balanceado-v2 + recompute-features',          filter: 'balanceado-v2', recomputeFeatures: true  },
  { name: 'estavel-v2',                                  filter: 'estavel-v2',    recomputeFeatures: false },
  { name: 'responsivo-v2',                               filter: 'responsivo-v2', recomputeFeatures: false },
  // Mantidos para permitir comparação v1 vs v2 sobre a mesma gravação.
  { name: 'balanceado (v1, pixel space)',                filter: 'balanceado',    recomputeFeatures: false },
];

// D4.3 (ROADMAP §5) — variantes de ablação de features. Rodam sobre a mesma
// gravação com `--drop-features <grupo>` para responder "esses termos ajudam?".
// Comparação relevante: cada variante vs. baseline v2 do topo. Se uma reduzida
// EMPATA ou VENCE a completa, o campo do relatório vira insumo pra decidir se
// aquele grupo é ruído — mas só como achado preliminar (N=1 gravação, ver
// riscos do D4). Não removemos feature nenhuma com base em 1 sessão.
const ABLATION_VARIANTS = [
  { name: 'ablation: sem pose linear (yaw/pitch/roll isoladas)', filter: 'balanceado-v2', recomputeFeatures: false, drop: 'pose-linear' },
  { name: 'ablation: sem pose×offset 1ª ordem (pose-cross)',     filter: 'balanceado-v2', recomputeFeatures: false, drop: 'pose-cross' },
  { name: 'ablation: sem pose quadrática (pose²/pose×scale)',    filter: 'balanceado-v2', recomputeFeatures: false, drop: 'pose-quadratic' },
  { name: 'ablation: sem bloco L2CS inteiro',                    filter: 'balanceado-v2', recomputeFeatures: false, drop: 'l2cs' },
  // D5.1 (ROADMAP §5) — variante combinada: nenhum termo de pose (nem linear
  // isolado, nem interação com offset). Herda de D4 mas é o número específico
  // que D5 pede pra decidir "os termos de pose ajudam? por quanto?". Se essa
  // linha empatar/vencer o baseline sobre a mesma gravação, é evidência
  // preliminar de que o Ridge já compensa pose implicitamente via offsets.
  { name: 'ablation: sem pose alguma (linear + cross + quadratic)', filter: 'balanceado-v2', recomputeFeatures: false, drop: 'pose-linear,pose-cross,pose-quadratic' },
];

// D7.1 (ROADMAP §5) — variantes de sweep das flags A2 relevantes para
// decidir "essas flags devem ligar por padrão?".
//
// EXIGE --recompute-features. Motivo: `isotropicLandmarks` altera o vetor
// de features antes do StandardScaler (multiplicando x por videoW/videoH).
// Se usarmos os features gravados (que foram calculados com a flag AO VIVO
// na sessão original), a variante sweeped estaria comparando "features
// gravados sob a flag da sessão" vs "features gravados sob a flag da
// sessão" — o sweep seria NO-OP silencioso. Com --recompute-features, o
// replay reconstrói o vetor a partir dos landmarks obedecendo a env-var
// (IRISFLOW_EXP_isotropicLandmarks) que setamos abaixo. Isso torna o
// sweep genuíno.
//
// LIMITAÇÃO: `lockCameraExposure` NÃO tem variante aqui — ela afeta apenas
// `ImageCapture.applyConstraints` na câmera ao vivo, e o replay não puxa
// pixels do sensor. Comentário no `experiment.ts:loadEnvOverrides` explica
// a decisão. A escolha de ligar/desligar essa flag por padrão fica como
// pendência humana (medição ao vivo), não como número do sweep.
const A2_FLAG_VARIANTS = [
  {
    name: 'A2-5: isotropicLandmarks=OFF (baseline reforçado com recompute)',
    filter: 'balanceado-v2',
    recomputeFeatures: true,
    env: { IRISFLOW_EXP_isotropicLandmarks: 'false' },
  },
  {
    name: 'A2-5: isotropicLandmarks=ON  (candidato a ligar por default)',
    filter: 'balanceado-v2',
    recomputeFeatures: true,
    env: { IRISFLOW_EXP_isotropicLandmarks: 'true' },
  },
];

function parseArgs(argv) {
  const args = {
    jsonl: null,
    out: null,
    variants: null,          // se null, usa DEFAULT_VARIANTS
    ablation: false,         // D4.3 — adiciona ABLATION_VARIANTS
    a2Flags: false,          // D7.1 — adiciona A2_FLAG_VARIANTS
    driftCurve: null,        // D7.3 — array de janelas (em minutos)
    verbose: false,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--jsonl') args.jsonl = argv[++i];
    else if (a === '--out') args.out = argv[++i];
    else if (a === '--variants') args.variants = argv[++i];
    else if (a === '--ablation') args.ablation = true;
    else if (a === '--a2-flags') args.a2Flags = true;
    else if (a === '--drift-curve') args.driftCurve = argv[++i];
    else if (a === '--verbose' || a === '-v') args.verbose = true;
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else throw new Error(`Argumento desconhecido: ${a}. Use --help.`);
  }
  if (!args.jsonl) {
    printHelp();
    throw new Error('Falta --jsonl <path>');
  }
  return args;
}

// D7.3 (ROADMAP §5) — a lógica de parse foi extraída para
// `driftWindows.mjs` para permitir teste unitário sem I/O.

function printHelp() {
  process.stdout.write(`
Uso:
  node frontend/scripts/measure_baseline.mjs --jsonl <path> [--out <path>] [--variants a,b,c] [--ablation] [-v]

Argumentos:
  --jsonl <path>     Gravação (JSONL v2) em fixtures/replay/. Obrigatório.
  --out <path>       Salva o relatório agregado (JSON) neste caminho. Sem
                     este flag, só imprime a tabela em stdout.
  --variants <lista> Lista separada por vírgula de nomes de preset do filtro
                     temporal (ex.: "balanceado-v2,estavel-v2"). Se omitido,
                     roda o conjunto padrão de 5 variantes.
  --ablation         D4.3 — adiciona 4 variantes de ablação de features:
                     sem pose linear; sem pose×offset; sem pose quadrática;
                     sem bloco L2CS. Comparar contra o baseline v2 do topo.
                     Preserva N=1 gravação — achado preliminar, não conclusivo.
  --a2-flags         D7.1 — adiciona 2 variantes sweeping isotropicLandmarks
                     (OFF vs ON) via env-var IRISFLOW_EXP_isotropicLandmarks
                     e --recompute-features. NÃO sweepa lockCameraExposure
                     (afeta apenas câmera ao vivo, no-op em replay — pendência
                     humana em medição real).
  --drift-curve <w>  D7.3 — produz a curva erro×tempo rodando o replay em
                     múltiplas janelas temporais da MESMA gravação. Formato:
                     "startMin-endMin,..." em minutos. Ex.: "0-5,20-25,40-45"
                     (default: ${DEFAULT_DRIFT_WINDOWS_MIN}). A calibração é
                     preservada em todas as janelas — só os frames de accuracy
                     são filtrados. Pré-requisito: JSONL com frames de accuracy
                     ao longo dos intervalos pedidos, senão as janelas vazias
                     aparecem com "—" na tabela.
  -v, --verbose      Ecoa o comando de cada replay antes de rodar.
  -h, --help         Mostra esta ajuda.

Exit codes:
  0 = todas as variantes rodaram e produziram relatório
  1 = argumento inválido
  2 = replay.mjs falhou em pelo menos uma variante (log em stderr)
`);
}

async function runReplay(fixturePath, variant, verbose) {
  const args = [
    REPLAY_MJS,
    '--jsonl', fixturePath,
    '--filter', variant.filter,
  ];
  if (variant.recomputeFeatures) args.push('--recompute-features');
  if (variant.drop) args.push('--drop-features', variant.drop);
  if (variant.timeWindow) args.push('--time-window', variant.timeWindow);

  // D7.1 — env-vars para override de EXPERIMENT no child. Herda o env do pai
  // e sobrepõe com o que a variante pede. Vazio (variant.env indefinido)
  // preserva comportamento anterior — variantes de D2-D5 não usam env.
  const childEnv = { ...process.env, ...(variant.env ?? {}) };

  if (verbose) {
    const envDump = variant.env ? ` env=${JSON.stringify(variant.env)}` : '';
    process.stderr.write(`\n[measure_baseline]${envDump} $ node ${args.join(' ')}\n`);
  }

  return new Promise((resolveP, rejectP) => {
    const child = spawn(process.execPath, args, { cwd: REPO_ROOT, env: childEnv });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString('utf8'); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });
    child.on('error', rejectP);
    child.on('close', (code) => {
      if (code !== 0) {
        rejectP(new Error(
          `replay.mjs exit ${code} para variante "${variant.name}"\n--- stderr ---\n${stderr}\n--- stdout ---\n${stdout}`,
        ));
        return;
      }
      try {
        resolveP({ report: JSON.parse(stdout), stderr });
      } catch {
        rejectP(new Error(`stdout do replay não é JSON válido:\n${stdout.slice(0, 500)}`));
      }
    });
  });
}

function fmt(n, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return '—';
  return n.toFixed(digits);
}

function pad(str, width, align = 'left') {
  const s = String(str);
  if (s.length >= width) return s;
  const filler = ' '.repeat(width - s.length);
  return align === 'right' ? filler + s : s + filler;
}

function printComparison(rows) {
  // Cabeçalho + linhas. Formato tabular fixo para caber num terminal 100 col.
  const cols = [
    { key: 'name',           label: 'variante',                width: 44, align: 'left'  },
    { key: 'frames',         label: 'frames',                  width:  8, align: 'right' },
    { key: 'meanErrorPx',    label: 'mean px',                 width:  9, align: 'right' },
    { key: 'medianErrorPx',  label: 'p50 px',                  width:  8, align: 'right' },
    { key: 'p90ErrorPx',     label: 'p90 px',                  width:  8, align: 'right' },
    { key: 'meanErrorDeg',   label: 'mean °',                  width:  8, align: 'right' },
  ];
  const line = (chars) => chars.map((c, i) => pad(c, cols[i].width, cols[i].align)).join(' │ ');
  const sep = cols.map((c) => '─'.repeat(c.width)).join('─┼─');
  process.stdout.write('\n');
  process.stdout.write(line(cols.map((c) => c.label)) + '\n');
  process.stdout.write(sep + '\n');
  for (const r of rows) {
    process.stdout.write(line([
      r.name,
      r.frames ?? '—',
      fmt(r.meanErrorPx),
      fmt(r.medianErrorPx),
      fmt(r.p90ErrorPx),
      fmt(r.meanErrorDeg, 2),
    ]) + '\n');
  }
  process.stdout.write(sep + '\n');
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const jsonlAbs = resolvePath(args.jsonl);
  if (!existsSync(jsonlAbs)) {
    process.stderr.write(`ERRO: arquivo não existe: ${jsonlAbs}\n`);
    process.stderr.write(
      `Dica: gravações vão em fixtures/replay/ (ver README dessa pasta ou o \n` +
      `botão "Gravador de sessão" em SettingsScreen para produzir uma).\n`,
    );
    return 1;
  }

  let variants = DEFAULT_VARIANTS;
  if (args.variants) {
    variants = args.variants.split(',').map((name) => ({
      name: name.trim(),
      filter: name.trim(),
      recomputeFeatures: false,
    }));
  }
  // D4.3 — anexa ablações ao final; sempre depois do baseline para o leitor
  // já ver a linha de referência antes das variantes reduzidas.
  if (args.ablation) {
    variants = [...variants, ...ABLATION_VARIANTS];
  }
  // D7.1 — anexa sweep de flags A2 ao final. Ordem intencional: baseline
  // primeiro, ablação depois (se pedido), e A2 flags no fim — o leitor da
  // tabela lê da esquerda pra direita (linha por linha) e a comparação
  // OFF vs ON fica agrupada visualmente.
  if (args.a2Flags) {
    variants = [...variants, ...A2_FLAG_VARIANTS];
  }
  // D7.3 — se `--drift-curve` foi passado, substitui completamente as
  // variantes por janelas temporais. Não faz sentido misturar drift-curve
  // com sweep A2 na mesma tabela (colunas comparariam coisas incomparáveis).
  if (args.driftCurve !== null) {
    variants = buildDriftCurveVariants(args.driftCurve);
    process.stderr.write(`[measure_baseline] modo drift-curve — ${variants.length} janela(s) temporais\n`);
  }

  process.stderr.write(`[measure_baseline] fixture: ${jsonlAbs}\n`);
  process.stderr.write(`[measure_baseline] ${variants.length} variante(s) a executar\n`);

  const results = [];
  let anyFailed = false;
  for (const v of variants) {
    try {
      const { report } = await runReplay(jsonlAbs, v, args.verbose);
      const acc = report.accuracy;
      results.push({
        name: v.name,
        variant: v,
        frames: acc?.n ?? 0,
        meanErrorPx: acc?.meanErrorPx ?? null,
        medianErrorPx: acc?.medianErrorPx ?? null,
        p90ErrorPx: acc?.p90ErrorPx ?? null,
        meanErrorDeg: acc?.meanErrorDeg ?? null,
        report,
      });
    } catch (e) {
      anyFailed = true;
      process.stderr.write(`[measure_baseline] FALHOU "${v.name}": ${e.message}\n`);
      results.push({
        name: v.name,
        variant: v,
        frames: null,
        meanErrorPx: null,
        medianErrorPx: null,
        p90ErrorPx: null,
        meanErrorDeg: null,
        error: e.message,
      });
    }
  }

  printComparison(results);

  if (args.out) {
    const outAbs = resolvePath(args.out);
    const aggregate = {
      generatedAt: new Date().toISOString(),
      fixture: jsonlAbs,
      variants: results.map((r) => ({
        name: r.name,
        variant: r.variant,
        error: r.error ?? null,
        summary: {
          frames: r.frames,
          meanErrorPx: r.meanErrorPx,
          medianErrorPx: r.medianErrorPx,
          p90ErrorPx: r.p90ErrorPx,
          meanErrorDeg: r.meanErrorDeg,
        },
        report: r.report ?? null,
      })),
    };
    await writeFile(outAbs, JSON.stringify(aggregate, null, 2), 'utf8');
    process.stderr.write(`[measure_baseline] agregado salvo em ${outAbs}\n`);
  }

  return anyFailed ? 2 : 0;
}

main().then(
  (code) => process.exit(code),
  (e) => { process.stderr.write(`ERRO fatal: ${e.stack ?? e.message ?? e}\n`); process.exit(1); },
);
