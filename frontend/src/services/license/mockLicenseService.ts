import type {
  ActiveLicense,
  DeviceBinding,
  LicenseService,
  LoginResult,
  Plan,
  VerifyResult,
} from './types';

/**
 * Serviço de licença simulado.
 *
 * Enquanto o backend tem só banco de dados, este módulo **é** o comportamento
 * do produto — não um stub de conveniência. Cada estado que a tela de login
 * precisa mostrar é alcançável de forma determinística, por conta nomeada ou
 * por um interruptor de rede, para que dê para exercitar o fluxo à mão sem
 * servidor nenhum.
 */

export const SENHA_DE_TESTE = 'teste123';

export const CONTAS_DE_TESTE = {
  /** Assinatura em dia, nenhuma máquina vinculada ainda. */
  ativa: 'ativa@teste.com',
  /** Conta existe, pagamento não. */
  semPlano: 'semplano@teste.com',
  /** Assinatura em dia, já ativada noutro computador. */
  outroPC: 'outropc@teste.com',
  /** Login passa, mas o plano já venceu — `verify` recusa. */
  vencida: 'vencida@teste.com',
} as const;

/**
 * Interruptor de rede simulada, lido do `localStorage` a cada chamada.
 *
 * Fica no storage em vez de num parâmetro para que dê para derrubar o
 * "servidor" com o app rodando, pelo console do DevTools, e ver a tela de erro
 * de verdade — que é justamente o que o §6.3 do spec exige provar.
 */
export const MOCK_NETWORK_KEY = 'irisflow_mock_network';

export type MockNetwork = 'online' | 'offline' | 'down';

export const MANAGE_URL = 'https://irisflow.com.br/conta/assinatura';

const TENTATIVAS_ATE_BLOQUEAR = 5;
const ESPERA_APOS_BLOQUEIO_S = 60;
const UM_ANO_MS = 365 * 24 * 60 * 60 * 1000;

function redeAtual(): MockNetwork {
  try {
    const v = localStorage.getItem(MOCK_NETWORK_KEY);
    return v === 'offline' || v === 'down' ? v : 'online';
  } catch {
    return 'online';
  }
}

function planoFamiliar(validUntil: string | null): Plan {
  return {
    id: 'familiar',
    name: 'IrisFlow Familiar',
    validUntil,
    // Hoje todo plano permite uma máquina. Quando existirem planos maiores,
    // muda aqui e nada na interface precisa mudar — as telas leem este campo.
    deviceLimit: 1,
  };
}

const emISO = (ms: number) => new Date(ms).toISOString();

interface ContaMock {
  email: string;
  temAssinatura: boolean;
  plan: Plan;
  /** Máquina hoje vinculada. `null` = nenhuma. */
  vinculo: DeviceBinding | null;
}

interface Sessao {
  email: string;
  deviceId: string;
}

function contasIniciais(agora: number): Map<string, ContaMock> {
  const m = new Map<string, ContaMock>();

  m.set(CONTAS_DE_TESTE.ativa, {
    email: CONTAS_DE_TESTE.ativa,
    temAssinatura: true,
    plan: planoFamiliar(emISO(agora + UM_ANO_MS)),
    vinculo: null,
  });

  m.set(CONTAS_DE_TESTE.semPlano, {
    email: CONTAS_DE_TESTE.semPlano,
    temAssinatura: false,
    plan: planoFamiliar(null),
    vinculo: null,
  });

  m.set(CONTAS_DE_TESTE.outroPC, {
    email: CONTAS_DE_TESTE.outroPC,
    temAssinatura: true,
    plan: planoFamiliar(emISO(agora + UM_ANO_MS)),
    vinculo: {
      deviceId: 'maquina-da-clinica',
      deviceName: 'Computador da clínica',
      boundAt: emISO(agora - 30 * 24 * 60 * 60 * 1000),
    },
  });

  m.set(CONTAS_DE_TESTE.vencida, {
    email: CONTAS_DE_TESTE.vencida,
    temAssinatura: true,
    plan: planoFamiliar(emISO(agora - 24 * 60 * 60 * 1000)),
    vinculo: null,
  });

  return m;
}

/**
 * Cria uma instância independente. É uma fábrica, e não um singleton com
 * `reset()`, para que os testes não precisem de um gancho que só existe para
 * eles no código de produção — cada teste monta o seu.
 */
export function createMockLicenseService(): LicenseService {
  const agora = Date.now();
  const contas = contasIniciais(agora);
  const sessoes = new Map<string, Sessao>();
  const transferencias = new Map<string, string>(); // transferToken -> email
  const tentativasFalhas = new Map<string, number>();

  let seq = 0;
  const novoToken = (prefixo: string) =>
    `${prefixo}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

  const normalizar = (email: string) => email.trim().toLowerCase();

  function licencaAtiva(conta: ContaMock, device: DeviceBinding): ActiveLicense {
    const token = novoToken('sess');
    sessoes.set(token, { email: conta.email, deviceId: device.deviceId });
    conta.vinculo = device;
    return {
      account: { email: conta.email },
      plan: conta.plan,
      token,
      devicesUsed: 1,
      thisDevice: device,
    };
  }

  async function login(
    emailBruto: string,
    senha: string,
    device: DeviceBinding
  ): Promise<LoginResult> {
    const rede = redeAtual();
    if (rede === 'offline') return { ok: false, reason: 'offline' };
    if (rede === 'down') return { ok: false, reason: 'server-down' };

    const email = normalizar(emailBruto);

    if ((tentativasFalhas.get(email) ?? 0) >= TENTATIVAS_ATE_BLOQUEAR) {
      return { ok: false, reason: 'rate-limited', retryAfterSeconds: ESPERA_APOS_BLOQUEIO_S };
    }

    const conta = contas.get(email);
    // Conta inexistente e senha errada dão a MESMA resposta de propósito:
    // distinguir as duas revela quais e-mails têm conta no produto.
    if (!conta || senha !== SENHA_DE_TESTE) {
      tentativasFalhas.set(email, (tentativasFalhas.get(email) ?? 0) + 1);
      return { ok: false, reason: 'invalid-credentials' };
    }

    tentativasFalhas.delete(email);

    if (!conta.temAssinatura) {
      return {
        ok: false,
        reason: 'no-subscription',
        account: { email: conta.email },
        manageUrl: MANAGE_URL,
      };
    }

    const jaVinculadaEmOutra = conta.vinculo !== null && conta.vinculo.deviceId !== device.deviceId;

    if (jaVinculadaEmOutra && conta.plan.deviceLimit !== null) {
      const transferToken = novoToken('transf');
      transferencias.set(transferToken, conta.email);
      return {
        ok: false,
        reason: 'device-limit',
        account: { email: conta.email },
        plan: conta.plan,
        devices: [conta.vinculo as DeviceBinding],
        transferToken,
      };
    }

    return { ok: true, license: licencaAtiva(conta, device) };
  }

  async function verify(token: string, deviceId: string): Promise<VerifyResult> {
    if (redeAtual() !== 'online') return { ok: false, reason: 'unreachable' };

    const sessao = sessoes.get(token);
    if (!sessao) return { ok: false, reason: 'invalid-token' };
    if (sessao.deviceId !== deviceId) return { ok: false, reason: 'device-unbound' };

    const conta = contas.get(sessao.email);
    if (!conta) return { ok: false, reason: 'invalid-token' };
    if (!conta.temAssinatura) return { ok: false, reason: 'revoked' };

    const { validUntil } = conta.plan;
    if (validUntil !== null && new Date(validUntil).getTime() < Date.now()) {
      return { ok: false, reason: 'expired' };
    }

    const vinculo = conta.vinculo;
    if (!vinculo || vinculo.deviceId !== deviceId) return { ok: false, reason: 'device-unbound' };

    return {
      ok: true,
      license: {
        account: { email: conta.email },
        plan: conta.plan,
        token,
        devicesUsed: 1,
        thisDevice: vinculo,
      },
    };
  }

  async function transferDevice(
    transferToken: string,
    device: DeviceBinding
  ): Promise<LoginResult> {
    const rede = redeAtual();
    if (rede === 'offline') return { ok: false, reason: 'offline' };
    if (rede === 'down') return { ok: false, reason: 'server-down' };

    const email = transferencias.get(transferToken);
    const conta = email ? contas.get(email) : undefined;
    if (!conta) return { ok: false, reason: 'invalid-credentials' };

    transferencias.delete(transferToken);

    // Derruba a sessão da máquina anterior: transferir sem invalidar deixaria
    // as duas ativas, que é exatamente o que o limite existe para impedir.
    for (const [t, s] of sessoes) {
      if (s.email === conta.email) sessoes.delete(t);
    }

    return { ok: true, license: licencaAtiva(conta, device) };
  }

  async function logout(token: string): Promise<void> {
    sessoes.delete(token);
  }

  return { login, verify, transferDevice, logout };
}
