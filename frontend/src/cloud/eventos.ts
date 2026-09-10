/**
 * Barramento de eventos do paciente → nuvem.
 *
 * As telas do paciente (teclado, frases, pictogramas, emergência, calibração)
 * NÃO conhecem o Supabase. Elas anunciam o que aconteceu aqui; o
 * `CloudProvider` escuta e decide se e como sincronizar. Isso mantém as telas
 * testáveis sem rede e faz a integração inteira desligável num só lugar.
 *
 * Para acrescentar um evento novo: declare o tipo em `EventoDoPaciente`,
 * emita-o na tela e trate-o em `CloudContext.tsx`.
 */
import type { MessageKind, HelpKind } from './types';
import type { AccuracyResult, RunMeta } from '@tracker/accuracy';

export type EventoDoPaciente =
  /** O paciente falou algo (teclado, frase rápida, pictograma, sim/não). */
  | { tipo: 'fala'; texto: string; kind: MessageKind }
  /** O paciente pediu ajuda ou o sistema detectou algo que o cuidador deve saber. */
  | { tipo: 'ajuda'; kind: HelpKind; mensagem: string }
  /** Calibração + teste de precisão concluídos. */
  | { tipo: 'calibracao'; resultado: AccuracyResult; meta: RunMeta | null; duracaoCalibracaoS: number | null }
  /** Contadores da sessão (o teclado conta caracteres; as telas contam frases). */
  | { tipo: 'uso'; caracteres?: number; frases?: number; modulo?: string };

type Ouvinte = (e: EventoDoPaciente) => void;
const ouvintes = new Set<Ouvinte>();

export function emitir(e: EventoDoPaciente): void {
  for (const o of ouvintes) {
    try {
      o(e);
    } catch (err) {
      // um ouvinte com defeito não pode derrubar a tela do paciente
      console.warn('[cloud] ouvinte falhou', err);
    }
  }
}

export function ouvir(o: Ouvinte): () => void {
  ouvintes.add(o);
  return () => { ouvintes.delete(o); };
}

// Atalhos legíveis nas telas.
export const emitirFalaDoPaciente = (texto: string, kind: MessageKind = 'texto') =>
  emitir({ tipo: 'fala', texto, kind });
export const emitirPedidoDeAjuda = (kind: HelpKind, mensagem: string) =>
  emitir({ tipo: 'ajuda', kind, mensagem });
export const emitirResultadoDeCalibracao = (
  resultado: AccuracyResult, meta: RunMeta | null, duracaoCalibracaoS: number | null,
) => emitir({ tipo: 'calibracao', resultado, meta, duracaoCalibracaoS });
export const emitirUso = (uso: { caracteres?: number; frases?: number; modulo?: string }) =>
  emitir({ tipo: 'uso', ...uso });

/** Só para testes: zera os ouvintes. */
export function _limparOuvintes(): void {
  ouvintes.clear();
}
