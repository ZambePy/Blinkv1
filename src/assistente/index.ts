/**
 * Assistente de composição — o "chatbot integrado" do plano de produto,
 * implementado como sugestão LOCAL.
 *
 * A decisão de projeto está aqui e é deliberada: nada neste módulo fala com a
 * rede. O paciente escreve, o modelo aprende no próprio computador, e a
 * sugestão sai do que ele já disse. Um serviço de nuvem daria frases mais
 * fluentes, mas custaria três coisas que o produto não pode pagar hoje: enviar
 * conversa de saúde para fora do dispositivo, custo por usuário ativo, e
 * dependência de internet numa tela que precisa funcionar sempre.
 *
 * A porta para a nuvem fica aberta e explícita — `ModoDoAssistente` já prevê
 * `'nuvem'` —, mas ligá-la exige autorização por funcionalidade, como a voz
 * clonada. Enquanto isso não existir, `'local'` é o único modo disponível e o
 * produto funciona inteiro sem ele.
 */

export { normalizar, semAcento, tokenizar, comecaCom, pedindoProximaPalavra } from './normalizar';
export { PALAVRAS_COMUNS, BIGRAMAS_COMUNS, FRASES_DE_PARTIDA } from './dicionario';
export {
  LIMITES,
  aprenderBigrama,
  aprenderFrase,
  aprenderPalavra,
  aprenderResposta,
  modeloVazio,
  podar,
  sanearModelo,
  tamanhoDoModelo,
  type FraseAprendida,
  type ModeloDoAssistente,
} from './modelo';
export { sugerirPalavras, type PedidoDePalavras } from './palavras';
export {
  ehPergunta,
  regraPara,
  sugerirFrases,
  type OrigemDaSugestao,
  type PedidoDeFrases,
  type SugestaoDeFrase,
} from './frases';

/**
 * Onde a sugestão é calculada. Só `'local'` está implementado; `'nuvem'` existe
 * no tipo para que as telas já tratem o caso e a troca futura não vire uma
 * varredura pelo código inteiro.
 */
export type ModoDoAssistente = 'local' | 'nuvem';

/** O que a interface precisa saber para decidir o que mostrar. */
export interface EstadoDoAssistente {
  /** O plano libera o assistente (`features.assistente`). */
  liberado: boolean;
  modo: ModoDoAssistente;
  /** `true` quando o paciente desligou as sugestões nos ajustes. */
  desligadoPeloUsuario: boolean;
}

export function assistenteAtivo(estado: EstadoDoAssistente): boolean {
  return estado.liberado && !estado.desligadoPeloUsuario && estado.modo === 'local';
}
