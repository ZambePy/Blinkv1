import { describe, it, expect } from 'vitest';
import { L2CSHealthMonitor, isGazePlausible } from './block';

// 2.5 — o modo de falha que de fato ocorreu não era detectável.
//
// O crop entregava imagem preta (bug de `sourceDimensions`, corrigido) e o
// modelo devolvia sempre o mesmo ângulo. Na gravação de referência: 1563
// quadros `valid`, yaw com um único valor distinto, −1,4315 rad.

const TRAVADO = -1.4315;   // o valor real medido na gravação

describe('isGazePlausible — o que ele pega e o que não pega', () => {
  it('pega o ângulo travado da gravação, por estar fora da faixa fisiológica', () => {
    expect(isGazePlausible(TRAVADO, 0)).toBe(false);
  });

  it('NÃO pegaria um travamento dentro da faixa — e nada garante que fique fora', () => {
    // Se a imagem preta produzisse 0,3 rad em vez de −1,43, a guarda de
    // plausibilidade aprovaria todos os quadros. É a lacuna que o monitor cobre.
    expect(isGazePlausible(0.3, 0.2)).toBe(true);
  });
});

describe('L2CSHealthMonitor', () => {
  it('acusa depois do limite de quadros idênticos', () => {
    const m = new L2CSHealthMonitor(5);
    // O primeiro quadro só estabelece a referência; a contagem é de REPETIÇÕES.
    for (let i = 0; i < 5; i++) expect(m.observe(0.3, true)).toBe(false);
    expect(m.observe(0.3, true)).toBe(true);
    expect(m.travado).toBe(true);
  });

  it('acusa UMA vez, não a cada quadro', () => {
    const m = new L2CSHealthMonitor(3);
    let acusacoes = 0;
    for (let i = 0; i < 100; i++) if (m.observe(0.3, true)) acusacoes++;
    expect(acusacoes).toBe(1);
  });

  it('variação normal nunca acusa — olho humano não fica parado', () => {
    const m = new L2CSHealthMonitor(10);
    for (let i = 0; i < 500; i++) {
      expect(m.observe(0.3 + Math.sin(i) * 1e-4, true)).toBe(false);
    }
    expect(m.travado).toBe(false);
  });

  it('uma única variação zera a contagem', () => {
    const m = new L2CSHealthMonitor(5);
    for (let i = 0; i < 4; i++) m.observe(0.3, true);
    m.observe(0.31, true);            // respirou
    for (let i = 0; i < 4; i++) expect(m.observe(0.31, true)).toBe(false);
  });

  it('quadro inválido não conta como repetição', () => {
    // Cache stale devolve o mesmo valor com valid=false. Isso é degradação
    // esperada, não travamento — contar seria falso positivo constante.
    const m = new L2CSHealthMonitor(5);
    for (let i = 0; i < 100; i++) expect(m.observe(TRAVADO, false)).toBe(false);
    expect(m.travado).toBe(false);
  });

  it('reset devolve ao estado inicial', () => {
    const m = new L2CSHealthMonitor(3);
    for (let i = 0; i < 10; i++) m.observe(0.3, true);
    expect(m.travado).toBe(true);
    m.reset();
    expect(m.travado).toBe(false);
    for (let i = 0; i < 3; i++) expect(m.observe(0.5, true)).toBe(false);
  });

  it('reproduz a gravação: 1563 quadros no mesmo yaw são acusados', () => {
    const m = new L2CSHealthMonitor();
    let acusou = false;
    for (let i = 0; i < 1563; i++) if (m.observe(TRAVADO, true)) acusou = true;
    expect(acusou).toBe(true);
  });
});
