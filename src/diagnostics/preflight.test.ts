import { describe, it, expect } from 'vitest';
import { preflight, podeComecar, type EntradaPreflight } from './preflight';

// -----------------------------------------------------------------------------
// A verificação pré-sessão.
//
// O que se testa aqui é sobretudo a SEVERIDADE atribuída a cada situação —
// porque é ela que decide se o operador começa ou não. Um `atencao` onde
// deveria haver `bloqueio` custa a sessão inteira; o contrário treina o
// operador a ignorar a lista.
// -----------------------------------------------------------------------------

const BOM: EntradaPreflight = {
  estadoEngine: 'tracking',
  calibrado: true,
  telaPolegadas: 23.6,
  origemGeometria: 'manual',
  distanciaCm: 60,
  viewportPx: { w: 1920, h: 1080 },
  telaPx: { w: 1920, h: 1080 },
  taxaAtualizacaoHz: 60,
  l2cs: { status: 'ready', executionProvider: 'webgpu', stalePct: 0, pendingCount: 0 },
  filtro: { pedido: 'oneEuro', efetivo: 'oneEuro', degradado: false },
  flags: { filterMode: 'oneEuro', l2csInputSize: 448 },
};

const com = (p: Partial<EntradaPreflight>): EntradaPreflight => ({ ...BOM, ...p });
const nivelDe = (e: EntradaPreflight, item: string) =>
  preflight(e).find((i) => i.item === item)?.nivel;

describe('a sessão boa passa inteira', () => {
  it('nenhum bloqueio, nenhuma atenção', () => {
    const itens = preflight(BOM);
    expect(podeComecar(itens)).toBe(true);
    expect(itens.filter((i) => i.nivel !== 'ok')).toEqual([]);
  });
});

describe('o que BLOQUEIA — dado que iria para o lixo', () => {
  it('sem calibração', () => {
    // Sem modelo a predição é o fallback do nariz; medir isso não mede nada.
    expect(nivelDe(com({ calibrado: false }), 'calibração')).toBe('bloqueio');
  });

  it('L2CS não pronto', () => {
    // É literalmente o critério de descarte de sessão que o `F8.1` declara.
    expect(nivelDe(com({
      l2cs: { ...BOM.l2cs, status: 'error' },
    }), 'L2CS')).toBe('bloqueio');
  });

  it('staleness alto — o modelo rodando com 4 das 6 dimensões', () => {
    // O achado do `P5.5`: com as leituras obsoletas, `buildL2CSBlock` zera o
    // bloco angular todo quadro e nada na interface diz isso. A sessão parece
    // normal e mede um modelo que não é o que se pensa estar medindo.
    expect(nivelDe(com({
      l2cs: { ...BOM.l2cs, stalePct: 100 },
    }), 'L2CS')).toBe('bloqueio');
  });

  it('janela não maximizada', () => {
    // O erro é medido em px de VIEWPORT. Rodadas com viewports diferentes não
    // são comparáveis entre si, e a diferença não aparece em lugar nenhum do
    // relatório como causa.
    expect(nivelDe(com({ viewportPx: { w: 1280, h: 720 } }), 'viewport')).toBe('bloqueio');
  });

  it('cadeia de filtragem degradada', () => {
    // `kalmanEma` sem geometria vira `kalman` puro. Medir assim atribuiria o
    // resultado a uma cadeia que nunca rodou.
    expect(nivelDe(com({
      filtro: { pedido: 'kalmanEma', efetivo: 'kalman', degradado: true },
    }), 'filtro')).toBe('bloqueio');
  });

  it('geometria inválida', () => {
    expect(nivelDe(com({ telaPolegadas: 0 }), 'geometria')).toBe('bloqueio');
    expect(nivelDe(com({ distanciaCm: 0 }), 'geometria')).toBe('bloqueio');
  });

  it('as flags ativas não são as da condição pretendida', () => {
    // O erro mais provável do dia inteiro: `__irisflowExp.set` só vale depois
    // do RELOAD. Sem esta conferência, esquecer de recarregar roda a condição
    // ANTERIOR sob o rótulo da nova — dado perfeito, atribuído ao errado.
    const itens = preflight(com({
      flags: { filterMode: 'oneEuro', l2csInputSize: 448 },
      condicaoEsperada: { filterMode: 'kalmanEma' },
    }));
    const c = itens.find((i) => i.item === 'condição')!;
    expect(c.nivel).toBe('bloqueio');
    expect(c.detalhe).toContain('filterMode');
    expect(c.acao).toContain('RECARREGAR');
  });

  it('a condição CONFERE quando bate', () => {
    expect(nivelDe(com({
      flags: { filterMode: 'kalmanEma', l2csInputSize: 224 },
      condicaoEsperada: { filterMode: 'kalmanEma', l2csInputSize: 224 },
    }), 'condição')).toBe('ok');
  });

  it('sem condição esperada, o item nem aparece', () => {
    // Não inventa veredito sobre o que não foi declarado.
    expect(preflight(BOM).find((i) => i.item === 'condição')).toBeUndefined();
  });
});

describe('o que só chama ATENÇÃO — a sessão continua válida', () => {
  it('geometria no default: o valor pode estar certo, a procedência não fica gravada', () => {
    // Não é bloqueio de propósito. O default de 23,6" está correto em algumas
    // telas; o que se perde é a capacidade de separar, depois do dia, as
    // sessões em que alguém mediu das em que ninguém mediu.
    expect(nivelDe(com({ origemGeometria: 'default' }), 'geometria')).toBe('atencao');
    expect(podeComecar(preflight(com({ origemGeometria: 'default' })))).toBe(true);
  });

  it('e a ação avisa que OLHAR o campo não basta', () => {
    // Armadilha real: o campo já exibe o default. O `onChange` do input só
    // dispara se o valor MUDAR, então conferir visualmente e seguir em frente
    // deixa a procedência em 'default' — e quem fez isso jura ter conferido.
    //
    // Uma instrução que falha em silêncio é pior que nenhuma: ela produz a
    // sensação de que o item foi resolvido.
    const item = preflight(com({ origemGeometria: 'default' }))
      .find((i) => i.item === 'geometria')!;
    expect(item.acao).toMatch(/REDIGITE|redigite/);
  });

  it('taxa de atualização alta', () => {
    const itens = preflight(com({ taxaAtualizacaoHz: 180 }));
    const t = itens.find((i) => i.item === 'taxa de atualização')!;
    expect(t.nivel).toBe('atencao');
    // A mensagem precisa dar o NÚMERO, não só o adjetivo: "6× por quadro" é
    // acionável, "alta" não é.
    expect(t.detalhe).toMatch(/6× por quadro/);
    expect(t.detalhe).toMatch(/83%/);
    expect(podeComecar(itens)).toBe(true);
  });

  it('60 Hz passa sem ressalva', () => {
    expect(nivelDe(com({ taxaAtualizacaoHz: 60 }), 'taxa de atualização')).toBe('ok');
  });

  it('fila do L2CS com pendência', () => {
    // Evidência direta do deadlock de submissão. Uma pendência isolada é
    // normal (é uma inferência em voo); presa é que é o problema — e o
    // operador é quem consegue ver se ela volta a zero.
    const itens = preflight(com({ l2cs: { ...BOM.l2cs, pendingCount: 1 } }));
    expect(itens.find((i) => i.item === 'L2CS · fila')!.nivel).toBe('atencao');
    expect(podeComecar(itens)).toBe(true);
  });

  it('fila vazia não gera item nenhum', () => {
    expect(preflight(BOM).find((i) => i.item === 'L2CS · fila')).toBeUndefined();
  });
});

describe('toda mensagem é acionável', () => {
  it('todo item não-ok diz o que FAZER', () => {
    // Uma verificação que aponta o problema sem dizer a saída transfere o
    // trabalho para quem está com o paciente esperando.
    const ruim = com({
      calibrado: false,
      origemGeometria: 'default',
      viewportPx: { w: 800, h: 600 },
      taxaAtualizacaoHz: 180,
      l2cs: { status: 'error', executionProvider: null, stalePct: 100, pendingCount: 3 },
      filtro: { pedido: 'kalmanEma', efetivo: 'kalman', degradado: true },
    });
    for (const i of preflight(ruim)) {
      if (i.nivel === 'ok') continue;
      expect(i.acao, `'${i.item}' não diz o que fazer`).toBeTruthy();
      expect(i.acao!.length).toBeGreaterThan(20);
    }
  });

  it('`taxa de atualização` não medida avisa sem bloquear', () => {
    expect(nivelDe(com({ taxaAtualizacaoHz: null }), 'taxa de atualização')).toBe('atencao');
    expect(podeComecar(preflight(com({ taxaAtualizacaoHz: null })))).toBe(true);
  });
});

describe('podeComecar', () => {
  it('atenção não impede; bloqueio impede', () => {
    expect(podeComecar(preflight(com({ origemGeometria: 'default' })))).toBe(true);
    expect(podeComecar(preflight(com({ calibrado: false })))).toBe(false);
  });
});
