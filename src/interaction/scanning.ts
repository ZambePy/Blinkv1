// Modo de varredura (scanning).
//
// Quando o rastreamento de olhar falha, este é o caminho que sobra: os botões
// são destacados um a um, em ciclo, e uma piscada seleciona o destacado. Não
// depende de gaze, de calibração, nem de predição — só de a pessoa conseguir
// fechar os olhos de propósito uma vez. Deve funcionar inclusive em `degraded`.
//
// Por isso o gatilho NÃO pergunta ao engine em que estado ele está; observa
// apenas "há gaze utilizável neste quadro?". Um gatilho pendurado em
// `state === 'degraded'` herdaria os modos de falha em que esse estado nunca
// é alcançado. O fallback de último recurso não pode compartilhar pressupostos
// com o sistema cuja falha ele existe para cobrir.
//
// A saída precisa de histerese: quando o rastreamento está ruim, quadros
// válidos chegam esparsos. Com saída imediata, cada quadro solto derrubaria a
// varredura e ela recomeçaria do item 0 — o destaque se mexe, mas o paciente
// nunca alcança o botão. Por isso a saída exige gaze válido SUSTENTADO, com
// limiar diferente do de entrada.

/** Tempo sem gaze utilizável até a varredura começar, em ms. */
export const SCANNING_ATIVA_APOS_MS = 3000;

/**
 * Tempo em cada item, em ms.
 *
 * Precisa ser maior que a latência de decisão de alguém com ELA em fadiga
 * (perceber o destaque, decidir, iniciar a piscada). Abaixo de ~1 s o item já
 * passou quando a piscada sai, e a seleção cai no item seguinte — um erro que o
 * paciente não tem como distinguir de "o sistema não me obedece".
 */
export const SCANNING_PASSO_MS = 1200;

/**
 * Gaze válido sustentado necessário para SAIR da varredura, em ms.
 *
 * Deliberadamente diferente do gatilho de entrada — ver a nota de histerese no
 * cabeçalho.
 */
export const SCANNING_SAIDA_ESTAVEL_MS = 500;

/**
 * Piscada mínima para selecionar, em ms. Mesmo valor e motivo do
 * `blinkClick`: abaixo disto é piscada espontânea. Aqui a guarda importa ainda
 * mais, porque não há "olhar estável sobre o alvo" como segunda confirmação.
 */
export const SCANNING_SELECAO_MIN_MS = 150;

/**
 * Piscada MÁXIMA para selecionar, em ms.
 *
 * Uma das causas mais comuns de 3 s sem gaze é o paciente descansando de
 * olhos fechados. Sem teto, ele reabriria os olhos depois de 10 s e
 * selecionaria o item destacado quando os fechou — vários ciclos atrás, um
 * item aleatório. Mesmo valor do `BLINK_CLICK_MAX_MS`: acima disso não é
 * piscada, é olho fechado.
 */
export const SCANNING_SELECAO_MAX_MS = 800;

export interface EstadoScanning {
  /** Instante em que a varredura começou, ou `null` se inativa. */
  ativoDesde: number | null;
  /** Índice destacado. Só tem sentido com `ativoDesde !== null`. */
  indice: number;
  /** Quando o item corrente passou a ser destacado. */
  passoDesde: number;
  /** Desde quando o gaze está utilizável de forma contínua, ou `null`. */
  gazeValidoDesde: number | null;
  /** Desde quando o gaze está INUTILIZÁVEL de forma contínua, ou `null`. */
  semGazeDesde: number | null;
  piscandoDesde: number | null;
  /**
   * Índice destacado no instante em que a piscada COMEÇOU, ou `null`.
   *
   * A piscada dura ~200 ms e o destaque continua avançando durante ela. Sem
   * congelar o índice na borda de subida, uma piscada que atravessa a
   * fronteira do passo seleciona o item SEGUINTE — para o paciente,
   * indistinguível de "o sistema não me obedece".
   */
  indiceNaPiscada: number | null;
  /** Ciclos completos desde a ativação — para o diagnóstico. */
  ciclos: number;
}

export interface EntradaScanning {
  gazeValido: boolean;
  piscando: boolean;
  nowMs: number;
  /** Quantos itens navegáveis existem na tela agora. */
  totalItens: number;
}

export interface ResultadoScanning {
  estado: EstadoScanning;
  /** A varredura está ativa neste quadro. */
  ativo: boolean;
  /** Índice destacado, ou `null` quando inativa. */
  indiceDestacado: number | null;
  /** Índice selecionado neste quadro, ou `null`. */
  selecionou: number | null;
}

export interface OpcoesScanning {
  ativaAposMs?: number;
  passoMs?: number;
  saidaEstavelMs?: number;
  selecaoMinMs?: number;
  selecaoMaxMs?: number;
}

export function criarEstadoScanning(): EstadoScanning {
  return {
    ativoDesde: null,
    indice: 0,
    passoDesde: 0,
    gazeValidoDesde: null,
    semGazeDesde: null,
    piscandoDesde: null,
    indiceNaPiscada: null,
    ciclos: 0,
  };
}

/**
 * Avança a varredura em um quadro. Puro.
 *
 * Não conflita com a piscada-como-clique: lá a piscada só vale com um alvo
 * sob o olhar e o olhar estável nele, e no scanning não há olhar.
 */
export function stepScanning(
  estado: EstadoScanning,
  entrada: EntradaScanning,
  opts: OpcoesScanning = {},
): ResultadoScanning {
  const ativaAposMs = opts.ativaAposMs ?? SCANNING_ATIVA_APOS_MS;
  const passoMs = opts.passoMs ?? SCANNING_PASSO_MS;
  const saidaEstavelMs = opts.saidaEstavelMs ?? SCANNING_SAIDA_ESTAVEL_MS;
  const selecaoMinMs = opts.selecaoMinMs ?? SCANNING_SELECAO_MIN_MS;
  const selecaoMaxMs = opts.selecaoMaxMs ?? SCANNING_SELECAO_MAX_MS;

  const novo: EstadoScanning = { ...estado };
  const now = entrada.nowMs;

  // ── Relógios de gaze ─────────────────────────────────────────────────────
  if (entrada.gazeValido) {
    if (novo.gazeValidoDesde === null) novo.gazeValidoDesde = now;
    novo.semGazeDesde = null;
  } else {
    if (novo.semGazeDesde === null) novo.semGazeDesde = now;
    novo.gazeValidoDesde = null;
  }

  // ── Relógio da piscada ───────────────────────────────────────────────────
  // Rastreado sempre, inclusive com a varredura inativa: a piscada que
  // seleciona pode começar no último quadro antes de a varredura ativar, e
  // perder essa borda faria a primeira seleção do paciente sumir.
  const piscadaTerminouAgora = !entrada.piscando && novo.piscandoDesde !== null;
  const duracaoDaPiscada = piscadaTerminouAgora ? now - novo.piscandoDesde! : 0;
  const indiceQuandoPiscou = novo.indiceNaPiscada;
  if (entrada.piscando) {
    if (novo.piscandoDesde === null) {
      novo.piscandoDesde = now;
      // Congela o alvo da confirmação na borda de SUBIDA — ver a nota no
      // campo. Só faz sentido com a varredura ativa; inativa, não há destaque.
      novo.indiceNaPiscada = novo.ativoDesde !== null ? novo.indice : null;
    }
  } else {
    novo.piscandoDesde = null;
    novo.indiceNaPiscada = null;
  }

  const inativo = (): ResultadoScanning =>
    ({ estado: novo, ativo: false, indiceDestacado: null, selecionou: null });

  // ── Sem itens, não há o que varrer ───────────────────────────────────────
  // Uma tela sem botões navegáveis (um modal carregando, uma rota vazia) faria
  // o índice girar sobre um vetor de tamanho zero. Desativa em vez de destacar
  // um item que não existe.
  if (entrada.totalItens <= 0) {
    novo.ativoDesde = null;
    return inativo();
  }

  // ── Saída: gaze válido SUSTENTADO ────────────────────────────────────────
  if (novo.ativoDesde !== null) {
    if (novo.gazeValidoDesde !== null && now - novo.gazeValidoDesde >= saidaEstavelMs) {
      novo.ativoDesde = null;
      novo.ciclos = 0;
      return inativo();
    }
  } else {
    // ── Entrada: sem gaze utilizável por `ativaAposMs` ─────────────────────
    if (novo.semGazeDesde === null || now - novo.semGazeDesde < ativaAposMs) {
      return inativo();
    }
    novo.ativoDesde = now;
    novo.indice = 0;
    novo.passoDesde = now;
    novo.ciclos = 0;
    // Não seleciona no quadro da ativação: a piscada em curso, se houver,
    // pertence ao que a pessoa estava fazendo antes — não a uma escolha sobre
    // um destaque que ela ainda não viu.
    return { estado: novo, ativo: true, indiceDestacado: 0, selecionou: null };
  }

  // ── Seleção ──────────────────────────────────────────────────────────────
  // Antes do avanço, para que a piscada selecione o item que estava
  // destacado quando ela começou, e não o seguinte.
  if (
    piscadaTerminouAgora
    && duracaoDaPiscada >= selecaoMinMs
    && duracaoDaPiscada <= selecaoMaxMs
  ) {
    // O índice congelado na borda de subida, não o corrente.
    const alvo = indiceQuandoPiscou ?? novo.indice;
    const escolhido = ((alvo % entrada.totalItens) + entrada.totalItens) % entrada.totalItens;
    novo.indice = escolhido;
    // A varredura continua ativa: o gaze não voltou, e desligar depois de uma
    // seleção deixaria o paciente sem via de entrada até os próximos 3 s.
    novo.passoDesde = now;
    return { estado: novo, ativo: true, indiceDestacado: escolhido, selecionou: escolhido };
  }

  // ── Avanço do destaque ───────────────────────────────────────────────────
  if (now - novo.passoDesde >= passoMs) {
    const proximo = novo.indice + 1;
    if (proximo >= entrada.totalItens) {
      novo.indice = 0;
      novo.ciclos++;
    } else {
      novo.indice = proximo;
    }
    novo.passoDesde = now;
  }

  // A lista pode ter encolhido desde o último quadro (um botão desmontou).
  const destacado = novo.indice % entrada.totalItens;
  novo.indice = destacado;
  return { estado: novo, ativo: true, indiceDestacado: destacado, selecionou: null };
}
