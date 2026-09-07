// Verificação pré-sessão — o que precisa estar certo ANTES de medir.
//
// O protocolo de medição depende de uma lista de coisas que o operador tem
// que lembrar (janela maximizada, diagonal informada, WebGPU ativo, nenhuma
// flag da rodada anterior ligada). Cada item é uma forma de perder uma
// sessão, e o pior modo de falha é esquecer e NÃO perceber: rodar com a flag
// da condição anterior produz dado de aparência perfeita atribuído à
// condição errada.
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

  /**
   * FOV horizontal da câmera, em graus, quando calibrado.
   *
   * `null` significa que `result.distanciaMedidaCm` sairá `null` no relatório
   * — e essa é a única testemunha de que a pessoa não se moveu durante o
   * teste. A ausência não invalida a sessão, mas descobri-la só depois de
   * medir custa a sessão inteira.
   */
  fovCameraDeg?: number | null;

  /** Viewport atual e resolução da tela — para detectar janela não maximizada. */
  viewportPx: { w: number; h: number };
  telaPx: { w: number; h: number };

  /** Taxa de atualização medida, em Hz. `null` quando não foi medida. */
  taxaAtualizacaoHz: number | null;

  /** fps que o engine está de fato entregando. `null` quando não medido. */
  fpsRender: number | null;

  /** Resolução que a câmera está ENTREGANDO — não a que foi pedida. */
  videoPx: { w: number; h: number };

  l2cs: {
    status: string;
    executionProvider: string | null;
    stalePct: number;
    /** Submissões sem resposta. Ver a nota no veredito: sozinho NÃO é sinal. */
    pendingCount: number;
    /** Taxa de inferências entregues, em Hz. `0` com fila presa = deadlock. */
    hz: number;
  };

  /** Modo de filtragem pedido e o que de fato está governando. */
  filtro: { pedido: string; efetivo: string; degradado: boolean };

  /** Snapshot das flags, para conferir a condição contra o que se pretendia. */
  flags: Readonly<Record<string, unknown>>;
  /** Flags que o operador PRETENDE nesta condição. Vazio = não confere. */
  condicaoEsperada?: Readonly<Record<string, unknown>>;
}

/**
 * Frações mínimas do viewport — assimétricas, e o motivo é físico.
 *
 * Havia um único limiar de 0,9 nos dois eixos, e ele estava errado por não
 * distinguir as duas causas de viewport pequeno:
 *
 *   **Largura** — o navegador NÃO consome largura. Se ela some, alguma coisa
 *   está ocupando espaço horizontal: DevTools ancorado na lateral (foi o caso
 *   real: 1001 px de 1920, exatamente os 919 px do painel), janela dividida,
 *   ou janela não maximizada. Todos são problema.
 *
 *   **Altura** — a barra do navegador (título + abas + endereço) come ~130 px
 *   de forma legítima. Uma janela MAXIMIZADA num monitor 1080p entrega
 *   ~1920×950, ou seja 88% de altura. Bloquear isso obrigaria a F11, e F11
 *   com o DevTools em janela separada é ergonomicamente inviável: o Chrome
 *   derruba o fullscreen quando a janela perde foco.
 *
 * O que a medição de fato exige não é fullscreen — é o MESMO viewport em todas
 * as rodadas. Uma janela maximizada garante isso tão bem quanto F11, e o
 * viewport exato sai no detalhe para ser anotado e conferido entre condições.
 */
const FRACAO_LARGURA_MIN = 0.95;
const FRACAO_ALTURA_MIN = 0.80;

/** Acima disto o rAF gira muito mais rápido que a câmera sem ganho nenhum. */
const TAXA_ATUALIZACAO_IDEAL_HZ = 75;

// Não existe limiar MÍNIMO de taxa de atualização de propósito: o rAF é
// amostrado com o pipeline rodando, então mede `min(monitor, thread
// principal)` — ~24 Hz nesta máquina com o monitor em 60 ou 180. Taxa baixa e
// fps baixo são o mesmo fenômeno, e o fps já cobre. Sobra o que este número
// distingue: taxa ALTA, que o thread não limita e é desperdício real.

/**
 * fps mínimo para a medição representar o pipeline.
 *
 * O teto real não é a câmera (30) — é o thread principal: mediapipe 18,9 +
 * quality 12,2 + crop 11,2 = 42,3 ms por quadro, ~23,6 fps com WebGPU. Um piso de 20 oscilava entre ok e bloqueio no
 * mesmo minuto. 15 é ~64% do teto: abaixo disso algo está competindo pelo
 * thread; entre 15 e 24 é a operação normal.
 */
const FPS_MIN = 15;

/** Staleness acima disto significa que o bloco angular está sendo zerado. */
const STALE_PCT_MAX = 10;

/**
 * Largura mínima de captura, em px.
 *
 * O app PEDE 1920×1080, mas o driver pode entregar menos sem avisar — e a
 * resolução entregue não aparecia em lugar nenhum da interface.
 *
 * Importa porque o README registra que *"o erro escala com o inverso da
 * densidade de pixels sobre o olho"*: menos pixels na íris é menos sinal, e o
 * sintoma é erro alto de forma UNIFORME, que se parece com "iluminação ruim"
 * ou "óculos" — as causas que a mensagem de diagnóstico sugere primeiro.
 *
 * Numa sessão real, trocar de câmera derrubou o fps de 22,8 para 15,6 E
 * ACELEROU todos os estágios (mediapipe 32,5 → 7,7 ms). Estágios mais rápidos
 * com erro maior é a assinatura de imagem menor — e não havia como ver isso
 * sem abrir o DevTools.
 *
 * 1280 é o piso: abaixo disso a íris ocupa poucos pixels a 60 cm.
 */
const VIDEO_LARGURA_MIN = 1280;

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

  // ── Distância medida ───────────────────────────────────────────────────
  //
  // Atenção, não bloqueio: a sessão continua válida sem isto, só perde a
  // testemunha de movimento. Existe porque a descoberta natural desse
  // `null` acontece ao ler o relatório — depois da sessão inteira.
  if (e.fovCameraDeg === undefined) {
    // Chamador antigo, que não informa o FOV. Não inventa veredito.
  } else if (e.fovCameraDeg === null) {
    add('distância medida', 'atencao', 'FOV da câmera não calibrado',
      'O relatório sairá com `distanciaMedidaCm: null` e a sessão fica sem a '
      + 'testemunha de que a pessoa não se moveu. Configurações → Campo de '
      + 'visão da câmera → Calibrar.');
  } else {
    add('distância medida', 'ok', `FOV ${e.fovCameraDeg.toFixed(1)}°`);
  }

  // ── Viewport ───────────────────────────────────────────────────────────
  // O erro é medido em px de viewport. Uma janela não maximizada muda
  // a escala de tudo, e a comparação entre rodadas deixa de valer.
  const fracaoW = e.telaPx.w > 0 ? e.viewportPx.w / e.telaPx.w : 1;
  const fracaoH = e.telaPx.h > 0 ? e.viewportPx.h / e.telaPx.h : 1;
  const dimensoes = `${e.viewportPx.w}×${e.viewportPx.h} de uma tela `
    + `${e.telaPx.w}×${e.telaPx.h} `
    + `(${(fracaoW * 100).toFixed(0)}% × ${(fracaoH * 100).toFixed(0)}%)`;
  if (fracaoW < FRACAO_LARGURA_MIN) {
    add('viewport', 'bloqueio', dimensoes,
      'Falta LARGURA — e o navegador não consome largura. Alguma coisa está '
      + 'ocupando espaço horizontal: DevTools ancorado na lateral (desancore '
      + 'em ⋮ → Dock side → Undock into separate window), janela dividida, ou '
      + 'janela não maximizada.');
  } else if (fracaoH < FRACAO_ALTURA_MIN) {
    add('viewport', 'bloqueio', dimensoes,
      'Falta ALTURA além do que a barra do navegador explica (~130 px). '
      + 'Maximize a janela ou use F11.');
  } else {
    // O viewport exato vai no detalhe SEMPRE, não só quando há problema: ele
    // precisa ser anotado e conferido igual entre as condições. O que a
    // medição exige é o MESMO viewport em todas as rodadas — não fullscreen.
    add('viewport', 'ok', `${e.viewportPx.w}×${e.viewportPx.h} — anote e mantenha igual`);
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
    // Sem piso: este número é limitado pelo thread principal, não pelo
    // monitor — quem cobre o caso baixo é o item `fps`. Ver a nota acima.
    add('taxa de atualização', 'ok', `${e.taxaAtualizacaoHz.toFixed(0)} Hz`);
  }

  // ── fps entregue ───────────────────────────────────────────────────────
  if (e.fpsRender === null) {
    add('fps', 'atencao', 'não medido', null);
  } else if (e.fpsRender < FPS_MIN) {
    add('fps', 'bloqueio',
      `${e.fpsRender.toFixed(1)} fps (teto medido desta máquina: ~23,6)`,
      'O pipeline está perdendo quadros demais. O erro medido misturaria "o '
      + 'modelo errou" com "o quadro nem foi processado", e as duas coisas '
      + 'não se separam depois. Use o build de produção e feche o que estiver '
      + 'disputando CPU/GPU.');
  } else if (e.fpsRender < 24) {
    // Faixa normal desta máquina. Reportada como `ok` com o contexto, para
    // ninguém ler "19 fps" como problema — é o teto do thread principal.
    add('fps', 'ok', `${e.fpsRender.toFixed(1)} fps (teto medido: ~23,6)`);
  } else {
    add('fps', 'ok', `${e.fpsRender.toFixed(1)} fps`);
  }

  // ── Câmera ─────────────────────────────────────────────────────────────
  const cam = `${e.videoPx.w}×${e.videoPx.h}`;
  if (!(e.videoPx.w > 0)) {
    add('câmera', 'atencao', 'resolução não reportada', null);
  } else if (e.videoPx.w < VIDEO_LARGURA_MIN) {
    add('câmera', 'bloqueio', `${cam} — abaixo de ${VIDEO_LARGURA_MIN}px de largura`,
      'A câmera está entregando menos resolução do que o app pediu. O erro '
      + 'escala com o inverso da densidade de pixels sobre o olho, e o sintoma '
      + 'é erro alto UNIFORME — que se parece com iluminação ruim. Troque de '
      + 'câmera ou confira as configurações do driver.');
  } else {
    add('câmera', 'ok', `${cam} — anote e mantenha igual`);
  }

  // ── L2CS ───────────────────────────────────────────────────────────────
  if (e.l2cs.status !== 'ready') {
    add('L2CS', 'bloqueio', `status '${e.l2cs.status}'`,
      'Sessão sem L2CS pronto é descartada pelo protocolo de medição.');
  } else if (e.l2cs.stalePct > STALE_PCT_MAX) {
    // Com o bloco angular zerado, o modelo roda com 4 das 6 dimensões — e
    // nada na interface diz isso.
    add('L2CS', 'bloqueio',
      `${e.l2cs.stalePct.toFixed(1)}% das leituras obsoletas`,
      'O bloco angular está sendo zerado: o modelo roda com 4 das 6 dimensões. '
      + 'Verifique se o L2CS caiu para WASM (`?ep=webgpu` força a GPU; medido: ~50 ms contra ~2300 ms em WASM).');
  } else {
    add('L2CS', 'ok',
      `${e.l2cs.executionProvider ?? 'provider desconhecido'}, `
      + `stale ${e.l2cs.stalePct.toFixed(1)}%`);
  }

  // `pendingCount > 0` SOZINHO não é sinal de nada: com submissões a ~7 Hz e
  // inferência de ~40 ms há quase sempre uma em voo, e `fila = 1` é o estado
  // saudável. A assinatura do deadlock são as DUAS coisas juntas: fila presa
  // E nada voltando.
  if (e.l2cs.pendingCount > 0 && e.l2cs.hz <= 0) {
    add('L2CS · fila', 'bloqueio',
      `${e.l2cs.pendingCount} submissão(ões) sem resposta e 0 Hz de retorno`,
      'A fila travou: o worker recebeu e não respondeu, e nenhuma inferência '
      + 'nova acontece pelo resto da sessão — com o status ainda dizendo '
      + '`ready`. Recarregue a página antes de medir.');
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
