/**
 * Normalização de texto para o assistente local.
 *
 * Duas formas do mesmo texto convivem o tempo todo aqui:
 *
 *   - a forma ORIGINAL, que é a que aparece na tela e é falada. "Não, obrigado"
 *     tem de sair com a vírgula, o til e a maiúscula.
 *   - a forma NORMALIZADA, que serve de chave: minúscula, sem acento, sem
 *     pontuação, espaços colapsados. É o que permite casar "voce quer agua?"
 *     com "Você quer água?" — e quem digita por fixação ocular erra acento e
 *     pontuação o tempo todo, então casar por essa forma não é luxo.
 *
 * A regra do módulo: chave normalizada para comparar, original para mostrar.
 * Nunca o contrário.
 */

/** Remove acentos preservando a letra base. "ação" → "acao". */
export function semAcento(texto: string): string {
  return texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Forma canônica usada como chave de comparação: minúscula, sem acento, sem
 * pontuação e com um espaço só entre palavras.
 */
export function normalizar(texto: string): string {
  return semAcento(texto)
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Palavras de um texto, já normalizadas. Vazio devolve lista vazia. */
export function tokenizar(texto: string): string[] {
  const n = normalizar(texto);
  return n ? n.split(' ') : [];
}

/**
 * O texto está pedindo a PRÓXIMA palavra (terminou com espaço) ou completando
 * a palavra atual? A distinção muda toda a predição, e depende do texto cru —
 * `normalizar` come o espaço final de propósito.
 */
export function pedindoProximaPalavra(textoCru: string): boolean {
  return /\s$/.test(textoCru) && textoCru.trim().length > 0;
}

/**
 * `prefixo` inicia `palavra`, ignorando acento e caixa. Usado na predição:
 * quem digitou "agu" espera ver "água".
 */
export function comecaCom(palavra: string, prefixo: string): boolean {
  if (!prefixo) return true;
  return normalizar(palavra).startsWith(normalizar(prefixo));
}
