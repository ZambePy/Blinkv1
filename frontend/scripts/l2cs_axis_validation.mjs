// Dependências ONNX/sharp carregadas dinamicamente dentro de main() para que
// `--help` funcione mesmo sem `npm install --no-save onnxruntime-node sharp`
// (a ajuda é o único ponto que o operador consulta antes de instalar).
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MODEL_PATH = path.resolve(__dirname, '../public/models/l2cs/l2cs_gaze360.onnx');
const META_PATH = path.resolve(__dirname, '../public/models/l2cs/l2cs.meta.json');
const DEFAULT_PHOTO_DIR = path.resolve(__dirname, '../python_scripts/l2cs_validation');

// O que este script mede, e o que não mede.
//
// A NORMALIZAÇÃO bate com `src/l2cs/crop.ts` (ImageNet, NCHW, RGB, /255 antes
// de (x−mean)/std). A GEOMETRIA DO CROP não bate: aqui é um quadrado central de
// `min(w,h)·0.6`; `crop.ts` usa a bbox dos 478 landmarks × EXPAND_FACTOR. Onde
// o rosto não está centrado — o caso comum — o modelo vê regiões diferentes.
//
// Logo: o SINAL de cada eixo (yaw positivo = direita?) é confiável, porque não
// depende do recorte; as MAGNITUDES não são transferíveis para o runtime. Use
// `--bbox x,y,side` para reproduzir a geometria de `crop.ts` quando a posição
// do rosto for conhecida.
/**
 * Lado default do crop. O ONNX tem eixos espaciais dinâmicos, então o mesmo
 * binário roda 224² e 448² — use `--size` para escolher. Os sinais gravados no
 * `meta.json` foram medidos em 448²; validar em 224² exige `--size 224`.
 */
const INPUT_SIZE = 448;

const IMAGENET_MEAN = [0.485, 0.456, 0.406];
const IMAGENET_STD = [0.229, 0.224, 0.225];

/**
 * Fração do menor lado usada no recorte central de fallback.
 *
 * Sem relação com `EXPAND_FACTOR` de `crop.ts` — são parametrizações de coisas
 * diferentes (aquele expande a bbox do rosto; este escolhe um pedaço do meio
 * da foto). Mantido para o script continuar utilizável sem `--bbox`.
 */
const CENTER_CROP_RATIO = 0.6;

const POSE_CATALOG = [
  { name: 'look_center', axis: 'center', sign: 0,  hint: 'Olhe direto para a lente'                            },
  { name: 'look_up',     axis: 'pitch',  sign: +1, hint: 'Cabeça reta — olhos para CIMA (topo do monitor)'      },
  { name: 'look_down',   axis: 'pitch',  sign: -1, hint: 'Cabeça reta — olhos para BAIXO (base do monitor)'     },
  { name: 'look_right',  axis: 'yaw',    sign: +1, hint: 'Cabeça reta — olhos para a DIREITA (borda direita)'   },
  { name: 'look_left',   axis: 'yaw',    sign: -1, hint: 'Cabeça reta — olhos para a ESQUERDA (borda esquerda)' },
];

const CENTER_TOL_DEG = 10;
const MIN_DELTA_DEG = 5;

function parseArgs(argv) {
  const args = { dirs: null, bbox: null, size: INPUT_SIZE };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dir') args.dirs = [argv[++i]];
    else if (a === '--dirs') args.dirs = argv[++i].split(',').map((s) => s.trim());
    else if (a === '--size') {
      const n = Number(argv[++i]);
      if (!Number.isFinite(n) || n <= 0 || n % 32 !== 0) {
        throw new Error('--size espera um múltiplo de 32 (a ResNet-50 reduz por 32). Ex.: 224 ou 448.');
      }
      args.size = n;
    }
    else if (a === '--bbox') {
      // Reproduz a geometria de `crop.ts`. Formato: `x,y,side` em pixels da
      // foto original, já com o EXPAND_FACTOR aplicado.
      const partes = String(argv[++i]).split(',').map((s) => Number(s.trim()));
      if (partes.length !== 3 || partes.some((n) => !Number.isFinite(n) || n < 0)) {
        throw new Error('--bbox espera três números não-negativos: x,y,side');
      }
      args.bbox = { x: partes[0], y: partes[1], side: partes[2] };
    }
    else if (a === '--help' || a === '-h') { printHelp(); process.exit(0); }
    else throw new Error(`Argumento desconhecido: ${a}. --help para uso.`);
  }
  return args;
}

function printHelp() {
  process.stdout.write(`
Validação empírica dos eixos do L2CS (matriz de poses).

Uso:
  node frontend/scripts/l2cs_axis_validation.mjs               (usa ${DEFAULT_PHOTO_DIR})
  node frontend/scripts/l2cs_axis_validation.mjs --dir <path>
  node frontend/scripts/l2cs_axis_validation.mjs --dirs <p1>,<p2>[,<p3>...]
  node frontend/scripts/l2cs_axis_validation.mjs --bbox <x>,<y>,<side>
  node frontend/scripts/l2cs_axis_validation.mjs --size 224

TAMANHO DE ENTRADA
  O ONNX foi reexportado com eixos espaciais dinâmicos, então o mesmo binário
  roda 224² e 448². O default aqui é 448 — a resolução em que a rede foi
  TREINADA e em que os sinais gravados no meta.json foram medidos.

  Os sinais NÃO foram revalidados em 224². Rodar com --size 224 antes de
  confiar em yaw/pitch naquele tamanho é pré-requisito, não formalidade.

GEOMETRIA DO RECORTE
  Sem --bbox, o script recorta um quadrado no CENTRO da foto. Isso NÃO é o que
  o runtime faz: crop.ts recorta a bbox dos 478 landmarks expandida por
  EXPAND_FACTOR (1.4). Os SINAIS medidos continuam válidos — não dependem do
  recorte —, mas as MAGNITUDES não são transferíveis para o pipeline.

  Passe --bbox x,y,side (px da foto original, já com EXPAND_FACTOR aplicado)
  para reproduzir a geometria real quando a posição do rosto for conhecida.

Fotos suportadas (todas opcionais — o script pula as ausentes com WARN):
${POSE_CATALOG.map((p) => '  ' + p.name.padEnd(14) + ' — ' + p.hint).join('\n')}

Para atingir a matriz completa (≥6 poses, ≥2 distâncias):
  Distância 1 (~60 cm) → 5 fotos em <dir1>/
  Distância 2 (~40 cm) → mesmas 5 em <dir2>/
Total: 10 fotos. O script valida sinais + simetria + consistência entre distâncias.
`);
}

let sharp; // populado no main()

/**
 * Recorte quadrado a usar.
 *
 * Com `bbox` (de `--bbox x,y,side`) reproduz a geometria de `crop.ts`: um
 * quadrado da bbox dos landmarks já expandida por `EXPAND_FACTOR`. Sem ela,
 * cai no recorte central — que NÃO é o que o runtime faz, e por isso avisa.
 *
 * O quadrado é clampado à imagem: `crop.ts` também pode produzir uma bbox que
 * ultrapassa a borda quando o rosto está perto do limite do frame.
 */
function resolverRecorte(w, h, bbox) {
  if (bbox) {
    const side = Math.max(1, Math.min(Math.floor(bbox.side), Math.min(w, h)));
    const left = Math.max(0, Math.min(Math.floor(bbox.x), w - side));
    const top = Math.max(0, Math.min(Math.floor(bbox.y), h - side));
    return { left, top, side, origem: 'bbox' };
  }
  const side = Math.floor(Math.min(w, h) * CENTER_CROP_RATIO);
  return {
    left: Math.floor((w - side) / 2),
    top: Math.floor((h - side) / 2),
    side,
    origem: 'centro',
  };
}

let avisouRecorteCentral = false;

async function preprocess(filepath, bbox, size = INPUT_SIZE) {
  const meta = await sharp(filepath).metadata();
  const w = meta.width;
  const h = meta.height;
  const { left, top, side, origem } = resolverRecorte(w, h, bbox);

  if (origem === 'centro' && !avisouRecorteCentral) {
    avisouRecorteCentral = true;
    console.warn(
      '[axis] ⚠ Usando recorte CENTRAL da foto — não é a geometria de crop.ts,\n' +
      '        que recorta a bbox dos 478 landmarks expandida por EXPAND_FACTOR.\n' +
      '        Os SINAIS medidos são confiáveis; as MAGNITUDES não são\n' +
      '        transferíveis para o runtime. Use --bbox x,y,side para reproduzir\n' +
      '        a geometria real quando a posição do rosto for conhecida.',
    );
  }

  const { data } = await sharp(filepath)
    // Quadrado → quadrado: `fill` aqui não distorce (o `extract` acima já é
    // `side × side`). Mantido explícito para o comportamento não depender do
    // default do sharp.
    .extract({ left, top, width: side, height: side })
    .resize(size, size, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  const px = size * size;
  const chw = new Float32Array(3 * px);
  for (let i = 0; i < px; i++) {
    const r = data[i * 3] / 255;
    const g = data[i * 3 + 1] / 255;
    const b = data[i * 3 + 2] / 255;
    chw[i] = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    chw[px + i] = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
    chw[2 * px + i] = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
  }
  return { chw, srcW: w, srcH: h, cropSide: side };
}

// Reimplementação local do decode. Idêntica ao decode.ts do runtime — se
// divergir, testes unitários de decode.test.ts pegariam.
function decodeAngleDegWithConfidence(logits, binWidth, binOffset) {
  let maxV = -Infinity;
  for (let i = 0; i < logits.length; i++) if (logits[i] > maxV) maxV = logits[i];
  let sumExp = 0;
  const exps = new Float64Array(logits.length);
  for (let i = 0; i < logits.length; i++) {
    exps[i] = Math.exp(logits[i] - maxV);
    sumExp += exps[i];
  }
  let deg = 0;
  let entropy = 0;
  for (let i = 0; i < logits.length; i++) {
    const p = exps[i] / sumExp;
    deg += p * (i * binWidth + binOffset);
    if (p > 0) entropy -= p * Math.log(p);
  }
  const maxH = Math.log(logits.length);
  const confidence = maxH > 0 ? Math.max(0, Math.min(1, 1 - entropy / maxH)) : 1;
  return { deg, confidence };
}

async function runPose(session, meta, filepath, ort, bbox, size = INPUT_SIZE) {
  const { chw, srcW, srcH, cropSide } = await preprocess(filepath, bbox, size);
  const input = new ort.Tensor('float32', chw, [1, 3, size, size]);
  const t0 = performance.now();
  const out = await session.run({ [session.inputNames[0]]: input });
  const dt = performance.now() - t0;
  const y = decodeAngleDegWithConfidence(out.yaw.data, meta.binWidth, meta.binOffset);
  const p = decodeAngleDegWithConfidence(out.pitch.data, meta.binWidth, meta.binOffset);
  return {
    yawDeg: Number(y.deg.toFixed(2)),
    pitchDeg: Number(p.deg.toFixed(2)),
    yawConfidence: Number(y.confidence.toFixed(3)),
    pitchConfidence: Number(p.confidence.toFixed(3)),
    inferenceMs: Number(dt.toFixed(1)),
    src: { w: srcW, h: srcH, cropSide },
  };
}

// Verifica um par simétrico (up/down ou right/left):
//   - Sinais opostos em relação ao centro
//   - Magnitudes parecidas (dentro de tolerância; se diferirem muito, o
//     usuário exagerou uma das poses OU há assimetria real do modelo)
//   - Eixo dominante correto (yaw > pitch para pares yaw, pitch > yaw para pares pitch)
function verdictSymmetryPair(name, axis, posDelta, negDelta, otherPos, otherNeg) {
  const opposite = Math.sign(posDelta) !== Math.sign(negDelta) && posDelta !== 0 && negDelta !== 0;
  const bothSignificant = Math.abs(posDelta) > MIN_DELTA_DEG && Math.abs(negDelta) > MIN_DELTA_DEG;
  const dominant = Math.abs(posDelta) > Math.abs(otherPos) && Math.abs(negDelta) > Math.abs(otherNeg);
  return {
    name,
    axis,
    posDelta: Number(posDelta.toFixed(2)),
    negDelta: Number(negDelta.toFixed(2)),
    opposite,
    bothSignificant,
    dominant,
    pass: opposite && bothSignificant && dominant,
  };
}

async function runOne(dirPath, session, meta, tagLabel, ort, bbox, size = INPUT_SIZE) {
  const dirResults = { dir: dirPath, poses: {}, verdicts: [], warnings: [] };
  let anyMissing = false;

  for (const pose of POSE_CATALOG) {
    const filepath = path.join(dirPath, pose.name + '.jpg');
    if (!existsSync(filepath)) {
      dirResults.warnings.push(`ausente: ${pose.name}.jpg (SKIP — capture com l2cs_capture.html)`);
      anyMissing = true;
      continue;
    }
    const r = await runPose(session, meta, filepath, ort, bbox, size);
    dirResults.poses[pose.name] = r;
    console.log(
      `[axis${tagLabel}] ${pose.name.padEnd(14)}  yaw=${String(r.yawDeg).padStart(7)}°  pitch=${String(r.pitchDeg).padStart(7)}°  ` +
      `conf y=${r.yawConfidence.toFixed(2)}/p=${r.pitchConfidence.toFixed(2)}  ${r.inferenceMs} ms`,
    );
  }

  const c = dirResults.poses.look_center;
  if (!c) {
    dirResults.warnings.push('sem look_center — NENHUM veredicto possível nesta pasta');
    return dirResults;
  }

  // V1: center próximo de (0,0)
  const centerOK = Math.abs(c.yawDeg) < CENTER_TOL_DEG && Math.abs(c.pitchDeg) < CENTER_TOL_DEG;
  dirResults.verdicts.push({
    name: 'center_near_zero',
    axis: 'center',
    yaw: c.yawDeg, pitch: c.pitchDeg, tol: CENTER_TOL_DEG,
    pass: centerOK,
  });

  const up = dirResults.poses.look_up;
  const down = dirResults.poses.look_down;
  const right = dirResults.poses.look_right;
  const left = dirResults.poses.look_left;

  // V2 (pitch): up vs down — simetria com sinais opostos + eixo pitch dominante
  if (up && down) {
    dirResults.verdicts.push(verdictSymmetryPair(
      'pitch_symmetry',
      'pitch',
      up.pitchDeg - c.pitchDeg,
      down.pitchDeg - c.pitchDeg,
      up.yawDeg - c.yawDeg,
      down.yawDeg - c.yawDeg,
    ));
  } else if (up) {
    // legado: só up disponível. Sinal apenas.
    const dUp = up.pitchDeg - c.pitchDeg;
    dirResults.verdicts.push({
      name: 'pitch_up_only',
      axis: 'pitch',
      delta: Number(dUp.toFixed(2)),
      dominant: Math.abs(dUp) > Math.abs(up.yawDeg - c.yawDeg) && Math.abs(dUp) > MIN_DELTA_DEG,
      signConvention: dUp > 0 ? 'up_is_positive' : 'up_is_negative',
      pass: Math.abs(dUp) > Math.abs(up.yawDeg - c.yawDeg) && Math.abs(dUp) > MIN_DELTA_DEG,
    });
  }

  // V3 (yaw): right vs left — simetria com sinais opostos + eixo yaw dominante
  if (right && left) {
    dirResults.verdicts.push(verdictSymmetryPair(
      'yaw_symmetry',
      'yaw',
      right.yawDeg - c.yawDeg,
      left.yawDeg - c.yawDeg,
      right.pitchDeg - c.pitchDeg,
      left.pitchDeg - c.pitchDeg,
    ));
  } else if (right) {
    const dRight = right.yawDeg - c.yawDeg;
    dirResults.verdicts.push({
      name: 'yaw_right_only',
      axis: 'yaw',
      delta: Number(dRight.toFixed(2)),
      dominant: Math.abs(dRight) > Math.abs(right.pitchDeg - c.pitchDeg) && Math.abs(dRight) > MIN_DELTA_DEG,
      signConvention: dRight > 0 ? 'right_is_positive' : 'right_is_negative',
      pass: Math.abs(dRight) > Math.abs(right.pitchDeg - c.pitchDeg) && Math.abs(dRight) > MIN_DELTA_DEG,
    });
  }

  if (anyMissing) {
    dirResults.warnings.push(
      `matriz completa exige as 5 poses ` +
      `(${POSE_CATALOG.map((p) => p.name).join(', ')}) para veredictos de simetria.`,
    );
  }

  return dirResults;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const dirs = args.dirs ?? [DEFAULT_PHOTO_DIR];

  // Carrega dependências pesadas só quando vamos rodar de fato. Se estiverem
  // faltando, guia o operador para o comando de instalação em vez de crashar
  // com "Cannot find package" sem contexto.
  let ort;
  try {
    ort = await import('onnxruntime-node');
    sharp = (await import('sharp')).default;
  } catch (e) {
    process.stderr.write(
      `\nERRO: falta instalar onnxruntime-node e/ou sharp:\n` +
      `  npm install --no-save onnxruntime-node sharp\n\n` +
      `Detalhe: ${e.message}\n`,
    );
    process.exit(1);
  }

  const meta = JSON.parse(await readFile(META_PATH, 'utf-8'));
  console.log(`[axis] Model: ${path.basename(MODEL_PATH)}`);
  console.log(`[axis] Dataset: ${meta.dataset}  bins=${meta.outputBins} binWidth=${meta.binWidth} offset=${meta.binOffset}`);
  console.log(`[axis] Diretórios: ${dirs.join(' | ')}`);

  const session = await ort.InferenceSession.create(await readFile(MODEL_PATH));

  const perDir = [];
  for (let i = 0; i < dirs.length; i++) {
    const dir = dirs[i];
    if (!existsSync(dir)) {
      console.log(`\n[axis] ⚠ diretório inexistente: ${dir} — pulando`);
      perDir.push({ dir, poses: {}, verdicts: [], warnings: [`diretório não existe: ${dir}`] });
      continue;
    }
    const tagLabel = dirs.length > 1 ? `#${i + 1}` : '';
    console.log(`\n[axis] === diretório ${i + 1}/${dirs.length}: ${dir} ===`);
    perDir.push(await runOne(dir, session, meta, tagLabel, ort, args.bbox, args.size));
  }

  // Consistência entre distâncias (se >1 diretório) — o sinal do eixo dominante
  // de cada pose tem que bater em todas as distâncias.
  const crossDistanceVerdicts = [];
  if (perDir.length > 1) {
    for (const pose of POSE_CATALOG) {
      if (pose.axis === 'center') continue;
      const signs = perDir
        .map((d) => d.poses[pose.name])
        .filter(Boolean)
        .map((r) => Math.sign(pose.axis === 'yaw' ? r.yawDeg : r.pitchDeg));
      if (signs.length < 2) continue;
      const allSame = signs.every((s) => s === signs[0]);
      crossDistanceVerdicts.push({
        name: `sign_consistency_${pose.name}`,
        axis: pose.axis,
        signs,
        pass: allSame,
      });
    }
  }

  // Sumário
  console.log('\n[axis] === VEREDICTOS ===');
  let allPass = true;
  perDir.forEach((d, i) => {
    console.log(`\n[dir ${i + 1}] ${d.dir}`);
    for (const w of d.warnings) console.log(`   WARN  ${w}`);
    for (const v of d.verdicts) {
      const mark = v.pass ? '✅' : '❌';
      const details = v.name === 'center_near_zero'
        ? `yaw=${v.yaw}° pitch=${v.pitch}° tol=±${v.tol}°`
        : v.name.endsWith('_symmetry')
          ? `pos=${v.posDelta}° neg=${v.negDelta}° opposite=${v.opposite} dominant=${v.dominant}`
          : `delta=${v.delta}° dominant=${v.dominant} conv=${v.signConvention}`;
      console.log(`   ${mark} ${v.name.padEnd(24)} ${details}`);
      if (!v.pass) allPass = false;
    }
  });
  if (crossDistanceVerdicts.length > 0) {
    console.log(`\n[cross-distance]`);
    for (const v of crossDistanceVerdicts) {
      const mark = v.pass ? '✅' : '❌';
      console.log(`   ${mark} ${v.name.padEnd(30)} signs=[${v.signs.join(',')}]`);
      if (!v.pass) allPass = false;
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    model: path.basename(MODEL_PATH),
    meta: { dataset: meta.dataset, bins: meta.outputBins, binWidth: meta.binWidth, binOffset: meta.binOffset },
    dirs: perDir,
    crossDistance: crossDistanceVerdicts,
    allPass,
  };
  const reportPath = path.join(dirs[0], 'axis_validation_report.json');
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\n[axis] Relatório salvo em: ${reportPath}`);
  console.log(`[axis] Resultado geral: ${allPass ? '✅ TODOS OS VEREDICTOS PASSARAM' : '❌ FALHOU — revisar espelhamento / eixo / enquadramento'}`);

  process.exit(allPass ? 0 : 1);
}

main().catch((e) => {
  process.stderr.write(`ERRO fatal: ${e.stack ?? e.message ?? e}\n`);
  process.exit(1);
});
