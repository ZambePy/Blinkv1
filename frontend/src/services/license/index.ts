import { createMockLicenseService } from './mockLicenseService';
import type { LicenseService } from './types';

export * from './types';
export { getDeviceId, getDeviceName, getDeviceBinding, DEVICE_ID_KEY } from './deviceId';
export {
  CONTAS_DE_TESTE,
  SENHA_DE_TESTE,
  MOCK_NETWORK_KEY,
  MANAGE_URL,
  LOGIN_PADRAO,
  createMockLicenseService,
} from './mockLicenseService';

/**
 * A implementação em uso pelo app.
 *
 * Só existe o mock: o backend tem apenas banco de dados, e um adapter HTTP
 * contra um servidor inexistente seria mais um módulo sem fio — padrão que já
 * se repetiu cinco vezes neste projeto. O contrato HTTP está documentado no
 * §4.2 do spec do Bloco 1; quando o servidor existir, o adapter entra aqui e
 * nenhuma tela muda.
 */
export const licenseService: LicenseService = createMockLicenseService();
