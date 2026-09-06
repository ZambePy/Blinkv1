import { describe, it, expect } from 'vitest';
import { createL2CSClient } from './client';

describe('createL2CSClient', () => {
  it('cria instância sem tocar no Worker antes de start()', () => {
    const client = createL2CSClient();
    expect(client.getMeta()).toBeNull();
    expect(client.getExecutionProvider()).toBeNull();
    expect(client.canSubmit(0)).toBe(false);
    // getLatestGaze antes de qualquer resultado deve devolver invalid
    const g = client.getLatestGaze(0);
    expect(g.valid).toBe(false);
    expect(g.yaw).toBe(0);
    expect(g.pitch).toBe(0);
  });

  it('submitTensor sem start() retorna false (não trava, não lança)', () => {
    const client = createL2CSClient();
    const t = new Float32Array(1 * 3 * 448 * 448);
    expect(client.submitTensor(t)).toBe(false);
  });

  it('getLatestGaze com nowMs > staleMs após timestamp devolve valid=false (mock)', () => {
    // Não conseguimos simular resultado real sem worker, mas conseguimos
    // testar o contrato de degradação graciosa via stop() após criação.
    const client = createL2CSClient();
    client.stop();
    const g = client.getLatestGaze(1000);
    expect(g.valid).toBe(false);
  });

  // O cliente responde `getAverageConfidence()` mesmo antes de qualquer
  // inferência (default 0) e não carimba `confidence` no L2CSGaze default
  // inválido — o consumidor distingue "sem sinal" de "conf=0" pela ausência
  // do campo.
  it('getAverageConfidence() = 0 antes de qualquer resultado', () => {
    const client = createL2CSClient();
    expect(client.getAverageConfidence()).toBe(0);
  });

  it('L2CSGaze inválido inicial NÃO carrega campo confidence', () => {
    const client = createL2CSClient();
    const g = client.getLatestGaze(0);
    expect(g.valid).toBe(false);
    expect(g.confidence).toBeUndefined();
  });
});
