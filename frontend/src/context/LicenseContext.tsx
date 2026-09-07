import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import {
  licenseService as servicoPadrao,
  getDeviceBinding,
  getDeviceId,
} from '../services/license';
import type {
  Account,
  ActiveLicense,
  DeviceBinding,
  LicenseService,
  LoginResult,
  Plan,
} from '../services/license';

/**
 * Estado da conta e da licença desta instalação.
 *
 * Separado do `AuthContext` de propósito: aqui vive o que é **remoto** (conta,
 * plano, vínculo da máquina); lá vive o que é **local** (perfil do paciente,
 * acesso do cuidador). Misturar os dois faria dados que nunca saem do PC
 * viajarem no mesmo objeto dos que vão ao servidor.
 */

export const LICENSE_KEY = 'irisflow_license';

/**
 * Quanto tempo uma licença em cache vale sem conseguir falar com o servidor.
 *
 * Sete dias é uma escolha de produto, não técnica: quem usa este app tem ELA e
 * muitas vezes está sozinho. Perder a comunicação porque o Wi-Fi caiu é pior
 * do que uma semana de uso não verificado.
 */
export const GRACE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000;

export type LicenseStatus = 'checking' | 'active' | 'grace' | 'none' | 'blocked';

/** Motivo do bloqueio, para a tela poder explicar o que fazer. */
export type BlockedReason =
  'expired' | 'revoked' | 'device-unbound' | 'invalid-token' | 'grace-expired';

interface LicenceGravada {
  account: Account;
  plan: Plan;
  token: string;
  deviceId: string;
  boundAt: string;
  lastVerifiedAt: number;
}

export interface LicenseContextData {
  status: LicenseStatus;
  license: ActiveLicense | null;
  blockedReason: BlockedReason | null;
  /** Instante da última verificação bem-sucedida; alimenta o aviso de "grace". */
  lastVerifiedAt: number | null;
  entrar: (email: string, senha: string) => Promise<LoginResult>;
  transferir: (transferToken: string) => Promise<LoginResult>;
  sair: () => Promise<void>;
  reverificar: () => Promise<void>;
}

const LicenseContext = createContext<LicenseContextData>({} as LicenseContextData);

function ler(): LicenceGravada | null {
  try {
    const raw = localStorage.getItem(LICENSE_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<LicenceGravada>;
    if (!p.token || !p.account || !p.plan || !p.deviceId) return null;
    return {
      account: p.account,
      plan: p.plan,
      token: p.token,
      deviceId: p.deviceId,
      boundAt: p.boundAt ?? new Date(0).toISOString(),
      lastVerifiedAt: typeof p.lastVerifiedAt === 'number' ? p.lastVerifiedAt : 0,
    };
  } catch {
    // JSON truncado por quota estourada já derrubou o boot deste app uma vez,
    // pelo `SettingsContext`. Aqui o pior caso é pedir login de novo.
    return null;
  }
}

function gravar(l: LicenceGravada): void {
  try {
    localStorage.setItem(LICENSE_KEY, JSON.stringify(l));
  } catch {
    // Sem persistência a licença vale só para esta execução.
  }
}

function apagar(): void {
  try {
    localStorage.removeItem(LICENSE_KEY);
  } catch {
    /* idem */
  }
}

const paraGravada = (l: ActiveLicense, verificadaEm: number): LicenceGravada => ({
  account: l.account,
  plan: l.plan,
  token: l.token,
  deviceId: l.thisDevice.deviceId,
  boundAt: l.thisDevice.boundAt,
  lastVerifiedAt: verificadaEm,
});

const paraAtiva = (g: LicenceGravada, device: DeviceBinding): ActiveLicense => ({
  account: g.account,
  plan: g.plan,
  token: g.token,
  devicesUsed: 1,
  thisDevice: { deviceId: g.deviceId, deviceName: device.deviceName, boundAt: g.boundAt },
});

export const LicenseProvider: React.FC<{
  children: React.ReactNode;
  /** Injetável para teste; em produção usa o serviço real do módulo. */
  service?: LicenseService;
}> = ({ children, service = servicoPadrao }) => {
  const [status, setStatus] = useState<LicenseStatus>('checking');
  const [license, setLicense] = useState<ActiveLicense | null>(null);
  const [blockedReason, setBlockedReason] = useState<BlockedReason | null>(null);
  const [lastVerifiedAt, setLastVerifiedAt] = useState<number | null>(null);

  const verificar = useCallback(async () => {
    const gravada = ler();
    if (!gravada) {
      setStatus('none');
      setLicense(null);
      return;
    }

    const device = getDeviceBinding();
    const r = await service.verify(gravada.token, getDeviceId());

    if (r.ok) {
      const agora = Date.now();
      gravar(paraGravada(r.license, agora));
      setLicense(r.license);
      setLastVerifiedAt(agora);
      setBlockedReason(null);
      setStatus('active');
      return;
    }

    // Silêncio da rede: a licença em cache ainda pode valer.
    if (r.reason === 'unreachable') {
      const idade = Date.now() - gravada.lastVerifiedAt;
      if (idade < GRACE_PERIOD_MS) {
        setLicense(paraAtiva(gravada, device));
        setLastVerifiedAt(gravada.lastVerifiedAt);
        setBlockedReason(null);
        setStatus('grace');
      } else {
        setLicense(null);
        setBlockedReason('grace-expired');
        setStatus('blocked');
      }
      return;
    }

    // Houve conversa e a resposta foi não. Insistir contornaria uma revogação.
    apagar();
    setLicense(null);
    setBlockedReason(r.reason);
    setStatus('blocked');
  }, [service]);

  useEffect(() => {
    void verificar();
  }, [verificar]);

  const aplicarLogin = useCallback((r: LoginResult): LoginResult => {
    if (r.ok) {
      const agora = Date.now();
      gravar(paraGravada(r.license, agora));
      setLicense(r.license);
      setLastVerifiedAt(agora);
      setBlockedReason(null);
      setStatus('active');
    }
    return r;
  }, []);

  const entrar = useCallback(
    async (email: string, senha: string) =>
      aplicarLogin(await service.login(email, senha, getDeviceBinding())),
    [service, aplicarLogin]
  );

  const transferir = useCallback(
    async (transferToken: string) =>
      aplicarLogin(await service.transferDevice(transferToken, getDeviceBinding())),
    [service, aplicarLogin]
  );

  const sair = useCallback(async () => {
    const gravada = ler();
    if (gravada) {
      try {
        await service.logout(gravada.token);
      } catch {
        // Servidor fora não pode impedir alguém de sair da própria máquina.
      }
    }
    apagar();
    setLicense(null);
    setLastVerifiedAt(null);
    setBlockedReason(null);
    setStatus('none');
  }, [service]);

  const value = useMemo<LicenseContextData>(
    () => ({
      status,
      license,
      blockedReason,
      lastVerifiedAt,
      entrar,
      transferir,
      sair,
      reverificar: verificar,
    }),
    [status, license, blockedReason, lastVerifiedAt, entrar, transferir, sair, verificar]
  );

  return <LicenseContext.Provider value={value}>{children}</LicenseContext.Provider>;
};

export const useLicense = () => useContext(LicenseContext);
