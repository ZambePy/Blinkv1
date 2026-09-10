/**
 * Relatório de suporte — um arquivo para o cuidador anexar quando algo dá
 * errado, sem que ele precise saber abrir console nenhum.
 *
 * A regra que governa o conteúdo é a mesma promessa do produto, e vale
 * repetir porque um arquivo de diagnóstico é exatamente onde ela costuma ser
 * quebrada: **nada do que o paciente escreveu entra aqui**. Nem frase, nem
 * palavra, nem trecho de conversa, nem imagem, nem vetor de calibração. O que
 * entra são NÚMEROS sobre o funcionamento — quantas frases, com que precisão,
 * em que máquina, com que erro.
 *
 * Se alguém precisar do conteúdo para depurar, a resposta certa é reproduzir o
 * problema, não exportar a vida de comunicação de uma pessoa por e-mail.
 */

import { getClinicalData } from '../../utils/clinicalLogger';
import { resumoDoModelo } from '../assistente';
import { modoApresentacaoAtivo } from '../apresentacao';

export interface RelatorioDeSuporte {
  gerado_em: string;
  aplicativo: {
    nome: string;
    versao: string | null;
    plataforma: string;
    idioma: string;
    modo_apresentacao: boolean;
  };
  computador: {
    nucleos: number | null;
    memoria_aproximada_gb: number | null;
    tela: { largura: number; altura: number; escala: number };
    agente: string;
  };
  rastreamento: {
    calibracoes_registradas: number;
    ultimo_erro_graus: number | null;
    melhor_erro_graus: number | null;
  };
  uso: {
    frases_faladas: number;
    caracteres: number;
    primeira_sessao: string | null;
    ultima_sessao: string | null;
  };
  assistente: { palavras: number; frases: number; perguntas: number; kb: number };
  voz: { motor: string; modelo_baixado: boolean; voz_importada: boolean; cache_mb: number } | null;
  erros_recentes: string[];
}

/**
 * Últimos erros do console.
 *
 * Um instalador não tem como pedir "abra o DevTools e me mande o print" para
 * uma família. Este anel guarda as últimas mensagens de erro e aviso desde a
 * abertura do app, e é a única parte do relatório que pode conter texto livre —
 * por isso ela é truncada e nunca inclui o conteúdo digitado pelo paciente:
 * o app não loga o que ele escreve.
 */
const MAX_ERROS = 40;
const errosRecentes: string[] = [];
let instalado = false;

export function instalarCapturaDeErros(): void {
  if (instalado) return;
  instalado = true;

  const guardar = (nivel: string, args: unknown[]) => {
    const texto = args
      .map((a) => (a instanceof Error ? `${a.name}: ${a.message}` : typeof a === 'string' ? a : safeStringify(a)))
      .join(' ')
      .slice(0, 400);
    errosRecentes.push(`${new Date().toISOString()} [${nivel}] ${texto}`);
    if (errosRecentes.length > MAX_ERROS) errosRecentes.shift();
  };

  const erroOriginal = console.error;
  const avisoOriginal = console.warn;
  console.error = (...args: unknown[]) => {
    guardar('erro', args);
    erroOriginal(...args);
  };
  console.warn = (...args: unknown[]) => {
    guardar('aviso', args);
    avisoOriginal(...args);
  };

  window.addEventListener('error', (e) => guardar('janela', [e.message]));
  window.addEventListener('unhandledrejection', (e) => guardar('promessa', [String((e as PromiseRejectionEvent).reason)]));
}

function safeStringify(v: unknown): string {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

interface EstadoDaVozParaRelatorio {
  motor: string;
  modelo: { baixado: boolean };
  voz: { importada: boolean };
  cache: { mb: number };
}

export function montarRelatorio(opcoes: {
  versao?: string | null;
  estadoDaVoz?: EstadoDaVozParaRelatorio | null;
} = {}): RelatorioDeSuporte {
  const clinico = getClinicalData();
  const calibracoes = clinico.calibrations ?? [];
  const erros = calibracoes.map((c) => c.errorDeg).filter((n): n is number => typeof n === 'number' && Number.isFinite(n));
  const faladas = clinico.sentences ?? [];

  const nav = navigator as Navigator & { deviceMemory?: number };

  return {
    gerado_em: new Date().toISOString(),
    aplicativo: {
      nome: 'IrisFlow Communicator',
      versao: opcoes.versao ?? null,
      plataforma: nav.platform ?? 'desconhecida',
      idioma: nav.language ?? 'desconhecido',
      modo_apresentacao: modoApresentacaoAtivo(),
    },
    computador: {
      nucleos: typeof nav.hardwareConcurrency === 'number' ? nav.hardwareConcurrency : null,
      memoria_aproximada_gb: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
      tela: {
        largura: window.screen?.width ?? 0,
        altura: window.screen?.height ?? 0,
        escala: window.devicePixelRatio ?? 1,
      },
      agente: (nav.userAgent ?? '').slice(0, 200),
    },
    rastreamento: {
      calibracoes_registradas: calibracoes.length,
      ultimo_erro_graus: erros.length ? erros[erros.length - 1] : null,
      melhor_erro_graus: erros.length ? Math.min(...erros) : null,
    },
    uso: {
      // Só a CONTAGEM. O texto das frases fica no computador, onde nasceu.
      frases_faladas: faladas.length,
      caracteres: faladas.reduce((s, f) => s + (f.text?.length ?? 0), 0),
      primeira_sessao: faladas.length ? (faladas[0].timestamp ?? null) : null,
      ultima_sessao: faladas.length ? (faladas[faladas.length - 1].timestamp ?? null) : null,
    },
    assistente: resumoDoModelo(),
    voz: opcoes.estadoDaVoz
      ? {
          motor: opcoes.estadoDaVoz.motor,
          modelo_baixado: opcoes.estadoDaVoz.modelo.baixado,
          voz_importada: opcoes.estadoDaVoz.voz.importada,
          cache_mb: opcoes.estadoDaVoz.cache.mb,
        }
      : null,
    erros_recentes: [...errosRecentes],
  };
}

/** Nome do arquivo, com data — o cuidador vai anexar isto a um e-mail. */
export function nomeDoArquivo(agora = new Date()): string {
  const iso = agora.toISOString().slice(0, 19).replace(/[:T]/g, '-');
  return `irisflow-suporte-${iso}.json`;
}

/**
 * Baixa o relatório. Usa um blob e um link temporário: o app roda em `file://`
 * dentro do Electron, onde não há servidor para servir o arquivo, e o download
 * do renderer é o caminho que o main já trata.
 */
export function baixarRelatorio(relatorio: RelatorioDeSuporte): void {
  const blob = new Blob([JSON.stringify(relatorio, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = nomeDoArquivo();
  document.body.appendChild(a);
  a.click();
  a.remove();
  // Revogar na hora corta o download em alguns navegadores; um quadro depois é
  // o suficiente e não vaza a URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** Só para os testes. */
export function _erros(): string[] {
  return errosRecentes;
}
