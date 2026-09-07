import type { LicenseStatus } from '../../context/LicenseContext';

/**
 * Para onde o app vai quando abre.
 *
 * Função pura, separada do splash de propósito: a decisão é a parte que tem
 * regra de negócio, e testá-la através da tela significaria timers, navegação
 * de router e renderização no caminho de uma asserção que só quer saber de
 * quatro booleanos.
 */

export interface EstadoDoBoot {
  status: LicenseStatus;
  introVisto: boolean;
  temConsentimento: boolean;
  temPerfil: boolean;
}

export const INTRO_SEEN_KEY = 'irisflow_intro_seen';

/** `null` = ainda não dá para decidir; continue mostrando o splash. */
export function destinoDoBoot({
  status,
  introVisto,
  temConsentimento,
  temPerfil,
}: EstadoDoBoot): string | null {
  if (status === 'checking') return null;

  if (status === 'none') return introVisto ? '/login' : '/intro';

  // Bloqueado já usou o produto: a apresentação não ajuda, a licença sim.
  if (status === 'blocked') return '/login';

  // `active` e `grace` seguem idênticos daqui para baixo — a tolerância
  // offline é um aviso, não um desvio de fluxo.
  if (!temConsentimento) return '/consent';
  if (!temPerfil) return '/profiles';
  return '/menu';
}
