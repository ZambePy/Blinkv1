import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { SupabaseClient } from '@supabase/supabase-js';
import { createSupabaseLicenseService } from './supabaseLicenseService';

// O contrato do Bloco 1 (`LicenseService`) cumprido pelo Supabase do site.
// Sem rede: o cliente supabase-js e o fetch da Edge Function são dublês.

vi.mock('../../cloud/config', () => ({
  nuvemConfigurada: true,
  cloudConfig: {
    url: 'https://abc.supabase.co', anonKey: 'ANON'.padEnd(30, 'x'),
    desktopSyncUrl: 'https://abc.supabase.co/functions/v1/desktop-sync',
    siteUrl: 'https://irisflow.test', carenciaOfflineDias: 7, heartbeatMs: 30_000,
  },
}));

const LICENCA = {
  allowed: true, reason: 'avaliacao', status: 'avaliacao', plan_id: 'essencial', plan_name: 'Essencial',
  trial_ends_at: '2026-09-23T00:00:00Z', next_charge_at: '2026-09-23T00:00:00Z', access_until: '2026-09-26T00:00:00Z',
  checked_at: '2026-09-08T00:00:00Z', beneficiary: { id: 'ben-1', user_name: 'Carlos' },
  features: { relatorios: false, multiplos_dispositivos: false, assistente: false, voz: false },
};

const device = { deviceId: 'local-uuid-1', deviceName: 'Computador com Windows', boundAt: '2026-09-08T00:00:00Z' };

function fabricarCliente(op: {
  authError?: { message: string } | null;
  licenca?: typeof LICENCA;
  ativos?: Array<{ id: string; name: string; hostname: string | null; paired_at: string; last_seen_at: string }>;
} = {}) {
  const rpc = vi.fn(async (nome: string) => {
    if (nome === 'desktop_license') return { data: op.licenca ?? LICENCA, error: null };
    if (nome === 'pair_device') return { data: { device_id: 'dev-9', device_key: 'CHAVE-9', revoked_device_ids: [] }, error: null };
    if (nome === 'revoke_device') return { data: true, error: null };
    return { data: null, error: { message: `rpc ${nome}` } };
  });
  const auth = {
    signInWithPassword: vi.fn(async () => ({ data: {}, error: op.authError ?? null })),
    signOut: vi.fn(async () => ({ error: null })),
  };
  const from = vi.fn(() => ({
    select: () => ({ eq: () => ({ is: () => ({ order: async () => ({ data: op.ativos ?? [], error: null }) }) }) }),
  }));
  const cliente = { rpc, auth, from } as unknown as SupabaseClient;
  return { cliente, rpc, auth };
}

const respostaHttp = (status: number, corpo: unknown) =>
  ({ ok: status < 300, status, json: async () => corpo }) as unknown as Response;

describe('supabaseLicenseService.login', () => {
  beforeEach(() => localStorage.clear());

  it('caminho feliz: autentica, consulta a licença, pareia e devolve a chave como token', async () => {
    const { cliente, rpc, auth } = fabricarCliente();
    const svc = createSupabaseLicenseService({ cliente: () => cliente });
    const r = await svc.login('Familia@Exemplo.com', 'segredo', device);
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: 'familia@exemplo.com', password: 'segredo' });
    expect(rpc).toHaveBeenCalledWith('pair_device', expect.objectContaining({ p_beneficiary_id: 'ben-1', p_hostname: 'local-uuid-1' }));
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.license.token).toBe('CHAVE-9');
      expect(r.license.account).toMatchObject({ email: 'familia@exemplo.com', beneficiaryId: 'ben-1', beneficiaryName: 'Carlos' });
      expect(r.license.plan).toMatchObject({ id: 'essencial', name: 'IrisFlow Essencial', deviceLimit: 1, validUntil: '2026-09-26T00:00:00Z' });
      expect(r.license.thisDevice.deviceId).toBe('local-uuid-1');
    }
    // o CloudProvider lê o vínculo do cofre (localStorage fora do Electron)
    expect(JSON.parse(localStorage.getItem('irisflow.vinculo')!)).toMatchObject({ device_key: 'CHAVE-9', beneficiary_id: 'ben-1' });
  });

  it('senha errada → invalid-credentials', async () => {
    const { cliente } = fabricarCliente({ authError: { message: 'Invalid login credentials' } });
    const r = await createSupabaseLicenseService({ cliente: () => cliente }).login('a@b.c', 'x', device);
    expect(r).toEqual({ ok: false, reason: 'invalid-credentials' });
  });

  it('sem internet no auth → offline; limite de tentativas → rate-limited', async () => {
    const off = fabricarCliente({ authError: { message: 'TypeError: Failed to fetch' } });
    expect(await createSupabaseLicenseService({ cliente: () => off.cliente }).login('a@b.c', 'x', device)).toEqual({ ok: false, reason: 'offline' });
    const rl = fabricarCliente({ authError: { message: 'Request rate limit reached' } });
    expect(await createSupabaseLicenseService({ cliente: () => rl.cliente }).login('a@b.c', 'x', device)).toMatchObject({ ok: false, reason: 'rate-limited' });
  });

  it('conta sem assinatura liberada → no-subscription com o endereço do site; não pareia', async () => {
    const { cliente, rpc } = fabricarCliente({ licenca: { ...LICENCA, allowed: false, reason: 'avaliacao_encerrada' } });
    const r = await createSupabaseLicenseService({ cliente: () => cliente }).login('a@b.c', 'x', device);
    expect(r).toMatchObject({ ok: false, reason: 'no-subscription', manageUrl: 'https://irisflow.test/conta' });
    expect(rpc).not.toHaveBeenCalledWith('pair_device', expect.anything());
  });

  it('Essencial com outro computador ativo → device-limit; transferir pareia (e o banco revoga o antigo)', async () => {
    const { cliente, rpc } = fabricarCliente({
      ativos: [{ id: 'dev-1', name: 'Notebook da sala', hostname: 'outro-uuid', paired_at: '2026-09-01T00:00:00Z', last_seen_at: '2026-09-08T00:00:00Z' }],
    });
    const svc = createSupabaseLicenseService({ cliente: () => cliente });
    const r = await svc.login('a@b.c', 'x', device);
    expect(r.ok).toBe(false);
    if (r.ok || r.reason !== 'device-limit') throw new Error('esperava device-limit');
    expect(r.devices).toEqual([{ deviceId: 'outro-uuid', deviceName: 'Notebook da sala', boundAt: '2026-09-01T00:00:00Z' }]);
    expect(rpc).not.toHaveBeenCalledWith('pair_device', expect.anything());

    const t = await svc.transferDevice(r.transferToken, device);
    expect(t.ok).toBe(true);
    expect(rpc).toHaveBeenCalledWith('pair_device', expect.objectContaining({ p_beneficiary_id: 'ben-1' }));
  });

  it('o mesmo computador (mesmo id local) não conta como "outro" no Essencial', async () => {
    const { cliente } = fabricarCliente({
      ativos: [{ id: 'dev-1', name: 'Este PC', hostname: 'local-uuid-1', paired_at: '2026-09-01T00:00:00Z', last_seen_at: '2026-09-08T00:00:00Z' }],
    });
    const r = await createSupabaseLicenseService({ cliente: () => cliente }).login('a@b.c', 'x', device);
    expect(r.ok).toBe(true);
  });

  it('plano com múltiplos dispositivos nunca devolve device-limit', async () => {
    const { cliente } = fabricarCliente({
      licenca: { ...LICENCA, plan_id: 'completo', plan_name: 'Completo', features: { ...LICENCA.features, multiplos_dispositivos: true } },
      ativos: [{ id: 'dev-1', name: 'Outro', hostname: 'x', paired_at: '', last_seen_at: '' }],
    });
    const r = await createSupabaseLicenseService({ cliente: () => cliente }).login('a@b.c', 'x', device);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.license.plan.deviceLimit).toBeNull();
  });

  it('transferToken inválido ou vencido não transfere', async () => {
    const { cliente } = fabricarCliente();
    const r = await createSupabaseLicenseService({ cliente: () => cliente }).transferDevice('tr-inexistente', device);
    expect(r.ok).toBe(false);
  });
});

describe('supabaseLicenseService.verify', () => {
  beforeEach(() => {
    localStorage.clear();
    localStorage.setItem('irisflow.vinculo', JSON.stringify({ device_id: 'dev-9', device_key: 'CHAVE-9', beneficiary_id: 'ben-1', beneficiary_name: 'Carlos', email: 'a@b.c', pareado_em: '2026-09-08T00:00:00Z' }));
  });

  const svcCom = (fetchImpl: typeof fetch) => createSupabaseLicenseService({ cliente: () => fabricarCliente().cliente, fetchImpl });

  it('device.info ok com licença liberada → ok, com JWT anônimo e chave no header', async () => {
    const fetchImpl = vi.fn(async () => respostaHttp(200, {
      device: { id: 'dev-9', name: 'PC', os: 'windows', app_version: '1' },
      beneficiary: { id: 'ben-1', user_name: 'Carlos' }, license: LICENCA, devices_active: 1,
    }));
    const r = await svcCom(fetchImpl as unknown as typeof fetch).verify('CHAVE-9', 'local-uuid-1');
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.license.account.email).toBe('a@b.c');
      expect(r.license.plan.name).toBe('IrisFlow Essencial');
    }
    const init = (fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1];
    const h = init.headers as Record<string, string>;
    expect(h['x-device-key']).toBe('CHAVE-9');
    expect(h.apikey).toBeDefined();
    expect(JSON.parse(String(init.body))).toEqual({ action: 'device.info' });
  });

  it('403 device_revoked → revoked; 401 unauthorized → invalid-token', async () => {
    expect(await svcCom(vi.fn(async () => respostaHttp(403, { error: 'device_revoked' })) as unknown as typeof fetch).verify('k', 'd'))
      .toEqual({ ok: false, reason: 'revoked' });
    expect(await svcCom(vi.fn(async () => respostaHttp(401, { error: 'unauthorized' })) as unknown as typeof fetch).verify('k', 'd'))
      .toEqual({ ok: false, reason: 'invalid-token' });
  });

  it('assinatura deixou de liberar → expired', async () => {
    const fetchImpl = vi.fn(async () => respostaHttp(200, {
      device: { id: 'dev-9', name: 'PC' }, beneficiary: { id: 'ben-1', user_name: 'Carlos' },
      license: { ...LICENCA, allowed: false, reason: 'avaliacao_encerrada' },
    }));
    expect(await svcCom(fetchImpl as unknown as typeof fetch).verify('CHAVE-9', 'd')).toEqual({ ok: false, reason: 'expired' });
  });

  it('rede fora, 5xx ou gateway sem a função → unreachable (aciona a tolerância offline)', async () => {
    expect(await svcCom(vi.fn(async () => { throw new TypeError('Failed to fetch'); }) as unknown as typeof fetch).verify('k', 'd')).toEqual({ ok: false, reason: 'unreachable' });
    expect(await svcCom(vi.fn(async () => respostaHttp(503, {})) as unknown as typeof fetch).verify('k', 'd')).toEqual({ ok: false, reason: 'unreachable' });
    expect(await svcCom(vi.fn(async () => respostaHttp(401, { code: 401, message: 'Missing authorization header' })) as unknown as typeof fetch).verify('k', 'd')).toEqual({ ok: false, reason: 'unreachable' });
  });
});

describe('supabaseLicenseService.logout', () => {
  it('revoga o computador, encerra a sessão e limpa o cofre', async () => {
    localStorage.setItem('irisflow.vinculo', JSON.stringify({ device_id: 'dev-9', device_key: 'CHAVE-9', beneficiary_id: 'ben-1', beneficiary_name: 'C', email: 'a@b.c', pareado_em: '' }));
    localStorage.setItem('irisflow.fila', '[]');
    const { cliente, rpc, auth } = fabricarCliente();
    await createSupabaseLicenseService({ cliente: () => cliente }).logout('CHAVE-9');
    expect(rpc).toHaveBeenCalledWith('revoke_device', { p_device_id: 'dev-9' });
    expect(auth.signOut).toHaveBeenCalled();
    expect(localStorage.getItem('irisflow.vinculo')).toBeNull();
    expect(localStorage.getItem('irisflow.fila')).toBeNull();
  });
});
