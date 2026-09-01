import { describe, it, expect } from 'vitest';
import {
  stepDwell,
  createDwellState,
  DEFAULT_DWELL_CONFIG,
  type DwellState,
  type DwellSample,
  type DwellTarget,
  type DwellConfig,
} from './dwell';

const CFG: DwellConfig = { ...DEFAULT_DWELL_CONFIG, dwellMs: 1000 };

const BOTAO: DwellTarget = { key: 'botao', customDwellMs: null, isEmergency: false, isDisabled: false };
const OUTRO: DwellTarget = { key: 'outro', customDwellMs: null, isEmergency: false, isDisabled: false };
const EMERGENCIA: DwellTarget = { key: 'sos', customDwellMs: null, isEmergency: true, isDisabled: false };

function amostra(over: Partial<DwellSample> = {}): DwellSample {
  return {
    x: 100, y: 100, timestamp: 0,
    hasFace: true, degraded: false, uncalibrated: false, eyeState: 'open',
    ...over,
  };
}

/** Alimenta frames a 30 fps e devolve o estado final + se clicou. */
function olharPor(
  ms: number,
  opts: {
    estado?: DwellState;
    alvo?: DwellTarget | null;
    inicio?: number;
    over?: (t: number) => Partial<DwellSample>;
  } = {},
) {
  let estado = opts.estado ?? createDwellState();
  const alvo = opts.alvo === undefined ? BOTAO : opts.alvo;
  const t0 = opts.inicio ?? 0;
  const passo = 1000 / 30;
  let cliques = 0;
  let ultimoPct = 0;
  for (let t = t0; t <= t0 + ms; t += passo) {
    const r = stepDwell(estado, amostra({ timestamp: t, ...(opts.over?.(t) ?? {}) }), alvo, CFG);
    estado = r.state;
    if (r.effect.type === 'click') cliques++;
    if (r.effect.type === 'progress') ultimoPct = r.effect.pct;
  }
  return { estado, cliques, ultimoPct };
}

describe('dwell — C-07: nada é clicável sem calibração', () => {
  it('não clica em botão comum com uncalibrated=true, por mais que se olhe', () => {
    const { cliques } = olharPor(5000, { over: () => ({ uncalibrated: true }) });
    expect(cliques).toBe(0);
  });

  it('não clica NEM no botão de emergência sem calibração', () => {
    const { cliques } = olharPor(5000, {
      alvo: EMERGENCIA,
      over: () => ({ uncalibrated: true }),
    });
    expect(cliques).toBe(0);
  });

  it('reporta o motivo do bloqueio como uncalibrated', () => {
    const r = stepDwell(createDwellState(), amostra({ uncalibrated: true }), BOTAO, CFG);
    expect(r.blockedBy).toBe('uncalibrated');
    expect(r.hoverKey).toBeNull();
  });

  it('volta a funcionar assim que a calibração existe', () => {
    const { cliques } = olharPor(1200);
    expect(cliques).toBe(1);
  });
});

describe('dwell — C-15: olhos fechados nunca completam um dwell', () => {
  it('fechar os olhos 3 s sobre um botão não gera clique ao reabrir', () => {
    // 500 ms de olhar real (metade do dwell), depois 3 s de olhos fechados.
    const parcial = olharPor(500);
    expect(parcial.cliques).toBe(0);

    const fechado = olharPor(3000, {
      estado: parcial.estado,
      inicio: 500,
      over: () => ({ eyeState: 'closed' }),
    });
    expect(fechado.cliques).toBe(0);

    // Ao reabrir, ainda faltam ~500 ms de olhar VÁLIDO. Um único frame não pode
    // completar — que era exatamente o bug do relógio de parede.
    const primeiroFrame = stepDwell(
      fechado.estado,
      amostra({ timestamp: 3500, eyeState: 'open' }),
      BOTAO,
      CFG,
    );
    expect(primeiroFrame.effect.type).not.toBe('click');
  });

  it('piscada PAUSA o progresso, não zera', () => {
    const parcial = olharPor(600);
    const antes = parcial.estado.elapsedMs;
    expect(antes).toBeGreaterThan(500);

    const piscou = stepDwell(
      parcial.estado,
      amostra({ timestamp: 620, eyeState: 'closed' }),
      BOTAO,
      CFG,
    );
    expect(piscou.state.elapsedMs).toBe(antes);
    expect(piscou.blockedBy).toBe('eyes-closed');
    expect(piscou.hoverKey).toBe('botao');
  });

  it('o tempo de olhos fechados não conta para o dwell', () => {
    const parcial = olharPor(500);
    const fechado = olharPor(3000, {
      estado: parcial.estado, inicio: 500, over: () => ({ eyeState: 'closed' }),
    });
    // Progresso preservado, mas nem um ms a mais.
    expect(fechado.estado.elapsedMs).toBeCloseTo(parcial.estado.elapsedMs, 5);
  });

  it('completa normalmente quando o olhar válido soma o dwell inteiro', () => {
    const parcial = olharPor(500);
    const fechado = olharPor(2000, {
      estado: parcial.estado, inicio: 500, over: () => ({ eyeState: 'closed' }),
    });
    const reaberto = olharPor(700, { estado: fechado.estado, inicio: 2600 });
    expect(reaberto.cliques).toBe(1);
  });

  it('rosto perdido por muito tempo zera o progresso', () => {
    const parcial = olharPor(600);
    const perdido = stepDwell(
      parcial.estado,
      amostra({ timestamp: 600 + CFG.lostResetMs + 50, hasFace: false }),
      null,
      CFG,
    );
    expect(perdido.state.elapsedMs).toBe(0);
    expect(perdido.state.targetKey).toBeNull();
  });

  it('uma lacuna curta de rosto apenas pausa', () => {
    const parcial = olharPor(600);
    const lacuna = stepDwell(
      parcial.estado,
      amostra({ timestamp: 610, hasFace: false }),
      null,
      CFG,
    );
    expect(lacuna.state.elapsedMs).toBe(parcial.estado.elapsedMs);
    expect(lacuna.blockedBy).toBe('no-face');
  });

  it('uma aba em segundo plano (salto grande de relógio) não completa o dwell', () => {
    // Um único frame com 60 s de salto: o delta é limitado a lostResetMs.
    const r1 = stepDwell(createDwellState(), amostra({ timestamp: 0 }), BOTAO, CFG);
    const r2 = stepDwell(r1.state, amostra({ timestamp: 60_000 }), BOTAO, CFG);
    expect(r2.effect.type).not.toBe('click');
    expect(r2.state.elapsedMs).toBeLessThanOrEqual(CFG.lostResetMs);
  });
});

describe('dwell — degraded e emergência', () => {
  it('em degraded, botão comum não acumula', () => {
    const { cliques } = olharPor(5000, { over: () => ({ degraded: true }) });
    expect(cliques).toBe(0);
  });

  it('em degraded, emergência continua clicável mas com dwell dobrado', () => {
    const curto = olharPor(1200, { alvo: EMERGENCIA, over: () => ({ degraded: true }) });
    expect(curto.cliques).toBe(0); // 1200 ms < 2000 ms exigidos

    const longo = olharPor(2200, { alvo: EMERGENCIA, over: () => ({ degraded: true }) });
    expect(longo.cliques).toBe(1);
  });

  it('alvo desabilitado nunca acumula', () => {
    const desabilitado: DwellTarget = { ...BOTAO, isDisabled: true };
    const { cliques } = olharPor(5000, { alvo: desabilitado });
    expect(cliques).toBe(0);
  });

  it('data-dwell-ms customizado é respeitado', () => {
    const rapido: DwellTarget = { ...BOTAO, customDwellMs: 300 };
    const { cliques } = olharPor(400, { alvo: rapido });
    expect(cliques).toBe(1);
  });
});

describe('dwell — refratário e troca de alvo', () => {
  it('não re-dispara sob o mesmo olhar dentro do refratário', () => {
    const { cliques } = olharPor(2000);
    expect(cliques).toBe(1);
  });

  it('o refratário é armado no mesmo passo do clique (C-23)', () => {
    const parcial = olharPor(990);
    const r = stepDwell(parcial.estado, amostra({ timestamp: 1000 }), BOTAO, CFG);
    expect(r.effect.type).toBe('click');
    // Mesmo que o chamador exploda ao executar o clique, o estado devolvido
    // já bloqueia o próximo disparo.
    expect(r.state.refractoryUntil).toBe(1000 + CFG.refractoryMs);
    expect(r.state.targetKey).toBeNull();
  });

  it('trocar de alvo zera o progresso do novo', () => {
    const parcial = olharPor(800);
    const trocou = stepDwell(parcial.estado, amostra({ timestamp: 810 }), OUTRO, CFG);
    expect(trocou.state.elapsedMs).toBe(0);
    expect(trocou.state.targetKey).toBe('outro');
  });

  it('sair e voltar dentro da tolerância preserva o progresso', () => {
    const parcial = olharPor(700);
    const saiu = stepDwell(parcial.estado, amostra({ timestamp: 710 }), null, CFG);
    const voltou = stepDwell(saiu.state, amostra({ timestamp: 800 }), BOTAO, CFG);
    expect(voltou.state.elapsedMs).toBeCloseTo(parcial.estado.elapsedMs, 5);
  });

  it('sair por mais que a tolerância descarta o progresso', () => {
    const parcial = olharPor(700);
    const saiu = stepDwell(parcial.estado, amostra({ timestamp: 710 }), null, CFG);
    const voltou = stepDwell(saiu.state, amostra({ timestamp: 710 + CFG.graceMs + 50 }), BOTAO, CFG);
    expect(voltou.state.elapsedMs).toBe(0);
  });

  it('um alvo trocado sob o olhar parado não herda progresso', () => {
    // Cenário real: a UI re-renderiza e substitui o nó sob o cursor.
    const parcial = olharPor(900);
    const substituto: DwellTarget = { key: 'novo-no', customDwellMs: null, isEmergency: false, isDisabled: false };
    const r = stepDwell(parcial.estado, amostra({ timestamp: 910 }), substituto, CFG);
    expect(r.effect.type).not.toBe('click');
    expect(r.state.elapsedMs).toBe(0);
  });
});

describe('dwell — pureza', () => {
  it('não muta o estado recebido', () => {
    const inicial = createDwellState();
    const copia = { ...inicial };
    stepDwell(inicial, amostra(), BOTAO, CFG);
    expect(inicial).toEqual(copia);
  });
});
