/**
 * O modelo do assistente: tudo o que ele aprendeu com ESTE paciente.
 *
 * É um objeto serializável simples, de propósito. Ele mora no computador do
 * paciente (localStorage no renderer) e nunca sai de lá — é o histórico de
 * comunicação de uma pessoa, categoria de dado que o plano promete manter
 * local. Nada aqui tem endereço de rede, e a estrutura é JSON puro justamente
 * para que exportar, apagar e auditar seja trivial.
 *
 * Quatro coisas são aprendidas:
 *
 *   palavras   quantas vezes o paciente usou cada palavra;
 *   bigramas   que palavra ele costuma escrever DEPOIS de outra;
 *   frases     frases inteiras que ele já disse, com frequência e recência;
 *   respostas  o que ele respondeu a cada pergunta do cuidador.
 *
 * A quarta é a que transforma predição de palavra em conversa: quando o
 * cuidador pergunta "quer água?" pela décima vez, a resposta que o paciente
 * deu nas nove anteriores deveria estar a uma fixação de distância.
 *
 * Todas as funções MUTAM o modelo recebido e o devolvem. É deliberado: o modelo
 * é grande, é gravado inteiro a cada fala, e copiar em cada aprendizado era
 * desperdício mensurável num computador que também roda o rastreamento ocular.
 */

import { normalizar } from './normalizar';

export interface FraseAprendida {
  /** Forma original, com acento e pontuação — é o que aparece e é falado. */
  texto: string;
  /** Quantas vezes o paciente disse esta frase. */
  n: number;
  /** Quando disse pela última vez (ms epoch). Recência desempata frequência. */
  em: number;
}

export interface ModeloDoAssistente {
  versao: 1;
  /** palavra (minúscula, com acento) → contagem */
  palavras: Record<string, number>;
  /** primeira palavra → { segunda palavra → contagem } */
  bigramas: Record<string, Record<string, number>>;
  /** chave normalizada da frase → frase aprendida */
  frases: Record<string, FraseAprendida>;
  /** pergunta do cuidador (normalizada) → { resposta original → contagem } */
  respostas: Record<string, Record<string, number>>;
}

/**
 * Tetos de tamanho. O localStorage costuma dar ~5 MB por origem, e o modelo
 * divide esse espaço com perfis de calibração e cache de voz. Estes números
 * mantêm o modelo na casa das dezenas de KB mesmo depois de meses de uso —
 * e um paciente que usa 800 palavras distintas já tem um vocabulário maior do
 * que qualquer predição consegue aproveitar.
 */
export const LIMITES = {
  palavras: 800,
  bigramasPorPalavra: 12,
  primeirasPalavras: 400,
  frases: 300,
  perguntas: 200,
  respostasPorPergunta: 6,
} as const;

/** Frases mais longas que isto não são história de conversa, são texto. */
const MAX_CARACTERES_DA_FRASE = 160;

export function modeloVazio(): ModeloDoAssistente {
  return { versao: 1, palavras: {}, bigramas: {}, frases: {}, respostas: {} };
}

/**
 * Aceita qualquer coisa vinda do disco e devolve um modelo válido. O que estiver
 * corrompido ou for de uma versão futura vira modelo vazio — perder o histórico
 * de sugestões é irritante, travar a tela de comunicação de alguém que não fala
 * é inaceitável.
 */
export function sanearModelo(bruto: unknown): ModeloDoAssistente {
  const m = modeloVazio();
  if (!bruto || typeof bruto !== 'object') return m;
  const o = bruto as Partial<ModeloDoAssistente>;
  if (o.versao !== 1) return m;

  if (o.palavras && typeof o.palavras === 'object') {
    for (const [k, v] of Object.entries(o.palavras)) {
      if (typeof k === 'string' && typeof v === 'number' && Number.isFinite(v) && v > 0) m.palavras[k] = v;
    }
  }
  if (o.bigramas && typeof o.bigramas === 'object') {
    for (const [a, seguintes] of Object.entries(o.bigramas)) {
      if (!seguintes || typeof seguintes !== 'object') continue;
      const dest: Record<string, number> = {};
      for (const [b, v] of Object.entries(seguintes as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) dest[b] = v;
      }
      if (Object.keys(dest).length) m.bigramas[a] = dest;
    }
  }
  if (o.frases && typeof o.frases === 'object') {
    for (const [k, f] of Object.entries(o.frases as Record<string, unknown>)) {
      const cand = f as Partial<FraseAprendida>;
      if (cand && typeof cand.texto === 'string' && typeof cand.n === 'number' && cand.n > 0) {
        m.frases[k] = { texto: cand.texto, n: cand.n, em: typeof cand.em === 'number' ? cand.em : 0 };
      }
    }
  }
  if (o.respostas && typeof o.respostas === 'object') {
    for (const [pergunta, respostas] of Object.entries(o.respostas as Record<string, unknown>)) {
      if (!respostas || typeof respostas !== 'object') continue;
      const dest: Record<string, number> = {};
      for (const [r, v] of Object.entries(respostas as Record<string, unknown>)) {
        if (typeof v === 'number' && Number.isFinite(v) && v > 0) dest[r] = v;
      }
      if (Object.keys(dest).length) m.respostas[pergunta] = dest;
    }
  }
  return m;
}

function limpaPalavra(bruta: string): string {
  return normalizar(bruta) ? bruta.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '') : '';
}

export function aprenderPalavra(modelo: ModeloDoAssistente, bruta: string): ModeloDoAssistente {
  const p = limpaPalavra(bruta);
  if (p.length < 2) return modelo;
  modelo.palavras[p] = (modelo.palavras[p] ?? 0) + 1;
  return modelo;
}

export function aprenderBigrama(modelo: ModeloDoAssistente, primeiraBruta: string, segundaBruta: string): ModeloDoAssistente {
  const a = limpaPalavra(primeiraBruta);
  const b = limpaPalavra(segundaBruta);
  if (a.length < 2 || b.length < 2) return modelo;
  const seguintes = (modelo.bigramas[a] ??= {});
  seguintes[b] = (seguintes[b] ?? 0) + 1;
  return modelo;
}

/**
 * Aprende uma frase que o paciente efetivamente FALOU (não o que ele digitou e
 * apagou). Alimenta as três estruturas de uma vez: palavras, bigramas e a frase
 * inteira.
 */
export function aprenderFrase(modelo: ModeloDoAssistente, frase: string, agoraMs = Date.now()): ModeloDoAssistente {
  const texto = frase.trim().replace(/\s+/g, ' ');
  if (!texto) return modelo;

  const tokens = texto.split(' ').filter(Boolean);
  for (let i = 0; i < tokens.length; i++) {
    aprenderPalavra(modelo, tokens[i]);
    if (i < tokens.length - 1) aprenderBigrama(modelo, tokens[i], tokens[i + 1]);
  }

  if (texto.length <= MAX_CARACTERES_DA_FRASE) {
    const chave = normalizar(texto);
    if (chave) {
      const atual = modelo.frases[chave];
      // A grafia mais recente vence: se o paciente passou a escrever com acento,
      // é essa a forma que ele quer ver de volta.
      modelo.frases[chave] = { texto, n: (atual?.n ?? 0) + 1, em: agoraMs };
    }
  }
  return modelo;
}

/**
 * Aprende que, à pergunta do cuidador, o paciente respondeu isto. A pergunta
 * entra normalizada (é chave); a resposta entra como foi dita (é conteúdo).
 */
export function aprenderResposta(
  modelo: ModeloDoAssistente,
  perguntaDoCuidador: string,
  respostaDoPaciente: string,
  agoraMs = Date.now(),
): ModeloDoAssistente {
  const chave = normalizar(perguntaDoCuidador);
  const resposta = respostaDoPaciente.trim().replace(/\s+/g, ' ');
  if (!chave || !resposta || resposta.length > MAX_CARACTERES_DA_FRASE) return modelo;
  const mapa = (modelo.respostas[chave] ??= {});
  mapa[resposta] = (mapa[resposta] ?? 0) + 1;
  aprenderFrase(modelo, resposta, agoraMs);
  return modelo;
}

function maioresPrimeiro<T>(entradas: [string, T][], peso: (v: T) => number, limite: number): [string, T][] {
  return entradas.sort((x, y) => peso(y[1]) - peso(x[1])).slice(0, limite);
}

/**
 * Corta o modelo nos limites. Chamado depois de aprender, não a cada leitura:
 * podar é O(n log n) e a leitura acontece a cada letra digitada.
 */
export function podar(modelo: ModeloDoAssistente, agoraMs = Date.now()): ModeloDoAssistente {
  const palavras = maioresPrimeiro(Object.entries(modelo.palavras), (n) => n, LIMITES.palavras);
  modelo.palavras = Object.fromEntries(palavras);

  const primeiras = Object.entries(modelo.bigramas);
  const pesoDaPrimeira = (seguintes: Record<string, number>) =>
    Object.values(seguintes).reduce((s, n) => s + n, 0);
  const mantidas = maioresPrimeiro(primeiras, pesoDaPrimeira, LIMITES.primeirasPalavras);
  modelo.bigramas = Object.fromEntries(
    mantidas.map(([a, seguintes]) => [
      a,
      Object.fromEntries(maioresPrimeiro(Object.entries(seguintes), (n) => n, LIMITES.bigramasPorPalavra)),
    ]),
  );

  // Frases: frequência com meia-vida de 30 dias. Uma frase dita 20 vezes há um
  // ano não deve empurrar para fora a que ele disse ontem — o vocabulário de
  // quem convive com uma doença progressiva muda com a doença.
  const MEIA_VIDA_MS = 30 * 24 * 3600_000;
  const pesoDaFrase = (f: FraseAprendida) =>
    f.n * Math.pow(0.5, Math.max(0, agoraMs - f.em) / MEIA_VIDA_MS);
  modelo.frases = Object.fromEntries(maioresPrimeiro(Object.entries(modelo.frases), pesoDaFrase, LIMITES.frases));

  const perguntas = Object.entries(modelo.respostas);
  const pesoDaPergunta = (rs: Record<string, number>) => Object.values(rs).reduce((s, n) => s + n, 0);
  modelo.respostas = Object.fromEntries(
    maioresPrimeiro(perguntas, pesoDaPergunta, LIMITES.perguntas).map(([p, rs]) => [
      p,
      Object.fromEntries(maioresPrimeiro(Object.entries(rs), (n) => n, LIMITES.respostasPorPergunta)),
    ]),
  );

  return modelo;
}

/** Quantos itens o paciente já ensinou — mostrado na tela de ajustes. */
export function tamanhoDoModelo(modelo: ModeloDoAssistente): {
  palavras: number;
  frases: number;
  perguntas: number;
  bytes: number;
} {
  const json = JSON.stringify(modelo);
  return {
    palavras: Object.keys(modelo.palavras).length,
    frases: Object.keys(modelo.frases).length,
    perguntas: Object.keys(modelo.respostas).length,
    bytes: json.length,
  };
}
