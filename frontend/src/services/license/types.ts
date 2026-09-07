/**
 * Contrato entre o app e o serviço de contas/licença.
 *
 * Hoje existe só a implementação mock (`mockLicenseService`): o backend tem
 * apenas banco de dados. O contrato HTTP correspondente está documentado em
 * `docs/superpowers/specs/2026-09-07-bloco1-conta-licenca-design.md` §4.2 e
 * vira um adapter quando o servidor existir.
 *
 * **Falhas voltam como valor, não como `throw`.** Cada motivo tem uma tela e
 * um CTA diferentes — "sem assinatura" manda para o site, "sem internet"
 * oferece tentar de novo, "outro computador" oferece transferir. Com exceção,
 * essa decisão viraria `catch` + `instanceof` espalhado pelos componentes.
 */

export interface Account {
  email: string;
  name?: string;
}

export interface Plan {
  id: string;
  /** Nome comercial, exibido ao cuidador. Ex.: "IrisFlow Familiar". */
  name: string;
  /** ISO 8601. `null` = sem data de expiração. */
  validUntil: string | null;
  /**
   * Quantos computadores o plano permite. `null` = sem limite.
   * Vem do servidor porque depende do plano assinado — o app não decide.
   */
  deviceLimit: number | null;
}

export interface DeviceBinding {
  deviceId: string;
  /** Legível para humanos, para o cuidador reconhecer a máquina numa lista. */
  deviceName: string;
  /** ISO 8601. */
  boundAt: string;
}

export interface ActiveLicense {
  account: Account;
  plan: Plan;
  token: string;
  devicesUsed: number;
  thisDevice: DeviceBinding;
}

export type LoginFailure =
  | { reason: 'invalid-credentials' }
  | { reason: 'no-subscription'; account: Account; manageUrl: string }
  | {
      reason: 'device-limit';
      account: Account;
      plan: Plan;
      devices: DeviceBinding[];
      /**
       * Credencial de curta duração para autorizar a transferência.
       *
       * O login falhou, então não há `token` — mas quem chegou até aqui provou
       * e-mail e senha. Sem isto, `transferDevice` teria de pedir a senha de
       * novo, ou aceitaria transferir vínculo de quem só sabe um `deviceId`.
       */
      transferToken: string;
    }
  | { reason: 'offline' }
  | { reason: 'server-down' }
  | { reason: 'rate-limited'; retryAfterSeconds: number };

export type LoginFailureReason = LoginFailure['reason'];

export type LoginResult = { ok: true; license: ActiveLicense } | ({ ok: false } & LoginFailure);

/**
 * `unreachable` é separado dos demais de propósito: só ele aciona o período de
 * tolerância offline. `expired` e `revoked` são respostas do servidor — houve
 * conversa, e a resposta foi não. Bloqueiam de imediato.
 */
export type VerifyResult =
  | { ok: true; license: ActiveLicense }
  | { ok: false; reason: 'expired' | 'revoked' | 'device-unbound' | 'invalid-token' }
  | { ok: false; reason: 'unreachable' };

export type VerifyFailureReason = Extract<VerifyResult, { ok: false }>['reason'];

export interface LicenseService {
  login(email: string, password: string, device: DeviceBinding): Promise<LoginResult>;
  verify(token: string, deviceId: string): Promise<VerifyResult>;
  /**
   * Move a ativação de outra máquina para esta, derrubando o vínculo anterior.
   * Recebe o `transferToken` da falha `device-limit`, não um token de sessão:
   * quem chama isto ainda não tem sessão.
   */
  transferDevice(transferToken: string, device: DeviceBinding): Promise<LoginResult>;
  logout(token: string): Promise<void>;
}
