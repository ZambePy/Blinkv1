import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import {
  startRecording,
  stopRecording,
  recordFrame,
  getRecording,
  clearRecording,
} from './recorder';

// -----------------------------------------------------------------------------
// B3.28 — O JSONL exportado não pode ser alinhado a nenhum evento externo.
//
// `header.startedAt` é relógio de PAREDE (`new Date().toISOString()`), mas
// `captureTs` e `emitTs` são `performance.now()` — milissegundos desde o
// *page load*, não desde a época. E `performance.timeOrigin`, que é a ponte
// entre os dois, **não era gravado**.
//
// Sem ele não há como responder "que horas eram no frame 4200?", e portanto
// não há como cruzar a gravação com nada de fora: um vídeo de referência, um
// log clínico, a anotação de um observador. Para um artefato cujo propósito é
// permitir análise offline, isso é a diferença entre dado e curiosidade.
//
// Segundo defeito: `frameIdx: framesSeen` é o contador VITALÍCIO do engine.
// Uma gravação iniciada 10 minutos após o boot começa em ~18000. O índice
// deixa de ser posição na gravação e vira "quantos frames o app já viu",
// que é uma informação diferente e não é a que o consumidor espera.
// -----------------------------------------------------------------------------

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

describe('B3.28 — a gravação carrega a origem do relógio', () => {
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

describe('B3.28 — frameIdx é relativo à GRAVAÇÃO', () => {
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
