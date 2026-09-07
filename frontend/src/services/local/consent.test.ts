import { describe, it, expect } from 'vitest';
import {
  CONSENT_KEY,
  CONSENT_VERSION,
  lerConsentimento,
  aceitarConsentimento,
  temConsentimentoValido,
} from './consent';

// -----------------------------------------------------------------------------
// O termo promete que imagem de câmera e calibração nunca saem da máquina. O
// registro do aceite é a prova de que o cuidador leu essa promessa, com data —
// e ele próprio é local, porque enviá-lo ao servidor contradiria o texto.
// -----------------------------------------------------------------------------

describe('temConsentimentoValido', () => {
  it('é falso antes de qualquer aceite', () => {
    expect(temConsentimentoValido()).toBe(false);
  });

  it('é verdadeiro depois do aceite', () => {
    aceitarConsentimento('cuidador@teste.com');
    expect(temConsentimentoValido()).toBe(true);
  });

  it('volta a ser falso quando o texto do termo muda de versão', () => {
    // Sem isto, uma mudança material no termo valeria com o aceite antigo —
    // que é consentimento para um texto que a pessoa nunca viu.
    localStorage.setItem(
      CONSENT_KEY,
      JSON.stringify({
        version: CONSENT_VERSION - 1,
        acceptedAt: new Date().toISOString(),
        acceptedByEmail: 'cuidador@teste.com',
      })
    );
    expect(temConsentimentoValido()).toBe(false);
  });

  it('é falso quando o registro está corrompido', () => {
    localStorage.setItem(CONSENT_KEY, '{"version":');
    expect(temConsentimentoValido()).toBe(false);
  });
});

describe('aceitarConsentimento', () => {
  it('grava versão, data ISO e quem aceitou', () => {
    aceitarConsentimento('cuidador@teste.com');
    const c = lerConsentimento();

    expect(c).not.toBeNull();
    expect(c?.version).toBe(CONSENT_VERSION);
    expect(c?.acceptedByEmail).toBe('cuidador@teste.com');
    expect(new Date(c!.acceptedAt).toISOString()).toBe(c!.acceptedAt);
  });
});
