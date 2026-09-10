/**
 * Contrato da voz clonada LOCAL.
 *
 * Três lados, dois protocolos:
 *
 *   renderer ⇄ main (IPC, `CANAIS_VOZ`): estado do motor, importar áudio de
 *   referência (com consentimento), sintetizar um texto, ligar/desligar.
 *
 *   main ⇄ sidecar Python (`voice-engine/`, JSON por linha em stdin/stdout,
 *   `Pedido`/`Resposta`): é o processo que carrega o modelo (Chatterbox
 *   multilíngue) e gera o áudio. O main o inicia, reinicia se cair e é o
 *   único que fala com ele.
 *
 * Nada aqui toca rede. O áudio de referência, o modelo e o cache de frases
 * ficam na pasta de dados do app, no computador do paciente.
 */

export const CANAIS_VOZ = {
  estado: 'irisflow:voz-estado',
  estadoMudou: 'irisflow:voz-estado-mudou',
  importar: 'irisflow:voz-importar',
  remover: 'irisflow:voz-remover',
  baixarModelo: 'irisflow:voz-baixar-modelo',
  sintetizar: 'irisflow:voz-sintetizar',
  ativar: 'irisflow:voz-ativar',
  sondar: 'irisflow:voz-sondar',
} as const;

export type QualidadeDaReferencia = 'boa' | 'aceitavel' | 'fraca';

export interface EstadoDoMotorDeVoz {
  /** Existe um motor para chamar (Python em dev, executável no build). */
  disponivel: boolean;
  /** Por que não está disponível, para o cuidador. */
  indisponivelPorque?: string;
  motor: 'parado' | 'iniciando' | 'pronto' | 'erro';
  erro?: string;
  modelo: {
    baixado: boolean;
    baixando: boolean;
    /** 0–100 enquanto baixa; `null` fora do download. */
    progresso: number | null;
    etapa?: string;
  };
  /** Onde o modelo roda. `null` até o motor responder. */
  dispositivo: 'cpu' | 'cuda' | null;
  /** Memória e núcleos da máquina, medidos pelo motor (`status`). */
  maquina?: { memoriaTotalGb: number; memoriaLivreGb: number; nucleos: number };
  voz: {
    importada: boolean;
    duracaoS?: number;
    qualidade?: QualidadeDaReferencia;
    avisos?: string[];
    importadaEm?: string;
    nomeDoArquivo?: string;
    consentimentoEm?: string;
  };
  /** O paciente escolheu falar com a voz clonada (senão, voz do sistema). */
  ativa: boolean;
  cache: { itens: number; mb: number };
  /** Ocupado sintetizando agora. */
  sintetizando: boolean;
}

export type ResultadoDaImportacao =
  | { ok: true; duracaoS: number; qualidade: QualidadeDaReferencia; avisos: string[] }
  | { ok: false; erro: string; cancelado?: boolean };

export type MotivoSemVoz = 'inativa' | 'sem_voz' | 'sem_modelo' | 'motor' | 'texto' | 'indisponivel' | 'nao_em_cache';

/** Opções de `sintetizar`. `soCache`: devolve só o que já está pronto, sem acordar o motor. */
export interface OpcoesDeSintese {
  soCache?: boolean;
}

export type ResultadoDaSintese =
  | { ok: true; wav: ArrayBuffer; deCache: boolean; ms: number }
  | { ok: false; motivo: MotivoSemVoz; erro?: string };

// ---------------------------------------------------------------------------
// Protocolo com o sidecar (JSON por linha).
// ---------------------------------------------------------------------------

export type PedidoAoMotor =
  | { id: number; cmd: 'status' }
  | { id: number; cmd: 'baixar_modelo' }
  | { id: number; cmd: 'preparar_referencia'; entrada: string; saida: string }
  | { id: number; cmd: 'falar'; texto: string; referencia: string; saida: string; idioma: string }
  | { id: number; cmd: 'sair' };

/** `Omit` distributivo: `Omit<União, 'id'>` colapsaria os campos específicos. */
export type PedidoSemId = PedidoAoMotor extends infer P ? (P extends unknown ? Omit<P, 'id'> : never) : never;

export interface RespostaDoMotor {
  id: number;
  ok: boolean;
  erro?: string;
  [k: string]: unknown;
}

export interface EventoDoMotor {
  evento: 'progresso' | 'log';
  etapa?: string;
  pct?: number;
  mensagem?: string;
}

export function ehResposta(v: unknown): v is RespostaDoMotor {
  return !!v && typeof v === 'object' && typeof (v as RespostaDoMotor).id === 'number' && typeof (v as RespostaDoMotor).ok === 'boolean';
}

export function ehEvento(v: unknown): v is EventoDoMotor {
  return !!v && typeof v === 'object' && typeof (v as EventoDoMotor).evento === 'string';
}

/**
 * Divide um fluxo de bytes em linhas JSON completas. Devolve as mensagens
 * inteiras e o resto (uma linha parcial) para a próxima chamada. Linhas que
 * não são JSON (avisos de bibliotecas Python no stdout) são ignoradas, não
 * derrubam o leitor.
 */
export function separarLinhasJson(buffer: string): { mensagens: unknown[]; resto: string } {
  const partes = buffer.split('\n');
  const resto = partes.pop() ?? '';
  const mensagens: unknown[] = [];
  for (const linha of partes) {
    const l = linha.trim();
    if (!l.startsWith('{')) continue;
    try {
      mensagens.push(JSON.parse(l));
    } catch { /* linha estranha: ignora */ }
  }
  return { mensagens, resto };
}

/**
 * Requisitos de memória da voz clonada em CPU (espelham `recursos.py`): o
 * modelo precisa de ~4,5 GB livres para carregar; abaixo de 12 GB no total a
 * máquina é considerada apertada e a tela avisa antes de tentar.
 */
export const VOZ_MEMORIA_NECESSARIA_GB = 4.5;
export const VOZ_MEMORIA_TOTAL_MINIMA_GB = 12;

/** Teto de texto por síntese. Acima disto vira várias falas. */
export const TEXTO_MAX_PARA_FALA = 400;

/**
 * Normaliza o texto para a chave de cache: a mesma frase digitada com espaço
 * a mais ou maiúscula diferente é a mesma fala. Pontuação fica — muda a
 * prosódia.
 */
export function normalizarTextoParaFala(texto: string): string {
  return texto.replace(/\s+/g, ' ').trim().slice(0, TEXTO_MAX_PARA_FALA);
}

/**
 * Qualidade da referência a partir do que o preparo mediu. Regras simples e
 * declaradas: o cuidador vê "fraca" e sabe que vale gravar/achar outro áudio.
 *
 *   - < 6 s de fala útil não dá timbre estável → fraca.
 *   - SNR < 12 dB (ruído de fundo forte) → fraca; 12–20 → aceitável.
 *   - 6–15 s limpos → aceitável; ≥ 15 s limpos → boa.
 */
export function classificarReferencia(duracaoUtilS: number, snrDb: number | null): QualidadeDaReferencia {
  if (!Number.isFinite(duracaoUtilS) || duracaoUtilS < 6) return 'fraca';
  if (snrDb !== null && Number.isFinite(snrDb) && snrDb < 12) return 'fraca';
  if (duracaoUtilS < 15) return 'aceitavel';
  if (snrDb !== null && Number.isFinite(snrDb) && snrDb < 20) return 'aceitavel';
  return 'boa';
}
