import { describe, it, expect } from 'vitest';
import {
  TUTORIAL_VERSION,
  chaveDoTutorial,
  lerTutorial,
  gravarTutorial,
  tutorialConcluido,
} from './tutorialProfile';

// -----------------------------------------------------------------------------
// Por perfil, como o preparo. ELA é progressiva: o tempo de permanência bom
// para um paciente hoje não é o de daqui a três meses, e dois pacientes no
// mesmo computador não compartilham nem o dwell nem o que já foi ensinado.
// -----------------------------------------------------------------------------

const feito = { dwellMsEscolhido: 1800, ensaiouEmergencia: true };

describe('tutorialConcluido', () => {
  it('é falso antes de qualquer conclusão', () => {
    expect(tutorialConcluido('p1')).toBe(false);
  });

  it('é verdadeiro depois de concluir', () => {
    gravarTutorial('p1', feito);
    expect(tutorialConcluido('p1')).toBe(true);
  });

  it('não vaza de um perfil para outro', () => {
    gravarTutorial('p1', feito);
    expect(tutorialConcluido('p2')).toBe(false);
  });

  it('volta a ser falso quando a versão do tutorial muda', () => {
    localStorage.setItem(
      chaveDoTutorial('p1'),
      JSON.stringify({
        ...feito,
        version: TUTORIAL_VERSION - 1,
        completedAt: new Date().toISOString(),
      })
    );
    expect(tutorialConcluido('p1')).toBe(false);
  });

  it('é falso com registro corrompido, sem lançar', () => {
    localStorage.setItem(chaveDoTutorial('p1'), '{"version":');
    expect(() => tutorialConcluido('p1')).not.toThrow();
    expect(tutorialConcluido('p1')).toBe(false);
  });
});

describe('o que fica registrado', () => {
  it('o tempo de permanência que o paciente escolheu', () => {
    gravarTutorial('p1', feito);
    expect(lerTutorial('p1')?.dwellMsEscolhido).toBe(1800);
  });

  it('se a emergência foi ensaiada de fato', () => {
    // A diferença entre "o cuidador clicou avançar" e "o paciente sabe onde o
    // botão fica". Sem isto não há como saber qual dos dois aconteceu.
    gravarTutorial('p1', { ...feito, ensaiouEmergencia: false });
    expect(lerTutorial('p1')?.ensaiouEmergencia).toBe(false);
  });

  it('data em ISO 8601', () => {
    gravarTutorial('p1', feito);
    const t = lerTutorial('p1')!;
    expect(new Date(t.completedAt).toISOString()).toBe(t.completedAt);
  });
});
