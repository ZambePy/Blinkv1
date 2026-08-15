// Contratos do gravador de sessão (Fase 0.1 do SPRINTSELA.MD).
//
// O gravador escreve JSON Lines: uma linha de cabeçalho seguida por N linhas
// de frame. O consumidor é o replay offline (Fase 0.2) que reexecuta o
// pipeline determinístico a partir das gravações.
//
// PRIVACIDADE — o gravador NÃO persiste vídeo. Landmarks e features já são
// dado biométrico; adicionar vídeo multiplicaria o passivo sem ganho para o
// replay (que precisa reproduzir o pipeline, não a imagem).

export const RECORDING_FORMAT_VERSION = 2; // era 1 — v2 adiciona `sampleDecision`

/** Decisão do pipeline de calibração sobre este frame. Reproduz, no replay,
 *  exatamente o filtro que `calibration.feedRawData` aplicou ao vivo.
 *  Ausente em frames fora de coleta de calibração. */
export interface RecordedSampleDecision {
  accepted: boolean;
  /** ms desde o início da coleta deste ponto. */
  elapsedMs: number;
  reason?: 'acclimation' | 'quality' | 'pose_drift' | 'not_collecting';
}

// Cap de frames em memória. ~30k frames a ~4 KB cada ≈ 120 MB — teto seguro
// para sessões de até ~17 min a 30 fps. Além disso, novos frames são
// contados em `droppedFrames` e ignorados. O consumidor deve olhar esse
// contador ao exportar; qualquer valor > 0 sinaliza gravação truncada.
export const MAX_FRAMES = 30000;

export interface RecordingHeader {
  formatVersion: number;
  startedAt: string;                      // ISO 8601 UTC
  resolution: { w: number; h: number };   // viewport CSS px
  videoResolution: { w: number; h: number };
  l2cs?: {
    dataset?: string;
    inputSize?: number;
    binWidth?: number;
    binOffset?: number;
  };
  meta?: Record<string, unknown>;
}

export interface RecordedL2CS {
  yaw: number;    // rad, sinal Gaze360 (yaw+ = direita)
  pitch: number;  // rad, sinal Gaze360 (pitch+ = cima, provisional)
  valid: boolean;
  // TODO Fase 3.2 — expor entropia do softmax como sinal de confiança do
  // modelo. Exige carregar o vetor de probabilidades pela mensagem do
  // worker; hoje só o valor esperado é transmitido.
}

export interface RecordedQuality {
  brightnessEstimate?: number;
  contrastEstimate?: number;
  blurEstimate?: number;
  detectorConfidence?: number;
  irisVisibilityPercentage?: number;
  yaw?: number; pitch?: number; roll?: number;
}

// Ground-truth do frame quando o usuário está sendo instruído a olhar para
// um ponto específico. Ausente durante uso livre. Coords em px de viewport,
// para casamento direto com `predicted` (também px).
export interface RecordedTarget {
  kind: 'calibration' | 'accuracy';
  xPx: number;
  yPx: number;
  label?: string;
}

export interface RecordedFrame {
  captureTs: number;   // performance.now() no início do processing do frame
  emitTs: number;      // performance.now() no momento do record
  frameIdx: number;
  hasFace: boolean;
  blink?: boolean;

  // Landmarks do MediaPipe achatados: [x0,y0,z0, x1,y1,z1, ...] com 478×3.
  // Presente sempre que hasFace=true. Formato achatado reduz o JSON em ~30%
  // contra array de objetos e é o que o replay espera.
  landmarks?: number[];

  // Matriz 4×4 (row-major, 16 floats) do MediaPipe. Undefined quando o
  // detector não emitiu essa saída no frame.
  faceMatrix?: number[];

  l2cs?: RecordedL2CS;
  featuresLeft?: number[];
  featuresRight?: number[];

  quality?: RecordedQuality;
  target?: RecordedTarget;
  sampleDecision?: RecordedSampleDecision;

  // Ponto emitido pelo pipeline após regressor + filtro temporal, em px.
  // Undefined quando o frame não gerou emissão (piscada + features vazias,
  // por exemplo).
  predicted?: { x: number; y: number };
}

export interface Recording {
  header: RecordingHeader;
  frames: RecordedFrame[];
  droppedFrames: number;
}
