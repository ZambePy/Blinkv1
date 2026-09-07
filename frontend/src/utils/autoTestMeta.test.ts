import { describe, it, expect, beforeEach } from 'vitest';
import {
  buildAutoTestMeta, opticalConditionToOculos, applyUptimeToRunMetaIfDefault,
  readinessMetaFrom, montarMetaDeMedicao,
} from './autoTestMeta';
import type { RunMeta } from '@tracker/accuracy';
import type { ReadinessReport } from '@tracker/setupReadiness';
import { guardarProntidao, limparProntidao } from '../ultimaProntidao';

describe('buildAutoTestMeta', () => {
  const base = {
    distanciaCm: 60,
    telaPolegadas: 15.6,
    dateISO: '2026-08-23',
  };

  it('minutosDeSessao vem do sessionUptimeMs (não é hardcode 0)', () => {
    const meta = buildAutoTestMeta({
      ...base,
      sessionUptimeMs: 5 * 60_000,
      opticalCondition: 'desconhecido',
    });
    expect(meta.minutosDeSessao).toBe(5);
  });

  it('arredonda minutosDeSessao para o inteiro mais próximo', () => {
    // 4 min 45 s → 5; 4 min 20 s → 4
    expect(
      buildAutoTestMeta({ ...base, sessionUptimeMs: 4 * 60_000 + 45_000, opticalCondition: 'desconhecido' }).minutosDeSessao,
    ).toBe(5);
    expect(
      buildAutoTestMeta({ ...base, sessionUptimeMs: 4 * 60_000 + 20_000, opticalCondition: 'desconhecido' }).minutosDeSessao,
    ).toBe(4);
  });

  it('minutosDeSessao nunca é negativo mesmo com uptime inválido', () => {
    const meta = buildAutoTestMeta({
      ...base,
      sessionUptimeMs: -1000,
      opticalCondition: 'desconhecido',
    });
    expect(meta.minutosDeSessao).toBe(0);
  });

  it('sessão recém-iniciada (uptime < 30s) reporta 0 min — comportamento honesto', () => {
    const meta = buildAutoTestMeta({
      ...base,
      sessionUptimeMs: 15_000,
      opticalCondition: 'desconhecido',
    });
    expect(meta.minutosDeSessao).toBe(0);
  });

  it('oculos=true quando o perfil ativo é oculos_simples', () => {
    const meta = buildAutoTestMeta({
      ...base,
      sessionUptimeMs: 60_000,
      opticalCondition: 'oculos_simples',
    });
    expect(meta.oculos).toBe(true);
  });

  it('oculos=true quando o perfil ativo é oculos_progressivo', () => {
    const meta = buildAutoTestMeta({
      ...base,
      sessionUptimeMs: 60_000,
      opticalCondition: 'oculos_progressivo',
    });
    expect(meta.oculos).toBe(true);
  });

  it('oculos=false para sem_oculos, lentes_contato e desconhecido', () => {
    for (const cond of ['sem_oculos', 'lentes_contato', 'desconhecido'] as const) {
      const meta = buildAutoTestMeta({
        ...base,
        sessionUptimeMs: 60_000,
        opticalCondition: cond,
      });
      expect(meta.oculos, `condição=${cond}`).toBe(false);
    }
  });

  it('preserva geometria (distanciaCm, telaPolegadas) tal como recebida', () => {
    const meta = buildAutoTestMeta({
      distanciaCm: 55,
      telaPolegadas: 23.6,
      dateISO: '2026-08-23',
      sessionUptimeMs: 60_000,
      opticalCondition: 'desconhecido',
    });
    expect(meta.distanciaCm).toBe(55);
    expect(meta.telaPolegadas).toBe(23.6);
  });

  it('observacoes inclui a condição óptica para o leitor do relatório saber a origem do valor', () => {
    const meta = buildAutoTestMeta({
      ...base,
      sessionUptimeMs: 60_000,
      opticalCondition: 'oculos_simples',
    });
    expect(meta.observacoes).toContain('oculos_simples');
    expect(meta.observacoes).toContain('auto');
  });

  it('usa dateISO injetado (determinístico) em vez de new Date()', () => {
    const meta = buildAutoTestMeta({
      ...base,
      dateISO: '2020-01-01',
      sessionUptimeMs: 60_000,
      opticalCondition: 'desconhecido',
    });
    expect(meta.data).toBe('2020-01-01');
  });
});

describe('applyUptimeToRunMetaIfDefault', () => {
  const baseMeta: RunMeta = {
    data: '2026-08-25',
    iluminacao: 'boa',
    oculos: false,
    movimentoCabeca: 'parada',
    minutosDeSessao: 0,
    distanciaCm: 60,
    telaPolegadas: 15.6,
  };

  it('substitui minutosDeSessao=0 pelo uptime real em minutos', () => {
    const result = applyUptimeToRunMetaIfDefault(baseMeta, 22 * 60_000);
    expect(result.minutosDeSessao).toBe(22);
  });

  it('preserva escolha manual do cuidador (20) mesmo com uptime diferente', () => {
    const result = applyUptimeToRunMetaIfDefault({ ...baseMeta, minutosDeSessao: 20 }, 42 * 60_000);
    expect(result.minutosDeSessao).toBe(20);
  });

  it('preserva escolha manual do cuidador (40)', () => {
    const result = applyUptimeToRunMetaIfDefault({ ...baseMeta, minutosDeSessao: 40 }, 5 * 60_000);
    expect(result.minutosDeSessao).toBe(40);
  });

  it('anota observacoes com sufixo "(auto: uptime N min)" quando aplica', () => {
    const result = applyUptimeToRunMetaIfDefault(baseMeta, 15 * 60_000);
    expect(result.observacoes).toContain('auto');
    expect(result.observacoes).toContain('15 min');
  });

  it('não anota observacoes quando escolha manual é preservada', () => {
    const original = { ...baseMeta, minutosDeSessao: 20, observacoes: 'teste manual' };
    const result = applyUptimeToRunMetaIfDefault(original, 42 * 60_000);
    expect(result.observacoes).toBe('teste manual');
  });

  it('uptime < 30s (arredonda para 0 min) não muda nada — nem observacoes', () => {
    const result = applyUptimeToRunMetaIfDefault(baseMeta, 20_000);
    expect(result.minutosDeSessao).toBe(0);
    expect(result.observacoes).toBeUndefined();
  });

  it('não toca em outros campos do RunMeta', () => {
    const result = applyUptimeToRunMetaIfDefault(baseMeta, 22 * 60_000);
    expect(result.distanciaCm).toBe(60);
    expect(result.telaPolegadas).toBe(15.6);
    expect(result.iluminacao).toBe('boa');
    expect(result.oculos).toBe(false);
    expect(result.movimentoCabeca).toBe('parada');
    expect(result.data).toBe('2026-08-25');
  });
});

describe('opticalConditionToOculos', () => {
  it('lentes de contato NÃO contam como óculos (sem refração dependente do ângulo)', () => {
    // Este comportamento está documentado em docs/BUG-OCULOS-EVIDENCIA.md e
    // preserva a interpretação correta do bug — se algum dia alguém "consertar"
    // isso mapeando lentes_contato → true, esta asserção falha primeiro.
    expect(opticalConditionToOculos('lentes_contato')).toBe(false);
  });

  it('desconhecido preserva o default anterior (false) para não mudar baseline silenciosamente', () => {
    expect(opticalConditionToOculos('desconhecido')).toBe(false);
  });
});

describe('readinessMetaFrom', () => {
  const build = (over: Partial<ReadinessReport> = {}): ReadinessReport => ({
    checks: [
      { id: 'face', status: 'ok', value: 0.99, message: '' },
      { id: 'lighting', status: 'ok', value: 0.45, message: '' },
      { id: 'contrast', status: 'ok', value: 0.2, message: '' },
      { id: 'headPose', status: 'ok', value: 0.01, message: '' },
      { id: 'glasses', status: 'ok', value: 0, message: '' },
    ],
    canStart: true,
    blockedHard: false,
    measured: {
      iodFraction: 0.18,
      estimatedDistanceCm: null,
      brightness: 0.45,
      contrast: 0.2,
      glassesLikely: false,
    },
    ...over,
  });

  it('sem veredito não sobrescreve nada (mantém o comportamento anterior)', () => {
    expect(readinessMetaFrom(null)).toEqual({});
  });

  it('posto de uso bom → iluminacao boa, cabeça parada, sem óculos', () => {
    const m = readinessMetaFrom(build());
    expect(m.iluminacao).toBe('boa');
    expect(m.movimentoCabeca).toBe('parada');
    expect(m.oculos).toBe(false);
  });

  it('qualquer aviso de luz OU contraste derruba iluminacao para ruim', () => {
    // Binário no schema: mentir para o lado otimista foi o que tornou o
    // histórico de relatórios inútil para comparar sessões.
    const luzRuim = build({
      checks: [
        { id: 'lighting', status: 'warn', value: 0.236, message: '' },
        { id: 'contrast', status: 'ok', value: 0.2, message: '' },
      ],
    });
    expect(readinessMetaFrom(luzRuim).iluminacao).toBe('ruim');

    const contrasteRuim = build({
      checks: [
        { id: 'lighting', status: 'ok', value: 0.45, message: '' },
        { id: 'contrast', status: 'warn', value: 0.094, message: '' },
      ],
    });
    expect(readinessMetaFrom(contrasteRuim).iluminacao).toBe('ruim');
  });

  it('óculos vem do reflexo MEDIDO, não da resposta do cuidador', () => {
    const m = readinessMetaFrom(build({
      measured: { ...build().measured, glassesLikely: true },
    }));
    expect(m.oculos).toBe(true);
  });

  it('postura fora de esquadro marca movimentoCabeca como livre', () => {
    const m = readinessMetaFrom(build({
      checks: [{ id: 'headPose', status: 'warn', value: 0.14, message: '' }],
    }));
    expect(m.movimentoCabeca).toBe('livre');
  });

  it('observacoes carrega os valores medidos e a lista de avisos', () => {
    const m = readinessMetaFrom(build({
      checks: [
        { id: 'lighting', status: 'warn', value: 0.236, message: '' },
        { id: 'distance', status: 'warn', value: 0.099, message: '' },
      ],
      measured: { ...build().measured, brightness: 0.236, iodFraction: 0.099 },
    }));
    expect(m.observacoes).toContain('0.236');
    expect(m.observacoes).toContain('9.9%');
    expect(m.observacoes).toContain('lighting');
    expect(m.observacoes).toContain('distance');
  });

  it('sem avisos, observacoes diz explicitamente "nenhum"', () => {
    expect(readinessMetaFrom(build()).observacoes).toContain('nenhum');
  });
});

/**
 * Montagem completa do `RunMeta`: o que antes era anotado à mão (e não era)
 * passa a entrar sozinho. Ver `docs/MEDICOES.md` §12.
 */
describe('montarMetaDeMedicao', () => {
  const base = {
    sessionUptimeMs: 60_000,
    opticalCondition: 'sem_oculos' as const,
    distanciaCm: 60,
    telaPolegadas: 23.6,
    screenGeometrySource: 'manual' as const,
    dateISO: '2026-09-06',
  };

  beforeEach(() => {
    limparProntidao();
    localStorage.clear();
  });

  it('grava o bloco derivado do instante do treino, sem ninguém digitar', () => {
    expect(montarMetaDeMedicao({ ...base, calibTs: 111 }).blocoDeMedicao).toBe(1);
    expect(montarMetaDeMedicao({ ...base, calibTs: 111 }).blocoDeMedicao).toBe(2);
    // Recalibrou: instante novo, contagem recomeça.
    expect(montarMetaDeMedicao({ ...base, calibTs: 222 }).blocoDeMedicao).toBe(1);
  });

  it('sem calibração ativa não atribui bloco', () => {
    expect(montarMetaDeMedicao({ ...base, calibTs: null }).blocoDeMedicao).toBeUndefined();
  });

  it('iluminação e postura vêm da prontidão MEDIDA quando ela existe', () => {
    guardarProntidao({
      checks: [
        { id: 'lighting', status: 'warn', value: 0.05, message: '' },
        { id: 'contrast', status: 'ok', value: 0.2, message: '' },
        { id: 'headPose', status: 'warn', value: 0.4, message: '' },
      ],
      canStart: false,
      blockedHard: false,
      measured: {
        iodFraction: 0.18, estimatedDistanceCm: null,
        brightness: 0.05, contrast: 0.2, glassesLikely: true,
      },
    });
    const m = montarMetaDeMedicao({ ...base, calibTs: 1 });
    expect(m.iluminacao).toBe('ruim');
    expect(m.movimentoCabeca).toBe('livre');
    // Óculos passa a vir do reflexo medido, não do dropdown do cuidador.
    expect(m.oculos).toBe(true);
  });

  it('sem prontidão recente, NÃO afirma "boa" em silêncio', () => {
    const m = montarMetaDeMedicao({ ...base, calibTs: 1 });
    expect(m.observacoes).toContain('prontidão não medida');
  });
});
