import type { SupabaseClient } from '@supabase/supabase-js';
import type {
  ActiveLicense,
  DeviceBinding,
  LicenseService,
  LoginResult,
  Plan,
} from './types';
import { cloudConfig } from '../../cloud/config';
import { supabase as clienteDoApp } from '../../cloud/supabaseClient';
import { cofre, CHAVES, infoDoApp } from '../../cloud/armazenamento';
import type { LicencaResposta, PareamentoResposta, VinculoLocal } from '../../cloud/types';

/**
 * `LicenseService` de verdade, sobre o Supabase do IrisFlow — o mesmo projeto
 * do site e do app do cuidador.
 *
 * Como o contrato do Bloco 1 é cumprido:
 *
 *   login        Supabase Auth (e-mail/senha do site) → `desktop_license()`
 *                (pode usar?) → `pair_device()` (vínculo deste computador).
 *                O `token` da licença É a chave do computador devolvida pelo
 *                pareamento: é ela que autentica tudo o que o desktop envia
 *                pela Edge Function `desktop-sync`.
 *   verify       `desktop-sync {action:'device.info'}` com a chave: a função
 *                confirma que o computador continua vinculado e devolve a
 *                licença atual do dono (`license_for_profile`). Sem rede →
 *                `unreachable` (e o LicenseContext aplica a tolerância de 7 dias).
 *   device-limit Plano Essencial permite um computador ativo. Se já houver
 *                outro, o login falha com `device-limit` e a transferência
 *                (`transferDevice`) chama `pair_device()`, que revoga o anterior.
 *   logout       `revoke_device()` + `signOut`.
 *
 * Falhas voltam como valor (D3 do spec). Nada aqui lança para a tela.
 */

/** Disparado no `window` logo antes de revogar o computador (ver CloudContext). */
export const EVENTO_ANTES_DE_SAIR = 'irisflow:cloud-antes-de-sair';

const UNREACHABLE = /failed to fetch|network|fetch failed|load failed|timeout|aborted/i;

function planoDe(l: LicencaResposta): Plan {
  return {
    id: l.plan_id ?? 'essencial',
    name: l.plan_name ? `IrisFlow ${l.plan_name}` : 'IrisFlow',
    // Para o cuidador, "válida até" é a data em que o acesso deixa de valer
    // se nada for pago: fim da avaliação ou próxima cobrança.
    validUntil: l.access_until ?? l.next_charge_at ?? l.trial_ends_at ?? null,
    deviceLimit: l.features?.multiplos_dispositivos ? null : 1,
    features: l.features,
  };
}

interface DispositivoAtivo {
  id: string;
  name: string;
  hostname: string | null;
  paired_at: string;
  last_seen_at: string;
}

interface TransferenciaPendente {
  beneficiaryId: string;
  email: string;
  licenca: LicencaResposta;
  expiraEm: number;
}

export interface OpcoesDoServico {
  cliente?: () => SupabaseClient;
  fetchImpl?: typeof fetch;
  /** Nome comercial da conta (o site não guarda nome do paciente no auth). */
  manageUrl?: string;
}

export function createSupabaseLicenseService(op: OpcoesDoServico = {}): LicenseService {
  const cliente = op.cliente ?? clienteDoApp;
  const fetchImpl = op.fetchImpl ?? ((...a: Parameters<typeof fetch>) => fetch(...a));
  const manageUrl = op.manageUrl ?? `${cloudConfig.siteUrl}/conta`;
  // Transferências autorizadas nesta execução (o `transferToken` é um nonce
  // local: quem chegou até aqui já provou e-mail e senha e tem a sessão aberta).
  const transferencias = new Map<string, TransferenciaPendente>();

  async function licencaAtual(): Promise<LicencaResposta> {
    const { data, error } = await cliente().rpc('desktop_license');
    if (error) throw error;
    return data as LicencaResposta;
  }

  async function dispositivosAtivos(beneficiaryId: string): Promise<DispositivoAtivo[]> {
    const { data, error } = await cliente()
      .from('devices')
      .select('id, name, hostname, paired_at, last_seen_at')
      .eq('beneficiary_id', beneficiaryId)
      .is('revoked_at', null)
      .order('paired_at', { ascending: false });
    if (error) throw error;
    return (data ?? []) as DispositivoAtivo[];
  }

  async function parear(
    beneficiaryId: string,
    beneficiaryName: string,
    email: string,
    licenca: LicencaResposta,
    device: DeviceBinding,
  ): Promise<ActiveLicense> {
    const info = await infoDoApp();
    const { data, error } = await cliente().rpc('pair_device', {
      p_beneficiary_id: beneficiaryId,
      p_name: device.deviceName,
      p_os: /win/i.test(info.platform) ? 'windows' : /mac|darwin/i.test(info.platform) ? 'macos' : 'linux',
      p_app_version: info.version,
      // O id local da máquina vai como hostname: é como o servidor reconhece
      // "este mesmo computador" num novo login sem gastar uma ativação.
      p_hostname: device.deviceId,
    });
    if (error) throw error;
    const par = data as PareamentoResposta;

    // O CloudProvider (conversa, socorro, sessões) lê o vínculo daqui.
    const vinculo: VinculoLocal = {
      device_id: par.device_id,
      device_key: par.device_key,
      beneficiary_id: beneficiaryId,
      beneficiary_name: beneficiaryName,
      email,
      pareado_em: new Date().toISOString(),
    };
    await cofre.gravarJson(CHAVES.vinculo, vinculo);

    const ativos = await dispositivosAtivos(beneficiaryId).catch(() => []);
    return {
      account: { email, name: beneficiaryName, beneficiaryId, beneficiaryName },
      plan: planoDe(licenca),
      token: par.device_key,
      devicesUsed: Math.max(1, ativos.length),
      thisDevice: { ...device, boundAt: new Date().toISOString() },
    };
  }

  function falhaDeRede(e: unknown): LoginResult {
    const msg = e instanceof Error ? e.message : String(e);
    if (UNREACHABLE.test(msg)) return { ok: false, reason: 'offline' };
    return { ok: false, reason: 'server-down' };
  }

  return {
    async login(email, password, device) {
      const sb = cliente();
      const emailNorm = email.trim().toLowerCase();

      const { error: erroAuth } = await sb.auth.signInWithPassword({ email: emailNorm, password });
      if (erroAuth) {
        const m = erroAuth.message ?? '';
        if (/invalid login credentials|invalid_credentials|email not confirmed/i.test(m)) {
          return { ok: false, reason: 'invalid-credentials' };
        }
        if (/rate limit|too many requests|over_request_rate_limit/i.test(m)) {
          return { ok: false, reason: 'rate-limited', retryAfterSeconds: 60 };
        }
        if (UNREACHABLE.test(m)) return { ok: false, reason: 'offline' };
        return { ok: false, reason: 'server-down' };
      }

      let licenca: LicencaResposta;
      try {
        licenca = await licencaAtual();
      } catch (e) {
        return falhaDeRede(e);
      }
      const conta = { email: emailNorm, beneficiaryId: licenca.beneficiary?.id, beneficiaryName: licenca.beneficiary?.user_name };
      if (!licenca.allowed || !licenca.beneficiary) {
        return { ok: false, reason: 'no-subscription', account: conta, manageUrl };
      }

      // Limite de computadores do plano: outro computador ativo bloqueia e
      // oferece a transferência. O próprio (mesmo id local) não conta.
      if (!licenca.features.multiplos_dispositivos) {
        let ativos: DispositivoAtivo[] = [];
        try {
          ativos = await dispositivosAtivos(licenca.beneficiary.id);
        } catch (e) {
          return falhaDeRede(e);
        }
        const outros = ativos.filter((d) => d.hostname !== device.deviceId);
        if (outros.length > 0) {
          const transferToken = `tr-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
          transferencias.set(transferToken, {
            beneficiaryId: licenca.beneficiary.id, email: emailNorm, licenca, expiraEm: Date.now() + 15 * 60_000,
          });
          return {
            ok: false,
            reason: 'device-limit',
            account: conta,
            plan: planoDe(licenca),
            devices: outros.map((d) => ({ deviceId: d.hostname ?? d.id, deviceName: d.name, boundAt: d.paired_at })),
            transferToken,
          };
        }
      }

      try {
        return { ok: true, license: await parear(licenca.beneficiary.id, licenca.beneficiary.user_name, emailNorm, licenca, device) };
      } catch (e) {
        return falhaDeRede(e);
      }
    },

    async verify(token, deviceId) {
      if (!token) return { ok: false, reason: 'invalid-token' };
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 8_000);
      let res: Response;
      try {
        res = await fetchImpl(cloudConfig.desktopSyncUrl, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-device-key': token,
            ...(cloudConfig.anonKey ? { apikey: cloudConfig.anonKey, authorization: `Bearer ${cloudConfig.anonKey}` } : {}),
          },
          body: JSON.stringify({ action: 'device.info' }),
          signal: controller.signal,
        });
      } catch {
        return { ok: false, reason: 'unreachable' };
      } finally {
        clearTimeout(timer);
      }

      let corpo: {
        error?: string;
        device?: { id: string; name: string };
        beneficiary?: { id: string; user_name: string } | null;
        license?: LicencaResposta | null;
        devices_active?: number;
      } = {};
      try { corpo = await res.json(); } catch { /* sem corpo */ }

      if (res.status === 403 && corpo.error === 'device_revoked') return { ok: false, reason: 'revoked' };
      if (res.status === 401 && corpo.error === 'unauthorized') return { ok: false, reason: 'invalid-token' };
      // Gateway sem a função publicada, 5xx, 429: silêncio útil → tolerância offline.
      if (!res.ok || !corpo.device) return { ok: false, reason: 'unreachable' };

      const lic = corpo.license ?? null;
      if (lic && !lic.allowed) return { ok: false, reason: 'expired' };

      const vinculo = await cofre.lerJson<VinculoLocal>(CHAVES.vinculo);
      const email = vinculo?.email ?? '';
      const beneficiaryName = corpo.beneficiary?.user_name ?? vinculo?.beneficiary_name ?? '';
      const beneficiaryId = corpo.beneficiary?.id ?? vinculo?.beneficiary_id;
      if (beneficiaryId && (!vinculo || vinculo.device_key !== token || vinculo.beneficiary_id !== beneficiaryId)) {
        // O cofre ficou para trás (outro login neste PC) ou foi limpo: realinha
        // com o que o servidor acabou de confirmar. O CloudProvider lê daqui.
        await cofre.gravarJson(CHAVES.vinculo, {
          device_id: corpo.device.id, device_key: token, beneficiary_id: beneficiaryId,
          beneficiary_name: beneficiaryName, email, pareado_em: vinculo?.pareado_em ?? new Date().toISOString(),
        } satisfies VinculoLocal);
      }
      return {
        ok: true,
        license: {
          account: { email, name: beneficiaryName, beneficiaryId, beneficiaryName },
          plan: lic ? planoDe(lic) : { id: 'essencial', name: 'IrisFlow', validUntil: null, deviceLimit: 1 },
          token,
          devicesUsed: Math.max(1, corpo.devices_active ?? 1),
          thisDevice: { deviceId, deviceName: corpo.device.name, boundAt: vinculo?.pareado_em ?? new Date().toISOString() },
        },
      };
    },

    async transferDevice(transferToken, device) {
      const t = transferencias.get(transferToken);
      if (!t || t.expiraEm < Date.now()) return { ok: false, reason: 'invalid-credentials' };
      transferencias.delete(transferToken);
      try {
        // `pair_device` no plano Essencial revoga os outros computadores.
        return { ok: true, license: await parear(t.beneficiaryId, t.licenca.beneficiary?.user_name ?? '', t.email, t.licenca, device) };
      } catch (e) {
        return falhaDeRede(e);
      }
    },

    async logout(_token) {
      // Avisa o CloudProvider ANTES de revogar: ele fecha a sessão no banco
      // (session.end) enquanto a chave ainda vale. Depois disso, o LicenseContext
      // zera a licença e o provider desliga sozinho.
      if (typeof window !== 'undefined') {
        window.dispatchEvent(new Event(EVENTO_ANTES_DE_SAIR));
        await new Promise((r) => setTimeout(r, 250));
      }
      const vinculo = await cofre.lerJson<VinculoLocal>(CHAVES.vinculo);
      const sb = cliente();
      try {
        if (vinculo?.device_id) await sb.rpc('revoke_device', { p_device_id: vinculo.device_id });
      } catch { /* offline: o cuidador ainda pode desvincular pelo celular ou pelo site */ }
      try { await sb.auth.signOut(); } catch { /* idem */ }
      await Promise.all([cofre.remover(CHAVES.vinculo), cofre.remover(CHAVES.filaDeEnvio)]);
    },
  };
}
