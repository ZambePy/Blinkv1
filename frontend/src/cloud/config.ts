/**
 * Configuração da nuvem do IrisFlow (projeto Supabase "Site Iris Flow").
 *
 * É o MESMO projeto do site e do app do cuidador. Sem estas variáveis o app
 * roda 100% local, como sempre rodou: login vira uma tela de passagem,
 * nenhuma mensagem sai e nada é bloqueado por licença. Com elas, o e-mail e a
 * senha da assinatura passam a valer aqui, condicionados ao pagamento
 * (`desktop_license()` no banco).
 *
 * Copie `frontend/.env.example` para `frontend/.env.local` e preencha.
 */
const url = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

export const cloudConfig = {
  url,
  anonKey,
  /** Edge Function por onde o desktop escreve (heartbeat, sessão, mensagens, socorro). */
  desktopSyncUrl: (import.meta.env.VITE_DESKTOP_SYNC_URL ?? '').trim() || (url ? `${url}/functions/v1/desktop-sync` : ''),
  /** Site da IrisFlow, para o link "gerenciar assinatura" nas telas de bloqueio. */
  siteUrl: (import.meta.env.VITE_SITE_URL ?? '').trim() || 'https://irisflow.com.br',
  /** Dias que uma licença já verificada continua valendo sem internet. */
  carenciaOfflineDias: Number(import.meta.env.VITE_LICENSE_OFFLINE_DAYS ?? 7) || 7,
  /** Intervalo do heartbeat que mantém o computador "online" no app do cuidador. */
  heartbeatMs: 30_000,
} as const;

/** Verdadeiro quando URL e chave anônima estão preenchidas. */
export const nuvemConfigurada = url.startsWith('https://') && anonKey.length > 20;
