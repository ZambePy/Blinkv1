// Política de segurança do processo principal do Electron.
//
// Fica em `src/` (e não inline em `electron/main.ts`) para que a decisão —
// dada uma origem, permitir ou não — seja testável sem abrir o Electron.

/** Permissões que o app legitimamente precisa. */
const PERMISSOES_PERMITIDAS = new Set(['media']);

/**
 * Origens confiáveis: `file://` (build empacotado) e `localhost`/`127.0.0.1`
 * (servidor de dev do Vite). Nenhum host remoto — o app é 100% local.
 */
export function origemConfiavel(url: string | null | undefined): boolean {
  if (!url) return false;
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol === 'file:') return true;
  if (u.protocol === 'http:' && (u.hostname === 'localhost' || u.hostname === '127.0.0.1')) {
    return true;
  }
  return false;
}

/**
 * Só concede o que o app precisa (`media`) e só para origem confiável. Lista
 * explícita, não `default: allow`: a lista de permissões do Chromium cresce.
 */
export function permitirPermissao(
  permission: string,
  url: string | null | undefined,
): boolean {
  return PERMISSOES_PERMITIDAS.has(permission) && origemConfiavel(url);
}

/** O app não navega para fora de si mesmo (um link num texto do paciente, por exemplo). */
export function permitirNavegacao(url: string | null | undefined): boolean {
  return origemConfiavel(url);
}

/**
 * Content-Security-Policy do app.
 *
 * - `'wasm-unsafe-eval'`: MediaPipe e ONNX Runtime compilam WebAssembly.
 * - `'unsafe-inline'` em `style-src`: o React usa `style={{...}}`.
 * - `connect-src` só aceita a própria origem e `localhost` — é o que torna a
 *   promessa de privacidade (nada sai do dispositivo) uma política de
 *   navegador. O `localhost` cobre o servidor de dev e o backend de
 *   demonstração das telas de chatbot/perfis.
 * - `blob:` em worker/media: o worker do L2CS e o `<video>` da câmera.
 *
 * No build empacotado (`file://`) não há cabeçalho HTTP; a mesma política é
 * injetada como `<meta http-equiv>` pelo Vite (ver `frontend/vite.config.ts`).
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  // `https:` em img-src só para as imagens de exemplo da galeria/perfis; nada
  // do paciente sai por aí.
  "img-src 'self' data: blob: https:",
  "media-src 'self' blob:",
  "font-src 'self' data:",
  "connect-src 'self' http://localhost:* http://127.0.0.1:* ws://localhost:* ws://127.0.0.1:*",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');

/**
 * Variante para o servidor de DESENVOLVIMENTO (Electron com `loadURL`).
 *
 * O `@vitejs/plugin-react` injeta no `index.html` um `<script>` INLINE (o
 * preâmbulo do Fast Refresh) e todo módulo transformado lança se ele não
 * rodou. Com `script-src 'self'` no cabeçalho, o app em dev abria em branco.
 * Só `script-src` muda, e só fora do build empacotado — a política de
 * produção continua sendo `CSP`.
 */
export const CSP_DEV = CSP.replace(
  "script-src 'self' 'wasm-unsafe-eval'",
  "script-src 'self' 'wasm-unsafe-eval' 'unsafe-inline'",
);
