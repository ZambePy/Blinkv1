import { describe, it, expect } from 'vitest';
import { destinoDoBoot, type EstadoDoBoot } from './bootDestination';

// -----------------------------------------------------------------------------
// A decisão de para onde o app vai ao abrir, isolada da tela.
//
// Isolada de propósito: a alternativa seria testar esta lógica através do
// splash, com timers e navegação de router no meio — três coisas podendo
// falhar quando só uma está sendo verificada.
// -----------------------------------------------------------------------------

const base: EstadoDoBoot = {
  status: 'none',
  introVisto: false,
  temConsentimento: false,
  temPerfil: false,
};

const destino = (parcial: Partial<EstadoDoBoot>) => destinoDoBoot({ ...base, ...parcial });

describe('enquanto verifica', () => {
  it('não decide nada', () => {
    // Decidir aqui expulsaria para o login quem tem licença válida, no
    // intervalo entre abrir o app e o servidor responder.
    expect(destino({ status: 'checking' })).toBeNull();
  });
});

describe('primeira abertura da vida', () => {
  it('vai para as boas-vindas', () => {
    expect(destino({ status: 'none', introVisto: false })).toBe('/intro');
  });

  it('pula as boas-vindas se já foram vistas e vai direto ao login', () => {
    expect(destino({ status: 'none', introVisto: true })).toBe('/login');
  });
});

describe('licença recusada', () => {
  it('vai para o login mesmo que o intro nunca tenha sido visto', () => {
    // Quem está bloqueado já usou o produto: já viu a apresentação, e o que
    // precisa é resolver a licença.
    expect(destino({ status: 'blocked', introVisto: false })).toBe('/login');
  });
});

describe('licença em ordem', () => {
  it('pede o termo antes de qualquer dado do paciente', () => {
    expect(destino({ status: 'active', temConsentimento: false })).toBe('/consent');
  });

  it('com termo aceito e sem perfil, pede o perfil', () => {
    expect(destino({ status: 'active', temConsentimento: true, temPerfil: false })).toBe(
      '/profiles'
    );
  });

  it('com tudo pronto, vai direto ao menu', () => {
    expect(destino({ status: 'active', temConsentimento: true, temPerfil: true })).toBe('/menu');
  });
});

describe('tolerância offline', () => {
  it('segue o mesmo caminho de uma licença ativa', () => {
    // O usuário não deve nem perceber a diferença: só um aviso, nenhum desvio.
    expect(destino({ status: 'grace', temConsentimento: true, temPerfil: true })).toBe('/menu');
    expect(destino({ status: 'grace', temConsentimento: false })).toBe('/consent');
  });
});
