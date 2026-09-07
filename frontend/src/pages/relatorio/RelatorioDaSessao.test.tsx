import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import React from 'react';
import i18n from '../../i18n';
import { RelatorioDaSessao } from './RelatorioDaSessao';
import { SCHEMA_DO_RESUMO, type ResumoDoRelatorio } from '../../services/local/ultimoRelatorio';

// -----------------------------------------------------------------------------
// O bloco de medição aparece SOMENTE LEITURA.
//
// `registroDaSessao.ts` registra por que ele deixou de ser digitado: "anotação
// manual virou `blocoDeMedicao: undefined` em todo relatório". Um campo
// editável ao lado do derivado seria a primeira coisa a ficar vazia de novo — e
// sem o bloco a sessão de duas rodadas não pode ser lida depois.
//
// A origem da diagonal do monitor também é dita: um erro em graus calculado
// sobre a diagonal PADRÃO não é comparável com um calculado sobre medida real,
// e nada no número denuncia a diferença.
// -----------------------------------------------------------------------------

beforeEach(async () => {
  await i18n.changeLanguage('pt-BR');
});

const resumo = (over: Record<string, unknown> = {}): ResumoDoRelatorio =>
  ({
    schema: SCHEMA_DO_RESUMO,
    em: new Date().toISOString(),
    result: { meanError: 96, meanErrorDeg: 1.42 },
    meta: {
      blocoDeMedicao: 2,
      telaPolegadas: 23.6,
      screenGeometrySource: 'manual',
      luxAmbiente: 320,
      ...(over.meta as Record<string, unknown>),
    },
    ...over,
  }) as unknown as ResumoDoRelatorio;

const montar = (r: ResumoDoRelatorio | null) =>
  render(
    <MemoryRouter>
      <RelatorioDaSessao resumo={r} />
    </MemoryRouter>
  );

describe('o bloco de medicao', () => {
  it('aparece quando ha um', () => {
    montar(resumo());
    expect(screen.getByText(/2ª rodada contra esta calibração/i)).toBeInTheDocument();
  });

  it('NAO e editavel', () => {
    const { container } = montar(resumo());
    expect(container.querySelectorAll('input, select, textarea')).toHaveLength(0);
  });

  it('bloco 1 diz que a comparacao ainda nao pode ser feita', () => {
    // Nenhum dos relatórios reais no repositório tem bloco 2. A tela torna
    // isso visível em vez de deixar implícito.
    montar(resumo({ meta: { blocoDeMedicao: 1 } }));
    expect(screen.getByText(/precisa de uma segunda|primeira rodada/i)).toBeInTheDocument();
  });

  it('sem calibracao ativa, diz que nao pertence a bloco nenhum', () => {
    montar(resumo({ meta: { blocoDeMedicao: undefined } }));
    expect(screen.getByText(/não pertence a bloco/i)).toBeInTheDocument();
  });
});

describe('a origem da diagonal', () => {
  it('medida a mao e dita', () => {
    montar(resumo());
    expect(screen.getByText(/medido à mão/i)).toBeInTheDocument();
  });

  it('valor padrao e denunciado como NAO medido', () => {
    // O caso perigoso: o erro em graus sai com cara de medição e foi calculado
    // sobre 23,6" de hardcode.
    montar(resumo({ meta: { screenGeometrySource: 'default' } }));
    expect(screen.getByText(/não medido/i)).toBeInTheDocument();
  });
});

describe('o erro', () => {
  it('aparece em graus, que e a metrica comparavel entre setups', () => {
    montar(resumo());
    expect(screen.getByText(/1,42°/)).toBeInTheDocument();
  });

  it('mostra px ao lado, para quem acompanha a medicao', () => {
    montar(resumo());
    expect(screen.getByText(/96 px/)).toBeInTheDocument();
  });
});

describe('o lux', () => {
  it('aparece quando foi preenchido no preparo', () => {
    montar(resumo());
    expect(screen.getByText(/320 lux/)).toBeInTheDocument();
  });

  it('a ausencia e dita, nao omitida', () => {
    montar(resumo({ meta: { luxAmbiente: null } }));
    expect(screen.getByText(/não medida/i)).toBeInTheDocument();
  });
});

describe('exportar', () => {
  it('baixa o resumo', () => {
    const click = vi.fn();
    vi.spyOn(document, 'createElement').mockImplementation(((tag: string) => {
      const el = document.createElementNS('http://www.w3.org/1999/xhtml', tag) as HTMLElement;
      if (tag === 'a') (el as HTMLAnchorElement).click = click;
      return el;
    }) as typeof document.createElement);
    URL.createObjectURL = vi.fn(() => 'blob:x');
    URL.revokeObjectURL = vi.fn();

    montar(resumo());
    fireEvent.click(screen.getByRole('button', { name: /exportar/i }));

    expect(click).toHaveBeenCalled();
    vi.restoreAllMocks();
  });

  it('diz que o relatorio completo ja foi salvo pelo teste', () => {
    // Sem isto o cuidador acha que exportar é a única forma de guardar, e o
    // resumo passa a ser tratado como o relatório.
    montar(resumo());
    expect(screen.getByText(/salvo automaticamente/i)).toBeInTheDocument();
  });
});

describe('sem relatorio ainda', () => {
  it('oferece rodar o teste, em vez de tela vazia', () => {
    montar(null);
    expect(screen.getByRole('button', { name: /rodar o teste/i })).toBeInTheDocument();
  });
});
