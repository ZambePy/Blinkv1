import { contextBridge, ipcRenderer } from 'electron';
import type { EncoderInput } from './inference/encoderRunner';

const irisflowAPI = {
  runEncoderInference: async (input: EncoderInput): Promise<Float32Array | null> => {
    // O main serializa o embedding como number[] para cruzar o boundary IPC+sandbox.
    // Reconstruímos Float32Array aqui, no contexto do renderer, após o boundary.
    const raw: number[] | null = await ipcRenderer.invoke('encoder:infer', input);
    return raw != null ? new Float32Array(raw) : null;
  },
};

export type IrisflowAPI = typeof irisflowAPI;

contextBridge.exposeInMainWorld('irisflowAPI', irisflowAPI);
