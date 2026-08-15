import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearRecording,
  exportAsJSONL,
  getDroppedCount,
  getFrameCount,
  getRecording,
  isRecording,
  parseJSONL,
  recordFrame,
  startRecording,
  stopRecording,
} from './recorder';
import { MAX_FRAMES, RECORDING_FORMAT_VERSION, type RecordedFrame } from './types';

// Todos os testes começam com o singleton limpo — como o módulo mantém
// estado entre testes, o beforeEach é obrigatório.
beforeEach(() => {
  clearRecording();
});

function makeFrame(idx: number, overrides: Partial<RecordedFrame> = {}): RecordedFrame {
  return {
    captureTs: 1000 + idx * 33,
    emitTs: 1001 + idx * 33,
    frameIdx: idx,
    hasFace: true,
    ...overrides,
  };
}

describe('recorder — lifecycle', () => {
  it('start ativa; stop desativa; ambos são idempotentes na leitura de estado', () => {
    expect(isRecording()).toBe(false);
    startRecording({
      resolution: { w: 1920, h: 1080 },
      videoResolution: { w: 1280, h: 720 },
    });
    expect(isRecording()).toBe(true);
    stopRecording();
    expect(isRecording()).toBe(false);
  });

  it('recordFrame quando inativo é no-op (não conta frame, não conta drop)', () => {
    recordFrame(makeFrame(0));
    expect(getFrameCount()).toBe(0);
    expect(getDroppedCount()).toBe(0);
  });

  it('clearRecording zera tudo (header, buffer, dropped, active)', () => {
    startRecording({
      resolution: { w: 1024, h: 768 },
      videoResolution: { w: 640, h: 480 },
    });
    recordFrame(makeFrame(0));
    expect(getFrameCount()).toBe(1);
    clearRecording();
    expect(isRecording()).toBe(false);
    expect(getFrameCount()).toBe(0);
    expect(getDroppedCount()).toBe(0);
    expect(getRecording()).toBeNull();
  });
});

describe('recorder — buffer', () => {
  it('acumula frames enquanto ativo, na ordem de chegada', () => {
    startRecording({
      resolution: { w: 1920, h: 1080 },
      videoResolution: { w: 1280, h: 720 },
    });
    for (let i = 0; i < 5; i++) recordFrame(makeFrame(i));
    const rec = getRecording();
    expect(rec).not.toBeNull();
    expect(rec!.frames).toHaveLength(5);
    expect(rec!.frames.map((f) => f.frameIdx)).toEqual([0, 1, 2, 3, 4]);
  });

  it('stopRecording não apaga o buffer — exportAsJSONL continua funcionando', () => {
    startRecording({
      resolution: { w: 1920, h: 1080 },
      videoResolution: { w: 1280, h: 720 },
    });
    recordFrame(makeFrame(0));
    recordFrame(makeFrame(1));
    stopRecording();
    // Novos frames após stop são ignorados, mas os antigos continuam.
    recordFrame(makeFrame(2));
    expect(getFrameCount()).toBe(2);
    const text = exportAsJSONL();
    expect(text.split('\n')).toHaveLength(1 + 2);
  });

  it('respeita MAX_FRAMES e conta drops', () => {
    startRecording({
      resolution: { w: 800, h: 600 },
      videoResolution: { w: 320, h: 240 },
    });
    // Overshoot deliberado em 10 frames para não precisar iterar MAX_FRAMES+algo
    // gigante em teste — bastam frames além do teto para acionar o drop.
    const overshoot = 10;
    for (let i = 0; i < MAX_FRAMES + overshoot; i++) recordFrame(makeFrame(i));
    expect(getFrameCount()).toBe(MAX_FRAMES);
    expect(getDroppedCount()).toBe(overshoot);
  });
});

describe('recorder — serialização', () => {
  it('roundtrip JSONL preserva header + frames + droppedFrames', () => {
    startRecording({
      resolution: { w: 1920, h: 1080 },
      videoResolution: { w: 1280, h: 720 },
      l2cs: { dataset: 'gaze360', inputSize: 448, binWidth: 4, binOffset: -180 },
    });
    const original: RecordedFrame[] = [
      makeFrame(0, { hasFace: false }),
      makeFrame(1, {
        landmarks: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6],
        l2cs: { yaw: 0.1, pitch: -0.05, valid: true },
        featuresLeft: [0.01, 0.02],
        featuresRight: [0.03, 0.04],
        predicted: { x: 960, y: 540 },
        target: { kind: 'calibration', xPx: 192, yPx: 108 },
      }),
      makeFrame(2, {
        blink: true,
        quality: { yaw: 0.01, pitch: -0.02, roll: 0.003, brightnessEstimate: 0.5 },
      }),
    ];
    for (const f of original) recordFrame(f);

    const text = exportAsJSONL();
    const parsed = parseJSONL(text);
    expect(parsed).not.toBeNull();
    expect(parsed!.header.formatVersion).toBe(RECORDING_FORMAT_VERSION);
    expect(parsed!.header.resolution).toEqual({ w: 1920, h: 1080 });
    expect(parsed!.header.l2cs).toEqual({
      dataset: 'gaze360', inputSize: 448, binWidth: 4, binOffset: -180,
    });
    expect(parsed!.droppedFrames).toBe(0);
    expect(parsed!.frames).toHaveLength(3);
    expect(parsed!.frames[1].landmarks).toEqual([0.1, 0.2, 0.3, 0.4, 0.5, 0.6]);
    expect(parsed!.frames[1].l2cs).toEqual({ yaw: 0.1, pitch: -0.05, valid: true });
    expect(parsed!.frames[1].target).toEqual({ kind: 'calibration', xPx: 192, yPx: 108 });
    expect(parsed!.frames[2].blink).toBe(true);
    expect(parsed!.frames[2].quality?.brightnessEstimate).toBe(0.5);
  });

  it('exportAsJSONL retorna string vazia se nunca gravou', () => {
    expect(exportAsJSONL()).toBe('');
  });

  it('parseJSONL rejeita texto sem header válido', () => {
    expect(parseJSONL('')).toBeNull();
    expect(parseJSONL('{"foo":1}')).toBeNull();   // sem formatVersion
    expect(parseJSONL('{{{')).toBeNull();          // JSON quebrado
  });

  it('parseJSONL rejeita quando uma linha de frame está corrompida (não pula silenciosamente)', () => {
    startRecording({
      resolution: { w: 800, h: 600 },
      videoResolution: { w: 640, h: 480 },
    });
    recordFrame(makeFrame(0));
    const text = exportAsJSONL();
    const corrupted = text + '\n{"frameIdx":99'; // 3ª linha inválida
    expect(parseJSONL(corrupted)).toBeNull();
  });
});
