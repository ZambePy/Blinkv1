/**
 * Onde o modelo do assistente mora: `localStorage`, no computador do paciente.
 *
 * Escolha deliberada e coerente com a promessa do produto — o histórico de
 * comunicação de uma pessoa é dado de saúde, e este é o tipo de dado que o
 * plano garante que nunca sai do dispositivo. Não há sincronização, não há
 * backup na nuvem, não há telemetria: quem quiser levar o modelo para outro
 * computador exporta o arquivo à mão.
 *
 * Gravação é adiada (`agendarGravacao`). Sem isso, cada letra digitada por
 * fixação ocular disparava um `JSON.stringify` de dezenas de KB no mesmo thread
 * que desenha o cursor de olhar — e engasgo no cursor é a falha mais visível
 * que este aplicativo pode ter.
 */

import {
  aprenderBigrama,
  aprenderFrase,
  aprenderPalavra,
  aprenderResposta,
  modeloVazio,
  podar,
  sanearModelo,
  tamanhoDoModelo,
  type ModeloDoAssistente,
} from '@tracker/assistente';

export const CHAVE_DO_MODELO = 'irisflow.assistente.v1';

/** Chaves do preditor antigo, lidas uma única vez para não perder o aprendido. */
const CHAVES_ANTIGAS = {
  palavras: 'irisflow_user_words',
  bigramas: 'irisflow_user_bigrams',
} as const;

const ATRASO_DE_GRAVACAO_MS = 1500;

let memoria: ModeloDoAssistente | null = null;
let gravacaoAgendada: ReturnType<typeof setTimeout> | null = null;
let aprendizadosDesdeAPoda = 0;

/** Poda a cada N aprendizados: é O(n log n) e não precisa rodar a cada palavra. */
const APRENDIZADOS_ENTRE_PODAS = 40;

function migrarDoPreditorAntigo(modelo: ModeloDoAssistente): boolean {
  let migrou = false;
  try {
    const brutoPalavras = localStorage.getItem(CHAVES_ANTIGAS.palavras);
    if (brutoPalavras) {
      const lista = JSON.parse(brutoPalavras) as { word?: string; count?: number }[];
      if (Array.isArray(lista)) {
        for (const item of lista) {
          if (typeof item?.word === 'string' && typeof item.count === 'number' && item.count > 0) {
            modelo.palavras[item.word] = (modelo.palavras[item.word] ?? 0) + item.count;
            migrou = true;
          }
        }
      }
    }
    const brutoBigramas = localStorage.getItem(CHAVES_ANTIGAS.bigramas);
    if (brutoBigramas) {
      const lista = JSON.parse(brutoBigramas) as { w1?: string; w2?: string; count?: number }[];
      if (Array.isArray(lista)) {
        for (const item of lista) {
          if (typeof item?.w1 === 'string' && typeof item.w2 === 'string' && typeof item.count === 'number') {
            const seguintes = (modelo.bigramas[item.w1] ??= {});
            seguintes[item.w2] = (seguintes[item.w2] ?? 0) + Math.max(1, item.count);
            migrou = true;
          }
        }
      }
    }
  } catch {
    /* preditor antigo corrompido: começa limpo, não é motivo para falhar */
  }
  return migrou;
}

/** O modelo em memória, carregando do disco na primeira chamada. */
export function carregarModelo(): ModeloDoAssistente {
  if (memoria) return memoria;
  let modelo: ModeloDoAssistente;
  try {
    const bruto = localStorage.getItem(CHAVE_DO_MODELO);
    modelo = bruto ? sanearModelo(JSON.parse(bruto)) : modeloVazio();
    if (!bruto && migrarDoPreditorAntigo(modelo)) {
      // Grava já: a migração é única e perdê-la significaria voltar ao vocabulário
      // de fábrica para um paciente que já ensinou o aparelho.
      gravarAgora(modelo);
    }
  } catch {
    modelo = modeloVazio();
  }
  memoria = modelo;
  return modelo;
}

function gravarAgora(modelo: ModeloDoAssistente): void {
  try {
    localStorage.setItem(CHAVE_DO_MODELO, JSON.stringify(modelo));
  } catch {
    // Cota estourada: poda agressiva e uma segunda tentativa. Se ainda falhar,
    // o assistente segue funcionando em memória durante a sessão.
    try {
      podar(modelo);
      localStorage.setItem(CHAVE_DO_MODELO, JSON.stringify(modelo));
    } catch {
      console.warn('[assistente] não foi possível gravar o modelo (cota do armazenamento)');
    }
  }
}

function agendarGravacao(): void {
  if (gravacaoAgendada) clearTimeout(gravacaoAgendada);
  gravacaoAgendada = setTimeout(() => {
    gravacaoAgendada = null;
    if (memoria) gravarAgora(memoria);
  }, ATRASO_DE_GRAVACAO_MS);
}

function contarAprendizado(): void {
  aprendizadosDesdeAPoda++;
  if (aprendizadosDesdeAPoda >= APRENDIZADOS_ENTRE_PODAS && memoria) {
    aprendizadosDesdeAPoda = 0;
    podar(memoria);
  }
  agendarGravacao();
}

/** O paciente FALOU esta frase (não apenas digitou e apagou). */
export function registrarFala(texto: string, respondendoA?: string): void {
  const modelo = carregarModelo();
  if (respondendoA) aprenderResposta(modelo, respondendoA, texto);
  else aprenderFrase(modelo, texto);
  contarAprendizado();
}

/** Aprendizado avulso, usado pelo adaptador do preditor antigo. */
export function registrarPalavra(palavra: string): void {
  aprenderPalavra(carregarModelo(), palavra);
  contarAprendizado();
}

export function registrarBigrama(primeira: string, segunda: string): void {
  aprenderBigrama(carregarModelo(), primeira, segunda);
  contarAprendizado();
}

/** Grava pendências imediatamente — chamado ao fechar a janela. */
export function descarregar(): void {
  if (gravacaoAgendada) {
    clearTimeout(gravacaoAgendada);
    gravacaoAgendada = null;
  }
  if (memoria) gravarAgora(memoria);
}

/** Apaga tudo o que o assistente aprendeu, inclusive o resíduo do preditor antigo. */
export function apagarModelo(): void {
  memoria = modeloVazio();
  aprendizadosDesdeAPoda = 0;
  if (gravacaoAgendada) {
    clearTimeout(gravacaoAgendada);
    gravacaoAgendada = null;
  }
  try {
    localStorage.removeItem(CHAVE_DO_MODELO);
    localStorage.removeItem(CHAVES_ANTIGAS.palavras);
    localStorage.removeItem(CHAVES_ANTIGAS.bigramas);
  } catch {
    /* nada a fazer */
  }
}

/** O que a tela de ajustes mostra sobre o aprendizado. */
export function resumoDoModelo(): { palavras: number; frases: number; perguntas: number; kb: number } {
  const t = tamanhoDoModelo(carregarModelo());
  return { palavras: t.palavras, frases: t.frases, perguntas: t.perguntas, kb: Math.round(t.bytes / 1024) };
}

/** Só para os testes: esquece o que está em memória e relê o disco. */
export function reiniciarParaTeste(): void {
  memoria = null;
  aprendizadosDesdeAPoda = 0;
  if (gravacaoAgendada) {
    clearTimeout(gravacaoAgendada);
    gravacaoAgendada = null;
  }
}
