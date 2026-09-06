import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  startRecording,
  stopRecording,
  recordFrame,
  getRecording,
  clearRecording,
} from './recorder';

// A gravação JSONL precisa ser alinhável a eventos externos (vídeo de
// referência, log clínico): `captureTs`/`emitTs` são `performance.now()`, então
// o header grava `performance.timeOrigin`. E `frameIdx` é relativo à
// gravação, não ao contador vitalício do engine.

const HEADER = {
  resolution: { w: 1920, h: 1080 },
  videoResolution: { w: 1920, h: 1080 },
};

beforeEach(() => {
  clearRecording();
});

afterEach(() => {
  vi.restoreAllMocks();
  clearRecording();
});

describe('a gravação carrega a origem do relógio', () => {
  it('o header grava timeOrigin', () => {
    startRecording(HEADER);
    const r = getRecording();
    expect(typeof r.header.timeOrigin).toBe('number');
    expect(Number.isFinite(r.header.timeOrigin!)).toBe(true);
  });

  it('timeOrigin + captureTs reconstrói a hora de parede do frame', () => {
    // A propriedade que torna a gravação cruzável com qualquer fonte externa.
    startRecording(HEADER);
    recordFrame({ captureTs: 1234.5, emitTs: 1240.0, frameIdx: 0, hasFace: true });

    const r = getRecording();
    const origem = r.header.timeOrigin!;
    const horaDoFrame = origem + r.frames[0].captureTs;

    // Bate com o `startedAt` do header dentro de alguns segundos — não é
    // igualdade exata porque `startedAt` é gravado antes do frame.
    const inicio = new Date(r.header.startedAt).getTime();
    expect(Math.abs(horaDoFrame - inicio)).toBeLessThan(60_000);
  });

  it('timeOrigin é coerente com startedAt', () => {
    startRecording(HEADER);
    const r = getRecording();
    const origem = r.header.timeOrigin!;
    const inicio = new Date(r.header.startedAt).getTime();
    // `startedAt` acontece DEPOIS do carregamento da página.
    expect(inicio).toBeGreaterThanOrEqual(origem - 1000);
  });
});

describe('frameIdx é relativo à GRAVAÇÃO', () => {
  it('a primeira gravação começa em 0', () => {
    startRecording(HEADER);
    // O caller passa o contador vitalício do engine; o recorder reindexará.
    recordFrame({ captureTs: 100, emitTs: 101, frameIdx: 18000, hasFace: true });
    recordFrame({ captureTs: 133, emitTs: 134, frameIdx: 18001, hasFace: true });

    const r = getRecording();
    expect(r.frames[0].frameIdx).toBe(0);
    expect(r.frames[1].frameIdx).toBe(1);
  });

  it('uma gravação iniciada tarde na sessão NÃO começa em 18000', () => {
    // O sintoma concreto: 10 minutos de app antes de gravar, e o JSONL abria
    // no frame 18000. Quem lê conclui que perdeu o começo do arquivo.
    startRecording(HEADER);
    for (let i = 0; i < 5; i++) {
      recordFrame({ captureTs: 100 + i * 33, emitTs: 101 + i * 33, frameIdx: 18000 + i, hasFace: true });
    }
    const r = getRecording();
    expect(r.frames.map((f) => f.frameIdx)).toEqual([0, 1, 2, 3, 4]);
  });

  it('uma segunda gravação recomeça em 0', () => {
    startRecording(HEADER);
    recordFrame({ captureTs: 1, emitTs: 2, frameIdx: 500, hasFace: true });
    stopRecording();

    startRecording(HEADER);
    recordFrame({ captureTs: 3, emitTs: 4, frameIdx: 900, hasFace: true });
    const r = getRecording();
    expect(r.frames).toHaveLength(1);
    expect(r.frames[0].frameIdx).toBe(0);
  });

  it('o índice é contíguo mesmo com frames sem rosto no meio', () => {
    // `frameIdx` é posição no arquivo, não contagem de frames úteis: pular
    // números quebraria qualquer consumidor que itere por índice.
    startRecording(HEADER);
    recordFrame({ captureTs: 1, emitTs: 2, frameIdx: 10, hasFace: true });
    recordFrame({ captureTs: 34, emitTs: 35, frameIdx: 11, hasFace: false });
    recordFrame({ captureTs: 67, emitTs: 68, frameIdx: 12, hasFace: true });
    const r = getRecording();
    expect(r.frames.map((f) => f.frameIdx)).toEqual([0, 1, 2]);
  });

  it('frames descartados por cap NÃO consomem índice', () => {
    // Se um frame não entrou no arquivo, o índice dele não pode existir —
    // senão haveria buracos.
    startRecording(HEADER);
    recordFrame({ captureTs: 1, emitTs: 2, frameIdx: 0, hasFace: true });
    stopRecording();
    recordFrame({ captureTs: 3, emitTs: 4, frameIdx: 1, hasFace: true }); // ignorado
    startRecording(HEADER);
    recordFrame({ captureTs: 5, emitTs: 6, frameIdx: 2, hasFace: true });

    const r = getRecording();
    expect(r.frames).toHaveLength(1);
    expect(r.frames[0].frameIdx).toBe(0);
  });
});
