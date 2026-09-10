/**
 * Predição de palavra.
 *
 * O custo real de escrever por fixação ocular não é o tempo de digitar: é o
 * número de fixações. Cada letra custa duas (achar o grupo, achar a letra) mais
 * o tempo de permanência. Uma sugestão aceita economiza tantas fixações quantas
 * forem as letras que faltavam — por isso a predição vale mais que qualquer
 * otimização de layout do teclado.
 *
 * A pontuação abaixo tem uma hierarquia declarada, do mais específico ao mais
 * genérico:
 *
 *   1. o que ESTE paciente escreve depois desta palavra   (bigrama aprendido)
 *   2. o que qualquer pessoa escreve depois desta palavra (bigrama do dicionário)
 *   3. as palavras que ESTE paciente mais usa             (vocabulário aprendido)
 *   4. o dicionário de partida                            (ordem editorial)
 *
 * O contexto sempre ganha da frequência: "com" seguido de "dor" é mais provável
 * que "obrigado", por mais que "obrigado" seja a palavra preferida do paciente.
 */

import { BIGRAMAS_COMUNS, PALAVRAS_COMUNS } from './dicionario';
import type { ModeloDoAssistente } from './modelo';
import { comecaCom, normalizar, pedindoProximaPalavra } from './normalizar';

export interface PedidoDePalavras {
  /** Texto cru do campo de composição, com espaço final se houver. */
  texto: string;
  modelo: ModeloDoAssistente;
  /** Quantas sugestões devolver. O teclado usa 4; a faixa larga, 5. */
  maximo?: number;
}

const PESO = {
  bigramaDoPaciente: 1000,
  bigramaDoDicionario: 500,
  vocabularioDoPaciente: 200,
  dicionario: 100,
  reserva: 1,
} as const;

/** Tira pontuação das pontas para casar prefixo: `"água,"` → `"água"`. */
function limparPonta(bruta: string): string {
  return bruta.replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');
}

export function sugerirPalavras({ texto, modelo, maximo = 4 }: PedidoDePalavras): string[] {
  const pontos = new Map<string, number>();
  const propor = (palavra: string, peso: number) => {
    const p = palavra.trim();
    if (!p) return;
    const atual = pontos.get(p);
    if (atual === undefined || peso > atual) pontos.set(p, peso);
  };

  const tokensCrus = texto.trim().split(/\s+/).map(limparPonta).filter(Boolean);
  const proximaPalavra = pedindoProximaPalavra(texto);

  if (proximaPalavra && tokensCrus.length > 0) {
    const ultima = normalizar(tokensCrus[tokensCrus.length - 1]);
    const aprendidos = modelo.bigramas[ultima] ?? {};
    for (const [palavra, n] of Object.entries(aprendidos)) {
      propor(palavra, PESO.bigramaDoPaciente + n);
    }
    const doDicionario = BIGRAMAS_COMUNS[ultima] ?? [];
    doDicionario.forEach((palavra, i) => propor(palavra, PESO.bigramaDoDicionario - i));
  } else if (tokensCrus.length > 0) {
    const prefixo = tokensCrus[tokensCrus.length - 1];
    const prefixoNormal = normalizar(prefixo);

    if (tokensCrus.length > 1) {
      const anterior = normalizar(tokensCrus[tokensCrus.length - 2]);
      for (const [palavra, n] of Object.entries(modelo.bigramas[anterior] ?? {})) {
        if (comecaCom(palavra, prefixo)) propor(palavra, PESO.bigramaDoPaciente + n);
      }
      (BIGRAMAS_COMUNS[anterior] ?? []).forEach((palavra, i) => {
        if (comecaCom(palavra, prefixo)) propor(palavra, PESO.bigramaDoDicionario - i);
      });
    }

    for (const [palavra, n] of Object.entries(modelo.palavras)) {
      if (comecaCom(palavra, prefixo)) propor(palavra, PESO.vocabularioDoPaciente + n);
    }
    PALAVRAS_COMUNS.forEach((palavra, i) => {
      if (comecaCom(palavra, prefixo)) propor(palavra, PESO.dicionario - i * 0.01);
    });

    // Oferecer de volta exatamente o que já está escrito não economiza fixação
    // nenhuma e ocupa um alvo grande na tela.
    for (const chave of [...pontos.keys()]) {
      if (normalizar(chave) === prefixoNormal) pontos.delete(chave);
    }
  }

  // Reserva: melhor mostrar palavra útil do que célula vazia. Um alvo em branco
  // no teclado ocular é pior que um alvo errado — o paciente fixa nele por
  // engano e perde o tempo de permanência inteiro.
  if (pontos.size < maximo) {
    const maisUsadas = Object.entries(modelo.palavras).sort((a, b) => b[1] - a[1]);
    for (const [palavra, n] of maisUsadas) {
      if (pontos.size >= maximo) break;
      propor(palavra, PESO.reserva + n / 1000);
    }
    for (let i = 0; i < PALAVRAS_COMUNS.length && pontos.size < maximo; i++) {
      propor(PALAVRAS_COMUNS[i], PESO.reserva - i * 0.001);
    }
  }

  return [...pontos.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, maximo)
    .map(([palavra]) => palavra);
}
