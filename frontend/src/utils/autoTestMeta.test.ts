import { describe, it, expect } from 'vitest';
import { buildAutoTestMeta, opticalConditionToOculos } from './autoTestMeta';

// D2 (ROADMAP.md) — critério de aceite: "teste unitário garantindo que
// `RunMeta` não usa mais valores hardcoded para `minutosDeSessao`". A regressão
// que estes testes protegem é o valor `0` fixo que estava em
// `CalibrationCheck.tsx:73` — se alguém reintroduzir hardcoding, ao menos
// esta suíte falha em vez do relatório mentir silenciosamente.

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
      telaPolegadas: 23.3,
      dateISO: '2026-08-23',
      sessionUptimeMs: 60_000,
      opticalCondition: 'desconhecido',
    });
    expect(meta.distanciaCm).toBe(55);
    expect(meta.telaPolegadas).toBe(23.3);
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
