export {};

declare global {
  interface Window {
    /**
     * Ponte para o processo main do Electron (contextBridge, sem Node no
     * renderer). Ausente quando o app roda como web app puro (`npm run dev`).
     */
    irisflowAPI?: {
      runEncoderInference(input: Float32Array): Promise<Float32Array | null>;
    };
  }
}
