// A1-6 — perfis de calibração por condição óptica.
//
// Por que existe: A0-5 mostrou que óculos degradam a calibração 8× (57 → 440 px).
// A causa dominante NÃO é bug de código — é refração das lentes, que introduz
// um viés dependente da direção do olhar. Nenhum modelo linear global compensa.
// A única solução é ter perfis SEPARADOS por condição óptica: o cuidador escolhe
// "com óculos" pela manhã (paciente lê) e "sem óculos" à tarde, cada um treinado
// naquela condição específica.
//
// Este módulo é o registry em memória. A persistência (localStorage + expiração
// + invalidação por resolução/vetor de features) é escopo de A2-7 (Sprint 5).
// Aqui, um refresh de página apaga tudo — mas dentro de uma sessão o usuário
// pode alternar sem recalibrar.

import type { RidgeModel } from './ridge';

// Categorias observáveis pelo cuidador. `oculos_progressivo` é registrado
// separadamente porque **é limite físico**, não bug — a refração muda com a
// região da lente pela qual o usuário olha, e um Ridge global não compensa.
// Ser honesto sobre isso na UI é melhor que o usuário achar que o sistema
// está quebrado.
export type OpticalCondition =
  | 'sem_oculos'
  | 'oculos_simples'
  | 'oculos_progressivo'
  | 'lentes_contato'
  | 'desconhecido';

export interface CalibrationProfileMeta {
  id: string;               // gerado automaticamente: `${condition}_${epoch}`
  label: string;            // rótulo humano: "Sem óculos", "Óculos de leitura"
  createdAt: string;        // ISO 8601
  opticalCondition: OpticalCondition;
}

// Snapshot serializável do que treinou. Formato pensado para viver em
// localStorage/IndexedDB quando A2-7 vier — nada de referências circulares,
// tudo primitivos + arrays de números.
export interface StoredCalibrationProfile {
  meta: CalibrationProfileMeta;
  modelLeft: RidgeModel;
  modelRight: RidgeModel;
  scalerParamsLeft:  { means: number[]; stds: number[] };
  scalerParamsRight: { means: number[]; stds: number[] };
  // Sumário da sessão que produziu o perfil — permite ao cuidador comparar
  // qual perfil está melhor sem recalibrar. Todos opcionais para compat
  // com perfis criados antes de A1-6.
  quality?: {
    sampleCount: number;
    varianceFloorBreaches: number;
    varianceCeilBreaches: number;
    specularWarnings: number;
    lambdaLeft: number;
    lambdaRight: number;
    lambdaRatio: number;
    deadFeaturesLeftPct: number;
    deadFeaturesRightPct: number;
  };
}

export interface ProfileListEntry {
  meta: CalibrationProfileMeta;
  isActive: boolean;
  hasQuality: boolean;
}

// Rótulo default por condição óptica. Cuidador pode sobrescrever no create.
function defaultLabel(cond: OpticalCondition): string {
  switch (cond) {
    case 'sem_oculos':          return 'Sem óculos';
    case 'oculos_simples':      return 'Com óculos';
    case 'oculos_progressivo':  return 'Com óculos progressivos';
    case 'lentes_contato':      return 'Com lentes de contato';
    case 'desconhecido':        return 'Perfil';
  }
}

// Gera id determinístico dentro do mesmo ms — o sufixo `epoch` cobre a maior
// parte dos casos. Se o cuidador criar dois perfis com o mesmo label no
// mesmo ms (raro), o id ainda desempata pela hora exata.
function newId(cond: OpticalCondition, when = Date.now()): string {
  return `${cond}_${when}`;
}

export class ProfileRegistry {
  private profiles = new Map<string, StoredCalibrationProfile>();
  private activeId: string | null = null;

  size(): number { return this.profiles.size; }

  list(): ProfileListEntry[] {
    return Array.from(this.profiles.values()).map(p => ({
      meta: p.meta,
      isActive: p.meta.id === this.activeId,
      hasQuality: !!p.quality,
    }));
  }

  getActiveId(): string | null { return this.activeId; }

  getActive(): StoredCalibrationProfile | null {
    if (!this.activeId) return null;
    return this.profiles.get(this.activeId) ?? null;
  }

  get(id: string): StoredCalibrationProfile | null {
    return this.profiles.get(id) ?? null;
  }

  createMeta(opts: {
    opticalCondition: OpticalCondition;
    label?: string;
    id?: string;
    createdAt?: string;
  }): CalibrationProfileMeta {
    const now = Date.now();
    return {
      id: opts.id ?? newId(opts.opticalCondition, now),
      label: opts.label ?? defaultLabel(opts.opticalCondition),
      createdAt: opts.createdAt ?? new Date(now).toISOString(),
      opticalCondition: opts.opticalCondition,
    };
  }

  save(profile: StoredCalibrationProfile): void {
    this.profiles.set(profile.meta.id, profile);
    this.activeId = profile.meta.id;
  }

  switchTo(id: string): StoredCalibrationProfile | null {
    const p = this.profiles.get(id);
    if (!p) return null;
    this.activeId = id;
    return p;
  }

  delete(id: string): boolean {
    const existed = this.profiles.delete(id);
    if (existed && this.activeId === id) this.activeId = null;
    return existed;
  }

  clear(): void {
    this.profiles.clear();
    this.activeId = null;
  }
}

// Singleton do processo. Fica em memória — quando A2-7 vier, esta instância
// carrega/salva em localStorage via um adapter injetado.
export const profileRegistry = new ProfileRegistry();

// Sinalização honesta na UI (B parte). Progressivas são um limite físico:
// a refração muda com a região da lente pela qual o usuário olha, então
// o modelo linear falha estruturalmente. `oculos_progressivo` NÃO é bug
// a corrigir — é condição a comunicar.
export function shouldWarnPrecisionForCondition(cond: OpticalCondition): boolean {
  return cond === 'oculos_progressivo';
}
