/**
 * Dicionário de partida do assistente: o que ele sabe ANTES de conhecer o
 * paciente.
 *
 * Nada aqui é genérico de língua portuguesa — é vocabulário de quem se comunica
 * por fixação ocular e paga caro por cada letra. Por isso a ordem importa: a
 * lista é percorrida de cima para baixo no desempate, então as primeiras
 * palavras são as que resolvem necessidade imediata ("quero", "preciso",
 * "estou", "dor"), não as mais frequentes do idioma.
 *
 * O modelo do paciente (`modelo.ts`) sempre ganha deste dicionário: quem usa o
 * aparelho todo dia tem um vocabulário próprio, e a primeira semana de uso já
 * deveria empurrar as palavras dele para a frente.
 */

export const PALAVRAS_COMUNS: readonly string[] = [
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
  'entrar', 'subir', 'descer', 'olhar', 'escutar', 'sentir', 'pensar', 'saber', 'lembrar',
];

export const BIGRAMAS_COMUNS: Readonly<Record<string, readonly string[]>> = {
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
  dor: ['de cabeça', 'nas costas', 'na perna', 'no braço', 'forte', 'aqui'],
  sinto: ['dor', 'frio', 'calor', 'falta de ar', 'sono', 'medo'],
  tem: ['alguém aí', 'como', 'certeza'],
  vamos: ['sair', 'conversar', 'descansar', 'assistir'],
};

/**
 * Frases inteiras oferecidas quando ainda não há histórico nenhum do paciente.
 * Um teclado ocular sem sugestão de frase custa dezenas de fixações para dizer
 * "estou com dor" — estas cobrem o primeiro dia de uso, e vão sendo empurradas
 * para trás conforme o paciente forma as frases dele.
 */
export const FRASES_DE_PARTIDA: readonly string[] = [
  'Estou bem',
  'Estou com dor',
  'Preciso de ajuda',
  'Quero água',
  'Quero mudar de posição',
  'Obrigado',
  'Espere um pouco',
  'Chame alguém, por favor',
];
