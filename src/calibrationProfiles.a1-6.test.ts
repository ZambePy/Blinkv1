import { describe, it, expect, beforeEach } from 'vitest';
import {
  ProfileRegistry,
  shouldWarnPrecisionForCondition,
  type StoredCalibrationProfile,
  type OpticalCondition,
} from './calibrationProfiles';

// A1-6 — registry por condição óptica. Testes cobrem a API pura;
// integração com calibration.ts (startCalibrationMode → completeCalibration
// → switchActiveProfile) precisa do DOM da calibração e é validada
// manualmente ou em teste E2E depois.

function fakeProfile(cond: OpticalCondition, label?: string): StoredCalibrationProfile {
  const reg = new ProfileRegistry();
  const meta = reg.createMeta({ opticalCondition: cond, label });
  return {
    meta,
    modelLeft:  { betaX: [0.1, 0.2], betaY: [0.3, 0.4], numFeatures: 1, lambda: 1.0, nearSingularCols: [] },
    modelRight: { betaX: [0.5, 0.6], betaY: [0.7, 0.8], numFeatures: 1, lambda: 0.1, nearSingularCols: [] },
    scalerParamsLeft:  { means: [0], stds: [1] },
    scalerParamsRight: { means: [0], stds: [1] },
  };
}

describe('A1-6: ProfileRegistry', () => {
  let reg: ProfileRegistry;

  beforeEach(() => {
    reg = new ProfileRegistry();
  });

  it('registry começa vazio', () => {
    expect(reg.size()).toBe(0);
    expect(reg.list()).toEqual([]);
    expect(reg.getActiveId()).toBeNull();
    expect(reg.getActive()).toBeNull();
  });

  it('createMeta gera id determinístico por condição+timestamp', () => {
    const meta = reg.createMeta({ opticalCondition: 'sem_oculos' });
    expect(meta.id.startsWith('sem_oculos_')).toBe(true);
    expect(meta.label).toBe('Sem óculos');
    expect(meta.opticalCondition).toBe('sem_oculos');
    expect(meta.createdAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it('createMeta aceita label custom e id explícito', () => {
    const meta = reg.createMeta({
      opticalCondition: 'oculos_simples',
      label: 'Óculos de leitura de manhã',
      id: 'custom-id',
      createdAt: '2026-01-01T00:00:00.000Z',
    });
    expect(meta.id).toBe('custom-id');
    expect(meta.label).toBe('Óculos de leitura de manhã');
    expect(meta.createdAt).toBe('2026-01-01T00:00:00.000Z');
  });

  it('save adiciona ao registry e marca como ativo', () => {
    const p = fakeProfile('sem_oculos');
    reg.save(p);
    expect(reg.size()).toBe(1);
    expect(reg.getActiveId()).toBe(p.meta.id);
    expect(reg.getActive()).toBe(p);
  });

  it('list retorna todos com isActive marcado no ativo', () => {
    const a = fakeProfile('sem_oculos', 'Manhã');
    const b = fakeProfile('oculos_simples', 'Tarde');
    reg.save(a);
    reg.save(b); // b passa a ser o ativo (último save)
    const entries = reg.list();
    expect(entries).toHaveLength(2);
    const aEntry = entries.find(e => e.meta.id === a.meta.id)!;
    const bEntry = entries.find(e => e.meta.id === b.meta.id)!;
    expect(aEntry.isActive).toBe(false);
    expect(bEntry.isActive).toBe(true);
  });

  it('switchTo troca o ativo e devolve o perfil', () => {
    const a = fakeProfile('sem_oculos');
    const b = fakeProfile('oculos_simples');
    reg.save(a);
    reg.save(b);
    const switched = reg.switchTo(a.meta.id);
    expect(switched).toBe(a);
    expect(reg.getActiveId()).toBe(a.meta.id);
  });

  it('switchTo id inexistente devolve null e não muda o ativo', () => {
    const a = fakeProfile('sem_oculos');
    reg.save(a);
    const result = reg.switchTo('does-not-exist');
    expect(result).toBeNull();
    expect(reg.getActiveId()).toBe(a.meta.id);
  });

  it('delete remove perfil; se era o ativo, zera ativeId', () => {
    const a = fakeProfile('sem_oculos');
    const b = fakeProfile('oculos_simples');
    reg.save(a);
    reg.save(b); // b é o ativo
    expect(reg.delete(b.meta.id)).toBe(true);
    expect(reg.size()).toBe(1);
    expect(reg.getActiveId()).toBeNull();
  });

  it('delete de não-ativo mantém o ativo', () => {
    const a = fakeProfile('sem_oculos');
    const b = fakeProfile('oculos_simples');
    reg.save(a);
    reg.save(b);
    reg.switchTo(a.meta.id);
    reg.delete(b.meta.id);
    expect(reg.getActiveId()).toBe(a.meta.id);
  });

  it('clear zera tudo', () => {
    reg.save(fakeProfile('sem_oculos'));
    reg.save(fakeProfile('oculos_simples'));
    reg.clear();
    expect(reg.size()).toBe(0);
    expect(reg.getActiveId()).toBeNull();
  });

  it('perfis podem coexistir por condição óptica', () => {
    reg.save(fakeProfile('sem_oculos', 'Sem'));
    reg.save(fakeProfile('oculos_simples', 'Leitura'));
    reg.save(fakeProfile('oculos_progressivo', 'Progressiva'));
    reg.save(fakeProfile('lentes_contato', 'Lentes'));
    expect(reg.size()).toBe(4);
    const conds = reg.list().map(e => e.meta.opticalCondition).sort();
    expect(conds).toEqual([
      'lentes_contato', 'oculos_progressivo', 'oculos_simples', 'sem_oculos',
    ]);
  });
});

describe('A1-6: shouldWarnPrecisionForCondition', () => {
  it('progressivas disparam warning (limite físico, não bug)', () => {
    expect(shouldWarnPrecisionForCondition('oculos_progressivo')).toBe(true);
  });

  it('demais condições NÃO disparam warning', () => {
    expect(shouldWarnPrecisionForCondition('sem_oculos')).toBe(false);
    expect(shouldWarnPrecisionForCondition('oculos_simples')).toBe(false);
    expect(shouldWarnPrecisionForCondition('lentes_contato')).toBe(false);
    expect(shouldWarnPrecisionForCondition('desconhecido')).toBe(false);
  });
});
