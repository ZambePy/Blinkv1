import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { apiFetch, ApiError } from './api';

describe('apiFetch', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('retorna JSON quando o content-type é application/json', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ ok: true }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
          })
      )
    );
    const res = await apiFetch<{ ok: boolean }>('/test');
    expect(res.ok).toBe(true);
  });

  it('lança ApiError com status em respostas não-ok', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response(JSON.stringify({ error: 'nope' }), {
            status: 404,
            headers: { 'content-type': 'application/json' },
          })
      )
    );
    await expect(apiFetch('/nao-existe')).rejects.toBeInstanceOf(ApiError);
  });

  it('anexa Authorization Bearer quando authToken é fornecido', async () => {
    const spy = vi.fn(async () => new Response(null, { status: 204 }));
    vi.stubGlobal('fetch', spy);
    await apiFetch('/x', { authToken: 'abc' });
    const call = spy.mock.calls[0];
    const init = call[1] as RequestInit;
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer abc');
  });
});
