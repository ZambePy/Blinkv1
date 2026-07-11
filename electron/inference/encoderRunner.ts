import { existsSync } from 'node:fs';
import * as ort from 'onnxruntime-node';

// Real model: 3-branch CNN encoder trained on MPIIFaceGaze (Sprint 2).
// ONNX input names (confirmed via onnx.checker): face, left_eye, right_eye, rect.
// ONNX output name: embedding (256 floats). gaze_xy head discarded at export.

export interface EncoderInput {
  face: Float32Array;      // 224 * 224 * 3 = 150_528 floats, NHWC layout
  leftEye: Float32Array;   // 112 * 112 * 3 =  37_632 floats
  rightEye: Float32Array;  // 112 * 112 * 3 =  37_632 floats
  rect: Float32Array;      // 12 floats (normalised bounding-box coords)
}

const FACE_LEN      = 224 * 224 * 3;
const EYE_LEN       = 112 * 112 * 3;
const RECT_LEN      = 12;

// Prioridade de execution providers por plataforma. onnxruntime-node lanca
// erro na criacao da sessao se um provider pedido nao estiver disponivel,
// entao tentamos em ordem ate um funcionar (cpu sempre funciona).
const PROVIDER_PRIORITY: Partial<Record<NodeJS.Platform, string[]>> = {
  win32:  ['dml', 'cpu'],
  darwin: ['coreml', 'cpu'],
  linux:  ['cuda', 'cpu'],
};

function providersForPlatform(): string[] {
  return PROVIDER_PRIORITY[process.platform] ?? ['cpu'];
}

let configuredModelPath = 'resources/models/gaze_encoder.onnx';
let cachedSession: ort.InferenceSession | null = null;
let cachedSessionPath: string | null = null;
let activeExecutionProvider: string | null = null;
let warnedMissingForPath: string | null = null;

export function configureEncoderModelPath(modelPath: string): void {
  if (modelPath === configuredModelPath) return;
  configuredModelPath  = modelPath;
  cachedSession        = null;
  cachedSessionPath    = null;
  activeExecutionProvider = null;
  warnedMissingForPath = null;
}

export function getActiveExecutionProvider(): string | null {
  return activeExecutionProvider;
}

async function loadSession(modelPath: string): Promise<ort.InferenceSession | null> {
  for (const provider of providersForPlatform()) {
    try {
      const session = await ort.InferenceSession.create(modelPath, {
        executionProviders: [provider],
      });
      activeExecutionProvider = provider;
      console.log(
        `[encoderRunner] modelo carregado (${modelPath}) com provider "${provider}"`
      );
      return session;
    } catch (err) {
      console.warn(
        `[encoderRunner] provider "${provider}" indisponivel, tentando proximo...`,
        (err as Error).message
      );
    }
  }
  return null;
}

/**
 * Carrega (ou retorna cacheada) a sessao ONNX.
 * Retorna null sem lancar se o modelo nao existir — o pipeline de
 * geometria + Ridge continua funcionando normalmente nesse caso.
 */
export async function ensureSession(): Promise<ort.InferenceSession | null> {
  if (cachedSession && cachedSessionPath === configuredModelPath) {
    return cachedSession;
  }

  if (!existsSync(configuredModelPath)) {
    if (warnedMissingForPath !== configuredModelPath) {
      console.warn(
        `[encoderRunner] Modelo nao encontrado em "${configuredModelPath}". ` +
          'Rodando sem encoder CNN.'
      );
      warnedMissingForPath = configuredModelPath;
    }
    return null;
  }

  const session = await loadSession(configuredModelPath);
  if (session) {
    cachedSession        = session;
    cachedSessionPath    = configuredModelPath;
    warnedMissingForPath = null;
  }
  return session;
}

/**
 * Roda o encoder CNN com as 4 entradas nomeadas da arquitetura real treinada.
 * Retorna Float32Array de 256 valores (embedding), ou null sem lancar se o
 * modelo nao estiver disponivel ou se a inferencia falhar.
 */
export async function runEncoderInference(input: EncoderInput): Promise<Float32Array | null> {
  if (input.face.length !== FACE_LEN) {
    console.error(`[encoderRunner] face: esperado ${FACE_LEN}, recebido ${input.face.length}`);
    return null;
  }
  if (input.leftEye.length !== EYE_LEN) {
    console.error(`[encoderRunner] leftEye: esperado ${EYE_LEN}, recebido ${input.leftEye.length}`);
    return null;
  }
  if (input.rightEye.length !== EYE_LEN) {
    console.error(`[encoderRunner] rightEye: esperado ${EYE_LEN}, recebido ${input.rightEye.length}`);
    return null;
  }
  if (input.rect.length !== RECT_LEN) {
    console.error(`[encoderRunner] rect: esperado ${RECT_LEN}, recebido ${input.rect.length}`);
    return null;
  }

  try {
    const session = await ensureSession();
    if (!session) return null;

    const feeds: Record<string, ort.Tensor> = {
      face:      new ort.Tensor('float32', input.face,     [1, 224, 224, 3]),
      left_eye:  new ort.Tensor('float32', input.leftEye,  [1, 112, 112, 3]),
      right_eye: new ort.Tensor('float32', input.rightEye, [1, 112, 112, 3]),
      rect:      new ort.Tensor('float32', input.rect,     [1, 12]),
    };

    const results = await session.run(feeds);
    const output  = results['embedding'];
    if (!output) {
      console.error('[encoderRunner] output "embedding" ausente na resposta ONNX');
      return null;
    }
    return Float32Array.from(output.data as ArrayLike<number>);
  } catch (err) {
    console.error('[encoderRunner] falha na inferencia:', err);
    return null;
  }
}
