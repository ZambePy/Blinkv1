/**
 * Contrato de dados compartilhado com o banco e com o app do cuidador.
 *
 * Os nomes são os das tabelas/colunas do Supabase (snake_case) para que um
 * `select('*')` caia direto nestes tipos. Fonte da verdade:
 *   irisflow-cuidador/supabase/migrations/20260904_caregiver_app.sql
 *   SITE IRISFLOW V1/supabase/migrations/20260908_integracao_ecossistema.sql
 * e, no app do cuidador, `src/data/types.ts` — os enums são os mesmos.
 */

export type MessageSender = 'paciente' | 'cuidador';
export type MessageKind = 'texto' | 'frase' | 'pictograma' | 'simnao' | 'sistema';
export type HelpKind = 'ajuda' | 'emergencia' | 'postura' | 'fadiga' | 'recalibracao' | 'dispositivo';
export type SessionStatus = 'calibrating' | 'active' | 'paused' | 'ended';
export type FilterPresetRemoto = 'estavel' | 'balanceado' | 'responsivo';
export type DwellMsRemoto = 800 | 1500 | 2500;

export interface Message {
  id: string;
  beneficiary_id: string;
  sender: MessageSender;
  kind: MessageKind;
  text: string;
  created_at: string;
  read_at: string | null;
  /** Vocalizado na tela do paciente (mensagens do cuidador). */
  spoken: boolean;
}

export interface QuickPhrase {
  id: string;
  beneficiary_id: string;
  text: string;
  category: 'necessidades' | 'conforto' | 'social' | 'saude' | 'outra';
  position: number;
}

export interface EmergencyContact {
  name: string;
  phone: string;
}

/** Ajuste remoto feito pelo cuidador no app (tabela `patient_settings`). */
export interface PatientSettings {
  beneficiary_id: string;
  dwell_ms: DwellMsRemoto;
  filter_preset: FilterPresetRemoto;
  keyboard_layout: 'frequencia' | 'alfabetico' | 'qwerty';
  sensitivity: number;
  voice: string;
  emergency_timeout_s: number;
  emergency_contacts: EmergencyContact[];
  updated_at: string;
}

/** Resposta de `desktop_license()` — a regra única de acesso, no banco. */
export interface LicencaResposta {
  allowed: boolean;
  reason: 'avaliacao' | 'avaliacao_encerrada' | 'ativa' | 'inadimplente' | 'cancelada' | 'sem_assinatura' | string;
  status: string | null;
  plan_id: string | null;
  plan_name: string | null;
  trial_ends_at: string | null;
  next_charge_at: string | null;
  access_until: string | null;
  checked_at: string;
  beneficiary: { id: string; user_name: string } | null;
  features: { relatorios: boolean; multiplos_dispositivos: boolean; assistente: boolean; voz: boolean };
}

/** Resposta de `pair_device()`. A chave só aparece aqui, uma vez. */
export interface PareamentoResposta {
  device_id: string;
  device_key: string;
  revoked_device_ids: string[];
}

/** O que fica no cofre local depois do login. */
export interface VinculoLocal {
  device_id: string;
  device_key: string;
  beneficiary_id: string;
  beneficiary_name: string;
  email: string;
  pareado_em: string;
}

/**
 * Resumo do teste de precisão gravado em `sessions.accuracy_report`.
 * Espelhado em irisflow-cuidador/src/data/types.ts (`AccuracySummary`).
 */
export interface ResumoDePrecisao {
  meanErrorPx: number | null;
  meanErrorDeg: number | null;
  medianErrorPx: number | null;
  p90ErrorPx: number | null;
  precisionPx: number | null;
  precisionDeg: number | null;
  hitRate100: number | null;
  hitRate150: number | null;
  minTargetPx: number | null;
  minTargetDeg: number | null;
  measuredDistanceCm: number | null;
  pointsMeasured: number;
  pointsTotal: number;
  score: string;
  conditions: {
    lighting?: string; glasses?: boolean; headMovement?: string; screenInches?: number; distanceCm?: number;
  } | null;
}

/** Campos de `sessions` que o desktop escreve. */
export interface SessaoRemota {
  id?: string;
  status?: SessionStatus;
  started_at?: string;
  ended_at?: string | null;
  calibration_error_px?: number | null;
  calibration_error_deg?: number | null;
  calibration_seconds?: number | null;
  hit_rate_150px?: number | null;
  hit_rate_100px?: number | null;
  precision_px?: number | null;
  precision_deg?: number | null;
  accuracy_report?: ResumoDePrecisao | null;
  dwell_ms?: DwellMsRemoto;
  filter_preset?: FilterPresetRemoto;
  utterances?: number;
  chars_typed?: number;
  modules_used?: string[];
  capture_conditions?: Record<string, unknown>;
  app_version?: string;
}
