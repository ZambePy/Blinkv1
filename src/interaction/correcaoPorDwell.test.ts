import { beforeEach, describe, expect, it } from 'vitest';
import {
  K,
  MEIA_VIDA_MS,
  RESFRIAMENTO_MS,
  SALTO_MAX_PX,
  TETO_NORMALIZADO,
  aplicar,
  aprenderComSelecao,
  corrigirPorDwell,
  criarEstado,
  decair,
  definirCorrecaoLigada,
  deveAprender,
  estadoDaCorrecao,
  fracaoDoTetoDaCorrecao,
  registrarSelecao,
  reiniciarCorrecao,
} from './correcaoPorDwell';

const viewport = { largura: 1920, altura: 1080 };

const contextoBom = {
  alvoIsolado: true,
  degradado: false,
  apresentacao: false,
  emergencia: false,
  alvoEspecial: false,
};

describe('deveAprender — as guardas', () => {
  it('alvo grande e isolado, sistema saudável: aprende', () => {
    expect(deveAprender(contextoBom)).toBe(true);
  });

  it('alvo não isolado nunca ensina — é o teclado ocular', () => {
    // No teclado, o dwell concluído com frequência NÃO acertou a tecla
    // pretendida. Aprender ali ensina o erro.
    expect(deveAprender({ ...contextoBom, alvoIsolado: false })).toBe(false);
  });

  it('rastreamento degradado não vale como rótulo', () => {
    expect(deveAprender({ ...contextoBom, degradado: true })).toBe(false);
  });

  it('modo apresentação não é uso real', () => {
    expect(deveAprender({ ...contextoBom, apresentacao: true })).toBe(false);
  });

  it('emergência é o pior momento possível para experimentar', () => {
    expect(deveAprender({ ...contextoBom, emergencia: true })).toBe(false);
    expect(deveAprender({ ...contextoBom, alvoEspecial: true })).toBe(false);
  });

  it('quadro saturado não ensina — seria realimentação positiva contra a borda', () => {
    // Com o alvo perto da borda, o softClamp comprime o cursor, o resíduo
    // contra o centro do botão sai inflado e o deslocamento cresce até o teto.
    expect(deveAprender({ ...contextoBom, saturado: true })).toBe(false);
  });
});

describe('registrarSelecao', () => {
  it('incorpora k do resíduo, em espaço normalizado', () => {
    const e = criarEstado();
    const r = registrarSelecao(e, {
      centroDoAlvo: { x: 1000, y: 500 },
      olhar: { x: 940, y: 470 },
      agoraMs: 1000,
      viewport,
    });
    expect(r.aceita).toBe(true);
    expect(r.estado.offset.x).toBeCloseTo((K * 60) / 1920, 9);
    expect(r.estado.offset.y).toBeCloseTo((K * 30) / 1080, 9);
    expect(r.estado.selecoes).toBe(1);
  });

  it('vinte seleções iguais convergem para o resíduo, sem passar dele', () => {
    let e = criarEstado();
    const alvo = { x: 1000, y: 500 };
    const desvioPx = { x: 60, y: 30 };
    for (let i = 0; i < 20; i++) {
      // O olhar corrigido se aproxima do alvo a cada passo, como na vida real.
      const olhar = {
        x: alvo.x - desvioPx.x + e.offset.x * viewport.largura,
        y: alvo.y - desvioPx.y + e.offset.y * viewport.altura,
      };
      e = registrarSelecao(e, { centroDoAlvo: alvo, olhar, agoraMs: 1000 + i * 5000, viewport }).estado;
    }
    // Converge por baixo: k=0,05 leva ~60 seleções para chegar perto de 1.
    expect(e.offset.x).toBeGreaterThan(0);
    expect(e.offset.x).toBeLessThan(desvioPx.x / viewport.largura);
  });

  it('salto grande é recusado e contado', () => {
    const e = criarEstado();
    const r = registrarSelecao(e, {
      centroDoAlvo: { x: 1000, y: 500 },
      olhar: { x: 1000 - SALTO_MAX_PX - 1, y: 500 },
      agoraMs: 1000,
      viewport,
    });
    expect(r.aceita).toBe(false);
    expect(r.motivo).toBe('salto');
    expect(r.estado.offset).toEqual({ x: 0, y: 0 });
    expect(r.estado.recusasPorSalto).toBe(1);
  });

  it('resfriamento bloqueia a segunda seleção imediata', () => {
    let e = criarEstado();
    e = registrarSelecao(e, {
      centroDoAlvo: { x: 1000, y: 500 }, olhar: { x: 990, y: 500 }, agoraMs: 1000, viewport,
    }).estado;
    const r = registrarSelecao(e, {
      centroDoAlvo: { x: 1000, y: 500 }, olhar: { x: 990, y: 500 },
      agoraMs: 1000 + RESFRIAMENTO_MS - 1, viewport,
    });
    expect(r.motivo).toBe('resfriamento');
    const depois = registrarSelecao(e, {
      centroDoAlvo: { x: 1000, y: 500 }, olhar: { x: 990, y: 500 },
      agoraMs: 1000 + RESFRIAMENTO_MS, viewport,
    });
    expect(depois.aceita).toBe(true);
  });

  it('o teto limita a NORMA, preservando a direção da correção', () => {
    let e = criarEstado();
    // Muitas seleções com resíduo grande e consistente, no limite do salto.
    for (let i = 0; i < 200; i++) {
      e = registrarSelecao(e, {
        centroDoAlvo: { x: 1000, y: 700 },
        olhar: { x: 1000 - 120, y: 700 - 120 },
        agoraMs: 1000 + i * 1000,
        viewport,
      }).estado;
    }
    const n = Math.hypot(e.offset.x, e.offset.y);
    expect(n).toBeLessThanOrEqual(TETO_NORMALIZADO + 1e-9);
    expect(n).toBeCloseTo(TETO_NORMALIZADO, 6);
    // Direção preservada: o resíduo em px era igual nos dois eixos, mas a
    // normalização por viewport faz Y pesar mais (tela mais baixa que larga).
    expect(e.offset.y / e.offset.x).toBeCloseTo(1920 / 1080, 3);
  });

  it('entrada inválida não corrompe o estado', () => {
    const e = criarEstado();
    for (const ruim of [
      { centroDoAlvo: { x: NaN, y: 0 }, olhar: { x: 0, y: 0 }, agoraMs: 0, viewport },
      { centroDoAlvo: { x: 0, y: 0 }, olhar: { x: 0, y: Infinity }, agoraMs: 0, viewport },
      { centroDoAlvo: { x: 0, y: 0 }, olhar: { x: 0, y: 0 }, agoraMs: NaN, viewport },
      { centroDoAlvo: { x: 0, y: 0 }, olhar: { x: 0, y: 0 }, agoraMs: 0, viewport: { largura: 0, altura: 1080 } },
    ]) {
      const r = registrarSelecao(e, ruim);
      expect(r.aceita).toBe(false);
      expect(r.estado.offset).toEqual({ x: 0, y: 0 });
    }
  });
});

describe('decaimento', () => {
  it('uma meia-vida corta o deslocamento pela metade', () => {
    let e = criarEstado();
    e = registrarSelecao(e, {
      centroDoAlvo: { x: 1000, y: 500 }, olhar: { x: 900, y: 500 }, agoraMs: 0, viewport,
    }).estado;
    const antes = e.offset.x;
    e = decair(e, MEIA_VIDA_MS);
    expect(e.offset.x).toBeCloseTo(antes / 2, 9);
  });

  it('a primeira chamada só marca o relógio, não decai', () => {
    let e = { ...criarEstado(), offset: { x: 0.05, y: 0 } };
    e = decair(e, 999999);
    expect(e.offset.x).toBeCloseTo(0.05, 9);
    expect(e.ultimoDecaimentoMs).toBe(999999);
  });

  it('relógio andando para trás não amplifica o deslocamento', () => {
    let e = { ...criarEstado(), offset: { x: 0.05, y: 0 }, ultimoDecaimentoMs: 10_000 };
    e = decair(e, 5_000);
    expect(e.offset.x).toBeCloseTo(0.05, 9);
  });

  it('aplicar soma o deslocamento ao ponto normalizado', () => {
    const e = { ...criarEstado(), offset: { x: 0.01, y: -0.02 } };
    expect(aplicar(e, { x: 0.5, y: 0.5 })).toEqual({ x: 0.51, y: 0.48 });
  });
});

describe('instância do app', () => {
  beforeEach(() => {
    reiniciarCorrecao();
    definirCorrecaoLigada(true);
  });

  it('aprende, corrige e reinicia', () => {
    expect(aprenderComSelecao({
      centroDoAlvo: { x: 1000, y: 500 }, olhar: { x: 940, y: 500 }, agoraMs: 1000, viewport,
    })).toBe(true);
    expect(estadoDaCorrecao().offset.x).toBeGreaterThan(0);

    const p = corrigirPorDwell({ x: 0.5, y: 0.5 }, 1000);
    expect(p.x).toBeGreaterThan(0.5);

    reiniciarCorrecao();
    expect(estadoDaCorrecao().offset).toEqual({ x: 0, y: 0 });
    expect(corrigirPorDwell({ x: 0.5, y: 0.5 }, 2000)).toEqual({ x: 0.5, y: 0.5 });
  });

  it('a fração do teto só existe depois de aprender algo', () => {
    expect(fracaoDoTetoDaCorrecao()).toBeNull();
    aprenderComSelecao({
      centroDoAlvo: { x: 1000, y: 500 }, olhar: { x: 940, y: 500 }, agoraMs: 1000, viewport,
    });
    const f = fracaoDoTetoDaCorrecao();
    expect(f).not.toBeNull();
    expect(f!).toBeGreaterThan(0);
    expect(f!).toBeLessThan(1);
  });

  it('a fração satura em 1 e volta a null quando desligada', () => {
    for (let i = 0; i < 200; i++) {
      aprenderComSelecao({
        centroDoAlvo: { x: 1000, y: 700 }, olhar: { x: 880, y: 580 },
        agoraMs: 1000 + i * 1000, viewport,
      });
    }
    expect(fracaoDoTetoDaCorrecao()).toBeCloseTo(1, 3);
    definirCorrecaoLigada(false);
    expect(fracaoDoTetoDaCorrecao()).toBeNull();
  });

  it('desligada, não aprende nem corrige — é assim que a medição compara', () => {
    definirCorrecaoLigada(false);
    expect(aprenderComSelecao({
      centroDoAlvo: { x: 1000, y: 500 }, olhar: { x: 940, y: 500 }, agoraMs: 1000, viewport,
    })).toBe(false);
    expect(corrigirPorDwell({ x: 0.5, y: 0.5 }, 1000)).toEqual({ x: 0.5, y: 0.5 });
  });
});
