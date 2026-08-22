// A3-1 — Invariantes explícitas do sistema IrisFlow.
//
// O módulo implementa a regra 1 do plano ("falhar alto, nunca em silêncio")
// em código, traduzindo assunções implícitas espalhadas por calibration.ts,
// extractor.ts e engine.ts em verificações nomeadas e rastreáveis.
//
// Comportamento por ambiente:
//   - NODE_ENV=test (Vitest): assertInvariant lança InvariantError imediatamente.
//     Isso garante que testes falhem ruidosamente se uma invariante for quebrada,
//     sem precisar fazer assert sobre o estado interno dos módulos.
//   - Produção: conta as violações e loga uma vez para não spammar. O cuidador
//     pode consultar o painel de diagnóstico; nenhuma exceção interrompe o loop
//     de rastreamento (a comunicação nunca é bloqueada — regra 2 do plano).

export type InvariantCode =
  | 'FEATURE_DIM'          // vetor do mesmo tamanho entre calibração e inferência
  | 'FINITE_FEATURES'      // nenhum NaN/Infinity nas features
  | 'SCALER_FITTED'        // scaler deve estar treinado antes de predict
  | 'SCREEN_UNCHANGED'     // resolução da tela não mudou desde a calibração
  | 'CALIBRATION_CLAIMED_OK'; // a UI só declara sucesso se isCalibrated() === true

export interface InvariantViolation {
  code: InvariantCode;
  detail: string;
  count: number;
  firstSeenAt: string; // ISO timestamp
  lastSeenAt: string;
}

// Mapa de código → violação acumulada
const violations = new Map<InvariantCode, InvariantViolation>();

export class InvariantError extends Error {
  constructor(public readonly code: InvariantCode, detail: string) {
    super(`[invariant:${code}] ${detail}`);
    this.name = 'InvariantError';
  }
}

/**
 * Verifica uma invariante do sistema.
 *
 * @param cond     - condição que DEVE ser verdadeira
 * @param code     - identificador da invariante (ver InvariantCode)
 * @param detail   - descrição do contexto ao falhar (valores reais, não genérico)
 *
 * Em NODE_ENV=test: lança InvariantError se cond===false.
 * Em produção: registra violação e loga 1× por código.
 */
export function assertInvariant(cond: boolean, code: InvariantCode, detail: string): void {
  if (cond) return;

  const isTest = typeof process !== 'undefined' && process.env?.NODE_ENV === 'test';
  if (isTest) {
    throw new InvariantError(code, detail);
  }

  // Produção: contabilizar e logar
  const now = new Date().toISOString();
  const existing = violations.get(code);
  if (existing) {
    existing.count++;
    existing.lastSeenAt = now;
  } else {
    violations.set(code, { code, detail, count: 1, firstSeenAt: now, lastSeenAt: now });
    // Loga apenas na primeira ocorrência de cada código
    console.error(`[IrisFlow] Invariante violada [${code}]: ${detail}`);
  }
}

/** Retorna cópia do mapa de violações acumuladas. */
export function getInvariantViolations(): InvariantViolation[] {
  return Array.from(violations.values());
}

/** Zera o contador — útil para testes unitários que precisam de isolamento. */
export function clearInvariantViolations(): void {
  violations.clear();
}

// ── Instrumentação das 5 invariantes críticas do plano ──────────────────────

/**
 * FEATURE_DIM — o vetor de features deve ter o mesmo tamanho entre calibração
 * e inferência. Se `calibratedDim` !== `inferenceDim`, o scaler e o regressor
 * foram treinados com uma geometria diferente da atual (mudança de pipeline,
 * versão de modelo, ou flag de A2-5 ligada pela metade).
 */
export function assertFeatureDim(calibratedDim: number, inferenceDim: number): void {
  assertInvariant(
    calibratedDim === inferenceDim,
    'FEATURE_DIM',
    `calibração com ${calibratedDim} dims, inferência com ${inferenceDim} dims`
  );
}

/**
 * FINITE_FEATURES — nenhuma feature pode ser NaN ou Infinity. Um NaN no vetor
 * corromperia o StandardScaler (mean/std=NaN) e faria o regressor prever sempre
 * o centro da tela — cursor estático sem nenhum aviso.
 */
export function assertFiniteFeatures(features: number[], eye: 'L' | 'R'): void {
  const badIdx = features.findIndex(v => !Number.isFinite(v));
  assertInvariant(
    badIdx === -1,
    'FINITE_FEATURES',
    `features[${eye}][${badIdx}] = ${features[badIdx]} (NaN ou Infinity)`
  );
}

/**
 * SCALER_FITTED — o StandardScaler deve ter sido treinado antes de ser
 * chamado para predict. Chamar transform() em scaler não treinado produz
 * divisão por zero (std=0) → NaN → cursor estático.
 */
export function assertScalerFitted(fitted: boolean, side: 'L' | 'R'): void {
  assertInvariant(fitted, 'SCALER_FITTED', `StandardScaler(${side}) chamado antes de fit()`);
}

/**
 * SCREEN_UNCHANGED — a resolução da tela não pode ter mudado desde a calibração.
 * O Ridge mapeia features → pixels; mudar a resolução sem recalibrar desloca
 * sistematicamente todos os pontos preditos.
 */
export function assertScreenUnchanged(
  calibW: number, calibH: number,
  currentW: number, currentH: number
): void {
  assertInvariant(
    calibW === currentW && calibH === currentH,
    'SCREEN_UNCHANGED',
    `calibrado em ${calibW}×${calibH}, tela atual ${currentW}×${currentH}`
  );
}

/**
 * CALIBRATION_CLAIMED_OK — tradução direta da regra 3 do plano em código:
 * "o que a tela afirma tem que ser verdade."
 *
 * Chamado em CalibrationCheck.tsx antes de exibir "Calibração Concluída".
 * Se isCalibrated()===false nesse ponto, existe uma desconexão entre o estado
 * interno e a UI — exatamente o bug dos óculos pré-A1-1.
 */
export function assertCalibrationClaimedOk(isCalibrated: boolean): void {
  assertInvariant(
    isCalibrated,
    'CALIBRATION_CLAIMED_OK',
    'UI declarou calibração concluída mas isCalibrated()===false'
  );
}

// ── Exposição no console de diagnóstico ─────────────────────────────────────
// Anexado ao objeto global __irisflowDebug pelo engine quando disponível.
// Uso: __irisflowDebug?.invariants?.()
export const invariantDebug = {
  violations: getInvariantViolations,
  clear: clearInvariantViolations,
};
