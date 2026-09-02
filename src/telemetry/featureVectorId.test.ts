import { describe, it, expect } from 'vitest';
import { FEATURE_VECTOR_ID, ACTIVE_FEATURE_SET, IRIS12_DIMS, activeFeatureDims } from '../extractor';
import { startRecording, stopRecording, clearRecording, getRecording, parseJSONL, exportAsJSONL, recordFrame } from './recorder';

// O identificador do vetor existe para que uma gravação nunca seja medida
// contra um build diferente do que a produziu, em silêncio.
describe('FEATURE_VECTOR_ID', () => {
  it('descreve o conjunto ativo e a dimensão', () => {
    expect(FEATURE_VECTOR_ID).toBe(`${ACTIVE_FEATURE_SET}:${activeFeatureDims()}`);
    expect(FEATURE_VECTOR_ID).toBe('irisCore+l2cs:6');
  });

  it('`compact` não promete dimensão fixa', () => {
    // 37 sem bloco L2CS, 44 com. Quem grava em `compact` não pode comparar por
    // dimensão — tem de recomputar.
    expect(activeFeatureDims('compact')).toBe('var');
    expect(activeFeatureDims('iris12')).toBe(IRIS12_DIMS);
  });

  it('muda quando o conjunto ativo muda — é o ponto do identificador', () => {
    expect(`iris12:${activeFeatureDims('iris12')}`).not.toBe(`compact:${activeFeatureDims('compact')}`);
  });
});

describe('cabeçalho da gravação', () => {
  it('grava o identificador do vetor sem o caller poder errar', () => {
    clearRecording();
    startRecording({
      resolution: { w: 1920, h: 1080 },
      videoResolution: { w: 1920, h: 1080 },
    });
    stopRecording();
    expect(getRecording()?.header.featureVectorId).toBe(FEATURE_VECTOR_ID);
  });

  it('sobrevive à ida e volta pelo JSONL — é lá que consumidores lêem', () => {
    clearRecording();
    startRecording({
      resolution: { w: 1920, h: 1080 },
      videoResolution: { w: 1920, h: 1080 },
    });
    recordFrame({ captureTs: 0, emitTs: 0, frameIdx: 0, hasFace: false, blink: false });
    stopRecording();
    const round = parseJSONL(exportAsJSONL());
    expect(round?.header.featureVectorId).toBe(FEATURE_VECTOR_ID);
  });

  it('gravação anterior à mudança não tem o campo — e isso é detectável', () => {
    // Consumidores devem tratar ausência como "vetor desconhecido" e abortar
    // em vez de assumir compatibilidade. Este teste trava esse contrato.
    const antiga = parseJSONL(
      JSON.stringify({ formatVersion: 2, startedAt: 'x', resolution: { w: 1, h: 1 }, videoResolution: { w: 1, h: 1 } }) + String.fromCharCode(10),
    );
    expect(antiga?.header.featureVectorId).toBeUndefined();
  });
});
