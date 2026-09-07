import { describe, it, expect } from 'vitest';
import { evaluateReadiness, type ReadinessSnapshot } from './setupReadiness';

// -----------------------------------------------------------------------------
// O falso positivo relatado: com óculos, o sistema acusava reflexo quase
// sempre; o cuidador calibrava assim mesmo e o erro saía normal. Um aviso que
// não prevê degradação nenhuma treina a pessoa a ignorar avisos — e aí o aviso
// que importa também é ignorado.
//
// A causa era o discriminador, não o limiar. `specularPersistence` mede a
// fração de quadros com brilho alto. Para separar reflexo de ruído passageiro
// isso funciona. Para separar óculos de reflexo nocivo está INVERTIDO: o
// brilho fixo de uma lente aparece em todos os quadros, marca persistência
// ≈ 1,0 e dispara sempre — exatamente o caso inócuo.
//
// O sinal certo é se a mancha se MOVE.
// -----------------------------------------------------------------------------

function snap(over: Partial<ReadinessSnapshot> = {}): ReadinessSnapshot {
  return {
    hasFace: true,
    iod: 340,
    videoWidth: 1920,
    videoHeight: 1080,
    faceCenter: { x: 0.5, y: 0.5 },
    pose: { yaw: 0.01, pitch: -0.02, roll: 0.005 },
    brightness: 0.45,
    contrast: 0.2,
    detectorConfidence: 0.99,
    specularRatio: 0,
    ...over,
  };
}

const oculos = (id: 'glasses') => (s: ReadinessSnapshot) =>
  evaluateReadiness(s).checks.find((c) => c.id === id)!;

const checkOculos = oculos('glasses');

describe('assinatura de óculos — o falso positivo que motivou a mudança', () => {
  it('brilho forte mas PARADO não acusa', () => {
    // Uma lente refletindo a luz do ambiente, sempre no mesmo lugar. É o caso
    // em que o usuário calibrou mesmo com o aviso e o erro saiu normal.
    const c = checkOculos(
      snap({ specularRatio: 0.08, specularPersistence: 1.0, specularStability: 0.95 })
    );
    expect(c.status).toBe('ok');
  });

  it('brilho parado em todos os quadros continua não acusando', () => {
    // Persistência máxima — o valor que ANTES garantia o aviso.
    const c = checkOculos(
      snap({ specularRatio: 0.12, specularPersistence: 1.0, specularStability: 0.9 })
    );
    expect(c.status).toBe('ok');
  });

  it('a mensagem diz que reconheceu a assinatura, em vez de calar', () => {
    // Silêncio faria o cuidador achar que o sistema não viu o reflexo. Ele
    // viu, avaliou, e concluiu que não atrapalha.
    const c = checkOculos(
      snap({ specularRatio: 0.08, specularPersistence: 1.0, specularStability: 0.95 })
    );
    expect(c.message).toMatch(/óculos|lente/i);
  });
});

describe('reflexo que atrapalha — mancha em movimento', () => {
  it('brilho que se move acusa', () => {
    const c = checkOculos(
      snap({ specularRatio: 0.08, specularPersistence: 0.9, specularStability: 0.2 })
    );
    expect(c.status).toBe('warn');
  });

  it('a mensagem diz o que fazer', () => {
    const c = checkOculos(
      snap({ specularRatio: 0.08, specularPersistence: 0.9, specularStability: 0.2 })
    );
    expect(c.message).toMatch(/incline|luz|janela/i);
  });

  it('brilho intermitente E móvel acusa mesmo com persistência baixa', () => {
    // O caso que a persistência sozinha DEIXAVA PASSAR: um reflexo que entra e
    // sai é pouco persistente e muito nocivo.
    const c = checkOculos(
      snap({ specularRatio: 0.08, specularPersistence: 0.2, specularStability: 0.1 })
    );
    expect(c.status).toBe('warn');
  });
});

describe('sem brilho nenhum', () => {
  it('não acusa, com estabilidade qualquer', () => {
    expect(checkOculos(snap({ specularRatio: 0, specularStability: 0 })).status).toBe('ok');
    expect(checkOculos(snap({ specularRatio: 0, specularStability: 1 })).status).toBe('ok');
  });
});

describe('sem a medida de estabilidade', () => {
  it('cai no critério antigo em vez de aprovar tudo em silêncio', () => {
    // Compatibilidade: um snapshot vindo de código que ainda não preenche o
    // campo não pode desligar a checagem inteira.
    const c = checkOculos(snap({ specularRatio: 0.08, specularPersistence: 0.9 }));
    expect(c.status).toBe('warn');
  });
});
