import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createL2CSClient } from './client';
import type { L2CSWorkerRequest } from './types';

// Os artefatos do ORT (frontend/public/ort/) são resolvidos pela PÁGINA e
// enviados ao worker no `init`. Dentro do worker `location.href` é a URL do
// próprio script (em `assets/` no build, em `/@fs/...` no dev-server): um
// `new URL('ort/', location.href)` lá apontaria para um diretório vazio e o
// L2CS nunca sairia de `loading`.

class FakeWorker {
  static ultimo: FakeWorker | null = null;
  posted: L2CSWorkerRequest[] = [];
  constructor(_url: URL | string, _opts?: WorkerOptions) {
    FakeWorker.ultimo = this;
  }
  addEventListener(): void {}
  removeEventListener(): void {}
  postMessage(msg: L2CSWorkerRequest): void {
    this.posted.push(msg);
  }
  terminate(): void {}
}

let originalWorker: unknown;

beforeEach(() => {
  FakeWorker.ultimo = null;
  originalWorker = (globalThis as Record<string, unknown>).Worker;
  (globalThis as Record<string, unknown>).Worker = FakeWorker;
});

afterEach(() => {
  (globalThis as Record<string, unknown>).Worker = originalWorker;
});

describe('o init leva a URL dos artefatos do ORT resolvida pela página', () => {
  it('ortBaseUrl é `ort/` relativo à página, ao lado de `models/`', () => {
    const client = createL2CSClient();
    void client.start();
    const init = FakeWorker.ultimo!.posted.find((m) => m.type === 'init');
    expect(init && init.type === 'init').toBe(true);
    if (!init || init.type !== 'init') return;

    const esperado = new URL('ort/', location.href).href;
    expect(init.ortBaseUrl).toBe(esperado);
    expect(init.ortBaseUrl!.endsWith('/')).toBe(true);
    // Mesma base dos modelos: se um resolve sob file://, o outro também.
    expect(init.modelUrl.startsWith(new URL('.', location.href).href)).toBe(true);
    expect(init.ortBaseUrl!.startsWith(new URL('.', location.href).href)).toBe(true);
    client.stop();
  });
});
