import { describe, it, expect, vi, afterEach } from 'vitest';
import { getDeviceId, getDeviceName, getDeviceBinding, DEVICE_ID_KEY } from './deviceId';

// -----------------------------------------------------------------------------
// A identidade da máquina sustenta o vínculo da licença. Se ela mudar entre
// dois boots, o servidor vê um computador novo e queima uma ativação do plano
// — o usuário é expulso da própria licença sem ter feito nada.
//
// Por isso a estabilidade é a propriedade central testada aqui, e não um
// detalhe de implementação.
// -----------------------------------------------------------------------------

afterEach(() => {
  vi.restoreAllMocks();
});

describe('getDeviceId', () => {
  it('devolve o mesmo id em chamadas repetidas', () => {
    expect(getDeviceId()).toBe(getDeviceId());
  });

  it('persiste o id, para sobreviver ao fechar o app', () => {
    const id = getDeviceId();
    expect(localStorage.getItem(DEVICE_ID_KEY)).toBe(id);
  });

  it('reaproveita um id já gravado em vez de gerar outro', () => {
    localStorage.setItem(DEVICE_ID_KEY, 'id-de-um-boot-anterior');
    expect(getDeviceId()).toBe('id-de-um-boot-anterior');
  });

  it('gera um id novo quando o gravado está vazio', () => {
    localStorage.setItem(DEVICE_ID_KEY, '   ');
    const id = getDeviceId();
    expect(id.trim()).not.toBe('');
    expect(id).not.toBe('   ');
  });

  it('não quebra quando o localStorage lança', () => {
    // Modo privado do Chromium, política de grupo, disco cheio: `setItem`
    // lança. Um throw aqui derruba o boot inteiro antes de qualquer tela.
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('storage indisponível');
    });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new Error('storage indisponível');
    });

    expect(() => getDeviceId()).not.toThrow();
    expect(getDeviceId().trim()).not.toBe('');
  });
});

describe('getDeviceName', () => {
  it('devolve algo legível e não vazio', () => {
    // O cuidador precisa reconhecer a máquina numa lista de dispositivos.
    expect(getDeviceName().trim().length).toBeGreaterThan(0);
  });
});

describe('getDeviceBinding', () => {
  it('junta id, nome e o instante do vínculo em ISO 8601', () => {
    const binding = getDeviceBinding();

    expect(binding.deviceId).toBe(getDeviceId());
    expect(binding.deviceName).toBe(getDeviceName());
    expect(new Date(binding.boundAt).toISOString()).toBe(binding.boundAt);
  });
});
