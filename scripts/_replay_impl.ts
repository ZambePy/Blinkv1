// Replay determinístico offline (Fase 0.2 do SPRINTSELA.MD) — implementação.
//
// Este arquivo é bundled+executado por scripts/replay.mjs. Ele não é rodado
// diretamente porque os módulos de src/ usam imports sem extensão (ex:
// `from './types'`), o que Node ESM nativo não resolve mas esbuild sim.
//
// O que faz:
//   1. Lê um .jsonl produzido pelo gravador da Fase 0.1.
//   2. Reagrupa frames por fase (calibração, precisão, uso livre).
//   3. Re-treina scalers + regressor Ridge do zero com os frames de
//      calibração (mesma matemática do calibration.ts, sem depender do
//      document/window).
//   4. Aplica predict + OneEuroFilter aos frames de precisão.
//   5. Calcula métricas equivalentes ao accuracy.ts.
//
// LIMITAÇÕES ASSUMIDAS (documentadas para não haver falha silenciosa):
//   - Não replica applyGazeCorrection (RBF) — o gravador não persiste o
//     mapa de correção; o replay é o baseline sem correção.
//   - Não replica USE_ONLINE_CALIBRATION (RLS) — flag off por default.
//   - Assume USE_COMPACT_FEATURES=true. Se o gravador foi feito com
//     features full, replay aborta com mensagem clara (dims incompatíveis).

import { readFile, writeFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import { RidgeRegressor } from '../src/ridge';
import { StandardScaler } from '../src/scaler';
import { OneEuroFilter2D, FILTER_PRESETS, type FilterPreset } from '../src/oneEuroFilter';
import { extractFeatures } from '../src/featurePipeline';
import type { Point3D, L2CSGazeInput } from '../src/extractor';
import { parseJSONL } from '../src/telemetry/recorder';
import type { RecordedFrame, Recording, RecordedTarget } from '../src/telemetry/types';

// Constante espelhada de accuracy.ts (não exportada de lá; se mudar, atualizar
// aqui também — replay tem que usar EXATAMENTE o mesmo valor para os graus
// baterem com os do teste online).
const ASSUMED_DIST_PX = 2268;

interface CliArgs {
  jsonl: string;
  report?: string;
  filter: FilterPreset;
  verbose: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const args: Partial<CliArgs> = { filter: 'balanceado', verbose: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--jsonl') args.jsonl = argv[++i];
    else if (a === '--report') args.report = argv[++i];
    else if (a === '--filter') args.filter = argv[++i] as FilterPreset;
    else if (a === '--verbose' || a === '-v') args.verbose = true;
    else if (a === '--help' || a === '-h') {
      printHelp();
      process.exit(0);
    } else {
      throw new Error(`Argumento desconhecido: ${a}`);
    }
  }
  if (!args.jsonl) {
    printHelp();
    throw new Error('Falta --jsonl <path>');
  }
  if (!(args.filter! in FILTER_PRESETS)) {
    throw new Error(`--filter deve ser um de: ${Object.keys(FILTER_PRESETS).join(', ')}`);
  }
  return args as CliArgs;
}

function printHelp(): void {
  process.stdout.write(`
Uso:
  npm run replay -- --jsonl <path> [--report <path>] [--filter <preset>] [-v]

Argumentos:
  --jsonl <path>    Arquivo .jsonl produzido pelo gravador (Fase 0.1). Obrigatorio.
  --report <path>   Escreve o relatorio em JSON no caminho dado. Sem esse flag,
                    imprime na stdout.
  --filter <preset> Preset do OneEuroFilter: estavel | balanceado | responsivo.
                    Padrao: balanceado.
  -v, --verbose     Loga cada frame de precisao com erro por frame.
  -h, --help        Mostra esta ajuda.
`);
}

// Reconstroi landmarks Point3D[] a partir do buffer achatado do JSONL
// ([x0,y0,z0, x1,y1,z1, ...]). Retorna null se comprimento nao e multiplo de 3
// ou zero — o replay marca o frame como sem-face nesse caso, sem cair no chao.
function unflattenLandmarks(flat: number[] | undefined): Point3D[] | null {
  if (!flat || flat.length === 0 || flat.length % 3 !== 0) return null;
  const out: Point3D[] = new Array(flat.length / 3);
  for (let i = 0, j = 0; i < flat.length; i += 3, j++) {
    out[j] = { x: flat[i], y: flat[i + 1], z: flat[i + 2] };
  }
  return out;
}

function toFloat32(arr: number[] | undefined): Float32Array | undefined {
  if (!arr || arr.length === 0) return undefined;
  return Float32Array.from(arr);
}

function toL2CSInput(l2cs: RecordedFrame['l2cs']): L2CSGazeInput | null {
  if (!l2cs || !l2cs.valid) return null;
  return { yaw: l2cs.yaw, pitch: l2cs.pitch, valid: true };
}

interface CalibrationSample {
  featuresLeft: number[];
  featuresRight: number[];
  targetXNorm: number;
  targetYNorm: number;
  targetXPx: number;
  targetYPx: number;
}

interface AccuracySample {
  featuresLeft: number[];
  featuresRight: number[];
  target: RecordedTarget;
  captureTs: number;
  frameIdx: number;
}

// Extrai (ou re-extrai) features do frame. Se o JSONL ja tem featuresLeft/Right,
// usa direto — economiza CPU e garante paridade com a gravacao. Se nao tem,
// tenta re-computar a partir de landmarks; se tambem nao tem landmarks, retorna
// null (frame descartado). O replay reporta a contagem de frames descartados.
function getFeatures(f: RecordedFrame): { left: number[]; right: number[] } | null {
  if (f.featuresLeft && f.featuresRight
      && f.featuresLeft.length > 0 && f.featuresRight.length > 0
      && f.featuresLeft.length === f.featuresRight.length) {
    return { left: f.featuresLeft, right: f.featuresRight };
  }
  const lm = unflattenLandmarks(f.landmarks);
  if (!lm) return null;
  const geo = extractFeatures(lm, toFloat32(f.faceMatrix), toL2CSInput(f.l2cs));
  if (geo.blinkDetected) return null;
  return { left: geo.featuresLeft, right: geo.featuresRight };
}

// Split canonico dos frames em calibracao, precisao e uso livre. Descarta
// frames sem face, sem features utilizaveis, ou com blink.
function splitFrames(rec: Recording): {
  calibration: CalibrationSample[];
  accuracy: AccuracySample[];
  live: number; // apenas contagem
  discarded: number;
  rejectedByDecision: number;
  legacyNoDecision: number;
} {
  const vw = rec.header.resolution.w;
  const vh = rec.header.resolution.h;
  const calibration: CalibrationSample[] = [];
  const accuracy: AccuracySample[] = [];
  let live = 0;
  let discarded = 0;
  let rejectedByDecision = 0;
  let legacyNoDecision = 0;

  for (const f of rec.frames) {
    if (!f.hasFace) { discarded++; continue; }
    if (f.blink) { discarded++; continue; }
    const feats = getFeatures(f);
    if (!feats) { discarded++; continue; }

    if (f.target?.kind === 'calibration') {
      // v2+: honra a decisão gravada. Sem isto o replay treina em frames de
      // acomodação/baixa qualidade que o pipeline ao vivo descartou — e o
      // baseline offline deixa de ser comparável ao online (achado A3).
      if (rec.header.formatVersion >= 2) {
        if (!f.sampleDecision?.accepted) { rejectedByDecision++; continue; }
      } else {
        legacyNoDecision++;   // v1: comportamento antigo, mas avisa no relatório
      }
      calibration.push({
        featuresLeft: feats.left,
        featuresRight: feats.right,
        targetXNorm: f.target.xPx / vw,
        targetYNorm: f.target.yPx / vh,
        targetXPx: f.target.xPx,
        targetYPx: f.target.yPx,
      });
    } else if (f.target?.kind === 'accuracy') {
      accuracy.push({
        featuresLeft: feats.left,
        featuresRight: feats.right,
        target: f.target,
        captureTs: f.captureTs,
        frameIdx: f.frameIdx,
      });
    } else {
      live++;
    }
  }
  return { calibration, accuracy, live, discarded, rejectedByDecision, legacyNoDecision };
}

// Espelha a matematica de calibration.trainScalersAndRegressors + mapGaze
// (sem RBF, sem RLS, sem document). Uma unica fonte de verdade seria melhor
// — mas calibration.ts esta acoplado ao browser e refatorar por causa do
// replay agora seria risco maior que o beneficio.
class ReplayRegressor {
  private scalerL = new StandardScaler();
  private scalerR = new StandardScaler();
  private ridgeL = new RidgeRegressor();
  private ridgeR = new RidgeRegressor();
  private trained = false;

  train(samples: CalibrationSample[]): void {
    if (samples.length < 2) {
      throw new Error(`Precisa de ao menos 2 amostras de calibracao para treinar (recebi ${samples.length})`);
    }
    const rawL = samples.map((s) => s.featuresLeft);
    const rawR = samples.map((s) => s.featuresRight);
    const tx = samples.map((s) => s.targetXNorm);
    const ty = samples.map((s) => s.targetYNorm);
    this.scalerL.fit(rawL);
    this.scalerR.fit(rawR);
    const scaledL = this.scalerL.transform(rawL);
    const scaledR = this.scalerR.transform(rawR);
    this.ridgeL.train(scaledL, tx, ty);
    this.ridgeR.train(scaledR, tx, ty);
    this.trained = true;
  }

  // Retorna coordenadas em px de tela ja com clamp normalizado, sem filtro
  // temporal (filtro e responsabilidade do caller).
  predictPx(fL: number[], fR: number[], vw: number, vh: number): { x: number; y: number } {
    if (!this.trained) throw new Error('ReplayRegressor.predictPx chamado antes de train');
    const sL = this.scalerL.transformSingle(fL);
    const sR = this.scalerR.transformSingle(fR);
    const pL = this.ridgeL.predict(sL);
    const pR = this.ridgeR.predict(sR);
    const baseX = (pL.x + pR.x) / 2;
    const baseY = (pL.y + pR.y) / 2;
    const normX = Math.min(1, Math.max(0, baseX));
    const normY = Math.min(1, Math.max(0, baseY));
    return { x: normX * vw, y: normY * vh };
  }
}

interface FrameError {
  frameIdx: number;
  targetXPx: number;
  targetYPx: number;
  predictedXPx: number;
  predictedYPx: number;
  errorPx: number;
  errorDeg: number;
}

interface PerPointStat {
  targetXPx: number;
  targetYPx: number;
  label?: string;
  count: number;
  meanErrorPx: number;
  medianErrorPx: number;
  meanErrorDeg: number;
}

interface Report {
  replayVersion: 1;
  generatedAt: string;
  input: { path: string; startedAt: string; formatVersion: number };
  resolution: { w: number; h: number };
  filter: { preset: FilterPreset; mincutoff: number; beta: number };
  frames: {
    totalInJsonl: number;
    droppedInRecording: number;
    calibration: number;
    accuracy: number;
    live: number;
    discarded: number;
    rejectedByDecision: number;
    legacyNoDecision: number;
  };
  calibration: { uniqueTargets: number };
  accuracy: {
    n: number;
    meanErrorPx: number;
    medianErrorPx: number;
    p90ErrorPx: number;
    maxErrorPx: number;
    meanErrorDeg: number;
    medianErrorDeg: number;
    p90ErrorDeg: number;
    perPoint: PerPointStat[];
  } | null;
  config: { assumedDistPx: number; rbfApplied: false; onlineRls: false; source: 'src/' };
}

function median(values: number[]): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 === 0 ? (s[m - 1] + s[m]) / 2 : s[m];
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.floor(s.length * p));
  return s[idx];
}

function pxToDeg(px: number): number {
  return (Math.atan(px / ASSUMED_DIST_PX) * 180) / Math.PI;
}

async function main(argv: string[]): Promise<number> {
  const args = parseArgs(argv);
  // Modulos importados de src/ (ex.: RidgeRegressor.selectLambdaCV) chamam
  // console.log para diagnostico. Sem redirecionar, isso polui o JSON escrito
  // em stdout — o que quebra `npm run replay > report.json` e a Fase 0.4
  // (bench) que vai parsear stdout. Desviamos para stderr sem mexer nos modulos.
  const origLog = console.log;
  console.log = (...a: unknown[]) => console.error(...a);
  try {
    return await runInner(args);
  } finally {
    console.log = origLog;
  }
}

async function runInner(args: CliArgs): Promise<number> {
  const text = await readFile(resolvePath(args.jsonl), 'utf8');
  const rec = parseJSONL(text);
  if (!rec) {
    process.stderr.write(`ERRO: nao foi possivel parsear ${args.jsonl} como JSONL da Fase 0.1.\n`);
    return 2;
  }
  const vw = rec.header.resolution.w;
  const vh = rec.header.resolution.h;
  if (!vw || !vh) {
    process.stderr.write(`ERRO: header sem resolution valida (${vw}x${vh}).\n`);
    return 2;
  }

  const split = splitFrames(rec);
  
  if (split.legacyNoDecision > 0) {
    process.stderr.write(
      `\nAVISO: gravação v1 sem sampleDecision — o modelo do replay inclui frames\n` +
      `que o pipeline ao vivo descartaria. Números NÃO comparáveis com o teste online.\n\n`
    );
  }

  if (split.calibration.length < 2) {
    process.stderr.write(
      `ERRO: nao ha frames de calibracao suficientes no JSONL (${split.calibration.length}). ` +
      `Regravar com calibracao rodando via SettingsScreen > Gravador de sessao.\n`,
    );
    return 3;
  }

  const regr = new ReplayRegressor();
  regr.train(split.calibration);
  const uniqueTargets = new Set(
    split.calibration.map((s) => `${s.targetXNorm.toFixed(4)},${s.targetYNorm.toFixed(4)}`),
  ).size;

  const fc = FILTER_PRESETS[args.filter];
  const filter = new OneEuroFilter2D(60, fc.mincutoff, fc.beta);

  const errors: FrameError[] = [];
  for (const s of split.accuracy) {
    const raw = regr.predictPx(s.featuresLeft, s.featuresRight, vw, vh);
    // Timestamp em segundos (OneEuro usa segundos). captureTs vem de
    // performance.now() em ms — divide por 1000.
    const smooth = filter.filter(raw.x, raw.y, s.captureTs / 1000);
    const dx = smooth.x - s.target.xPx;
    const dy = smooth.y - s.target.yPx;
    const errPx = Math.hypot(dx, dy);
    errors.push({
      frameIdx: s.frameIdx,
      targetXPx: s.target.xPx,
      targetYPx: s.target.yPx,
      predictedXPx: smooth.x,
      predictedYPx: smooth.y,
      errorPx: errPx,
      errorDeg: pxToDeg(errPx),
    });
    if (args.verbose) {
      process.stdout.write(
        `frame ${s.frameIdx}: target=(${s.target.xPx.toFixed(0)}, ${s.target.yPx.toFixed(0)}) ` +
        `pred=(${smooth.x.toFixed(0)}, ${smooth.y.toFixed(0)}) ` +
        `err=${errPx.toFixed(1)}px / ${pxToDeg(errPx).toFixed(2)}°\n`,
      );
    }
  }

  const accSection: Report['accuracy'] = errors.length === 0 ? null : (() => {
    const errPx = errors.map((e) => e.errorPx);
    const errDeg = errors.map((e) => e.errorDeg);
    const byTarget = new Map<string, FrameError[]>();
    for (const e of errors) {
      const key = `${e.targetXPx.toFixed(1)},${e.targetYPx.toFixed(1)}`;
      const arr = byTarget.get(key) ?? [];
      arr.push(e);
      byTarget.set(key, arr);
    }
    const perPoint: PerPointStat[] = [];
    for (const [, arr] of byTarget) {
      const ppErrPx = arr.map((e) => e.errorPx);
      const ppErrDeg = arr.map((e) => e.errorDeg);
      perPoint.push({
        targetXPx: arr[0].targetXPx,
        targetYPx: arr[0].targetYPx,
        count: arr.length,
        meanErrorPx: ppErrPx.reduce((a, b) => a + b, 0) / ppErrPx.length,
        medianErrorPx: median(ppErrPx),
        meanErrorDeg: ppErrDeg.reduce((a, b) => a + b, 0) / ppErrDeg.length,
      });
    }
    return {
      n: errors.length,
      meanErrorPx: errPx.reduce((a, b) => a + b, 0) / errPx.length,
      medianErrorPx: median(errPx),
      p90ErrorPx: percentile(errPx, 0.9),
      maxErrorPx: Math.max(...errPx),
      meanErrorDeg: errDeg.reduce((a, b) => a + b, 0) / errDeg.length,
      medianErrorDeg: median(errDeg),
      p90ErrorDeg: percentile(errDeg, 0.9),
      perPoint,
    };
  })();

  const report: Report = {
    replayVersion: 1,
    generatedAt: new Date().toISOString(),
    input: {
      path: resolvePath(args.jsonl),
      startedAt: rec.header.startedAt,
      formatVersion: rec.header.formatVersion,
    },
    resolution: { w: vw, h: vh },
    filter: { preset: args.filter, mincutoff: fc.mincutoff, beta: fc.beta },
    frames: {
      totalInJsonl: rec.frames.length,
      droppedInRecording: rec.droppedFrames,
      calibration: split.calibration.length,
      accuracy: split.accuracy.length,
      live: split.live,
      discarded: split.discarded,
      rejectedByDecision: split.rejectedByDecision,
      legacyNoDecision: split.legacyNoDecision,
    },
    calibration: { uniqueTargets },
    accuracy: accSection,
    config: { assumedDistPx: ASSUMED_DIST_PX, rbfApplied: false, onlineRls: false, source: 'src/' },
  };

  const output = JSON.stringify(report, null, 2);
  if (args.report) {
    await writeFile(resolvePath(args.report), output, 'utf8');
    process.stdout.write(`Relatorio escrito em ${resolvePath(args.report)}\n`);
  } else {
    process.stdout.write(output + '\n');
  }
  return 0;
}

// Bootstrap chama esta funcao; qualquer excecao vira exit != 0.
export async function run(argv: string[]): Promise<number> {
  try {
    return await main(argv);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    process.stderr.write(`ERRO: ${msg}\n`);
    return 1;
  }
}
