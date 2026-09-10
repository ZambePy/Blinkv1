import { createMockLicenseService } from './mockLicenseService';
import { createSupabaseLicenseService } from './supabaseLicenseService';
import { nuvemConfigurada } from '../../cloud/config';
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

export { createSupabaseLicenseService } from './supabaseLicenseService';

/**
 * A implementação em uso pelo app.
 *
 * Com `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY` em `frontend/.env.local`
 * entra o serviço real (`supabaseLicenseService`): o e-mail/senha do site vale
 * aqui, condicionado à assinatura, e o computador fica ligado ao app do
 * cuidador. Sem as variáveis, o mock continua sendo o comportamento do produto
 * (contas de teste, modo local) — nenhuma tela muda entre um e outro.
 */
export const licenseService: LicenseService = nuvemConfigurada
  ? createSupabaseLicenseService()
  : createMockLicenseService();

/** Qual implementação está ativa, para a tela de conta dizer a verdade. */
export const licenseBackend: 'supabase' | 'mock' = nuvemConfigurada ? 'supabase' : 'mock';
