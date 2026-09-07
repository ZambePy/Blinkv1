/**
 * Registro local do aceite do termo de privacidade.
 *
 * O termo promete que imagem de câmera e dados de calibração nunca saem deste
 * computador. O registro do aceite obedece à mesma promessa: fica no
 * `localStorage` e não é enviado a lugar nenhum — mandá-lo ao servidor
 * contradiria o próprio texto que a pessoa aceitou.
 */

export const CONSENT_KEY = 'irisflow_consent';

/**
 * Suba este número sempre que o texto do termo mudar de forma material.
 * Aceites de versões anteriores deixam de valer, e a tela reaparece — o
 * contrário seria tratar como consentido um texto que a pessoa nunca leu.
 */
export const CONSENT_VERSION = 1;

export interface RegistroDeConsentimento {
  version: number;
  /** ISO 8601. */
  acceptedAt: string;
  acceptedByEmail: string;
}

export function lerConsentimento(): RegistroDeConsentimento | null {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<RegistroDeConsentimento>;
    if (typeof p.version !== 'number' || typeof p.acceptedAt !== 'string') return null;
    return {
      version: p.version,
      acceptedAt: p.acceptedAt,
      acceptedByEmail: p.acceptedByEmail ?? '',
    };
  } catch {
    return null;
  }
}

export function aceitarConsentimento(email: string): RegistroDeConsentimento {
  const registro: RegistroDeConsentimento = {
    version: CONSENT_VERSION,
    acceptedAt: new Date().toISOString(),
    acceptedByEmail: email,
  };
  try {
    localStorage.setItem(CONSENT_KEY, JSON.stringify(registro));
  } catch {
    // Sem persistência o termo reaparece no próximo boot. Chato, não perigoso.
  }
  return registro;
}

export function temConsentimentoValido(): boolean {
  return lerConsentimento()?.version === CONSENT_VERSION;
}
