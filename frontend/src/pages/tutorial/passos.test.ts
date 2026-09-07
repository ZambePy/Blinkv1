import { describe, it, expect } from 'vitest';
import { PASSOS_DO_TUTORIAL, proximoPassoDoTutorial, passoAnteriorDoTutorial } from './passos';

// -----------------------------------------------------------------------------
// A ordem é a do aprendizado: entender o que é dwell, praticar, ajustar o tempo
// à luz da prática, e só então a emergência — que é dwell mais longo e não faz
// sentido antes de o dwell comum estar entendido.
// -----------------------------------------------------------------------------

describe('a ordem dos passos', () => {
  it('explica antes de praticar, e pratica antes de ajustar', () => {
    expect(PASSOS_DO_TUTORIAL).toEqual([
      'oQueEDwell',
      'pratica',
      'ajuste',
      'emergencia',
      'concluido',
    ]);
  });
});

describe('navegação', () => {
  it('avança até o fim', () => {
    expect(proximoPassoDoTutorial('oQueEDwell')).toBe('pratica');
    expect(proximoPassoDoTutorial('concluido')).toBeNull();
  });

  it('volta é sempre livre', () => {
    for (const p of PASSOS_DO_TUTORIAL.slice(1)) {
      expect(passoAnteriorDoTutorial(p)).not.toBeNull();
    }
  });

  it('do primeiro não volta', () => {
    expect(passoAnteriorDoTutorial('oQueEDwell')).toBeNull();
  });
});
