import { describe, it, expect } from 'vitest';
import { PROFILES_KEY, listarPerfis, criarPerfil, removerPerfil } from './profiles';

// -----------------------------------------------------------------------------
// Perfis de paciente NUNCA saem desta máquina — é a promessa do termo de
// privacidade. Nome, idade, condição e foto de alguém com ELA são dado de
// saúde; o único lugar onde ficam é o localStorage deste computador.
// -----------------------------------------------------------------------------

describe('listarPerfis', () => {
  it('começa vazio — nada de "Paciente A/B/C" de enfeite', () => {
    // Perfis fictícios num produto clínico levam o cuidador a calibrar no
    // perfil errado e perder a sessão.
    expect(listarPerfis()).toEqual([]);
  });

  it('devolve vazio quando o storage está corrompido, sem lançar', () => {
    localStorage.setItem(PROFILES_KEY, 'nao é json');
    expect(listarPerfis()).toEqual([]);
  });
});

describe('criarPerfil', () => {
  it('guarda o perfil e o devolve na listagem', () => {
    const p = criarPerfil({ name: 'Joana' });

    expect(p.id).toBeTruthy();
    expect(listarPerfis()).toHaveLength(1);
    expect(listarPerfis()[0].name).toBe('Joana');
  });

  it('persiste entre leituras, para sobreviver ao fechar o app', () => {
    criarPerfil({ name: 'Joana' });
    expect(JSON.parse(localStorage.getItem(PROFILES_KEY) ?? '[]')).toHaveLength(1);
  });

  it('guarda idade, condição e foto quando informados', () => {
    const p = criarPerfil({
      name: 'Joana',
      age: 58,
      condition: 'ELA',
      avatarDataUrl: 'data:image/png;base64,iVBORw0KGgo=',
    });

    expect(p.age).toBe(58);
    expect(p.condition).toBe('ELA');
    expect(p.avatarDataUrl).toMatch(/^data:image\//);
  });

  it('aceita perfil só com nome — idade e condição são opcionais', () => {
    const p = criarPerfil({ name: 'Joana' });
    expect(p.age).toBeUndefined();
    expect(p.condition).toBeUndefined();
  });

  it('recusa nome vazio', () => {
    expect(() => criarPerfil({ name: '   ' })).toThrow();
  });

  it('dá ids diferentes a perfis de mesmo nome', () => {
    // Dois irmãos com o mesmo primeiro nome não podem compartilhar calibração.
    const a = criarPerfil({ name: 'Joana' });
    const b = criarPerfil({ name: 'Joana' });
    expect(a.id).not.toBe(b.id);
  });

  it('carimba a data de criação em ISO 8601', () => {
    const p = criarPerfil({ name: 'Joana' });
    expect(new Date(p.createdAt).toISOString()).toBe(p.createdAt);
  });
});

describe('removerPerfil', () => {
  it('tira só o perfil pedido', () => {
    const a = criarPerfil({ name: 'Joana' });
    criarPerfil({ name: 'Carlos' });

    removerPerfil(a.id);

    const restantes = listarPerfis();
    expect(restantes).toHaveLength(1);
    expect(restantes[0].name).toBe('Carlos');
  });
});
