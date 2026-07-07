import { existsSync } from 'node:fs';
import * as ort from 'onnxruntime-node';

// Crop 64x64 grayscale normalizado (NCHW: batch=1, channel=1, 64, 64).
const ENCODER_INPUT_SIZE = 64;
const EXPECTED_INPUT_LENGTH = ENCODER_INPUT_SIZE * ENCODER_INPUT_SIZE;

// Prioridade de execution providers por plataforma. onnxruntime-node lança
// erro na criação da sessão se um provider explicitamente pedido não estiver
// disponível, então tentamos em ordem até um funcionar (cpu sempre funciona).
const PROVIDER_PRIORITY: Partial<Record<NodeJS.Platform, string[]>> = {
  win32: ['dml', 'cpu'],
  darwin: ['coreml', 'cpu'],
  linux: ['cuda', 'cpu'],
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
  configuredModelPath = modelPath;
  cachedSession = null;
  cachedSessionPath = null;
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
        `[encoderRunner] modelo carregado (${modelPath}) com execution provider "${provider}"`
      );
      return session;
    } catch (err) {
      console.warn(
        `[encoderRunner] execution provider "${provider}" indisponível, tentando próximo...`,
        (err as Error).message
      );
    }
  }
  return null;
}

async function ensureSession(): Promise<ort.InferenceSession | null> {
  if (cachedSession && cachedSessionPath === configuredModelPath) {
    return cachedSession;
  }

  if (!existsSync(configuredModelPath)) {
    if (warnedMissingForPath !== configuredModelPath) {
      console.warn(
        `[encoderRunner] Modelo do encoder CNN não encontrado em "${configuredModelPath}". ` +
          'Rodando sem encoder — pipeline de geometria + Ridge continua funcionando normalmente.'
      );
      warnedMissingForPath = configuredModelPath;
    }
    return null;
  }

  const session = await loadSession(configuredModelPath);
  if (session) {
    cachedSession = session;
    cachedSessionPath = configuredModelPath;
    warnedMissingForPath = null;
  }
  return session;
}

/**
 * Roda o encoder CNN sobre um crop de olho já pré-processado (64x64 grayscale
 * normalizado, achatado em um Float32Array de tamanho 4096). Retorna null
 * (sem lançar) sempre que o modelo não está disponível ou a inferência falha,
 * para que o resto do pipeline (geometria + Ridge) continue funcionando.
 */
export async function runEncoder(input: Float32Array): Promise<Float32Array | null> {
  if (input.length !== EXPECTED_INPUT_LENGTH) {
    console.error(
      `[encoderRunner] tensor de entrada com tamanho inesperado: esperado ${EXPECTED_INPUT_LENGTH}, recebido ${input.length}`
    );
    return null;
  }

  try {
    const session = await ensureSession();
    if (!session) return null;

    const inputName = session.inputNames[0];
    const outputName = session.outputNames[0];
    const tensor = new ort.Tensor('float32', input, [1, 1, ENCODER_INPUT_SIZE, ENCODER_INPUT_SIZE]);

    const results = await session.run({ [inputName]: tensor });
    const output = results[outputName];
    return Float32Array.from(output.data as ArrayLike<number>);
  } catch (err) {
    console.error('[encoderRunner] falha ao rodar inferência do encoder:', err);
    return null;
  }
}
