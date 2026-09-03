// Política de segurança do processo principal do Electron — B3.30.
//
// Mora em `src/` (e não inline em `electron/main.ts`) pelo mesmo motivo de
// B2.11: o CI roda `windows-latest` mas não abre o Electron. O que dá para
// verificar deterministicamente é a DECISÃO — dada uma origem, permitir ou
// não —, e uma decisão de segurança sem teste é uma decisão que ninguém sabe
// se está certa.
//
// ## O que estava errado
//
//   session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
//     cb(permission === 'media');
//   });
//
// O primeiro argumento — o `webContents` que fez o pedido — era descartado.
// **Qualquer origem carregada na janela ganhava acesso à câmera**, e o app não
// tinha `setPermissionCheckHandler`, `will-navigate`, `setWindowOpenHandler`
// nem CSP. Bastava uma navegação para fora (um link, um redirect, um iframe)
// para uma página arbitrária pedir a webcam de um paciente com ELA e receber.
//
// A superfície é pequena porque o app carrega conteúdo local, mas "pequena"
// não é "inexistente", e o custo de fechá-la é uma função de dez linhas.

/** Permissões que o app legitimamente precisa. */
const PERMISSOES_PERMITIDAS = new Set(['media']);

/**
 * Origens confiáveis.
 *
 * - `file://` é o build empacotado (`win.loadFile`).
 * - `http://localhost:*` e `http://127.0.0.1:*` são o servidor de dev do Vite.
 *
 * Nada mais. Em particular, nenhum host remoto: o projeto é 100% local por
 * design, e uma origem remota pedindo câmera é, por definição, coisa que não
 * deveria estar acontecendo.
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
 * Decide um pedido de permissão.
 *
 * Só concede o que o app precisa (`media`) e só para origem confiável. Tudo o
 * mais é negado — inclusive permissões que hoje ninguém pede, porque a lista
 * de permissões do Chromium cresce e um `default: allow` envelheceria mal.
 */
export function permitirPermissao(
  permission: string,
  url: string | null | undefined,
): boolean {
  return PERMISSOES_PERMITIDAS.has(permission) && origemConfiavel(url);
}

/**
 * Decide se uma navegação pode acontecer.
 *
 * O app não navega para fora de si mesmo. Um link externo — num texto que o
 * paciente compôs, por exemplo — não pode substituir a aplicação inteira por
 * uma página remota que herda o contexto do processo.
 */
export function permitirNavegacao(url: string | null | undefined): boolean {
  return origemConfiavel(url);
}

/**
 * Content-Security-Policy do app.
 *
 * `'unsafe-inline'` em `style-src` é necessário: o projeto usa estilos inline
 * em vários componentes (`style={{...}}` do React). `'wasm-unsafe-eval'` é
 * exigido pelo MediaPipe e pelo ONNX Runtime, que compilam WebAssembly.
 *
 * `connect-src 'self'` é o que fecha a promessa de privacidade do README —
 * nenhuma imagem, landmark ou perfil sai do dispositivo — em política de
 * navegador, e não apenas em disciplina de código.
 */
export const CSP = [
  "default-src 'self'",
  "script-src 'self' 'wasm-unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "media-src 'self' blob:",
  "connect-src 'self'",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "frame-src 'none'",
  "base-uri 'self'",
  "form-action 'none'",
].join('; ');
