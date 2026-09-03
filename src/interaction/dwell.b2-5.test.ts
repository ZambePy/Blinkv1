import { describe, it, expect } from 'vitest';
import {
  stepDwell,
  createDwellState,
  DEFAULT_DWELL_CONFIG,
  type DwellState,
  type DwellTarget,
  type DwellSample,
} from './dwell';

// -----------------------------------------------------------------------------
// B2.5 — Dwell perde TODO o progresso no segundo frame sem rosto.
//
//   const perdidoHa = state.lastValidTs === null ? Infinity : now - state.lastValidTs;
//   return parar('no-face', { preservarProgresso: perdidoHa < config.lostResetMs });
//
// O ramo de PAUSA devolve `lastValidTs: null`. Então:
//   frame 1 sem rosto → pausa, e apaga `lastValidTs`
//   frame 2 (33 ms depois) → `perdidoHa = Infinity` → **reset total**
//
// A tolerância efetiva é **1 frame**, não os 500 ms documentados em
// `lostResetMs`. O teste existente `dwell.test.ts:146` só exercita UM frame de
// perda, e por isso passava.
//
// O bug se compõe com o lado do engine (B2.3/B2.5): o engine emite
// `hasFace:false` uma ÚNICA vez por episódio (`if (lastEmitHadFace)`), então na
// prática o dispatcher nunca recebe o segundo frame — e o dwell fica em pausa
// INDEFINIDA. Paciente com 1400/1500 ms sobre um botão, rosto perdido por 5
// minutos: ao reaparecer, o dwell completa em ~2 frames.
//
// A invariante documentada não se sustenta em nenhuma das duas direções: nem
// os 500 ms de tolerância, nem o reset após eles.
//
// Correção: preservar `lastValidTs` no ramo de pausa, para que a idade da
// perda continue sendo medida a partir da última amostra VÁLIDA.
// -----------------------------------------------------------------------------

const CONFIG = { ...DEFAULT_DWELL_CONFIG };

function amostra(over: Partial<DwellSample> = {}): DwellSample {
  return {
    timestamp: 0,
    hasFace: true,
    eyeState: 'open',
    degraded: false,
    uncalibrated: false,
    ...over,
  };
}

function alvo(key: unknown = 'botao'): DwellTarget {
  return { key, customDwellMs: null, isEmergency: false, isRecovery: false, isDisabled: false };
}

/** Acumula progresso no alvo por `ms`, a 30 fps. Devolve o estado. */
function acumular(ms: number): { state: DwellState; t: number } {
  let state = createDwellState();
  const passo = 1000 / 30;
  let t = 0;
  for (; t <= ms; t += passo) {
    state = stepDwell(state, amostra({ timestamp: t }), alvo(), CONFIG).state;
  }
  return { state, t };
}

describe('B2.5 — a tolerância de perda de rosto são 500 ms, não 1 frame', () => {
  it('DOIS frames seguidos sem rosto preservam o progresso', () => {
    // Este é o teste que o `dwell.test.ts` existente não fazia: ele só
    // exercitava UM frame de perda, e por isso o bug passou despercebido.
    const { state, t } = acumular(1000);
    const progresso = state.elapsedMs;
    expect(progresso).toBeGreaterThan(900);

    const passo = 1000 / 30;
    let s = stepDwell(state, amostra({ timestamp: t, hasFace: false }), null, CONFIG).state;
    s = stepDwell(s, amostra({ timestamp: t + passo, hasFace: false }), null, CONFIG).state;

    expect(s.elapsedMs).toBeCloseTo(progresso, 5);
    expect(s.targetKey).not.toBeNull();
  });

  it('perda de 400 ms (abaixo de lostResetMs) preserva o progresso', () => {
    const { state, t } = acumular(1000);
    const progresso = state.elapsedMs;

    let s = state;
    const passo = 1000 / 30;
    for (let dt = 0; dt < 400; dt += passo) {
      s = stepDwell(s, amostra({ timestamp: t + dt, hasFace: false }), null, CONFIG).state;
    }

    expect(s.elapsedMs).toBeCloseTo(progresso, 5);
  });

  it('perda de 600 ms (acima de lostResetMs) ZERA o progresso', () => {
    // A outra direção da invariante, que também não se sustentava: com o
    // engine emitindo só uma amostra por episódio, o dwell ficava em pausa
    // indefinida e um rosto perdido por 5 min voltava com o progresso intacto.
    const { state, t } = acumular(1000);

    let s = state;
    const passo = 1000 / 30;
    for (let dt = 0; dt < 700; dt += passo) {
      s = stepDwell(s, amostra({ timestamp: t + dt, hasFace: false }), null, CONFIG).state;
    }

    expect(s.elapsedMs).toBe(0);
    expect(s.targetKey).toBeNull();
  });

  it('rosto perdido por 5 MINUTOS não permite completar em 2 frames', () => {
    // O sintoma concreto descrito no plano.
    const { state, t } = acumular(1400);
    expect(state.elapsedMs).toBeGreaterThan(1300);

    let s = state;
    const passo = 1000 / 30;
    for (let dt = 0; dt < 5 * 60 * 1000; dt += 500) {
      s = stepDwell(s, amostra({ timestamp: t + dt, hasFace: false }), null, CONFIG).state;
    }

    // Ao reaparecer, o dwell tem que recomeçar do zero — nunca completar.
    // (Entrar num alvo emite `progress` com 0%; o que não pode acontecer é
    // `click`.)
    const volta = stepDwell(
      s,
      amostra({ timestamp: t + 5 * 60 * 1000 + passo }),
      alvo(),
      CONFIG,
    );
    expect(volta.effect.type).not.toBe('click');
    expect(volta.state.elapsedMs).toBe(0);

    // E o frame seguinte também não completa: o progresso de 1400 ms sumiu.
    const seguinte = stepDwell(
      volta.state,
      amostra({ timestamp: t + 5 * 60 * 1000 + 2 * passo }),
      alvo(),
      CONFIG,
    );
    expect(seguinte.effect.type).not.toBe('click');
  });
});

describe('B2.5 — retomada após pausa curta', () => {
  it('o progresso preservado continua de onde parou', () => {
    const { state, t } = acumular(1000);
    const progresso = state.elapsedMs;

    const passo = 1000 / 30;
    let s = state;
    for (let dt = 0; dt < 300; dt += passo) {
      s = stepDwell(s, amostra({ timestamp: t + dt, hasFace: false }), null, CONFIG).state;
    }

    // Volta o rosto. O primeiro frame só restabelece o encadeamento (não
    // acrescenta tempo), os seguintes voltam a acumular.
    let out = stepDwell(s, amostra({ timestamp: t + 300 }), alvo(), CONFIG);
    expect(out.state.elapsedMs).toBeCloseTo(progresso, 5);

    out = stepDwell(out.state, amostra({ timestamp: t + 300 + passo }), alvo(), CONFIG);
    expect(out.state.elapsedMs).toBeGreaterThan(progresso);
  });

  it('a lacuna da pausa NÃO é contada como olhar', () => {
    // A razão de o ramo de pausa existir: o tempo com o rosto ausente não pode
    // avançar o dwell, senão fechar os olhos completaria a seleção.
    const { state, t } = acumular(1000);
    const progresso = state.elapsedMs;

    const passo = 1000 / 30;
    let s = state;
    for (let dt = 0; dt < 400; dt += passo) {
      s = stepDwell(s, amostra({ timestamp: t + dt, hasFace: false }), null, CONFIG).state;
    }
    const out = stepDwell(s, amostra({ timestamp: t + 400 }), alvo(), CONFIG);

    // Passaram 400 ms de relógio, mas o progresso não andou.
    expect(out.state.elapsedMs).toBeCloseTo(progresso, 5);
  });

  it('piscada LONGA preserva o progresso — decisão de design, não bug', () => {
    // Assimetria deliberada em relação à perda de rosto, e vale registrar por
    // quê: com o rosto perdido não se sabe para onde o paciente está olhando;
    // com os olhos fechados ele ESTÁ sobre o alvo, apenas piscando. Fadiga é a
    // condição do público-alvo (ELA), e zerar o progresso por fechamento
    // prolongado seria hostil a quem o sistema serve.
    //
    // B2.5 mexe apenas no ramo `no-face`. Este teste existe para travar a
    // fronteira: se alguém "uniformizar" os dois ramos, falha aqui.
    const { state, t } = acumular(1000);
    const progresso = state.elapsedMs;

    let s = state;
    const passo = 1000 / 30;
    for (let dt = 0; dt < 3000; dt += passo) {
      s = stepDwell(s, amostra({ timestamp: t + dt, eyeState: 'closed' }), alvo(), CONFIG).state;
    }
    expect(s.elapsedMs).toBeCloseTo(progresso, 5);
  });

  it('piscada curta preserva o progresso', () => {
    // Regressão: o comportamento que já funcionava não pode ter sido perdido.
    const { state, t } = acumular(1000);
    const progresso = state.elapsedMs;

    let s = state;
    const passo = 1000 / 30;
    for (let dt = 0; dt < 200; dt += passo) {
      s = stepDwell(s, amostra({ timestamp: t + dt, eyeState: 'closed' }), alvo(), CONFIG).state;
    }
    expect(s.elapsedMs).toBeCloseTo(progresso, 5);
  });
});
