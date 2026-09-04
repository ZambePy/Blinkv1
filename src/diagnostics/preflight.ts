// Verificação pré-sessão — o que precisa estar certo ANTES de medir.
//
// ── Por que isto existe ─────────────────────────────────────────────────────
//
// O protocolo do `F8.1` depende de uma lista de coisas que o operador tem que
// lembrar: fullscreen, diagonal informada, WebGPU de fato ativo, recarregar a
// página depois de cada `__irisflowExp.set`, conferir o staleness, não deixar
// uma flag da rodada anterior ligada.
//
// Cada item dessa lista é uma forma de perder uma sessão. E o público-alvo tem
// fadiga limitante: uma sessão perdida não é meia hora de trabalho refeito, é
// meia hora que o paciente não tem para dar de novo.
//
// O modo de falha que mais preocupa não é esquecer — é esquecer e **não
// perceber**. Rodar a condição inteira com a flag da condição anterior produz
// dado de aparência perfeita, atribuído à condição errada. Nada no relatório
// denuncia, e a conclusão sai invertida.
//
// ── Três níveis, e a diferença importa ──────────────────────────────────────
//
// `bloqueio` não é "cuidado", é "o dado desta sessão vai para o lixo". A
// distinção existe para que `atencao` continue significando alguma coisa: uma
// lista em que tudo é vermelho é uma lista que se aprende a ignorar.
//
// Puro: não lê relógio, não toca no DOM, não chama o engine. Tudo entra por
// parâmetro, então dá para testar cada veredito sem navegador.

export type NivelPreflight =
  /** Pronto. */
  | 'ok'
  /** Vale saber, mas a sessão é válida. */
  | 'atencao'
  /** A sessão produziria dado que será descartado. Não começar. */
  | 'bloqueio';

export interface ItemPreflight {
  item: string;
  nivel: NivelPreflight;
  detalhe: string;
  /** O que fazer para resolver. `null` quando não há ação. */
  acao: string | null;
}

export interface EntradaPreflight {
  /** Estado do engine (`'tracking'`, `'no_face'`, `'error'`…). */
  estadoEngine: string;
  calibrado: boolean;

  /** Diagonal configurada, em polegadas, e de onde ela veio. */
  telaPolegadas: number;
  origemGeometria: 'default' | 'manual' | 'auto' | string;
  distanciaCm: number;

  /** Viewport atual e resolução da tela — para detectar janela não maximizada. */
  viewportPx: { w: number; h: number };
  telaPx: { w: number; h: number };

  /** Taxa de atualização medida, em Hz. `null` quando não foi medida. */
  taxaAtualizacaoHz: number | null;

  l2cs: {
    status: string;
    executionProvider: string | null;
    stalePct: number;
    /** Submissões sem resposta. Preso > 0 por muito tempo é deadlock. */
    pendingCount: number;
  };

  /** Modo de filtragem pedido e o que de fato está governando. */
  filtro: { pedido: string; efetivo: string; degradado: boolean };

  /** Snapshot das flags, para conferir a condição contra o que se pretendia. */
  flags: Readonly<Record<string, unknown>>;
  /** Flags que o operador PRETENDE nesta condição. Vazio = não confere. */
  condicaoEsperada?: Readonly<Record<string, unknown>>;
}

/** Fração da tela abaixo da qual o viewport é considerado "não maximizado". */
const FRACAO_FULLSCREEN_MIN = 0.9;

/** Acima disto o rAF gira muito mais rápido que a câmera sem ganho nenhum. */
const TAXA_ATUALIZACAO_IDEAL_HZ = 75;

/** Staleness acima disto significa que o bloco angular está sendo zerado. */
const STALE_PCT_MAX = 10;

export function preflight(e: EntradaPreflight): ItemPreflight[] {
  const itens: ItemPreflight[] = [];
  const add = (
    item: string, nivel: NivelPreflight, detalhe: string, acao: string | null = null,
  ) => itens.push({ item, nivel, detalhe, acao });

  // ── Engine e calibração ────────────────────────────────────────────────
  if (e.estadoEngine === 'error') {
    add('engine', 'bloqueio', `estado '${e.estadoEngine}'`,
      'Recarregue a página e confira o console.');
  } else {
    add('engine', 'ok', `estado '${e.estadoEngine}'`);
  }

  if (!e.calibrado) {
    add('calibração', 'bloqueio', 'não há calibração ativa',
      'Calibre antes de medir. Sem modelo, a predição é o fallback do nariz.');
  } else {
    add('calibração', 'ok', 'modelo ativo');
  }

  // ── Geometria ──────────────────────────────────────────────────────────
  if (!(e.telaPolegadas > 0) || !(e.distanciaCm > 0)) {
    add('geometria', 'bloqueio',
      `diagonal ${e.telaPolegadas}" a ${e.distanciaCm} cm`,
      'Valores inválidos tornam o erro em GRAUS impossível de calcular.');
  } else if (e.origemGeometria === 'default') {
    // Não é bloqueio: o default pode estar certo. Mas a procedência fica
    // gravada como "assumida", e depois do dia ninguém consegue separar as
    // sessões em que alguém mediu das em que ninguém mediu.
    add('geometria', 'atencao',
      `diagonal ${e.telaPolegadas}" (DEFAULT, não informada) a ${e.distanciaCm} cm`,
      'Configurações → diagonal da tela. ⚠️ APAGUE e REDIGITE o valor: o campo '
      + 'já mostra o default, e só olhar para ele não marca nada — a procedência '
      + 'só muda para "manual" quando o valor é editado. Mesmo que o default '
      + 'esteja correto, sem isso o relatório grava a geometria como assumida.');
  } else {
    add('geometria', 'ok',
      `diagonal ${e.telaPolegadas}" (${e.origemGeometria}) a ${e.distanciaCm} cm`);
  }

  // ── Viewport ───────────────────────────────────────────────────────────
  // B2.9 — o erro é medido em px de viewport. Uma janela não maximizada muda
  // a escala de tudo, e a comparação entre rodadas deixa de valer.
  const fracaoW = e.telaPx.w > 0 ? e.viewportPx.w / e.telaPx.w : 1;
  const fracaoH = e.telaPx.h > 0 ? e.viewportPx.h / e.telaPx.h : 1;
  if (fracaoW < FRACAO_FULLSCREEN_MIN || fracaoH < FRACAO_FULLSCREEN_MIN) {
    add('viewport', 'bloqueio',
      `${e.viewportPx.w}×${e.viewportPx.h} de uma tela ${e.telaPx.w}×${e.telaPx.h} `
      + `(${(fracaoW * 100).toFixed(0)}% × ${(fracaoH * 100).toFixed(0)}%)`,
      'Maximize ou entre em tela cheia. O erro é medido em px de viewport: '
      + 'rodadas com viewports diferentes não são comparáveis.');
  } else {
    add('viewport', 'ok', `${e.viewportPx.w}×${e.viewportPx.h}`);
  }

  // ── Taxa de atualização ────────────────────────────────────────────────
  if (e.taxaAtualizacaoHz === null) {
    add('taxa de atualização', 'atencao', 'não medida', null);
  } else if (e.taxaAtualizacaoHz > TAXA_ATUALIZACAO_IDEAL_HZ) {
    const porQuadro = e.taxaAtualizacaoHz / 30;
    add('taxa de atualização', 'atencao',
      `${e.taxaAtualizacaoHz.toFixed(0)} Hz — o rAF roda ~${porQuadro.toFixed(0)}× `
      + `por quadro de câmera, e ${(100 * (1 - 1 / porQuadro)).toFixed(0)}% das `
      + 'iterações não têm trabalho a fazer',
      'Fixe o monitor em 60 Hz para as sessões. Um pipeline de 30 fps não ganha '
      + 'nada acima disso, e o thread principal já está acima do orçamento.');
  } else {
    add('taxa de atualização', 'ok', `${e.taxaAtualizacaoHz.toFixed(0)} Hz`);
  }

  // ── L2CS ───────────────────────────────────────────────────────────────
  if (e.l2cs.status !== 'ready') {
    add('L2CS', 'bloqueio', `status '${e.l2cs.status}'`,
      'O critério de descarte de sessão do F8.1 lista `l2csStatus != ready`.');
  } else if (e.l2cs.stalePct > STALE_PCT_MAX) {
    // Com o bloco angular zerado, o modelo roda com 4 das 6 dimensões — e
    // nada na interface diz isso. Foi o que a medição de `P5.5` descobriu.
    add('L2CS', 'bloqueio',
      `${e.l2cs.stalePct.toFixed(1)}% das leituras obsoletas`,
      'O bloco angular está sendo zerado: o modelo roda com 4 das 6 dimensões. '
      + "Use `l2csExecutionProvider: 'webgpu'` (medido: 50 ms contra 2319 ms em wasm).");
  } else {
    add('L2CS', 'ok',
      `${e.l2cs.executionProvider ?? 'provider desconhecido'}, `
      + `stale ${e.l2cs.stalePct.toFixed(1)}%`);
  }

  if (e.l2cs.pendingCount > 0) {
    // Evidência direta do deadlock de submissão: se ficar preso, nenhuma
    // inferência nova acontece pelo resto da sessão, com o status ainda
    // dizendo 'ready'.
    add('L2CS · fila', 'atencao',
      `${e.l2cs.pendingCount} submissão(ões) sem resposta`,
      'Se este número não voltar a zero, a fila travou e o L2CS parou de '
      + 'entregar — recarregue a página antes de medir.');
  }

  // ── Cadeia de filtragem ────────────────────────────────────────────────
  if (e.filtro.degradado) {
    add('filtro', 'bloqueio',
      `pedido '${e.filtro.pedido}', rodando '${e.filtro.efetivo}'`,
      'A cadeia degradou por falta de geometria de tela. Medir assim atribui '
      + 'o resultado a uma cadeia que não rodou.');
  } else {
    add('filtro', 'ok', `'${e.filtro.efetivo}'`);
  }

  // ── A condição é a que se pretendia? ───────────────────────────────────
  //
  // O erro mais provável do dia: `__irisflowExp.set` só vale depois do
  // RELOAD. Sem esta conferência, esquecer de recarregar roda a condição
  // anterior inteira sob o rótulo da nova.
  if (e.condicaoEsperada && Object.keys(e.condicaoEsperada).length > 0) {
    const divergentes: string[] = [];
    for (const [k, v] of Object.entries(e.condicaoEsperada)) {
      if (e.flags[k] !== v) {
        divergentes.push(`${k}: esperado ${JSON.stringify(v)}, ativo ${JSON.stringify(e.flags[k])}`);
      }
    }
    if (divergentes.length > 0) {
      add('condição', 'bloqueio', divergentes.join(' · '),
        'As flags ativas não são as da condição pretendida. `__irisflowExp.set` '
        + 'só passa a valer depois de RECARREGAR a página.');
    } else {
      add('condição', 'ok', `${Object.keys(e.condicaoEsperada).length} flag(s) conferida(s)`);
    }
  }

  return itens;
}

/** `true` quando nenhum item bloqueia — a sessão pode começar. */
export function podeComecar(itens: readonly ItemPreflight[]): boolean {
  return !itens.some((i) => i.nivel === 'bloqueio');
}
