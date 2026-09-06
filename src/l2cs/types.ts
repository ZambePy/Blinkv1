// Contratos de dados do módulo L2CS.

// Radianos, na convenção registrada em l2cs.meta.json (`signConvention`):
//   yaw   > 0  →  olhar para a DIREITA (imagem não espelhada)
//   pitch > 0  →  olhar para CIMA
// `valid` cai para false quando o último resultado envelheceu além da
// tolerância do cliente; o consumidor degrada em vez de usar dado velho.
//
// `confidence` = min(conf_yaw, conf_pitch), com cada componente `1 - H/H_max`
// da softmax daquele eixo: 0 = distribuição uniforme, 1 = massa num único bin.
export interface L2CSGaze {
  yaw: number;
  pitch: number;
  timestamp: number;
  valid: boolean;
  confidence?: number;
}

// Metadados do modelo (frontend/public/models/l2cs/l2cs.meta.json).
export interface L2CSModelMeta {
  dataset: string;
  outputBins: number;
  binWidth: number;
  binOffset: number;
  inputSize: number;
  inputTensorName: string;
  outputTensorNames: { yaw: string; pitch: string };
}

export type L2CSWorkerRequest =
  /** `ortBaseUrl`: diretório dos artefatos do ORT, resolvido pela PÁGINA. Dentro
   *  do worker `location.href` é a URL do script do worker (em `assets/` no
   *  build, em `/@fs/...` no dev-server), não a da página. */
  | { type: 'init'; modelUrl: string; metaUrl: string; provider: 'auto' | 'webgpu' | 'wasm'; ortBaseUrl?: string }
  | { type: 'infer'; id: number; tensor: Float32Array };

export type L2CSWorkerResponse =
  /** `executionProvider` é o que ficou ativo; `fallback` marca quando ele
   *  difere do pedido (só possível no modo `auto`). */
  | { type: 'ready'; meta: L2CSModelMeta; executionProvider: 'webgpu' | 'wasm'; requested: string; fallback: boolean }
  | { type: 'init_error'; error: string }
  | { type: 'result'; id: number; yaw: number; pitch: number; confidence: number; inferenceMs: number }
  | { type: 'infer_error'; id: number; error: string };
