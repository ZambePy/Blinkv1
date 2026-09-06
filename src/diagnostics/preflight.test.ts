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
  fpsRender: 29,
  videoPx: { w: 1920, h: 1080 },
  l2cs: { status: 'ready', executionProvider: 'webgpu', stalePct: 0, pendingCount: 0, hz: 7 },
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
    // É o critério de descarte de sessão do protocolo de medição.
    expect(nivelDe(com({
      l2cs: { ...BOM.l2cs, status: 'error' },
    }), 'L2CS')).toBe('bloqueio');
  });

  it('staleness alto — o modelo rodando com 4 das 6 dimensões', () => {
    // Com as leituras obsoletas, `buildL2CSBlock` zera o bloco angular todo
    // quadro e nada na interface diz isso. A sessão parece normal e mede um
    // modelo que não é o que se pensa estar medindo.
    expect(nivelDe(com({
      l2cs: { ...BOM.l2cs, stalePct: 100 },
    }), 'L2CS')).toBe('bloqueio');
  });

  it('janela MAXIMIZADA passa — a barra do navegador come altura legitimamente', () => {
    // ~1920×950 é o que um Chrome maximizado entrega num monitor 1080p (88%
    // de altura). Bloquear isso obrigaria a F11, e F11 com o DevTools em
    // janela separada é inviável: o Chrome derruba o fullscreen ao perder
    // foco. O que a medição exige é o MESMO viewport em todas as rodadas, e
    // uma janela maximizada garante isso tão bem quanto fullscreen.
    expect(nivelDe(com({ viewportPx: { w: 1920, h: 950 } }), 'viewport')).toBe('ok');
  });

  it('o detalhe do viewport aparece MESMO quando está ok', () => {
    // Ele precisa ser anotado e conferido igual entre condições — não é
    // informação só de erro.
    const d = preflight(com({ viewportPx: { w: 1920, h: 950 } }))
      .find((i) => i.item === 'viewport')!.detalhe;
    expect(d).toContain('1920');
    expect(d).toContain('950');
  });

  it('perder LARGURA bloqueia — o navegador não consome largura', () => {
    // Caso real: DevTools ancorado à direita deixou 1001 px de 1920 —
    // exatamente os 919 px do painel.
    const i = preflight(com({ viewportPx: { w: 1001, h: 1080 } }))
      .find((x) => x.item === 'viewport')!;
    expect(i.nivel).toBe('bloqueio');
    expect(i.acao).toContain('LARGURA');
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

  it('taxa baixa NÃO bloqueia — quem cobre esse caso é o `fps`', () => {
    // Houve um piso de 45 Hz aqui, e ele estava errado: o rAF é amostrado com
    // o pipeline rodando, então mede `min(monitor, thread principal)`. Com o
    // thread em 42,3 ms, o rAF não passa de ~24 Hz nesta máquina — o piso
    // bloquearia toda sessão, para sempre.
    //
    // O sintoma que ele tentava pegar já é coberto: taxa baixa e fps baixo são
    // a mesma causa vista por duas lentes, e dois bloqueios para uma causa só
    // viram ruído.
    expect(nivelDe(com({ taxaAtualizacaoHz: 20 }), 'taxa de atualização')).toBe('ok');
    expect(podeComecar(preflight(com({ taxaAtualizacaoHz: 20 })))).toBe(true);
    // Mas com o fps junto no chão, o `fps` bloqueia.
    expect(podeComecar(preflight(com({ taxaAtualizacaoHz: 11, fpsRender: 6 })))).toBe(false);
  });

  it('fps abaixo do mínimo bloqueia', () => {
    // A câmera entrega 30 fps. Abaixo de 20 o erro medido misturaria "o modelo
    // errou" com "o quadro nem foi processado" — duas populações que não se
    // separam depois.
    expect(nivelDe(com({ fpsRender: 6.7 }), 'fps')).toBe('bloqueio');
    expect(nivelDe(com({ fpsRender: 29 }), 'fps')).toBe('ok');
    expect(nivelDe(com({ fpsRender: null }), 'fps')).toBe('atencao');
  });

  it('o limiar não OSCILA na faixa de operação da máquina', () => {
    // O limiar esteve em 20, derivado da câmera (30 fps). Mas o teto real é o
    // thread principal, medido em 42,3 ms = ~23,6 fps. Um piso de 20 contra um
    // teto de 23,6 alternava ✅/⛔ no mesmo minuto (20,9 → 18,8) — e um limiar
    // que oscila só ensina a rodar de novo até passar.
    for (const fps of [15.1, 17, 18.8, 19, 20.9, 22, 23.5]) {
      expect(nivelDe(com({ fpsRender: fps }), 'fps'), `${fps} fps oscilou`).toBe('ok');
    }
  });

  it('o detalhe dá o TETO da máquina, não a taxa da câmera', () => {
    // "18,8 fps (a câmera entrega 30)" faz o operador perseguir um número
    // inalcançável. O teto do thread principal é a referência útil.
    const d = preflight(com({ fpsRender: 19 })).find((i) => i.item === 'fps')!.detalhe;
    expect(d).toContain('23,6');
  });

  it('60 Hz passa sem ressalva', () => {
    expect(nivelDe(com({ taxaAtualizacaoHz: 60 }), 'taxa de atualização')).toBe('ok');
  });

  it('fila com pendência mas ENTREGANDO não gera aviso nenhum', () => {
    // Este aviso disparava em toda sessão saudável, dizendo "o L2CS parou de
    // entregar" enquanto ele entregava a 7 Hz com 0% de staleness. O operador
    // razoavelmente concluiu que o modelo não tinha carregado.
    //
    // O `engine.ts` já documentava: com backpressure o valor fica em {0,1}, e
    // a assinatura de deadlock é fila presa COM `hz` em 0. Com submissões a
    // ~7 Hz e inferência de ~40 ms, há sempre uma em voo no instante da
    // leitura — `fila = 1` é o estado saudável.
    //
    // Um aviso que dispara sempre não avisa nada: ensina que o painel exagera,
    // e aí o alarme que importa também é ignorado.
    const itens = preflight(com({ l2cs: { ...BOM.l2cs, pendingCount: 1, hz: 7 } }));
    expect(itens.find((i) => i.item === 'L2CS · fila')).toBeUndefined();
    expect(podeComecar(itens)).toBe(true);
  });

  it('fila presa E nada voltando BLOQUEIA — as duas coisas juntas', () => {
    const itens = preflight(com({ l2cs: { ...BOM.l2cs, pendingCount: 1, hz: 0 } }));
    expect(itens.find((i) => i.item === 'L2CS · fila')!.nivel).toBe('bloqueio');
    expect(podeComecar(itens)).toBe(false);
  });

  it('fila vazia não gera item nenhum', () => {
    expect(preflight(BOM).find((i) => i.item === 'L2CS · fila')).toBeUndefined();
  });
});

describe('a resolução da câmera', () => {
  it('resolução baixa BLOQUEIA', () => {
    // O app pede 1920×1080; o driver pode entregar menos sem avisar, e isso
    // não aparecia em lugar nenhum da interface. O README registra que "o erro
    // escala com o inverso da densidade de pixels sobre o olho" — o sintoma é
    // erro alto UNIFORME, que se parece com iluminação ruim, e manda o
    // operador investigar a lâmpada quando o problema é a câmera.
    expect(nivelDe(com({ videoPx: { w: 640, h: 480 } }), 'câmera')).toBe('bloqueio');
    expect(nivelDe(com({ videoPx: { w: 1920, h: 1080 } }), 'câmera')).toBe('ok');
    expect(nivelDe(com({ videoPx: { w: 1280, h: 720 } }), 'câmera')).toBe('ok');
  });

  it('resolução não reportada avisa sem bloquear', () => {
    expect(nivelDe(com({ videoPx: { w: 0, h: 0 } }), 'câmera')).toBe('atencao');
  });

  it('a resolução aparece no detalhe MESMO quando ok — é condição de sessão', () => {
    const d = preflight(com({ videoPx: { w: 1920, h: 1080 } }))
      .find((i) => i.item === 'câmera')!.detalhe;
    expect(d).toContain('1920×1080');
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
      fpsRender: 5,
      l2cs: { status: 'error', executionProvider: null, stalePct: 100, pendingCount: 3, hz: 0 },
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
