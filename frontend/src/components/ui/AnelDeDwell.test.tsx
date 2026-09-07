import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import React from 'react';
import { AnelDeDwell } from './AnelDeDwell';
import { geometriaDoAnel } from '@tracker/interaction/dwellRing';

// -----------------------------------------------------------------------------
// O anel que o tutorial mostra tem de ser o MESMO que o paciente vê depois.
// Um desenho parecido divergiria do real no primeiro ajuste de espessura ou
// folga, e o tutorial passaria a ensinar uma coisa que não acontece.
//
// Por isso a geometria vem de `dwellRing.ts`, do core, e não é recalculada
// aqui.
// -----------------------------------------------------------------------------

const circulo = (c: HTMLElement) => c.querySelectorAll('circle')[1] as SVGCircleElement;

describe('a geometria vem do core', () => {
  it('o raio é o que `geometriaDoAnel` calcula', () => {
    const { container } = render(<AnelDeDwell tamanhoPx={64} progresso={0.5} />);
    const g = geometriaDoAnel(64, 0.5);
    expect(circulo(container).getAttribute('r')).toBe(String(g.raio));
  });

  it('o dasharray é a circunferência do core', () => {
    const { container } = render(<AnelDeDwell tamanhoPx={64} progresso={0.5} />);
    const g = geometriaDoAnel(64, 0.5);
    expect(circulo(container).getAttribute('stroke-dasharray')).toBe(String(g.circunferencia));
  });
});

describe('o progresso', () => {
  it('em 0 o anel está vazio', () => {
    const { container } = render(<AnelDeDwell tamanhoPx={64} progresso={0} />);
    const g = geometriaDoAnel(64, 0);
    expect(circulo(container).getAttribute('stroke-dashoffset')).toBe(String(g.offset));
  });

  it('em 1 o anel está cheio', () => {
    const { container } = render(<AnelDeDwell tamanhoPx={64} progresso={1} />);
    expect(Number(circulo(container).getAttribute('stroke-dashoffset'))).toBeCloseTo(0, 6);
  });

  it('NaN não deixa o anel cheio', () => {
    // Um `stroke-dashoffset: NaN` é ignorado pelo navegador e o anel aparece
    // COMPLETO: o paciente veria dwell terminado num dwell que não começou.
    // `geometriaDoAnel` prende isso; o teste garante que o componente não
    // contorna a proteção.
    const { container } = render(<AnelDeDwell tamanhoPx={64} progresso={Number.NaN} />);
    const off = Number(circulo(container).getAttribute('stroke-dashoffset'));
    expect(Number.isNaN(off)).toBe(false);
    expect(off).toBeGreaterThan(0);
  });
});

describe('acessibilidade', () => {
  it('é decorativo — quem anuncia o progresso é a tela em volta', () => {
    const { container } = render(<AnelDeDwell tamanhoPx={64} progresso={0.5} />);
    expect(container.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
  });
});
