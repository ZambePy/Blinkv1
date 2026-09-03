import { describe, it, expect } from 'vitest';
import { origemConfiavel, permitirPermissao, permitirNavegacao, CSP } from './electronSecurity';

// -----------------------------------------------------------------------------
// B3.30 — `setPermissionRequestHandler` concede `media` a QUALQUER origem.
//
//   session.defaultSession.setPermissionRequestHandler((_wc, permission, cb) => {
//     cb(permission === 'media');
//   });
//
// O primeiro argumento — o `webContents` que fez o pedido — era descartado com
// `_`. Qualquer origem carregada na janela ganhava a câmera. E o app não tinha
// `setPermissionCheckHandler`, `will-navigate`, `setWindowOpenHandler` nem
// CSP: bastava uma navegação para fora para uma página arbitrária pedir a
// webcam de um paciente com ELA e recebê-la.
//
// A superfície é pequena — o app carrega conteúdo local —, mas pequena não é
// inexistente, e o custo de fechá-la é uma função de dez linhas.
// -----------------------------------------------------------------------------

describe('B3.30 — só origem local é confiável', () => {
  it('file:// é confiável — é o build empacotado', () => {
    expect(origemConfiavel('file:///C:/app/frontend/dist/index.html')).toBe(true);
  });

  it('localhost é confiável — é o servidor de dev', () => {
    expect(origemConfiavel('http://localhost:5173/')).toBe(true);
    expect(origemConfiavel('http://127.0.0.1:5173/index.html')).toBe(true);
  });

  it('host remoto NÃO é confiável', () => {
    expect(origemConfiavel('https://exemplo.com/')).toBe(false);
    expect(origemConfiavel('http://exemplo.com/')).toBe(false);
  });

  it('um host que apenas CONTÉM "localhost" não passa', () => {
    // Defesa contra checagem por substring, que é o erro clássico aqui.
    expect(origemConfiavel('https://localhost.exemplo.com/')).toBe(false);
    expect(origemConfiavel('https://evil-localhost/')).toBe(false);
  });

  it('URL inválida ou ausente não é confiável', () => {
    expect(origemConfiavel(null)).toBe(false);
    expect(origemConfiavel(undefined)).toBe(false);
    expect(origemConfiavel('')).toBe(false);
    expect(origemConfiavel('nao-e-url')).toBe(false);
  });

  it('outros protocolos não passam', () => {
    expect(origemConfiavel('data:text/html,<h1>x</h1>')).toBe(false);
    expect(origemConfiavel('javascript:alert(1)')).toBe(false);
    expect(origemConfiavel('ftp://exemplo.com/')).toBe(false);
  });
});

describe('B3.30 — a permissão depende da ORIGEM, não só do tipo', () => {
  it('media de origem local é concedida', () => {
    expect(permitirPermissao('media', 'file:///C:/app/index.html')).toBe(true);
    expect(permitirPermissao('media', 'http://localhost:5173/')).toBe(true);
  });

  it('media de origem REMOTA é negada', () => {
    // O bug, na sua forma mais direta: a câmera do paciente para quem pedir.
    expect(permitirPermissao('media', 'https://exemplo.com/')).toBe(false);
  });

  it('permissões que o app não precisa são negadas, mesmo local', () => {
    // Lista de permissão explícita, não `default: allow`. A lista do Chromium
    // cresce, e um default permissivo envelheceria mal.
    for (const p of ['geolocation', 'notifications', 'midi', 'clipboard-read', 'display-capture']) {
      expect(permitirPermissao(p, 'file:///C:/app/index.html'), p).toBe(false);
    }
  });

  it('origem ausente nega tudo', () => {
    expect(permitirPermissao('media', null)).toBe(false);
  });
});

describe('B3.30 — navegação para fora é bloqueada', () => {
  it('navegar para o próprio app é permitido', () => {
    expect(permitirNavegacao('file:///C:/app/index.html')).toBe(true);
    expect(permitirNavegacao('http://localhost:5173/menu')).toBe(true);
  });

  it('navegar para fora é bloqueado', () => {
    // Um link externo — num texto que o paciente compôs, por exemplo — não
    // pode substituir a aplicação inteira por uma página remota.
    expect(permitirNavegacao('https://exemplo.com/')).toBe(false);
  });
});

describe('B3.30 — a CSP fecha a promessa de privacidade', () => {
  it('connect-src restringe a origem própria', () => {
    // O README promete que nenhuma imagem, landmark ou perfil sai do
    // dispositivo. Isso passa a ser política de navegador, não só disciplina
    // de código.
    expect(CSP).toContain("connect-src 'self'");
  });

  it('permite WASM — MediaPipe e ONNX Runtime dependem disso', () => {
    // Uma CSP que quebre o pipeline seria pior que nenhuma: alguém a
    // removeria inteira em vez de ajustá-la.
    expect(CSP).toContain("'wasm-unsafe-eval'");
  });

  it('permite estilos inline — o projeto usa style={{...}} em toda parte', () => {
    expect(CSP).toContain("style-src 'self' 'unsafe-inline'");
  });

  it('permite blob: para worker e media', () => {
    // O worker do L2CS e o `<video>` da câmera precisam.
    expect(CSP).toContain("worker-src 'self' blob:");
    expect(CSP).toContain("media-src 'self' blob:");
  });

  it('bloqueia object, frame e form-action', () => {
    expect(CSP).toContain("object-src 'none'");
    expect(CSP).toContain("frame-src 'none'");
    expect(CSP).toContain("form-action 'none'");
  });

  it('NÃO contém unsafe-eval para script', () => {
    // `wasm-unsafe-eval` é específico e necessário; `unsafe-eval` genérico
    // abriria `eval()` e `new Function()`.
    expect(CSP).not.toMatch(/script-src[^;]*'unsafe-eval'/);
  });
});
