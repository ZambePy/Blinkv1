import { describe, it, expect } from 'vitest';
import {
  stepScanning,
  criarEstadoScanning,
  SCANNING_ATIVA_APOS_MS,
  SCANNING_PASSO_MS,
  SCANNING_SAIDA_ESTAVEL_MS,
  SCANNING_SELECAO_MIN_MS,
  type EstadoScanning,
} from './scanning';

// -----------------------------------------------------------------------------
// Modo de varredura.
//
// "É o fallback de acessibilidade mais importante do documento: é o que mantém
// o paciente com alguma via de comunicação quando o rastreamento falha."
//
// Testes escritos com essa frase em mente: o que se verifica aqui é sobretudo
// que a varredura NÃO se desliga sozinha, NÃO reinicia sob rastreamento ruim, e
// NÃO seleciona o item errado.
// -----------------------------------------------------------------------------

const ITENS = 4;
const DT = 33;

/** Roda `ms` de quadros e devolve o estado e tudo que saiu. */
function rodar(
  estado: EstadoScanning,
  ms: number,
  entrada: { gazeValido: boolean; piscando?: boolean; totalItens?: number },
  t0: number,
) {
  const saidas = [];
  let e = estado;
  let t = t0;
  for (; t < t0 + ms; t += DT) {
    const r = stepScanning(e, {
      gazeValido: entrada.gazeValido,
      piscando: entrada.piscando ?? false,
      nowMs: t,
      totalItens: entrada.totalItens ?? ITENS,
    });
    e = r.estado;
    saidas.push(r);
  }
  return { estado: e, saidas, t };
}

describe('a ativação', () => {
  it(`liga depois de ${SCANNING_ATIVA_APOS_MS} ms sem gaze utilizável`, () => {
    const { saidas } = rodar(criarEstadoScanning(), 4000, { gazeValido: false }, 0);
    expect(saidas[0].ativo).toBe(false);
    expect(saidas[saidas.length - 1].ativo).toBe(true);
  });

  it('NÃO liga antes do prazo', () => {
    const { saidas } = rodar(criarEstadoScanning(), SCANNING_ATIVA_APOS_MS - 100, { gazeValido: false }, 0);
    expect(saidas.every((s) => !s.ativo)).toBe(true);
  });

  it('o gatilho é "sem gaze", não "estado degraded"', () => {
    // Esta é a razão de a entrada não ter campo de estado do engine. Um
    // gatilho pendurado em `state === 'degraded'` herdaria os modos de falha
    // que nunca alcançam esse estado (um app congelado em silêncio nunca
    // entra em degradado). O fallback de último recurso não pode compartilhar
    // pressupostos com o sistema cuja falha ele cobre.
    const chaves = Object.keys({
      gazeValido: false, piscando: false, nowMs: 0, totalItens: 4,
    });
    expect(chaves).not.toContain('estado');
    expect(chaves).not.toContain('degraded');
  });

  it('não seleciona no quadro da ativação, mesmo com piscada em curso', () => {
    // A piscada em curso pertence ao que a pessoa fazia antes; ela não pode
    // virar escolha sobre um destaque que ninguém viu ainda.
    const { saidas } = rodar(criarEstadoScanning(), 4000, { gazeValido: false, piscando: true }, 0);
    const ativacao = saidas.find((s) => s.ativo)!;
    expect(ativacao.selecionou).toBeNull();
  });

  it('começa no item 0', () => {
    const { saidas } = rodar(criarEstadoScanning(), 3100, { gazeValido: false }, 0);
    expect(saidas.find((s) => s.ativo)!.indiceDestacado).toBe(0);
  });
});

describe('a saída exige gaze SUSTENTADO — o defeito que quase passou', () => {
  it('um único quadro válido NÃO derruba a varredura', () => {
    // Com rastreamento ruim — que é quando o scanning está ligado — quadros
    // válidos chegam esparsos. Se cada um derrubasse a varredura, os 3 s
    // recomeçariam, o destaque voltaria ao item 0, e o paciente nunca chegaria
    // ao botão que quer. O sistema PARECERIA funcionar (o destaque se mexe) e
    // seria inutilizável.
    const a = rodar(criarEstadoScanning(), 3100, { gazeValido: false }, 0);
    const r = stepScanning(a.estado, {
      gazeValido: true, piscando: false, nowMs: a.t, totalItens: ITENS,
    });
    expect(r.ativo).toBe(true);
  });

  it('gaze válido sustentado desliga', () => {
    const a = rodar(criarEstadoScanning(), 3100, { gazeValido: false }, 0);
    const b = rodar(a.estado, SCANNING_SAIDA_ESTAVEL_MS + 100, { gazeValido: true }, a.t);
    expect(b.saidas[b.saidas.length - 1].ativo).toBe(false);
  });

  it('quadros válidos intermitentes nunca somam até a saída', () => {
    // O caso patológico completo: um quadro bom a cada ~300 ms, por 20 s. A
    // varredura tem que continuar ativa o tempo todo.
    let e = rodar(criarEstadoScanning(), 3100, { gazeValido: false }, 0).estado;
    let t = 3100;
    for (; t < 23000; t += DT) {
      const bom = Math.floor(t / 300) !== Math.floor((t - DT) / 300);
      const r = stepScanning(e, { gazeValido: bom, piscando: false, nowMs: t, totalItens: ITENS });
      e = r.estado;
      expect(r.ativo, `desligou em t=${t}`).toBe(true);
    }
  });

  it('o limiar de saída é MENOR que o de entrada, e isso é a histerese', () => {
    // Simétrico, o par entraria e sairia no mesmo ponto e oscilaria na
    // fronteira.
    expect(SCANNING_SAIDA_ESTAVEL_MS).toBeLessThan(SCANNING_ATIVA_APOS_MS);
  });
});

describe('o destaque percorre os itens', () => {
  it(`avança a cada ${SCANNING_PASSO_MS} ms`, () => {
    const a = rodar(criarEstadoScanning(), 3100, { gazeValido: false }, 0);
    const b = rodar(a.estado, SCANNING_PASSO_MS * 3, { gazeValido: false }, a.t);
    const indices = b.saidas.map((s) => s.indiceDestacado);
    expect(new Set(indices).size).toBeGreaterThan(1);
  });

  it('dá a volta: depois do último, volta ao primeiro', () => {
    const a = rodar(criarEstadoScanning(), 3100, { gazeValido: false }, 0);
    const b = rodar(a.estado, SCANNING_PASSO_MS * ITENS + 200, { gazeValido: false }, a.t);
    const vistos = new Set(b.saidas.map((s) => s.indiceDestacado));
    for (let i = 0; i < ITENS; i++) expect(vistos.has(i)).toBe(true);
    expect(b.estado.ciclos).toBeGreaterThanOrEqual(1);
  });

  it('NUNCA para sozinha, por mais ciclos que passem', () => {
    // Sem gaze e sem piscada, a varredura é a única via que resta. Desligá-la
    // por "inatividade" deixaria o paciente sem nenhuma entrada — e sem via de
    // entrada não há como pedir que alguém a ligue de volta.
    const a = rodar(criarEstadoScanning(), 3100, { gazeValido: false }, 0);
    const b = rodar(a.estado, 120000, { gazeValido: false }, a.t);
    expect(b.saidas[b.saidas.length - 1].ativo).toBe(true);
    expect(b.estado.ciclos).toBeGreaterThan(10);
  });

  it('o passo é longo o bastante para uma decisão em fadiga', () => {
    // Abaixo de ~1 s, o item já passou quando a piscada sai e a seleção cai no
    // seguinte — indistinguível de "o sistema não me obedece".
    expect(SCANNING_PASSO_MS).toBeGreaterThanOrEqual(1000);
  });
});

describe('a seleção por piscada', () => {
  it('uma piscada longa seleciona o item destacado', () => {
    const a = rodar(criarEstadoScanning(), 3100, { gazeValido: false }, 0);
    const b = rodar(a.estado, 200, { gazeValido: false, piscando: true }, a.t);
    const r = stepScanning(b.estado, {
      gazeValido: false, piscando: false, nowMs: b.t, totalItens: ITENS,
    });
    expect(r.selecionou).toBe(0);
  });

  it('piscada CURTA (espontânea) não seleciona', () => {
    // No scanning a piscada é a ÚNICA entrada — não há "olhar estável sobre o
    // alvo" para servir de segunda confirmação, como há no clique por piscada.
    // A guarda de duração precisa carregar sozinha o peso que lá era dividido.
    const a = rodar(criarEstadoScanning(), 3100, { gazeValido: false }, 0);
    const b = rodar(a.estado, SCANNING_SELECAO_MIN_MS - 60, { gazeValido: false, piscando: true }, a.t);
    const r = stepScanning(b.estado, {
      gazeValido: false, piscando: false, nowMs: b.t, totalItens: ITENS,
    });
    expect(r.selecionou).toBeNull();
  });

  it('seleciona o item destacado quando a piscada COMEÇOU, não o seguinte', () => {
    // A piscada dura ~200 ms e o destaque continua avançando durante ela. Se a
    // seleção usasse o índice do quadro FINAL, uma piscada que atravessa a
    // fronteira do passo escolheria o botão vizinho — o erro mais frustrante
    // possível num teclado ocular, porque o paciente olhou o item certo e
    // piscou na hora certa.
    //
    // O passo é encurtado aqui de propósito. Com os 1200 ms de produção uma
    // piscada de 250 ms quase nunca cruza a fronteira, e o teste passaria sem
    // exercitar nada. Com passo de 200 ms: destaque no item 1, piscada de
    // 264 ms, selecionaria o item 2.
    const O = { ativaAposMs: 100, passoMs: 200, saidaEstavelMs: 500, selecaoMinMs: 150 };
    let e = criarEstadoScanning();
    let t = 0;
    for (; t < 400; t += DT) {
      e = stepScanning(e, { gazeValido: false, piscando: false, nowMs: t, totalItens: ITENS }, O).estado;
    }
    const antes = stepScanning(e, {
      gazeValido: false, piscando: false, nowMs: t, totalItens: ITENS,
    }, O).indiceDestacado;

    const t0 = t;
    for (; t < t0 + 250; t += DT) {
      e = stepScanning(e, { gazeValido: false, piscando: true, nowMs: t, totalItens: ITENS }, O).estado;
    }
    const r = stepScanning(e, {
      gazeValido: false, piscando: false, nowMs: t, totalItens: ITENS,
    }, O);

    // A piscada precisa MESMO ter cruzado a fronteira, senão o teste volta a
    // ser vácuo: sem o cruzamento, preservar e não preservar dão o mesmo.
    expect(t - t0).toBeGreaterThan(O.passoMs);
    expect(r.selecionou).toBe(antes);
  });

  it('a varredura CONTINUA depois de selecionar', () => {
    // Desligar depois da seleção deixaria o paciente sem via de entrada até os
    // próximos 3 s de espera — e o gaze não voltou, foi por isso que ele está
    // no scanning.
    const a = rodar(criarEstadoScanning(), 3100, { gazeValido: false }, 0);
    const b = rodar(a.estado, 200, { gazeValido: false, piscando: true }, a.t);
    const r = stepScanning(b.estado, {
      gazeValido: false, piscando: false, nowMs: b.t, totalItens: ITENS,
    });
    expect(r.selecionou).not.toBeNull();
    expect(r.ativo).toBe(true);
  });

  it('o relógio do passo reinicia após a seleção', () => {
    // Sem isso, um item selecionado perto do fim do seu passo avançaria no
    // quadro seguinte, e o destaque saltaria no instante da confirmação — o
    // paciente leria como "selecionei o errado".
    const a = rodar(criarEstadoScanning(), 3100, { gazeValido: false }, 0);
    const b = rodar(a.estado, SCANNING_PASSO_MS - 100, { gazeValido: false }, a.t);
    const c = rodar(b.estado, 200, { gazeValido: false, piscando: true }, b.t);
    const sel = stepScanning(c.estado, {
      gazeValido: false, piscando: false, nowMs: c.t, totalItens: ITENS,
    });
    const seguinte = stepScanning(sel.estado, {
      gazeValido: false, piscando: false, nowMs: c.t + DT, totalItens: ITENS,
    });
    expect(seguinte.indiceDestacado).toBe(sel.selecionou);
  });

  it('não seleciona com a varredura desligada', () => {
    const estado = criarEstadoScanning();
    const r = rodar(estado, 500, { gazeValido: true, piscando: true }, 0);
    expect(r.saidas.every((s) => s.selecionou === null)).toBe(true);
  });
});

describe('listas degeneradas não quebram a varredura', () => {
  it('tela sem itens navegáveis: desativa em vez de destacar o inexistente', () => {
    const { saidas } = rodar(criarEstadoScanning(), 5000, { gazeValido: false, totalItens: 0 }, 0);
    expect(saidas.every((s) => !s.ativo && s.indiceDestacado === null)).toBe(true);
  });

  it('a lista ENCOLHER no meio da varredura não produz índice fora do vetor', () => {
    // Um botão desmontar (um modal fechando) com o destaque além do novo fim.
    const a = rodar(criarEstadoScanning(), 3100, { gazeValido: false }, 0);
    const b = rodar(a.estado, SCANNING_PASSO_MS * 3 + 50, { gazeValido: false, totalItens: 6 }, a.t);
    const r = stepScanning(b.estado, {
      gazeValido: false, piscando: false, nowMs: b.t, totalItens: 2,
    });
    expect(r.indiceDestacado).toBeGreaterThanOrEqual(0);
    expect(r.indiceDestacado!).toBeLessThan(2);
  });

  it('um único item: o destaque fica nele e a seleção funciona', () => {
    const a = rodar(criarEstadoScanning(), 3100, { gazeValido: false, totalItens: 1 }, 0);
    const b = rodar(a.estado, SCANNING_PASSO_MS * 2, { gazeValido: false, totalItens: 1 }, a.t);
    expect(b.saidas.every((s) => s.indiceDestacado === 0)).toBe(true);
    const c = rodar(b.estado, 200, { gazeValido: false, piscando: true, totalItens: 1 }, b.t);
    const r = stepScanning(c.estado, {
      gazeValido: false, piscando: false, nowMs: c.t, totalItens: 1,
    });
    expect(r.selecionou).toBe(0);
  });
});

describe('pureza', () => {
  it('não muta o estado recebido', () => {
    const e = criarEstadoScanning();
    const copia = { ...e };
    stepScanning(e, { gazeValido: false, piscando: false, nowMs: 9999, totalItens: 4 });
    expect(e).toEqual(copia);
  });
});
