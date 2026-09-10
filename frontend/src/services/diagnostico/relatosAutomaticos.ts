/**
 * Relatos de falha automáticos — opt-in, desligado por padrão.
 *
 * O relatório de suporte manual já existia. O que faltava era ele chegar sem
 * que alguém precisasse abrir Ajustes: na prática, o cuidador não abre, e o
 * primeiro sinal de que o app falhou é a família desistindo dele.
 *
 * Duas regras governam este arquivo, e são as mesmas da política de
 * privacidade (camada 2 — sai só com conta vinculada, e só se autorizado):
 *
 *   1. Desligado por padrão. Liga-se em Ajustes; um convite aparece uma vez,
 *      na primeira abertura com conta vinculada, e depois nunca mais.
 *   2. O conteúdo é EXATAMENTE o do relatório manual — `montarRelatorio()`,
 *      que tem teste garantindo que nenhuma frase do paciente entra. Este
 *      módulo não monta nada por conta própria.
 *
 * E uma de engenharia: um app em loop de erro não pode virar uma tempestade
 * de envios. No máximo um relato a cada 10 min e cinco por sessão; o servidor
 * ainda aplica o próprio teto por hora.
 */

export const CHAVE_LIGADO = 'irisflow.relatos.automaticos';
export const CHAVE_CONVITE_VISTO = 'irisflow.relatos.convite-visto';

/** Intervalo mínimo entre relatos automáticos. */
export const INTERVALO_MINIMO_MS = 10 * 60_000;
/** Teto por sessão do aplicativo (reinicia ao reabrir). */
export const MAXIMO_POR_SESSAO = 5;

type Enviador = (motivo: 'erro', resumo: string) => Promise<boolean>;

let enviador: Enviador | null = null;
let ultimoEnvioMs = -Infinity;
let enviadosNestaSessao = 0;
let instalado = false;

function ler(chave: string): boolean {
  try {
    return localStorage.getItem(chave) === '1';
  } catch {
    return false;
  }
}

function gravar(chave: string, valor: boolean): void {
  try {
    if (valor) localStorage.setItem(chave, '1');
    else localStorage.removeItem(chave);
  } catch {
    /* sem armazenamento: vale só nesta sessão */
  }
}

export function relatosAutomaticosLigados(): boolean {
  return ler(CHAVE_LIGADO);
}

export function definirRelatosAutomaticos(ligado: boolean): void {
  gravar(CHAVE_LIGADO, ligado);
  // Decidir — para qualquer lado — encerra o convite.
  gravar(CHAVE_CONVITE_VISTO, true);
}

export function conviteJaVisto(): boolean {
  return ler(CHAVE_CONVITE_VISTO);
}

export function marcarConviteVisto(): void {
  gravar(CHAVE_CONVITE_VISTO, true);
}

/**
 * Quem sabe enviar (o `CloudProvider`, que tem a chave do computador) se
 * registra aqui. Sem registro, os erros só ficam no anel do relatório manual.
 */
export function registrarEnviador(fn: Enviador | null): void {
  enviador = fn;
}

/**
 * Decide se este erro vira um relato agora. Pura em relação ao tempo para o
 * teste; a captura de erros chama com `performance.now()`.
 */
export function deveEnviarAgora(agoraMs: number): boolean {
  if (!relatosAutomaticosLigados()) return false;
  if (!enviador) return false;
  if (enviadosNestaSessao >= MAXIMO_POR_SESSAO) return false;
  if (agoraMs - ultimoEnvioMs < INTERVALO_MINIMO_MS) return false;
  return true;
}

async function tentarEnviar(resumo: string, agoraMs: number): Promise<void> {
  if (!deveEnviarAgora(agoraMs)) return;
  // Marca ANTES de enviar: se o próprio envio lançar, o erro dele não pode
  // disparar um segundo envio dentro do mesmo minuto.
  ultimoEnvioMs = agoraMs;
  enviadosNestaSessao++;
  try {
    await enviador!('erro', resumo.slice(0, 200));
  } catch (e) {
    console.warn('[relatos] envio automático falhou:', e);
  }
}

/**
 * Liga a escuta de erros. Idempotente. Roda ao lado de
 * `instalarCapturaDeErros()`, que alimenta o anel do relatório; aqui só se
 * decide QUANDO um erro vira um envio.
 */
export function instalarRelatosAutomaticos(): void {
  if (instalado || typeof window === 'undefined') return;
  instalado = true;
  window.addEventListener('error', (e) => {
    void tentarEnviar(`erro: ${e.message}`, performance.now());
  });
  window.addEventListener('unhandledrejection', (e) => {
    const razao = (e as PromiseRejectionEvent).reason;
    const texto = razao instanceof Error ? `${razao.name}: ${razao.message}` : String(razao);
    void tentarEnviar(`promessa: ${texto}`, performance.now());
  });
}

/** Só para os testes. */
export function _reiniciarParaTeste(): void {
  enviador = null;
  ultimoEnvioMs = -Infinity;
  enviadosNestaSessao = 0;
}
