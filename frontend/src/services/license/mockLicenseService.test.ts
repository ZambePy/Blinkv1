import { describe, it, expect, beforeEach } from 'vitest';
import {
  createMockLicenseService,
  CONTAS_DE_TESTE,
  SENHA_DE_TESTE,
  MOCK_NETWORK_KEY,
} from './mockLicenseService';
import { getDeviceBinding } from './deviceId';
import type { LicenseService } from './types';

// -----------------------------------------------------------------------------
// O mock não é um stub de conveniência: até o backend existir, ele É o
// comportamento do produto. Cada estado que a tela de login precisa mostrar
// tem de ser alcançável de forma determinística por quem estiver testando à
// mão — daí as contas nomeadas.
// -----------------------------------------------------------------------------

let service: LicenseService;

beforeEach(() => {
  service = createMockLicenseService();
});

const estePC = () => getDeviceBinding();

describe('login — caminho feliz', () => {
  it('aceita a conta ativa e devolve plano, token e o vínculo desta máquina', async () => {
    const device = estePC();
    const r = await service.login(CONTAS_DE_TESTE.ativa, SENHA_DE_TESTE, device);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.license.account.email).toBe(CONTAS_DE_TESTE.ativa);
    expect(r.license.token).toBeTruthy();
    expect(r.license.plan.name).toBeTruthy();
    expect(r.license.thisDevice.deviceId).toBe(device.deviceId);
  });

  it('ignora caixa e espaços em volta do e-mail', async () => {
    // O cuidador digita com Caps Lock ligado ou cola com espaço no fim.
    // Recusar por isso é suporte por telefone garantido.
    const r = await service.login(
      `  ${CONTAS_DE_TESTE.ativa.toUpperCase()} `,
      SENHA_DE_TESTE,
      estePC()
    );
    expect(r.ok).toBe(true);
  });
});

describe('login — os motivos de recusa', () => {
  it('senha errada devolve invalid-credentials', async () => {
    const r = await service.login(CONTAS_DE_TESTE.ativa, 'senha-errada', estePC());
    expect(r).toMatchObject({ ok: false, reason: 'invalid-credentials' });
  });

  it('e-mail desconhecido devolve invalid-credentials, não "conta inexistente"', async () => {
    // Distinguir os dois casos entrega ao atacante quais e-mails têm conta.
    const r = await service.login('ninguem@lugar.nenhum', SENHA_DE_TESTE, estePC());
    expect(r).toMatchObject({ ok: false, reason: 'invalid-credentials' });
  });

  it('conta sem assinatura devolve no-subscription com o link de gerenciar', async () => {
    const r = await service.login(CONTAS_DE_TESTE.semPlano, SENHA_DE_TESTE, estePC());

    expect(r.ok).toBe(false);
    if (r.ok || r.reason !== 'no-subscription') throw new Error('motivo inesperado');
    expect(r.manageUrl).toMatch(/^https?:\/\//);
    expect(r.account.email).toBe(CONTAS_DE_TESTE.semPlano);
  });

  it('conta ativa noutra máquina devolve device-limit com a lista e um transferToken', async () => {
    const r = await service.login(CONTAS_DE_TESTE.outroPC, SENHA_DE_TESTE, estePC());

    expect(r.ok).toBe(false);
    if (r.ok || r.reason !== 'device-limit') throw new Error('motivo inesperado');
    expect(r.devices.length).toBeGreaterThan(0);
    expect(r.devices[0].deviceId).not.toBe(estePC().deviceId);
    expect(r.transferToken).toBeTruthy();
  });

  it('sem internet devolve offline', async () => {
    localStorage.setItem(MOCK_NETWORK_KEY, 'offline');
    const r = await service.login(CONTAS_DE_TESTE.ativa, SENHA_DE_TESTE, estePC());
    expect(r).toMatchObject({ ok: false, reason: 'offline' });
  });

  it('servidor fora do ar devolve server-down', async () => {
    localStorage.setItem(MOCK_NETWORK_KEY, 'down');
    const r = await service.login(CONTAS_DE_TESTE.ativa, SENHA_DE_TESTE, estePC());
    expect(r).toMatchObject({ ok: false, reason: 'server-down' });
  });

  it('tentativas demais com senha errada devolve rate-limited com espera', async () => {
    for (let i = 0; i < 5; i++) {
      await service.login(CONTAS_DE_TESTE.ativa, 'senha-errada', estePC());
    }
    const r = await service.login(CONTAS_DE_TESTE.ativa, 'senha-errada', estePC());

    expect(r.ok).toBe(false);
    if (r.ok || r.reason !== 'rate-limited') throw new Error('motivo inesperado');
    expect(r.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('o contador de tentativas zera após um login bem-sucedido', async () => {
    for (let i = 0; i < 4; i++) {
      await service.login(CONTAS_DE_TESTE.ativa, 'senha-errada', estePC());
    }
    await service.login(CONTAS_DE_TESTE.ativa, SENHA_DE_TESTE, estePC());

    const r = await service.login(CONTAS_DE_TESTE.ativa, 'errada-de-novo', estePC());
    expect(r).toMatchObject({ ok: false, reason: 'invalid-credentials' });
  });
});

describe('verify', () => {
  it('aceita o token e o dispositivo vinculados no login', async () => {
    const device = estePC();
    const login = await service.login(CONTAS_DE_TESTE.ativa, SENHA_DE_TESTE, device);
    if (!login.ok) throw new Error('login deveria ter passado');

    const r = await service.verify(login.license.token, device.deviceId);
    expect(r.ok).toBe(true);
  });

  it('token desconhecido devolve invalid-token', async () => {
    const r = await service.verify('token-que-nunca-existiu', estePC().deviceId);
    expect(r).toMatchObject({ ok: false, reason: 'invalid-token' });
  });

  it('token válido em outra máquina devolve device-unbound', async () => {
    const login = await service.login(CONTAS_DE_TESTE.ativa, SENHA_DE_TESTE, estePC());
    if (!login.ok) throw new Error('login deveria ter passado');

    const r = await service.verify(login.license.token, 'id-de-outra-maquina');
    expect(r).toMatchObject({ ok: false, reason: 'device-unbound' });
  });

  it('plano vencido devolve expired', async () => {
    const device = estePC();
    const login = await service.login(CONTAS_DE_TESTE.vencida, SENHA_DE_TESTE, device);
    if (!login.ok) throw new Error('login deveria ter passado — o plano vence, mas existe');

    const r = await service.verify(login.license.token, device.deviceId);
    expect(r).toMatchObject({ ok: false, reason: 'expired' });
  });

  it('sem rede devolve unreachable, o único motivo que aciona a tolerância', async () => {
    const device = estePC();
    const login = await service.login(CONTAS_DE_TESTE.ativa, SENHA_DE_TESTE, device);
    if (!login.ok) throw new Error('login deveria ter passado');

    localStorage.setItem(MOCK_NETWORK_KEY, 'offline');
    const r = await service.verify(login.license.token, device.deviceId);
    expect(r).toMatchObject({ ok: false, reason: 'unreachable' });
  });
});

describe('transferDevice', () => {
  it('vincula esta máquina e devolve licença ativa', async () => {
    const device = estePC();
    const recusa = await service.login(CONTAS_DE_TESTE.outroPC, SENHA_DE_TESTE, device);
    if (recusa.ok || recusa.reason !== 'device-limit') throw new Error('esperava device-limit');

    const r = await service.transferDevice(recusa.transferToken, device);

    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.license.thisDevice.deviceId).toBe(device.deviceId);
  });

  it('depois de transferir, o login nesta máquina passa direto', async () => {
    // A propriedade que importa: a transferência é durável, não cosmética.
    const device = estePC();
    const recusa = await service.login(CONTAS_DE_TESTE.outroPC, SENHA_DE_TESTE, device);
    if (recusa.ok || recusa.reason !== 'device-limit') throw new Error('esperava device-limit');
    await service.transferDevice(recusa.transferToken, device);

    const r = await service.login(CONTAS_DE_TESTE.outroPC, SENHA_DE_TESTE, device);
    expect(r.ok).toBe(true);
  });

  it('recusa um transferToken inventado', async () => {
    const r = await service.transferDevice('token-forjado', estePC());
    expect(r).toMatchObject({ ok: false, reason: 'invalid-credentials' });
  });
});

describe('logout', () => {
  it('invalida o token, que deixa de verificar', async () => {
    const device = estePC();
    const login = await service.login(CONTAS_DE_TESTE.ativa, SENHA_DE_TESTE, device);
    if (!login.ok) throw new Error('login deveria ter passado');

    await service.logout(login.license.token);

    const r = await service.verify(login.license.token, device.deviceId);
    expect(r).toMatchObject({ ok: false, reason: 'invalid-token' });
  });
});
