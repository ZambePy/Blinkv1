import { describe, it, expect, beforeEach, vi } from 'vitest';
import { DesktopSync } from './desktopSync';

// Fora do Electron o cofre cai no localStorage — é o que os testes exercitam.
const URL_FN = 'https://abc.supabase.co/functions/v1/desktop-sync';

function respostaHttp(status: number, corpo: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => corpo,
  } as unknown as Response;
}

describe('DesktopSync — envio, fila offline e credencial', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('envia com a chave do computador no header e devolve o corpo', async () => {
    const fetchImpl = vi.fn(async () => respostaHttp(200, { ok: true, id: 'm1' }));
    const s = new DesktopSync({ url: URL_FN, chave: () => 'chave-123', fetchImpl });
    const r = await s.enviar({ action: 'message.send', text: 'oi', kind: 'texto' });
    expect(r).toEqual({ ok: true, id: 'm1' });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(URL_FN);
    expect((init.headers as Record<string, string>)['x-device-key']).toBe('chave-123');
    expect(JSON.parse(String(init.body))).toEqual({ action: 'message.send', text: 'oi', kind: 'texto' });
  });

  it('sem rede, mensagem e socorro vão para a fila; heartbeat não', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const s = new DesktopSync({ url: URL_FN, chave: () => 'k', fetchImpl });
    await s.enviar({ action: 'message.send', text: 'água', kind: 'frase' });
    await s.enviar({ action: 'help.create', kind: 'emergencia', message: 'dor' });
    await s.enviar({ action: 'heartbeat', app_version: '1', camera_ok: true, tracker_ok: true, calibrated: true });
    expect(s.tamanhoDaFila).toBe(2);
    expect(localStorage.getItem('irisflow.fila')).not.toBeNull();
  });

  it('quando a rede volta, drena na ordem e limpa a fila', async () => {
    let online = false;
    const enviados: string[] = [];
    const fetchImpl = vi.fn(async (_u: string | URL | Request, init?: RequestInit) => {
      if (!online) throw new TypeError('Failed to fetch');
      enviados.push(JSON.parse(String(init?.body)).action);
      return respostaHttp(200, { ok: true });
    });
    const s = new DesktopSync({ url: URL_FN, chave: () => 'k', fetchImpl: fetchImpl as unknown as typeof fetch });
    await s.enviar({ action: 'message.send', text: '1', kind: 'texto' });
    await s.enviar({ action: 'help.create', kind: 'ajuda', message: '2' });
    online = true;
    const n = await s.drenar();
    expect(n).toBe(2);
    expect(enviados).toEqual(['message.send', 'help.create']);
    expect(s.tamanhoDaFila).toBe(0);
    expect(localStorage.getItem('irisflow.fila')).toBeNull();
  });

  it('a fila sobrevive a uma nova instância (reabrir o app)', async () => {
    const off = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const s1 = new DesktopSync({ url: URL_FN, chave: () => 'k', fetchImpl: off });
    await s1.enviar({ action: 'message.send', text: 'antes de fechar', kind: 'texto' });

    const on = vi.fn(async () => respostaHttp(200, { ok: true }));
    const s2 = new DesktopSync({ url: URL_FN, chave: () => 'k', fetchImpl: on });
    expect(await s2.drenar()).toBe(1);
    expect(on).toHaveBeenCalledTimes(1);
  });

  it('401/403 (computador desvinculado) avisa e NÃO enfileira', async () => {
    const fetchImpl = vi.fn(async () => respostaHttp(403, { error: 'device_revoked' }));
    const perdeu = vi.fn();
    const s = new DesktopSync({ url: URL_FN, chave: () => 'k', fetchImpl, aoPerderCredencial: perdeu });
    const r = await s.enviar({ action: 'message.send', text: 'x', kind: 'texto' });
    expect(r.error).toBe('device_revoked');
    expect(perdeu).toHaveBeenCalledTimes(1);
    expect(s.tamanhoDaFila).toBe(0);
  });

  it('400 (payload inválido) não enfileira — reenviar não resolve', async () => {
    const fetchImpl = vi.fn(async () => respostaHttp(400, { error: 'texto vazio' }));
    const s = new DesktopSync({ url: URL_FN, chave: () => 'k', fetchImpl });
    const r = await s.enviar({ action: 'message.send', text: '', kind: 'texto' });
    expect(r.ok).toBe(false);
    expect(s.tamanhoDaFila).toBe(0);
  });

  it('manda o JWT anônimo junto (o gateway do Supabase exige) e a chave do computador', async () => {
    const fetchImpl = vi.fn(async () => respostaHttp(200, { ok: true }));
    const s = new DesktopSync({ url: URL_FN, chave: () => 'k', anonKey: 'ANON', fetchImpl });
    await s.enviar({ action: 'settings.get' });
    const init = fetchImpl.mock.calls[0][1] as RequestInit;
    const h = init.headers as Record<string, string>;
    expect(h.apikey).toBe('ANON');
    expect(h.authorization).toBe('Bearer ANON');
    expect(h['x-device-key']).toBe('k');
  });

  it('um 401 do GATEWAY (função publicada com verify_jwt) não é perda de credencial: vai para a fila', async () => {
    const fetchImpl = vi.fn(async () => respostaHttp(401, { code: 401, message: 'Missing authorization header' }));
    const perdeu = vi.fn();
    const s = new DesktopSync({ url: URL_FN, chave: () => 'k', fetchImpl, aoPerderCredencial: perdeu });
    await s.enviar({ action: 'help.create', kind: 'emergencia', message: 'socorro' });
    expect(perdeu).not.toHaveBeenCalled();
    expect(s.tamanhoDaFila).toBe(1);
  });

  it('session.upsert não entra na fila (a resposta é o que importa)', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const s = new DesktopSync({ url: URL_FN, chave: () => 'k', fetchImpl });
    await s.enviar({ action: 'session.upsert', session: { status: 'active' } });
    expect(s.tamanhoDaFila).toBe(0);
  });

  it('limparFila descarta o pendente e o que estava no cofre', async () => {
    const off = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    const s = new DesktopSync({ url: URL_FN, chave: () => 'k', fetchImpl: off });
    await s.enviar({ action: 'message.send', text: 'x', kind: 'texto' });
    await s.limparFila();
    expect(s.tamanhoDaFila).toBe(0);
    expect(localStorage.getItem('irisflow.fila')).toBeNull();
  });

  it('sem vínculo, guarda para quando houver chave', async () => {
    const fetchImpl = vi.fn();
    let chave: string | null = null;
    const s = new DesktopSync({ url: URL_FN, chave: () => chave, fetchImpl });
    await s.enviar({ action: 'help.create', kind: 'emergencia', message: 'socorro' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(s.tamanhoDaFila).toBe(1);
    chave = 'agora-tem';
    fetchImpl.mockResolvedValue(respostaHttp(200, { ok: true }));
    expect(await s.drenar()).toBe(1);
  });
});
