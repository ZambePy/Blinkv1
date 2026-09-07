/**
 * Registro de que o tutorial foi feito, por perfil.
 *
 * Por perfil como o preparo, e pela mesma razão mais uma: ELA é progressiva. O
 * tempo de permanência bom para um paciente hoje não é o de daqui a três meses,
 * e dois pacientes no mesmo computador não compartilham nem o dwell nem o que
 * já lhes foi ensinado.
 */

/** Suba quando os passos mudarem a ponto de valer a pena reapresentá-los. */
export const TUTORIAL_VERSION = 1;

export interface DadosDoTutorial {
  dwellMsEscolhido: number;
  /**
   * Se o paciente acionou o ensaio de emergência.
   *
   * É a diferença entre "o cuidador clicou avançar" e "o paciente sabe onde o
   * botão fica". Sem o campo não há como saber qual dos dois aconteceu.
   */
  ensaiouEmergencia: boolean;
}

export interface TutorialDoPerfil extends DadosDoTutorial {
  version: number;
  /** ISO 8601. */
  completedAt: string;
}

export const chaveDoTutorial = (profileId: string) => `irisflow_tutorial_${profileId}`;

export function lerTutorial(profileId: string): TutorialDoPerfil | null {
  try {
    const raw = localStorage.getItem(chaveDoTutorial(profileId));
    if (!raw) return null;
    const p = JSON.parse(raw) as Partial<TutorialDoPerfil>;
    if (typeof p.version !== 'number' || typeof p.completedAt !== 'string') return null;
    return {
      version: p.version,
      completedAt: p.completedAt,
      dwellMsEscolhido: typeof p.dwellMsEscolhido === 'number' ? p.dwellMsEscolhido : 0,
      ensaiouEmergencia: p.ensaiouEmergencia === true,
    };
  } catch {
    // Registro ilegível faz o tutorial reaparecer. Chato, e melhor que
    // derrubar a tela que vem logo depois da calibração.
    return null;
  }
}

export function gravarTutorial(profileId: string, dados: DadosDoTutorial): TutorialDoPerfil {
  const registro: TutorialDoPerfil = {
    ...dados,
    version: TUTORIAL_VERSION,
    completedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(chaveDoTutorial(profileId), JSON.stringify(registro));
  } catch {
    // Sem persistência o tutorial reaparece no próximo boot.
  }
  return registro;
}

export function tutorialConcluido(profileId: string): boolean {
  return lerTutorial(profileId)?.version === TUTORIAL_VERSION;
}

export function limparTutorial(profileId: string): void {
  try {
    localStorage.removeItem(chaveDoTutorial(profileId));
  } catch {
    /* idem */
  }
}
