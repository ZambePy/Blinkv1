/**
 * Ordem dos passos do tutorial.
 *
 * É a ordem do aprendizado, não uma lista arbitrária:
 *
 *  1. Entender o que é dwell — sem isso a prática é só uma tela que muda sozinha.
 *  2. Praticar, para sentir o tempo no próprio olhar.
 *  3. Ajustar o tempo à luz do que acabou de ser sentido. Ajustar antes de
 *     praticar seria ajustar às cegas.
 *  4. Emergência por último: é dwell MAIS LONGO, e não faz sentido antes de o
 *     dwell comum estar entendido.
 *  5. Conclusão, com o caminho para refazer.
 */

export const PASSOS_DO_TUTORIAL = [
  'oQueEDwell',
  'pratica',
  'ajuste',
  'emergencia',
  'concluido',
] as const;

export type PassoDoTutorial = (typeof PASSOS_DO_TUTORIAL)[number];

export const indiceDoPassoDoTutorial = (p: PassoDoTutorial) => PASSOS_DO_TUTORIAL.indexOf(p);

export function proximoPassoDoTutorial(p: PassoDoTutorial): PassoDoTutorial | null {
  const i = indiceDoPassoDoTutorial(p);
  return i >= 0 && i < PASSOS_DO_TUTORIAL.length - 1 ? PASSOS_DO_TUTORIAL[i + 1] : null;
}

/** Voltar não tem condição: nada aqui pode prender o paciente num passo. */
export function passoAnteriorDoTutorial(p: PassoDoTutorial): PassoDoTutorial | null {
  const i = indiceDoPassoDoTutorial(p);
  return i > 0 ? PASSOS_DO_TUTORIAL[i - 1] : null;
}
