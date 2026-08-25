import { describe, it, expect } from 'vitest';
import { buildAutoTestMeta, opticalConditionToOculos, applyUptimeToRunMetaIfDefault } from './autoTestMeta';
import type { RunMeta } from '@tracker/accuracy';

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

// D7.2 (ROADMAP §5) — o fluxo de accuracy test MANUAL do SettingsScreen mantém
// um select "Sessão (min)" com default 0. Estes testes garantem que:
//   (i)  se o valor for 0 (default do state), aplyUptimeToRunMetaIfDefault
//        substitui pelo uptime real, e anota o `observacoes`;
//   (ii) se o cuidador escolheu manualmente 20 ou 40, a escolha é preservada
//        — override manual sempre vence (regra: nunca sobrescrever dado
//        que o humano digitou expressamente);
//   (iii) uptime < 30s (autoMinutos == 0) não polui o observacoes.
describe('applyUptimeToRunMetaIfDefault (D7.2)', () => {
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
