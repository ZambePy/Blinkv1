import { describe, it, expect } from 'vitest';
import {
  stepBlinkClick,
  criarEstadoBlinkClick,
  BLINK_CLICK_MIN_MS,
  BLINK_CLICK_MAX_MS,
  BLINK_CLICK_ESTABILIDADE_MS,
  BLINK_CLICK_REFRATARIO_MS,
  type EstadoBlinkClick,
} from './blinkClick';

// -----------------------------------------------------------------------------
// P7.3 — piscada como clique.
//
// A especificação é explícita sobre o risco: *"piscada espontânea é
// involuntária e frequente — exigir que o gaze esteja estável sobre um alvo
// antes de aceitar, e expor um interruptor para desativar por paciente. Para
// ELA, um clique acidental num botão de emergência é um evento sério."*
//
// Por isso a maior parte destes testes é sobre o que NÃO deve virar clique.
// -----------------------------------------------------------------------------

const ALVO = { id: 'botao-a' };
const OUTRO = { id: 'botao-b' };

/**
 * Simula um episódio: olhar estável no alvo por `estavelMs`, depois piscar por
 * `piscadaMs`, depois reabrir.
 */
function episodio(opts: {
  estavelMs: number;
  piscadaMs: number;
  alvo?: unknown;
  emergencia?: boolean;
  estadoInicial?: EstadoBlinkClick;
  t0?: number;
}) {
  let estado = opts.estadoInicial ?? criarEstadoBlinkClick();
  const alvo = opts.alvo ?? ALVO;
  let t = opts.t0 ?? 1000;

  // Fixação estável, sem piscar.
  for (let i = 0; i <= opts.estavelMs; i += 33) {
    estado = stepBlinkClick(estado, {
      piscando: false, nowMs: t + i, alvo, alvoEhEmergencia: !!opts.emergencia,
    }).estado;
  }
  t += opts.estavelMs;

  // Piscada.
  for (let i = 0; i < opts.piscadaMs; i += 33) {
    estado = stepBlinkClick(estado, {
      piscando: true, nowMs: t + i, alvo, alvoEhEmergencia: !!opts.emergencia,
    }).estado;
  }
  t += opts.piscadaMs;

  // Reabre — é aqui que o clique sai, se sair.
  const r = stepBlinkClick(estado, {
    piscando: false, nowMs: t, alvo, alvoEhEmergencia: !!opts.emergencia,
  });
  return { ...r, tFinal: t };
}

describe('os limiares são os da especificação', () => {
  it('150 ms de piscada mínima', () => {
    expect(BLINK_CLICK_MIN_MS).toBe(150);
  });

  it('há um TETO, e ele é maior que o piso', () => {
    // Sem teto, um paciente descansando os olhos por três segundos dispararia
    // um clique ao reabrir.
    expect(BLINK_CLICK_MAX_MS).toBeGreaterThan(BLINK_CLICK_MIN_MS);
    expect(BLINK_CLICK_MAX_MS).toBeLessThanOrEqual(1000);
  });

  it('há período refratário e exigência de estabilidade', () => {
    expect(BLINK_CLICK_ESTABILIDADE_MS).toBeGreaterThan(0);
    expect(BLINK_CLICK_REFRATARIO_MS).toBeGreaterThan(0);
  });
});

describe('o caminho feliz', () => {
  it('olhar estável + piscada de 200 ms = clique', () => {
    const r = episodio({ estavelMs: 500, piscadaMs: 200 });
    expect(r.clicou).toBe(ALVO);
    expect(r.motivoRejeicao).toBeNull();
  });

  it('o clique sai no FIM da piscada, não no começo', () => {
    // Duas razões: só no fim se conhece a DURAÇÃO, que é o critério que separa
    // intenção de reflexo; e disparar no começo tornaria impossível cancelar
    // um gesto acidental.
    let estado = criarEstadoBlinkClick();
    for (let t = 1000; t <= 1500; t += 33) {
      estado = stepBlinkClick(estado, { piscando: false, nowMs: t, alvo: ALVO, alvoEhEmergencia: false }).estado;
    }
    for (let t = 1533; t <= 1733; t += 33) {
      const r = stepBlinkClick(estado, { piscando: true, nowMs: t, alvo: ALVO, alvoEhEmergencia: false });
      expect(r.clicou).toBeNull();   // durante a piscada, nada
      estado = r.estado;
    }
    const fim = stepBlinkClick(estado, { piscando: false, nowMs: 1766, alvo: ALVO, alvoEhEmergencia: false });
    expect(fim.clicou).toBe(ALVO);
  });
});

describe('o que NÃO pode virar clique', () => {
  it('piscada CURTA demais (espontânea) é ignorada', () => {
    // 100 ms é a duração típica de uma piscada involuntária.
    const r = episodio({ estavelMs: 500, piscadaMs: 100 });
    expect(r.clicou).toBeNull();
    expect(r.motivoRejeicao).toBe('curta-demais');
  });

  it('olho FECHADO por muito tempo não vira clique ao reabrir', () => {
    const r = episodio({ estavelMs: 500, piscadaMs: 3000 });
    expect(r.clicou).toBeNull();
    expect(r.motivoRejeicao).toBe('longa-demais');
  });

  it('piscar SEM alvo não faz nada', () => {
    let estado = criarEstadoBlinkClick();
    for (let t = 1000; t <= 1300; t += 33) {
      estado = stepBlinkClick(estado, { piscando: true, nowMs: t, alvo: null, alvoEhEmergencia: false }).estado;
    }
    const r = stepBlinkClick(estado, { piscando: false, nowMs: 1400, alvo: null, alvoEhEmergencia: false });
    expect(r.clicou).toBeNull();
    expect(r.motivoRejeicao).toBe('sem-alvo');
  });

  it('alvo INSTÁVEL (olhar acabou de chegar) não aceita', () => {
    // O cursor passar por cima de um botão a caminho de outro não pode virar
    // clique só porque a pessoa piscou no meio do caminho.
    const r = episodio({ estavelMs: 60, piscadaMs: 200 });
    expect(r.clicou).toBeNull();
    expect(r.motivoRejeicao).toBe('alvo-instavel');
  });

  it('ALVO DE EMERGÊNCIA nunca aceita piscada — e isso não é configurável', () => {
    // O custo de um falso positivo aqui é grande demais. O dwell longo
    // continua sendo o caminho para a emergência.
    const r = episodio({ estavelMs: 1000, piscadaMs: 300, emergencia: true });
    expect(r.clicou).toBeNull();
    expect(r.motivoRejeicao).toBe('alvo-de-emergencia');
  });

  it('rajada de piscadas não vira rajada de cliques', () => {
    // Espasmo ocular ou reflexo em série. Sem o refratário, cada piscada da
    // rajada acionaria um botão.
    let estado = criarEstadoBlinkClick();
    let t = 1000;
    const cliques: unknown[] = [];
    // Estabiliza.
    for (; t <= 1500; t += 33) {
      estado = stepBlinkClick(estado, { piscando: false, nowMs: t, alvo: ALVO, alvoEhEmergencia: false }).estado;
    }
    // Cinco piscadas de 200 ms, separadas por 100 ms.
    for (let n = 0; n < 5; n++) {
      for (let i = 0; i < 200; i += 33) {
        estado = stepBlinkClick(estado, { piscando: true, nowMs: t + i, alvo: ALVO, alvoEhEmergencia: false }).estado;
      }
      t += 200;
      const r = stepBlinkClick(estado, { piscando: false, nowMs: t, alvo: ALVO, alvoEhEmergencia: false });
      estado = r.estado;
      if (r.clicou) cliques.push(r.clicou);
      t += 100;
    }
    // Cinco piscadas em 1,5 s, com refratário de 1 s: no máximo 2 podem
    // passar. O ponto não é "exatamente um" — é que a rajada NÃO vira um
    // clique por piscada, e que os cliques que passam respeitam o refratário.
    expect(cliques.length).toBeLessThan(5);
    expect(cliques.length).toBeLessThanOrEqual(2);
  });

  it('cliques consecutivos respeitam o refratário', () => {
    let estado = criarEstadoBlinkClick();
    let t = 1000;
    const instantes: number[] = [];
    for (; t <= 1500; t += 33) {
      estado = stepBlinkClick(estado, { piscando: false, nowMs: t, alvo: ALVO, alvoEhEmergencia: false }).estado;
    }
    for (let n = 0; n < 12; n++) {
      for (let i = 0; i < 200; i += 33) {
        estado = stepBlinkClick(estado, { piscando: true, nowMs: t + i, alvo: ALVO, alvoEhEmergencia: false }).estado;
      }
      t += 200;
      const r = stepBlinkClick(estado, { piscando: false, nowMs: t, alvo: ALVO, alvoEhEmergencia: false });
      estado = r.estado;
      if (r.clicou) instantes.push(t);
      t += 100;
    }
    expect(instantes.length).toBeGreaterThan(1);
    for (let i = 1; i < instantes.length; i++) {
      expect(instantes[i] - instantes[i - 1]).toBeGreaterThanOrEqual(BLINK_CLICK_REFRATARIO_MS);
    }
  });

  it('trocar de alvo REINICIA o relógio de estabilidade', () => {
    let estado = criarEstadoBlinkClick();
    let t = 1000;
    for (; t <= 1500; t += 33) {
      estado = stepBlinkClick(estado, { piscando: false, nowMs: t, alvo: ALVO, alvoEhEmergencia: false }).estado;
    }
    // Muda para outro alvo e pisca logo em seguida.
    estado = stepBlinkClick(estado, { piscando: false, nowMs: t, alvo: OUTRO, alvoEhEmergencia: false }).estado;
    for (let i = 0; i < 200; i += 33) {
      estado = stepBlinkClick(estado, { piscando: true, nowMs: t + i, alvo: OUTRO, alvoEhEmergencia: false }).estado;
    }
    const r = stepBlinkClick(estado, { piscando: false, nowMs: t + 233, alvo: OUTRO, alvoEhEmergencia: false });
    expect(r.clicou).toBeNull();
    expect(r.motivoRejeicao).toBe('alvo-instavel');
  });
});

describe('a guarda que quase não funciona', () => {
  it('a estabilidade do alvo SOBREVIVE à piscada', () => {
    // Sutil e decisivo: com o olho fechado não há gaze, então o `alvo` chega
    // `null` durante a piscada. Se o relógio de estabilidade zerasse aí,
    // NENHUMA piscada jamais passaria — a guarda mataria a funcionalidade
    // inteira em vez de protegê-la.
    let estado = criarEstadoBlinkClick();
    let t = 1000;
    for (; t <= 1500; t += 33) {
      estado = stepBlinkClick(estado, { piscando: false, nowMs: t, alvo: ALVO, alvoEhEmergencia: false }).estado;
    }
    // Pisca, e durante a piscada o alvo chega null (não há gaze).
    for (let i = 0; i < 200; i += 33) {
      estado = stepBlinkClick(estado, { piscando: true, nowMs: t + i, alvo: null, alvoEhEmergencia: false }).estado;
    }
    const r = stepBlinkClick(estado, { piscando: false, nowMs: t + 233, alvo: ALVO, alvoEhEmergencia: false });
    expect(r.clicou).toBe(ALVO);
  });
});

describe('o motivo da rejeição é observável', () => {
  it('cada rejeição diz POR QUE', () => {
    // Sem isso, "a piscada não funcionou" é indistinguível de "a piscada não
    // foi detectada", e o cuidador não tem como ajudar o paciente a acertar
    // o gesto.
    const motivos = [
      episodio({ estavelMs: 500, piscadaMs: 100 }).motivoRejeicao,
      episodio({ estavelMs: 500, piscadaMs: 3000 }).motivoRejeicao,
      episodio({ estavelMs: 60, piscadaMs: 200 }).motivoRejeicao,
      episodio({ estavelMs: 1000, piscadaMs: 300, emergencia: true }).motivoRejeicao,
    ];
    expect(motivos).toEqual(['curta-demais', 'longa-demais', 'alvo-instavel', 'alvo-de-emergencia']);
  });

  it('sem piscada terminando, não há motivo — é null, não uma string', () => {
    const r = stepBlinkClick(criarEstadoBlinkClick(), {
      piscando: false, nowMs: 1000, alvo: ALVO, alvoEhEmergencia: false,
    });
    expect(r.motivoRejeicao).toBeNull();
  });
});

describe('pureza', () => {
  it('não modifica o estado recebido', () => {
    const estado = criarEstadoBlinkClick();
    const copia = { ...estado };
    stepBlinkClick(estado, { piscando: true, nowMs: 1000, alvo: ALVO, alvoEhEmergencia: false });
    expect(estado).toEqual(copia);
  });

  it('é determinístico', () => {
    const a = episodio({ estavelMs: 500, piscadaMs: 200 });
    const b = episodio({ estavelMs: 500, piscadaMs: 200 });
    expect(a.clicou).toBe(b.clicou);
    expect(a.estado).toEqual(b.estado);
  });
});
