// Motor local de predição de palavras e n-gramas em português brasileiro

// 1. Dicionário estático de termos comuns em contexto assistivo/médico
const COMMON_WORDS = [
  'quero', 'preciso', 'estou', 'dor', 'banheiro', 'água', 'comer', 'beber', 'fome', 'sede',
  'frio', 'calor', 'sono', 'cansaço', 'cobertor', 'travesseiro', 'mudar', 'posição', 'ligar', 'televisão',
  'música', 'conversar', 'chamar', 'cuidador', 'médico', 'família', 'obrigado', 'por favor', 'sim', 'não',
  'está', 'aqui', 'agora', 'depois', 'hoje', 'amanhã', 'remédio', 'deitar', 'sentar', 'ajuda',
  'coçar', 'coceira', 'respiração', 'ar', 'janela', 'porta', 'fechar', 'abrir', 'luz', 'escuro',
  'óculos', 'limpar', 'olho', 'boca', 'dente', 'lavar', 'banho', 'sabonete', 'toalha', 'calçar',
  'sapato', 'roupa', 'vestir', 'tirar', 'meia', 'falar', 'escrever', 'ler', 'livro', 'celular',
  'telefone', 'computador', 'internet', 'jogo', 'ouvir', 'ver', 'assistir', 'filme', 'notícia', 'tempo',
  'chuva', 'sol', 'vento', 'quente', 'gelado', 'suco', 'chá', 'café', 'leite', 'pão',
  'bolacha', 'fruta', 'maçã', 'banana', 'sopa', 'arroz', 'feijão', 'carne', 'peixe', 'frango',
  'salada', 'doce', 'açúcar', 'sal', 'prato', 'copo', 'colher', 'garfo', 'faca', 'guardanapo',
  'cadeira', 'cama', 'sofá', 'mesa', 'quarto', 'sala', 'cozinha', 'clínica', 'hospital', 'casa',
  'rua', 'carro', 'passear', 'andar', 'ficar', 'esperar', 'vir', 'ir', 'voltar', 'sair',
  'entrar', 'subir', 'descer', 'olhar', 'escutar', 'sentir', 'pensar', 'saber', 'lembrar'
];

// 2. Bigramas estáticos pré-definidos (próxima palavra mais provável)
const COMMON_BIGRAMS: Record<string, string[]> = {
  quero: ['comer', 'beber', 'ir', 'descansar', 'água', 'conversar', 'deitar', 'sair', 'dormir'],
  estou: ['bem', 'com dor', 'com fome', 'com sede', 'cansado', 'com frio', 'com calor', 'com sono', 'aqui'],
  preciso: ['de ajuda', 'ir ao banheiro', 'de um cobertor', 'de remédio', 'descansar', 'mudar de posição', 'conversar'],
  pode: ['ajudar', 'abrir a janela', 'fechar a janela', 'ligar a televisão', 'mudar de posição', 'chamar alguém'],
  chamar: ['cuidador', 'médico', 'família', 'alguém', 'enfermeira'],
  ir: ['ao banheiro', 'para o quarto', 'descansar', 'dormir', 'passear', 'deitar'],
  com: ['dor', 'fome', 'sede', 'frio', 'calor', 'sono', 'cansaço', 'pressa', 'medo'],
  de: ['ajuda', 'remédio', 'cobertor', 'água', 'comida', 'suco', 'café', 'leite'],
  mudar: ['de posição', 'de canal', 'a música'],
  abrir: ['a janela', 'a porta', 'o olho'],
  fechar: ['a janela', 'a porta', 'o olho'],
  ligar: ['a televisão', 'a luz', 'o ventilador', 'o ar condicionado', 'o computador'],
  desligar: ['a televisão', 'a luz', 'o ventilador', 'o ar condicionado', 'o computador'],
};

// Estruturas do localStorage
interface UserWord {
  word: string;
  count: number;
}

interface UserBigram {
  w1: string;
  w2: string;
  count: number;
}

const STORAGE_KEYS = {
  WORDS: 'irisflow_user_words',
  BIGRAMS: 'irisflow_user_bigrams',
};

// Carrega dados do localStorage
const loadUserWords = (): UserWord[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.WORDS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

const loadUserBigrams = (): UserBigram[] => {
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.BIGRAMS);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
};

// Salva dados no localStorage
const saveUserWords = (data: UserWord[]) => {
  try {
    localStorage.setItem(STORAGE_KEYS.WORDS, JSON.stringify(data));
  } catch (e) {
    console.warn('Erro ao salvar palavras do usuário:', e);
  }
};

const saveUserBigrams = (data: UserBigram[]) => {
  try {
    localStorage.setItem(STORAGE_KEYS.BIGRAMS, JSON.stringify(data));
  } catch (e) {
    console.warn('Erro ao salvar bigramas do usuário:', e);
  }
};

// 3. Funções públicas de aprendizado
export const learnWord = (rawWord: string) => {
  const word = rawWord.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '');
  if (!word || word.length < 2) return;

  const words = loadUserWords();
  const existing = words.find((w) => w.word === word);
  if (existing) {
    existing.count += 1;
  } else {
    words.push({ word, count: 1 });
  }

  // Ordena por uso e mantém limite de 500 palavras aprendidas
  words.sort((a, b) => b.count - a.count);
  saveUserWords(words.slice(0, 500));
};

export const learnBigram = (w1Raw: string, w2Raw: string) => {
  const w1 = w1Raw.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '');
  const w2 = w2Raw.trim().toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '');
  if (!w1 || !w2 || w1.length < 2 || w2.length < 2) return;

  const bigrams = loadUserBigrams();
  const existing = bigrams.find((b) => b.w1 === w1 && b.w2 === w2);
  if (existing) {
    existing.count += 1;
  } else {
    bigrams.push({ w1, w2, count: 1 });
  }

  bigrams.sort((a, b) => b.count - a.count);
  saveUserBigrams(bigrams.slice(0, 500));
};

// Aprende toda uma frase digitada
export const learnSentence = (sentence: string) => {
  const tokens = sentence.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return;

  for (let i = 0; i < tokens.length; i++) {
    learnWord(tokens[i]);
    if (i < tokens.length - 1) {
      learnBigram(tokens[i], tokens[i + 1]);
    }
  }
};

// 4. Função principal de predição
export const getPredictions = (text: string): string[] => {
  // Limpa espaços duplicados
  const trimmed = text.replace(/\s+/g, ' ');
  const isNextWord = text.endsWith(' ') && text.trim().length > 0;
  const tokens = trimmed.trim().split(' ').filter(Boolean);

  const userWords = loadUserWords();
  const userBigrams = loadUserBigrams();
  const suggestionsSet = new Set<string>();

  // Caso 1: Próxima palavra (se o texto termina com espaço)
  if (isNextWord && tokens.length > 0) {
    const lastWord = tokens[tokens.length - 1].toLowerCase();

    // 1a. Buscar nos bigramas aprendidos do usuário (maior prioridade)
    const matchingUserBigrams = userBigrams.filter((b) => b.w1 === lastWord);
    matchingUserBigrams.forEach((b) => suggestionsSet.add(b.w2));

    // 1b. Buscar nos bigramas estáticos comuns
    const staticNextWords = COMMON_BIGRAMS[lastWord] || [];
    staticNextWords.forEach((word) => suggestionsSet.add(word));
  }
  // Caso 2: Completar palavra atual (se o usuário está digitando)
  else if (tokens.length > 0) {
    const currentWord = tokens[tokens.length - 1].toLowerCase();

    // 2a. Buscar em bigramas da palavra anterior que casem com o prefixo
    if (tokens.length > 1) {
      const prevWord = tokens[tokens.length - 2].toLowerCase();

      const userMatches = userBigrams.filter(
        (b) => b.w1 === prevWord && b.w2.startsWith(currentWord)
      );
      userMatches.forEach((b) => suggestionsSet.add(b.w2));

      const staticMatches = (COMMON_BIGRAMS[prevWord] || []).filter((w) =>
        w.startsWith(currentWord)
      );
      staticMatches.forEach((w) => suggestionsSet.add(w));
    }

    // 2b. Buscar palavras aprendidas pelo usuário que comecem com o prefixo
    const userWordMatches = userWords.filter((w) => w.word.startsWith(currentWord));
    userWordMatches.forEach((w) => suggestionsSet.add(w.word));

    // 2c. Buscar palavras estáticas que comecem com o prefixo
    const staticWordMatches = COMMON_WORDS.filter((w) => w.startsWith(currentWord));
    staticWordMatches.forEach((w) => suggestionsSet.add(w));
  }

  // 3. Fallback: Se não tiver predições suficientes, preenche com as palavras mais usadas
  if (suggestionsSet.size < 4) {
    // Insere as palavras aprendidas mais comuns do usuário
    userWords.slice(0, 10).forEach((w) => {
      if (suggestionsSet.size < 4) {
        suggestionsSet.add(w.word);
      }
    });

    // Insere as palavras comuns padrão
    COMMON_WORDS.slice(0, 15).forEach((w) => {
      if (suggestionsSet.size < 4) {
        suggestionsSet.add(w);
      }
    });
  }

  // Retorna no máximo 4 sugestões exclusivas
  return Array.from(suggestionsSet).slice(0, 4);
};
