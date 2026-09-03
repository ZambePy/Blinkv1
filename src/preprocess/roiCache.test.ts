import { describe, it, expect } from 'vitest';
import {
  RoiCache,
  ROI_MAX_ANGLE_RAD,
  ROI_MAX_AGE_MS,
  ROI_MAX_TRANSLATION_CM,
  ROI_MAX_CONSECUTIVE_REUSES,
  type RoiObservation,
} from './roiCache';

// P4.8 — reutilizar o crop quando a cabeça não mexeu.
//
// ⚠️ A ECONOMIA PROMETIDA NÃO É AFIRMADA AQUI. O plano diz 40%; o crop custa
// ~1–2 ms contra 300+ ms do L2CS, então o ganho relativo real é provavelmente
// muito menor. Quem mede é `T0.5`, em runtime. Estes testes verificam a LÓGICA
// DE DECISÃO — que é o que pode estar errado de forma silenciosa.
//
// ── Por que duas guardas além do ângulo ──────────────────────────────────────
//
// Reutilizar por pose parada, sozinho, é uma armadilha: o paciente pode
// TRANSLADAR sem girar (escorregar na cadeira, a cadeira andar), e translação
// não aparece como rotação. O crop reusado passaria a enquadrar outra coisa, o
// L2CS inferiria sobre a região errada, e nada no sistema acusaria — o gaze
// continuaria "válido". Daí a invalidação por tempo e a por translação.
//
// O público-alvo torna isso mais crítico, não menos: são usuários de ELA/ALS,
// que ficam com a cabeça parada por longos períodos. O caso "pose idêntica por
// 30 s" é o caso NORMAL aqui, não a exceção — sem a guarda de tempo, um crop
// de 30 s atrás continuaria alimentando o modelo.

const GRAUS = Math.PI / 180;

function obs(over: Partial<RoiObservation> = {}): RoiObservation {
  return {
    nowMs: 1000,
    pose: { yaw: 0, pitch: 0, roll: 0 },
    faceCenter: { x: 0.5, y: 0.5 },
    iodPx: 100,
    videoWidth: 1280,
    videoHeight: 720,
    ...over,
  };
}

describe('RoiCache — decisão por pose', () => {
  it('o primeiro frame nunca reusa: não há o que reusar', () => {
    const c = new RoiCache();
    const d = c.decide(obs());
    expect(d.reuse).toBe(false);
    expect(d.reason).toBe('primeiro-frame');
  });

  it('pose praticamente parada: reusa', () => {
    const c = new RoiCache();
    c.decide(obs());
    const d = c.decide(obs({ nowMs: 1033, pose: { yaw: 0.5 * GRAUS, pitch: 0.2 * GRAUS, roll: 0 } }));
    expect(d.reuse).toBe(true);
    expect(d.reason).toBe('reuso');
  });

  it('giro acima de 2° invalida', () => {
    const c = new RoiCache();
    c.decide(obs());
    const d = c.decide(obs({ nowMs: 1033, pose: { yaw: 3 * GRAUS, pitch: 0, roll: 0 } }));
    expect(d.reuse).toBe(false);
    expect(d.reason).toBe('pose');
  });

  it('o limiar é 2°, como a especificação pede', () => {
    expect(ROI_MAX_ANGLE_RAD).toBeCloseTo(2 * GRAUS, 9);
  });

  it('pitch conta igual a yaw — o crop é quadrado nos dois eixos', () => {
    const c = new RoiCache();
    c.decide(obs());
    const d = c.decide(obs({ nowMs: 1033, pose: { yaw: 0, pitch: 3 * GRAUS, roll: 0 } }));
    expect(d.reuse).toBe(false);
    expect(d.reason).toBe('pose');
  });

  it('roll NÃO invalida: o crop é axis-aligned e não gira com a cabeça', () => {
    // Girar a cabeça no eixo do nariz não muda a região que o bbox cobre de
    // forma relevante. Invalidar por roll gastaria recomputo sem ganho.
    const c = new RoiCache();
    c.decide(obs());
    const d = c.decide(obs({ nowMs: 1033, pose: { yaw: 0, pitch: 0, roll: 20 * GRAUS } }));
    expect(d.reuse).toBe(true);
  });
});

describe('RoiCache — guarda de tempo', () => {
  it('pose idêntica mas ROI velho demais: recomputa', () => {
    const c = new RoiCache();
    c.decide(obs({ nowMs: 0 }));
    const d = c.decide(obs({ nowMs: ROI_MAX_AGE_MS + 1 }));
    expect(d.reuse).toBe(false);
    expect(d.reason).toBe('tempo');
  });

  it('a idade conta desde o último RECOMPUTO, não desde o último frame', () => {
    // Se contasse desde o último frame, uma sequência de reusos renovaria o
    // prazo indefinidamente e a guarda nunca dispararia — que é o bug que ela
    // existe para evitar.
    const c = new RoiCache({ maxConsecutiveReuses: 100 });
    c.decide(obs({ nowMs: 0 }));
    for (let t = 30; t < ROI_MAX_AGE_MS; t += 30) {
      expect(c.decide(obs({ nowMs: t })).reuse).toBe(true);
    }
    const d = c.decide(obs({ nowMs: ROI_MAX_AGE_MS + 30 }));
    expect(d.reuse).toBe(false);
    expect(d.reason).toBe('tempo');
  });

  it('o teto de idade é declarado e é da ordem de centenas de ms', () => {
    expect(ROI_MAX_AGE_MS).toBeGreaterThanOrEqual(100);
    expect(ROI_MAX_AGE_MS).toBeLessThanOrEqual(1000);
  });
});

describe('RoiCache — guarda de translação', () => {
  it('a cabeça desliza sem girar: recomputa', () => {
    const c = new RoiCache();
    c.decide(obs());
    // 0,05 normalizado × 1280 px = 64 px; com iod = 100 px e distância cantal
    // de ~9 cm, isso é ~5,8 cm de deslocamento real — muito acima do limiar.
    const d = c.decide(obs({ nowMs: 1033, faceCenter: { x: 0.55, y: 0.5 } }));
    expect(d.reuse).toBe(false);
    expect(d.reason).toBe('translacao');
  });

  it('deslocamento minúsculo não invalida — senão nunca reusaria', () => {
    const c = new RoiCache();
    c.decide(obs());
    const d = c.decide(obs({ nowMs: 1033, faceCenter: { x: 0.5005, y: 0.5 } }));
    expect(d.reuse).toBe(true);
  });

  it('vale para o eixo vertical também', () => {
    const c = new RoiCache();
    c.decide(obs());
    const d = c.decide(obs({ nowMs: 1033, faceCenter: { x: 0.5, y: 0.58 } }));
    expect(d.reuse).toBe(false);
    expect(d.reason).toBe('translacao');
  });

  it('a translação é medida em CM, não em pixels — escala com o zoom', () => {
    // Mesmo deslocamento normalizado, rosto duas vezes maior no frame (iod
    // dobrado) = metade do deslocamento físico. Um limiar em px trataria os
    // dois casos como iguais e invalidaria demais em câmera com zoom.
    const perto = new RoiCache();
    perto.decide(obs({ iodPx: 300 }));
    const dPerto = perto.decide(obs({ nowMs: 1033, iodPx: 300, faceCenter: { x: 0.515, y: 0.5 } }));

    const longe = new RoiCache();
    longe.decide(obs({ iodPx: 60 }));
    const dLonge = longe.decide(obs({ nowMs: 1033, iodPx: 60, faceCenter: { x: 0.515, y: 0.5 } }));

    expect(dPerto.reuse).toBe(true);   // ~0,6 cm físico
    expect(dLonge.reuse).toBe(false);  // ~2,9 cm físico
  });

  it('o limiar de translação é declarado e é sub-centimétrico a poucos cm', () => {
    expect(ROI_MAX_TRANSLATION_CM).toBeGreaterThan(0);
    expect(ROI_MAX_TRANSLATION_CM).toBeLessThanOrEqual(3);
  });
});

describe('RoiCache — skip rate', () => {
  it('no máximo 2 reusos seguidos: 2 frames em 3, como a especificação pede', () => {
    expect(ROI_MAX_CONSECUTIVE_REUSES).toBe(2);
    const c = new RoiCache();
    c.decide(obs({ nowMs: 0 })); // computa
    expect(c.decide(obs({ nowMs: 33 })).reuse).toBe(true);
    expect(c.decide(obs({ nowMs: 66 })).reuse).toBe(true);
    const terceiro = c.decide(obs({ nowMs: 99 }));
    expect(terceiro.reuse).toBe(false);
    expect(terceiro.reason).toBe('skip-esgotado');
    // E o ciclo recomeça.
    expect(c.decide(obs({ nowMs: 132 })).reuse).toBe(true);
  });

  it('a taxa de reuso em regime estacionário fica em 2/3', () => {
    const c = new RoiCache();
    for (let i = 0; i < 300; i++) c.decide(obs({ nowMs: i * 33 }));
    const s = c.stats();
    expect(s.reuseRate).toBeGreaterThan(0.6);
    expect(s.reuseRate).toBeLessThanOrEqual(2 / 3 + 0.01);
  });
});

describe('RoiCache — dados ruins e ciclo de vida', () => {
  it('pose não-finita nunca reusa', () => {
    const c = new RoiCache();
    c.decide(obs());
    const d = c.decide(obs({ nowMs: 1033, pose: { yaw: NaN, pitch: 0, roll: 0 } }));
    expect(d.reuse).toBe(false);
    expect(d.reason).toBe('dados-invalidos');
  });

  it('iod degenerado nunca reusa — sem escala não há como julgar translação', () => {
    const c = new RoiCache();
    c.decide(obs());
    const d = c.decide(obs({ nowMs: 1033, iodPx: 0 }));
    expect(d.reuse).toBe(false);
    expect(d.reason).toBe('dados-invalidos');
  });

  it('guarda e devolve o ROI associado', () => {
    const c = new RoiCache<{ tensor: string }>();
    c.decide(obs({ nowMs: 0 }));
    c.store({ tensor: 'crop-a' });
    expect(c.decide(obs({ nowMs: 33 })).reuse).toBe(true);
    expect(c.get()).toEqual({ tensor: 'crop-a' });
  });

  it('sem ROI guardado, não anuncia reuso — evita reusar o que não existe', () => {
    const c = new RoiCache<{ tensor: string }>({ requireStored: true });
    c.decide(obs({ nowMs: 0 })); // decidiu recomputar, mas ninguém chamou store()
    const d = c.decide(obs({ nowMs: 33 }));
    expect(d.reuse).toBe(false);
    expect(d.reason).toBe('sem-roi');
  });

  it('reset esquece tudo, inclusive as estatísticas', () => {
    const c = new RoiCache();
    c.decide(obs({ nowMs: 0 }));
    c.decide(obs({ nowMs: 33 }));
    c.reset();
    expect(c.get()).toBeNull();
    expect(c.stats().decisions).toBe(0);
    expect(c.decide(obs({ nowMs: 66 })).reason).toBe('primeiro-frame');
  });

  it('as estatísticas separam o motivo de cada recomputo', () => {
    // ⚠️ Cada recomputo MOVE A BASE para o frame atual. Uma sequência que
    // ignore isso testa outra coisa: voltar yaw a 0 depois de uma base em 5°
    // é mais uma mudança de 5°, e cairia em 'pose' de novo em vez de
    // 'translacao'. Por isso cada passo abaixo muda um eixo por vez, partindo
    // do estado que o passo anterior deixou.
    const c = new RoiCache();
    const inclinado = { yaw: 5 * GRAUS, pitch: 0, roll: 0 };
    c.decide(obs({ nowMs: 0 }));                                                   // primeiro-frame
    c.decide(obs({ nowMs: 33, pose: inclinado }));                                 // pose
    c.decide(obs({ nowMs: 66, pose: inclinado, faceCenter: { x: 0.6, y: 0.5 } })); // translação
    c.decide(obs({                                                                 // tempo
      nowMs: 66 + ROI_MAX_AGE_MS + 1, pose: inclinado, faceCenter: { x: 0.6, y: 0.5 },
    }));
    const s = c.stats();
    expect(s.refreshByReason.pose).toBe(1);
    expect(s.refreshByReason.translacao).toBe(1);
    expect(s.refreshByReason.tempo).toBe(1);
    expect(s.decisions).toBe(4);
  });
});
