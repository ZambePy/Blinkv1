/**
 * Caminhos dos ativos da marca, resolvidos a partir de `BASE_URL`.
 *
 * O build usa `base: './'` (o Electron carrega via `file://`), então caminhos
 * absolutos como `/LOGO.png` quebram no app empacotado. Use estas constantes
 * em vez de strings soltas.
 */
const base = import.meta.env.BASE_URL.endsWith('/')
  ? import.meta.env.BASE_URL
  : `${import.meta.env.BASE_URL}/`;

/** Logo completo: íris azul + wordmark "IrisFlow". */
export const LOGO_URL = `${base}LOGO.png`;

/** Só a íris (ícone). */
export const ICON_URL = `${base}REDUZIDO.png`;
