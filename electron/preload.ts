import { contextBridge, ipcRenderer } from 'electron';

const irisflowAPI = {
  runEncoderInference: (input: Float32Array): Promise<Float32Array | null> =>
    ipcRenderer.invoke('encoder:infer', input),
};

export type IrisflowAPI = typeof irisflowAPI;

contextBridge.exposeInMainWorld('irisflowAPI', irisflowAPI);
