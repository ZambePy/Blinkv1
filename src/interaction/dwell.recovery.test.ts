import { describe, it, expect } from 'vitest';
import {
  stepDwell,
  createDwellState,
  DEFAULT_DWELL_CONFIG,
  type DwellState,
  type DwellTarget,
  type DwellSample,
  type DwellConfig,
} from './dwell';

// Alvos de RECUPERAÇÃO (`data-recovery="true"`, ex.: "Recalibre aqui") são
// aceitos pelo dwell em `degraded`, no mesmo ramo do emergency, com dwell mais
// longo contra acionamento acidental — senão a única saída oferecida ao
// paciente quando o rastreamento degrada seria inalcançável por olhar.

const CONFIG: DwellConfig = { ...DEFAULT_DWELL_CONFIG };

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

function alvo(over: Partial<DwellTarget> = {}): DwellTarget {
  return {
    key: 'alvo-comum',
    customDwellMs: null,
    isEmergency: false,
    isRecovery: false,
    isDisabled: false,
    ...over,
  };
}

/**
 * Roda o dwell por `duracaoMs` a 30 fps.
 *
 * Devolve o último outcome MAIS o instante simulado em que o clique saiu
 * (`msAteClique`, `null` se não houve). Medir o tempo até o clique — e não
 * `state.elapsedMs` — importa porque o outcome de clique JÁ zera `elapsedMs`
 * para armar o refratário; ler o campo depois do clique dá sempre 0.
 */
function correrDwell(
  target: DwellTarget,
  sampleBase: Partial<DwellSample>,
  duracaoMs: number,
  config: DwellConfig = CONFIG,
) {
  let state: DwellState = createDwellState();
  let out = stepDwell(state, amostra({ ...sampleBase, timestamp: 0 }), target, config);
  state = out.state;
  const passo = 1000 / 30;
  let msAteClique: number | null = out.effect.type === 'click' ? 0 : null;
  for (let t = passo; t <= duracaoMs; t += passo) {
    out = stepDwell(state, amostra({ ...sampleBase, timestamp: t }), target, config);
    state = out.state;
    if (out.effect.type === 'click') { msAteClique = t; break; }
  }
  return { ...out, msAteClique };
}

describe('o alvo de recuperação é alcançável em degraded', () => {
  it('um alvo comum continua bloqueado em degraded', () => {
    // A política existente é correta e precisa continuar valendo: sobre um
    // cursor não-confiável, clicar em qualquer botão é pior que não clicar.
    const out = stepDwell(
      createDwellState(),
      amostra({ degraded: true }),
      alvo(),
      CONFIG,
    );
    expect(out.blockedBy).toBe('degraded');
    expect(out.effect.type).toBe('none');
  });

  it('um alvo de recuperação não é bloqueado em degraded', () => {
    const out = stepDwell(
      createDwellState(),
      amostra({ degraded: true }),
      alvo({ key: 'recalibrar', isRecovery: true }),
      CONFIG,
    );
    expect(out.blockedBy).toBeNull();
  });

  it('o dwell num alvo de recuperação completa em degraded', () => {
    // O paciente consegue, de fato, acionar a recalibração só com o olhar.
    const out = correrDwell(
      alvo({ key: 'recalibrar', isRecovery: true }),
      { degraded: true },
      10_000,
    );
    expect(out.effect.type).toBe('click');
  });

  it('o alvo de recuperação exige dwell mais longo que o normal', () => {
    // Acionamento acidental de "recalibrar" custa 1–2 min de sessão ao
    // paciente. O dwell estendido é a defesa — e vale só no estado degradado,
    // onde o cursor é sabidamente instável.
    const normal = correrDwell(alvo({ key: 'a' }), {}, 10_000);
    const recuperacao = correrDwell(
      alvo({ key: 'recalibrar', isRecovery: true }),
      { degraded: true },
      10_000,
    );
    expect(normal.effect.type).toBe('click');
    expect(recuperacao.effect.type).toBe('click');
    // 2,5× o dwell base contra 1× — a recuperação tem que demorar
    // visivelmente mais para não ser acionada por um cursor instável.
    expect(recuperacao.msAteClique!).toBeGreaterThan(normal.msAteClique! * 2);
  });

  it('fora de degraded, o alvo de recuperação usa o dwell normal', () => {
    // Sem degradação o cursor é confiável e não há motivo para penalizar o
    // paciente com um dwell mais longo.
    const comum = correrDwell(alvo({ key: 'a' }), {}, 10_000);
    const recuperacao = correrDwell(alvo({ key: 'r', isRecovery: true }), {}, 10_000);
    expect(recuperacao.msAteClique).toBeCloseTo(comum.msAteClique!, 0);
  });
});

describe('a exceção de recuperação não afrouxa as outras barreiras', () => {
  it('sem calibração, nem o alvo de recuperação passa', () => {
    // `uncalibrated` significa que o ponto é a ponta do nariz, não o olhar.
    // Sobre um sinal que não acompanha o olhar, nada pode ser clicável — a
    // recalibração inclusive, porque o paciente não teria como mirar.
    const out = stepDwell(
      createDwellState(),
      amostra({ uncalibrated: true, degraded: true }),
      alvo({ key: 'recalibrar', isRecovery: true }),
      CONFIG,
    );
    expect(out.blockedBy).toBe('uncalibrated');
  });

  it('sem rosto, o alvo de recuperação não avança', () => {
    const out = stepDwell(
      createDwellState(),
      amostra({ hasFace: false, degraded: true }),
      alvo({ key: 'recalibrar', isRecovery: true }),
      CONFIG,
    );
    expect(out.blockedBy).toBe('no-face');
  });

  it('olho fechado pausa o alvo de recuperação, não completa', () => {
    // Fechar os olhos por muito tempo é comum em fadiga — a condição do
    // público-alvo. Não pode virar um clique em "recalibrar".
    const out = stepDwell(
      createDwellState(),
      amostra({ eyeState: 'closed', degraded: true }),
      alvo({ key: 'recalibrar', isRecovery: true }),
      CONFIG,
    );
    expect(out.blockedBy).toBe('eyes-closed');
    expect(out.effect.type).toBe('none');
  });

  it('um alvo desabilitado continua bloqueado mesmo sendo de recuperação', () => {
    const out = stepDwell(
      createDwellState(),
      amostra({ degraded: true }),
      alvo({ key: 'recalibrar', isRecovery: true, isDisabled: true }),
      CONFIG,
    );
    expect(out.blockedBy).toBe('disabled');
  });

  it('o refratário continua valendo para o alvo de recuperação', () => {
    // Sem isto, um clique em "recalibrar" poderia re-disparar sob o mesmo
    // olhar e reiniciar a calibração no meio dela.
    const state: DwellState = { ...createDwellState(), refractoryUntil: 5000 };
    const out = stepDwell(
      state,
      amostra({ timestamp: 1000, degraded: true }),
      alvo({ key: 'recalibrar', isRecovery: true }),
      CONFIG,
    );
    expect(out.blockedBy).toBe('refractory');
  });
});

describe('emergência e recuperação coexistem', () => {
  it('o alvo de emergência segue funcionando em degraded', () => {
    // A exceção de recuperação não pode substituir a de emergência.
    const out = correrDwell(
      alvo({ key: 'sos', isEmergency: true }),
      { degraded: true },
      10_000,
    );
    expect(out.effect.type).toBe('click');
  });

  it('um alvo que é emergência E recuperação não soma os multiplicadores', () => {
    // Defesa contra o dwell virar absurdamente longo por acumulação de
    // exceções — o paciente ficaria olhando 6 s para um botão de emergência.
    const soEmergencia = correrDwell(
      alvo({ key: 'a', isEmergency: true }),
      { degraded: true },
      20_000,
    );
    const ambos = correrDwell(
      alvo({ key: 'b', isEmergency: true, isRecovery: true }),
      { degraded: true },
      20_000,
    );
    expect(ambos.effect.type).toBe('click');
    // Com `Math.max` o resultado é 2,5× (o maior dos dois). Com soma ou
    // produto seria 4,5× ou 5× — 6,75 s a 7,5 s olhando para um botão de
    // emergência, o que anularia a razão de ele existir.
    expect(ambos.msAteClique!).toBeLessThanOrEqual(soEmergencia.msAteClique! * 1.5);
  });
});
