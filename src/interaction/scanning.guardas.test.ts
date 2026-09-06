import { describe, it, expect } from 'vitest';
import {
  stepScanning,
  criarEstadoScanning,
  SCANNING_SELECAO_MIN_MS,
  SCANNING_SELECAO_MAX_MS,
} from './scanning';
import { BLINK_CLICK_MAX_MS } from './blinkClick';

// -----------------------------------------------------------------------------
// Guardas da varredura: as mesmas guardas inegociáveis do clique por piscada
// (emergência, calibração, duração máxima) precisam valer também aqui — a
// varredura não é só "o dwell, mas por relógio".
// -----------------------------------------------------------------------------

const ITENS = 4;
const DT = 33;

/** Ativa a varredura e devolve o estado logo depois. */
function ativada(t0 = 0) {
  let e = criarEstadoScanning();
  let t = t0;
  for (; t < t0 + 3100; t += DT) {
    e = stepScanning(e, {
      gazeValido: false, piscando: false, nowMs: t, totalItens: ITENS,
    }).estado;
  }
  return { estado: e, t };
}

/** Pisca por `ms` e devolve o resultado do quadro em que o olho reabre. */
function piscarPor(estado: ReturnType<typeof ativada>['estado'], t0: number, ms: number) {
  let e = estado;
  let t = t0;
  for (; t < t0 + ms; t += DT) {
    e = stepScanning(e, {
      gazeValido: false, piscando: true, nowMs: t, totalItens: ITENS,
    }).estado;
  }
  return stepScanning(e, {
    gazeValido: false, piscando: false, nowMs: t, totalItens: ITENS,
  });
}

describe('olho fechado prolongado NÃO seleciona', () => {
  it('existe um teto de duração, e ele bate com o do blinkClick', () => {
    expect(SCANNING_SELECAO_MAX_MS).toBe(BLINK_CLICK_MAX_MS);
    expect(SCANNING_SELECAO_MAX_MS).toBeGreaterThan(SCANNING_SELECAO_MIN_MS);
  });

  it('10 s de olho fechado não selecionam nada ao reabrir', () => {
    // Este é o caso mais provável de todos, e o mais danoso.
    //
    // A varredura LIGA depois de 3 s sem gaze utilizável — e uma das causas
    // mais comuns disso é o paciente estar com os olhos fechados, descansando.
    // Sem teto, ele reabre depois de 10 s e seleciona o item que estava
    // destacado quando fechou: dez segundos e vários ciclos atrás.
    //
    // O item escolhido é, para todos os efeitos, aleatório. Num teclado ocular
    // isso escreve uma letra que ninguém quis — e acontece justamente na
    // fadiga, que é a condição do público-alvo.
    const a = ativada();
    expect(piscarPor(a.estado, a.t, 10000).selecionou).toBeNull();
  });

  it('uma piscada dentro da faixa continua selecionando', () => {
    // O teto não pode ter matado a funcionalidade — o modo de falha típico
    // de uma guarda de estabilidade apertada demais.
    const a = ativada();
    expect(piscarPor(a.estado, a.t, 300).selecionou).not.toBeNull();
  });

  it('a fronteira é a DURAÇÃO REAL, não a pedida', () => {
    // Com passo de 33 ms, pedir 800 ms de piscada produz um episódio de 825 ms
    // — o quadro de reabertura cai depois do teto. A primeira versão deste
    // teste supunha que a duração fosse a pedida e falhou por isso; o código
    // estava certo.
    //
    // Testar a fronteira exige controlar o instante da reabertura, não o
    // número de quadros.
    const a = ativada();
    let e = a.estado;
    for (let t = a.t; t < a.t + SCANNING_SELECAO_MAX_MS; t += DT) {
      e = stepScanning(e, {
        gazeValido: false, piscando: true, nowMs: t, totalItens: ITENS,
      }).estado;
    }
    // Reabre EXATAMENTE no teto.
    const noTeto = stepScanning(e, {
      gazeValido: false, piscando: false,
      nowMs: a.t + SCANNING_SELECAO_MAX_MS, totalItens: ITENS,
    });
    expect(noTeto.selecionou).not.toBeNull();

    // E um milissegundo além dele.
    const b = ativada();
    let e2 = b.estado;
    for (let t = b.t; t < b.t + SCANNING_SELECAO_MAX_MS; t += DT) {
      e2 = stepScanning(e2, {
        gazeValido: false, piscando: true, nowMs: t, totalItens: ITENS,
      }).estado;
    }
    const alemDoTeto = stepScanning(e2, {
      gazeValido: false, piscando: false,
      nowMs: b.t + SCANNING_SELECAO_MAX_MS + 1, totalItens: ITENS,
    });
    expect(alemDoTeto.selecionou).toBeNull();
  });
});
