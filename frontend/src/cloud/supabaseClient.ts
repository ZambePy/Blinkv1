/**
 * Cliente Supabase do desktop.
 *
 * Um único cliente, criado sob demanda. A sessão (access/refresh token) não
 * fica no localStorage: o adaptador de storage abaixo manda para o cofre
 * cifrado do processo principal (`armazenamento.ts`).
 *
 * `autoRefreshToken` mantém o token vivo enquanto o app está aberto; ao abrir
 * de novo, o supabase-js lê o refresh token do cofre e renova sozinho — é o
 * que faz o login persistir entre sessões sem guardar senha.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { cloudConfig, nuvemConfigurada } from './config';
import { cofre } from './armazenamento';

let cliente: SupabaseClient | null = null;

export function supabase(): SupabaseClient {
  if (!nuvemConfigurada) {
    throw new Error(
      'Nuvem não configurada: preencha VITE_SUPABASE_URL e VITE_SUPABASE_ANON_KEY em frontend/.env.local.',
    );
  }
  if (!cliente) {
    cliente = createClient(cloudConfig.url, cloudConfig.anonKey, {
      auth: {
        storage: {
          getItem: (k) => cofre.ler(`irisflow.sb.${k}`),
          setItem: async (k, v) => { await cofre.gravar(`irisflow.sb.${k}`, v); },
          removeItem: (k) => cofre.remover(`irisflow.sb.${k}`),
        },
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      realtime: { params: { eventsPerSecond: 5 } },
    });
  }
  return cliente;
}

/** Só para testes: injeta um cliente falso. */
export function _definirClienteParaTeste(c: SupabaseClient | null): void {
  cliente = c;
}
