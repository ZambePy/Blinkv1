// Contratos do gravador de sessão.
//
// O gravador escreve JSON Lines: uma linha de cabeçalho seguida por N linhas
// de frame.
//
// PRIVACIDADE — o gravador NÃO persiste vídeo. Landmarks e features já são
// dado biométrico; adicionar vídeo multiplicaria o passivo sem ganho para
// consumidores offline (que precisam reproduzir o pipeline, não a imagem).

/** Versão do formato do JSONL de gravação (v2 adiciona `sampleDecision`).
 *  Não confundir com a versão do vetor de features em `extractor.ts`. */
export const TELEMETRY_FORMAT_VERSION = 2;

/** Decisão do pipeline de calibração sobre este frame. Reproduz exatamente
 *  o filtro que `calibration.feedRawData` aplicou ao vivo.
 *  Ausente em frames fora de coleta de calibração. */
export interface RecordedSampleDecision {
  accepted: boolean;
  /** ms desde o início da coleta deste ponto. */
  elapsedMs: number;
  reason?: 'acclimation' | 'quality' | 'l2cs_invalid' | 'not_collecting';
}

// Cap de frames em memória. ~30k frames a ~4 KB cada ≈ 120 MB — teto seguro
// para sessões de até ~17 min a 30 fps. Além disso, novos frames são
// contados em `droppedFrames` e ignorados. O consumidor deve olhar esse
// contador ao exportar; qualquer valor > 0 sinaliza gravação truncada.
export const MAX_FRAMES = 30000;

export interface RecordingHeader {
  formatVersion: number;
  /**
   * Identificador do vetor de features do build que gravou (`iris12:12`).
   *
   * Fica no CABEÇALHO e não em cada `RecordedFrame` de propósito: é uma
   * constante de compilação, não pode variar entre frames da mesma gravação,
   * e repeti-la em 30 mil linhas seria redundância pura num arquivo que já
   * passa de 90 MB. O consumidor lê daqui e compara com o próprio build.
   *
   * Opcional para gravações antigas que não têm o campo — consumidores devem
   * tratar ausência como "desconhecido, recompute" em vez de assumir
   * compatibilidade.
   */
  featureVectorId?: string;
  startedAt: string;                      // ISO 8601 UTC
  /**
   * `performance.timeOrigin` da página, em ms desde a época.
   *
   * Ponte entre os dois relógios da gravação: `startedAt` é relógio de parede,
   * mas `captureTs`/`emitTs` são `performance.now()` (ms desde o page load).
   * `timeOrigin + captureTs` é o que permite alinhar o JSONL a um vídeo de
   * referência ou log externo. Opcional em gravações antigas; ausente
   * significa "não dá para cruzar com relógio externo".
   */
  timeOrigin?: number;
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
  // Confiança agregada da softmax do L2CS, min(yaw, pitch) de `1 - H/H_max`.
  // Opcional para compat com gravações antigas (formato v2 sem esse campo);
  // consumidores devem tratar undefined como "sem sinal de confiança nesta
  // gravação", não como 0.
  confidence?: number;
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
  // contra array de objetos.
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

  /**
   * Ponto do regressor ANTES do filtro temporal, em px.
   *
   * Permite reproduzir o mesmo JSONL por filtros diferentes offline sem
   * depender do modelo salvo daquela sessão — assim a comparação isola o
   * filtro. Undefined nos mesmos casos que `predicted`.
   */
  preFilter?: { x: number; y: number };
}

export interface Recording {
  header: RecordingHeader;
  frames: RecordedFrame[];
  droppedFrames: number;
}
