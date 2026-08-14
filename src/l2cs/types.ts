// Contratos de dados do módulo L2CS (E4 do L2CS-NET.md).

// Radianos. Sinais confirmados em axis_validation_report.json:
//   yaw   > 0  →  olhar para a DIREITA (imagem não espelhada)
//   pitch > 0  →  olhar para CIMA (provisional, ver l2cs.meta.json)
// `valid` cai para false se o último resultado for mais velho que STALE_MS,
// para que o consumidor faça degradação graciosa em vez de travar.
export interface L2CSGaze {
  yaw: number;
  pitch: number;
  timestamp: number;
  valid: boolean;
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

// Mensagens do protocolo worker↔client.
// (wasmPath foi removido — o worker agora resolve URLs dos artefatos ORT via
// Vite `?url` imports, não precisa de path externo.)
export type L2CSWorkerRequest =
  | { type: 'init'; modelUrl: string; metaUrl: string }
  | { type: 'infer'; id: number; tensor: Float32Array; width: number; height: number };

export type L2CSWorkerResponse =
  | { type: 'ready'; meta: L2CSModelMeta }
  | { type: 'init_error'; error: string }
  | { type: 'result'; id: number; yaw: number; pitch: number; inferenceMs: number }
  | { type: 'infer_error'; id: number; error: string };
