import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, act } from '@testing-library/react';
import type { AcaoDoSistema, AmostraDeOlhar, ConfiguracaoDoModo, RespostaDaAcao } from '@tracker/computador/protocolo';
import { Overlay } from './Overlay';

/**
 * Sobreposição de ponta a ponta com uma ponte falsa: config → barra; dwell
 * no botão "Clicar" arma; dwell na área pede a lupa; dwell dentro da lupa
 * clica no ponto mapeado. O jsdom não implementa `elementFromPoint`, então
 * o teste diz o que está sob cada ponto.
 */

let onOlhar: ((a: AmostraDeOlhar) => void) | null = null;
let onConfig: ((c: ConfiguracaoDoModo) => void) | null = null;
const acoes: AcaoDoSistema[] = [];
let respostaDaLupa: RespostaDaAcao = { ok: true, lupa: { imagem: 'data:image/png;base64,AAAA', regiao: { x: 290, y: 190, width: 220, height: 220 } } };

vi.mock('./ponte', () => ({
  pontePara: () => ({
    onOlhar: (cb: (a: AmostraDeOlhar) => void) => { onOlhar = cb; return () => { onOlhar = null; }; },
    onConfig: (cb: (c: ConfiguracaoDoModo) => void) => { onConfig = cb; return () => { onConfig = null; }; },
    acao: async (a: AcaoDoSistema) => { acoes.push(a); return a.tipo === 'lupa' ? respostaDaLupa : { ok: true }; },
  }),
}));

const CONFIG: ConfiguracaoDoModo = { dwellMs: 1000, tamanhoCursorPx: 28, lupa: true, monitor: { width: 1920, height: 1080 }, plataforma: 'win32' };

/** `n` amostras espaçadas de `passo` ms a partir de `t0`, todas em (x, y). */
function olhar(x: number, y: number, t0: number, n: number, passo = 100): number {
  let t = t0;
  for (let i = 0; i < n; i++) {
    t = t0 + i * passo;
    act(() => onOlhar?.({ x, y, t, hasFace: true, eyeState: 'open', degraded: false, uncalibrated: false }));
  }
  return t;
}

describe('Overlay', () => {
  let sob: Element | null = null;
  beforeEach(() => {
    acoes.length = 0;
    sob = null;
    document.elementFromPoint = () => sob;
  });
  afterEach(() => { sob = null; });

  it('arma "Clicar" por dwell, amplia com a lupa e clica no ponto mapeado', async () => {
    render(<Overlay />);
    act(() => onConfig?.(CONFIG));
    expect(screen.getByText('Clicar')).toBeInTheDocument();
    expect(screen.getByRole('status').textContent).toMatch(/Escolha uma ação/);

    // 1. Dwell no botão "Clicar" (1000 ms de amostras válidas + refratário).
    const botao = document.querySelector('[data-alvo="botao:clique"]')!;
    sob = botao;
    let t = olhar(1880, 200, 1000, 12);
    expect(botao.getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('status').textContent).toMatch(/Clique armado/);

    // 2. Dwell na área (nada sob o olhar): pede a lupa em volta do ponto.
    sob = null;
    t = olhar(400, 300, t + 900, 12);
    await act(async () => { await Promise.resolve(); });
    expect(acoes.at(-1)).toMatchObject({ tipo: 'lupa', ponto: { x: 400, y: 300 } });
    const painel = document.querySelector('[data-alvo="lupa-area"]') as HTMLElement;
    expect(painel).not.toBeNull();
    expect(painel.querySelector('img')).not.toBeNull();

    // 3. Dwell no centro do painel → clique no centro da região (400, 300).
    painel.getBoundingClientRect = () => ({ left: 100, top: 100, width: 550, height: 550, right: 650, bottom: 650, x: 100, y: 100, toJSON: () => ({}) });
    sob = painel;
    olhar(375, 375, t + 900, 12);
    await act(async () => { await Promise.resolve(); });
    const clique = acoes.find((a) => a.tipo === 'clique');
    expect(clique).toMatchObject({ tipo: 'clique', botao: 'esquerdo', vezes: 1, ponto: { x: 400, y: 300 } });
    // Sem "Fixar", a tarefa desarma depois do clique.
    expect(botao.getAttribute('aria-pressed')).toBe('false');
  });

  it('olhar que passeia pela área não completa dwell; fixação completa', () => {
    render(<Overlay />);
    act(() => onConfig?.({ ...CONFIG, lupa: false }));
    const botao = document.querySelector('[data-alvo="botao:clique"]')!;
    sob = botao;
    let t = olhar(1880, 200, 1000, 12);
    sob = null;
    // Passeio: cada amostra 60 px adiante — nunca a mesma fixação.
    for (let i = 0; i < 15; i++) {
      t += 100;
      act(() => onOlhar?.({ x: 200 + i * 60, y: 300, t, hasFace: true, eyeState: 'open', degraded: false, uncalibrated: false }));
    }
    expect(acoes.some((a) => a.tipo === 'clique')).toBe(false);
    // Fixação de verdade (jitter de ±10 px) completa.
    for (let i = 0; i < 12; i++) {
      t += 100;
      act(() => onOlhar?.({ x: 900 + (i % 2 ? 10 : -10), y: 500, t, hasFace: true, eyeState: 'open', degraded: false, uncalibrated: false }));
    }
    const clique = acoes.at(-1);
    expect(clique).toMatchObject({ tipo: 'clique', ponto: { y: 500 } });
    expect([890, 910]).toContain((clique as { ponto: { x: number } }).ponto.x);
  });

  it('"IrisFlow" pede saída; "Socorro" funciona mesmo em degradado', () => {
    render(<Overlay />);
    act(() => onConfig?.(CONFIG));
    const socorro = document.querySelector('[data-alvo="botao:emergencia"]')!;
    sob = socorro;
    let t = 1000;
    // Degradado: dwell de emergência é 2× (2000 ms).
    for (let i = 0; i < 24; i++) {
      t += 100;
      act(() => onOlhar?.({ x: 1880, y: 900, t, hasFace: true, eyeState: 'open', degraded: true, uncalibrated: false }));
    }
    expect(acoes.at(-1)).toEqual({ tipo: 'sair', motivo: 'emergencia' });
  });
});
