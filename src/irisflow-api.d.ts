export {};

// Inputs for the 3-branch CNN encoder (gaze_encoder.onnx).
// Matches ONNX node names: face, left_eye, right_eye, rect.
export interface EncoderInput {
  face: Float32Array;      // 224 * 224 * 3 = 150_528 floats, NHWC
  leftEye: Float32Array;   // 112 * 112 * 3 =  37_632 floats
  rightEye: Float32Array;  // 112 * 112 * 3 =  37_632 floats
  rect: Float32Array;      // 12 floats (normalised bounding-box coords)
}

declare global {
  interface Window {
    /**
     * Ponte para o processo main do Electron (contextBridge, sem Node no
     * renderer). Ausente quando o app roda como web app puro (`npm run dev`).
     */
    irisflowAPI?: {
      runEncoderInference(input: EncoderInput): Promise<Float32Array | null>;
    };
    /** Dispara download do log de falhas do eyeCrop (campo: diagnóstico). */
    __exportEyeCropLog?: () => void;
  }
}
