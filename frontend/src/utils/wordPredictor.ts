/**
 * Adaptador do preditor antigo.
 *
 * A predição de palavra saiu daqui e virou o assistente local em
 * `@tracker/assistente` (motor puro, testado no núcleo) com persistência em
 * `services/assistente`. Este arquivo continua existindo porque telas e testes
 * já importavam estas quatro funções, e trocar a API em todo lugar no mesmo
 * passo em que se troca o motor é como se perde a chance de saber qual dos dois
 * quebrou.
 *
 * O modelo antigo (`irisflow_user_words` / `irisflow_user_bigrams`) é migrado
 * uma única vez na primeira leitura — ninguém perde o vocabulário que ensinou.
 *
 * Para código novo, use `services/assistente` diretamente: ele também sugere
 * FRASES, que é onde está a economia real de fixações.
 */

import { sugerirPalavras } from '@tracker/assistente';
import { carregarModelo, registrarBigrama, registrarFala, registrarPalavra } from '../services/assistente/armazenamento';

export const learnWord = (rawWord: string): void => registrarPalavra(rawWord);

export const learnBigram = (w1Raw: string, w2Raw: string): void => registrarBigrama(w1Raw, w2Raw);

export const learnSentence = (sentence: string): void => registrarFala(sentence);

/**
 * Predição de palavra. Diferente do preditor antigo, aqui a lista sai ORDENADA
 * por relevância (contexto > vocabulário do paciente > dicionário) em vez da
 * ordem de inserção num `Set`.
 */
export const getPredictions = (text: string): string[] =>
  sugerirPalavras({ texto: text, modelo: carregarModelo(), maximo: 4 });
