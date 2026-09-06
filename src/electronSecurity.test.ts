import { describe, it, expect } from 'vitest';
import { origemConfiavel, permitirPermissao, permitirNavegacao, CSP, CSP_DEV } from './electronSecurity';

// A decisão de segurança do Electron é testável sem abrir o Electron.

describe('só origem local é confiável', () => {
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

describe('a permissão depende da origem, não só do tipo', () => {
  it('media de origem local é concedida', () => {
    expect(permitirPermissao('media', 'file:///C:/app/index.html')).toBe(true);
    expect(permitirPermissao('media', 'http://localhost:5173/')).toBe(true);
  });

  it('media de origem REMOTA é negada', () => {
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

describe('navegação para fora é bloqueada', () => {
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

describe('a CSP fecha a promessa de privacidade', () => {
  it('connect-src só aceita a própria origem e localhost', () => {
    // Nenhuma imagem, landmark ou perfil sai do dispositivo.
    const connect = CSP.split('; ').find((d) => d.startsWith('connect-src'))!;
    expect(connect).toContain("'self'");
    expect(connect).not.toMatch(/https?:\/\/(?!localhost|127\.0\.0\.1)/);
  });

  it('permite WASM — MediaPipe e ONNX Runtime dependem disso', () => {
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

  it('produção não aceita script inline; a variante de dev aceita só isso a mais', () => {
    // O preâmbulo do Fast Refresh do Vite é inline: sem esta exceção o
    // `electron:dev` abre em branco. Fora de `script-src` as duas são iguais.
    expect(CSP).not.toMatch(/script-src[^;]*'unsafe-inline'/);
    expect(CSP_DEV).toMatch(/script-src[^;]*'unsafe-inline'/);
    const semScript = (p: string) => p.split('; ').filter((d) => !d.startsWith('script-src'));
    expect(semScript(CSP_DEV)).toEqual(semScript(CSP));
    expect(CSP_DEV).not.toMatch(/script-src[^;]*'unsafe-eval'/);
  });
});
