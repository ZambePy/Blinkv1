/**
 * Sugestão de FRASE — o módulo que transforma predição de palavra em conversa.
 *
 * A diferença de valor entre os dois é grande. Completar "águ" → "água" poupa
 * duas letras. Oferecer "Sim, por favor" logo depois de o cuidador perguntar
 * "quer água?" poupa a frase inteira: quatorze letras, ~30 fixações, quase um
 * minuto de espera para quem está do outro lado. É a métrica que o plano de
 * negócios adota para este módulo — fixações economizadas por frase — e é aqui
 * que ela é ganha.
 *
 * Três fontes, nesta ordem de prioridade:
 *
 *   1. APRENDIDA — o que este paciente já respondeu a esta mesma pergunta.
 *      Ninguém prevê melhor a resposta dele do que ele mesmo.
 *   2. REGRA — o que a forma da pergunta pede. Pergunta fechada pede sim/não;
 *      "está com dor?" pede uma escala; "quer que eu chame alguém?" pede
 *      autorização. São regras declaradas e legíveis, não um modelo opaco:
 *      dá para explicar ao cuidador por que aquela sugestão apareceu.
 *   3. FREQUENTE — as frases que o paciente mais usa, com recência.
 *
 * Tudo roda no dispositivo, sem rede. É a diferença entre um chatbot que exige
 * autorização de envio de dados e um assistente que funciona no primeiro dia,
 * offline, sem enviar a conversa de ninguém para lugar nenhum.
 */

import { FRASES_DE_PARTIDA } from './dicionario';
import type { ModeloDoAssistente } from './modelo';
import { normalizar } from './normalizar';

export type OrigemDaSugestao = 'aprendida' | 'regra' | 'frequente' | 'completar';

export interface SugestaoDeFrase {
  /** Como será mostrada e falada, com acento e pontuação. */
  texto: string;
  origem: OrigemDaSugestao;
}

export interface PedidoDeFrases {
  /** Última mensagem que o cuidador mandou, se houver. */
  mensagemDoCuidador?: string;
  /** O que o paciente já escreveu no campo, se estiver compondo. */
  textoAtual?: string;
  modelo: ModeloDoAssistente;
  maximo?: number;
  agoraMs?: number;
}

interface Regra {
  /** Nome legível — aparece nos testes e no log, não na tela. */
  nome: string;
  quando: RegExp;
  respostas: readonly string[];
}

/**
 * As regras são avaliadas em ordem e a PRIMEIRA que casar vence, então elas vão
 * do mais específico ao mais genérico. Uma regra genérica no topo apagaria
 * todas as outras.
 */
const REGRAS: readonly Regra[] = [
  {
    nome: 'dor',
    quando: /\b(dor|doendo|doi|machuca|incomod\w*)\b/,
    respostas: ['Sim, estou com dor', 'Um pouco', 'Não, estou bem', 'Está piorando'],
  },
  {
    nome: 'chamar-alguem',
    quando: /\b(chamo|chamar|chame|ligo|ligar para|aviso|avisar)\b/,
    respostas: ['Sim, por favor', 'Não precisa', 'Daqui a pouco'],
  },
  {
    nome: 'como-esta',
    quando: /\b(como (voce |vc )?(esta|se sente|vai)|tudo bem|esta bem|se sente)\b/,
    respostas: ['Estou bem', 'Mais ou menos', 'Não estou bem', 'Estou cansado'],
  },
  {
    nome: 'oferta',
    quando: /\b(quer|queria|gostaria|deseja|aceita|precisa|posso|quer que eu|vamos)\b/,
    respostas: ['Sim, por favor', 'Não, obrigado', 'Daqui a pouco', 'Um pouco'],
  },
  {
    nome: 'posicao',
    quando: /\b(posicao|deitar|sentar|virar|almofada|travesseiro|cobertor)\b/,
    respostas: ['Sim, por favor', 'Estou confortável', 'Um pouco mais', 'Assim está bom'],
  },
  {
    nome: 'saudacao',
    quando: /\b(bom dia|boa tarde|boa noite|oi|ola|cheguei|estou aqui)\b/,
    respostas: ['Oi', 'Bom dia', 'Que bom que você chegou', 'Estou aqui'],
  },
  {
    nome: 'despedida',
    quando: /\b(ja volto|vou sair|ate logo|tchau|volto (logo|ja))\b/,
    respostas: ['Está bem', 'Não demore', 'Tchau', 'Preciso de você aqui'],
  },
];

/** Resposta de última instância para qualquer pergunta que não casou regra. */
const RESPOSTAS_GENERICAS: readonly string[] = ['Sim', 'Não', 'Não sei', 'Espere um pouco'];

/** A mensagem do cuidador é uma pergunta? Ponto de interrogação ou forma interrogativa. */
export function ehPergunta(mensagem: string): boolean {
  if (/\?/.test(mensagem)) return true;
  const n = normalizar(mensagem);
  return /^(voce|vc|quer|queria|gostaria|deseja|aceita|precisa|posso|pode|esta|tem|quando|onde|como|qual|quantos?|quem|por que|porque)\b/.test(n);
}

/** Qual regra responde a esta mensagem. Exportada para o teste e para o log. */
export function regraPara(mensagem: string): Regra | null {
  const n = normalizar(mensagem);
  return REGRAS.find((r) => r.quando.test(n)) ?? null;
}

function pesoDaFrase(n: number, em: number, agoraMs: number): number {
  const MEIA_VIDA_MS = 30 * 24 * 3600_000;
  return n * Math.pow(0.5, Math.max(0, agoraMs - em) / MEIA_VIDA_MS);
}

export function sugerirFrases({
  mensagemDoCuidador,
  textoAtual,
  modelo,
  maximo = 4,
  agoraMs = Date.now(),
}: PedidoDeFrases): SugestaoDeFrase[] {
  const escolhidas: SugestaoDeFrase[] = [];
  const vistas = new Set<string>();

  const juntar = (texto: string, origem: OrigemDaSugestao) => {
    const t = texto.trim().replace(/\s+/g, ' ');
    if (!t) return;
    const chave = normalizar(t);
    if (!chave || vistas.has(chave)) return;
    vistas.add(chave);
    escolhidas.push({ texto: t, origem });
  };

  // 1. Completar o que já está escrito. Quando o paciente já começou a frase,
  //    oferecer respostas prontas a uma pergunta seria trocar o assunto — o que
  //    ele quer é terminar o que começou.
  const emComposicao = (textoAtual ?? '').trim();
  // `normalizar` come toda a pontuação, então um texto só de pontuação ("?",
  // "...") vira prefixo VAZIO — e prefixo vazio casa com todas as frases do
  // histórico, que sairiam como "completar" e engoliriam as respostas à
  // pergunta do cuidador. Um "?" digitado por engano trocaria "Sim, por favor"
  // por sugestões aleatórias.
  const prefixoDaComposicao = normalizar(emComposicao);
  if (prefixoDaComposicao) {
    const prefixo = prefixoDaComposicao;
    const candidatas = Object.values(modelo.frases)
      .filter((f) => {
        const n = normalizar(f.texto);
        return n.startsWith(prefixo) && n !== prefixo;
      })
      .sort((a, b) => pesoDaFrase(b.n, b.em, agoraMs) - pesoDaFrase(a.n, a.em, agoraMs));
    for (const f of candidatas) {
      if (escolhidas.length >= maximo) break;
      juntar(f.texto, 'completar');
    }
    if (escolhidas.length >= maximo) return escolhidas.slice(0, maximo);
  }

  // 2. O que ele já respondeu a esta pergunta.
  if (mensagemDoCuidador) {
    const chave = normalizar(mensagemDoCuidador);
    const aprendidas = Object.entries(modelo.respostas[chave] ?? {}).sort((a, b) => b[1] - a[1]);
    for (const [resposta] of aprendidas) {
      if (escolhidas.length >= maximo) break;
      juntar(resposta, 'aprendida');
    }

    // 3. O que a forma da pergunta pede.
    const regra = regraPara(mensagemDoCuidador);
    const respostas = regra ? regra.respostas : ehPergunta(mensagemDoCuidador) ? RESPOSTAS_GENERICAS : [];
    for (const r of respostas) {
      if (escolhidas.length >= maximo) break;
      juntar(r, 'regra');
    }
  }

  // 4. O que ele mais diz — e, sem histórico nenhum, as frases de partida.
  if (escolhidas.length < maximo) {
    const frequentes = Object.values(modelo.frases).sort(
      (a, b) => pesoDaFrase(b.n, b.em, agoraMs) - pesoDaFrase(a.n, a.em, agoraMs),
    );
    for (const f of frequentes) {
      if (escolhidas.length >= maximo) break;
      juntar(f.texto, 'frequente');
    }
    for (const f of FRASES_DE_PARTIDA) {
      if (escolhidas.length >= maximo) break;
      juntar(f, 'frequente');
    }
  }

  return escolhidas.slice(0, maximo);
}
