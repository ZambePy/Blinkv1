// Construção do `RunMeta` para o teste de precisão automático pós-calibração.
// Existe como função pura, isolada da árvore React, por dois motivos:
//
//   1. Testabilidade. Testar a partir do componente React exigiria montar
//      todo o `GazeProvider` só para observar o objeto que a UI passa ao
//      `startAccuracyTest`. Extraído aqui, o teste é uma linha.
//
//   2. "O que a UI afirma tem que ser verdade". Antes deste util, todo
//      relatório automático saía com `iluminacao: 'boa', oculos: false,
//      movimentoCabeca: 'parada', minutosDeSessao: 0` — independente da
//      realidade. Um gráfico de deriva erro×tempo fica impossível de
//      construir se `minutosDeSessao` for sempre 0; a filtragem por
//      condição óptica fica impossível se `oculos` for sempre `false`.
import type { RunMeta } from '@tracker/accuracy';
import type { OpticalCondition } from '@tracker/calibrationProfiles';
import type { ReadinessReport } from '@tracker/setupReadiness';

export interface AutoTestMetaInput {
  /** Tempo em ms desde o `engine.start()` bem-sucedido. Origem:
   *  `GazeContext.getSessionUptimeMs()`, que delega a `engine.getSessionUptimeMs()`. */
  sessionUptimeMs: number;
  /** Condição óptica do perfil de calibração ativo. Origem:
   *  `calibration.getActiveOpticalCondition()`. */
  opticalCondition: OpticalCondition;
  /** Distância olho→tela em cm, definida pelo cuidador nas configurações.
   *  60 é o meio da faixa recomendada (50–60 cm) exibida em `CalibrationCheck`. */
  distanciaCm: number;
  /** Diagonal física do monitor em polegadas. Definida pelo cuidador. */
  telaPolegadas: number;
  /**
   * De onde veio `telaPolegadas` (B2.10): `'default'` (hardcode 23,6″),
   * `'auto'` (EDID) ou `'manual'` (o cuidador mediu).
   *
   * Sem este campo o relatório declarava `geometryAssumed: false` sempre que o
   * número existisse — e como o default sempre existe, TODO relatório afirmava
   * ter medido a diagonal. O erro angular é calculado sobre ela.
   */
  screenGeometrySource?: 'default' | 'auto' | 'manual';
  /** ISO date do dia (yyyy-mm-dd). Injetável para o teste ser determinístico. */
  dateISO?: string;
}

// Mapeia a condição óptica para o booleano `oculos` que o `RunMeta` exige.
// `lentes_contato` NÃO tem o problema estrutural das lentes (refração
// dependente do ângulo de olhar), então não conta como "óculos" para efeito
// de análise dos relatórios. `desconhecido` preserva o comportamento default
// anterior (`false`) para não introduzir mudança silenciosa de baseline.
export function opticalConditionToOculos(cond: OpticalCondition): boolean {
  return cond === 'oculos_simples' || cond === 'oculos_progressivo';
}

export function buildAutoTestMeta(input: AutoTestMetaInput): RunMeta {
  const minutosDeSessao = Math.max(0, Math.round(input.sessionUptimeMs / 60_000));
  const data = input.dateISO ?? new Date().toISOString().slice(0, 10);
  return {
    data,
    iluminacao: 'boa',
    oculos: opticalConditionToOculos(input.opticalCondition),
    movimentoCabeca: 'parada',
    minutosDeSessao,
    observacoes:
      `auto (imediatamente após calibração; iluminação=default; ` +
      `condição óptica=${input.opticalCondition})`,
    distanciaCm: input.distanciaCm,
    telaPolegadas: input.telaPolegadas,
    // B2.10 — a procedência da diagonal viaja com o relatório. Ausente é
    // tratado como 'default' pelo consumidor, que é o pior caso honesto.
    screenGeometrySource: input.screenGeometrySource ?? 'default',
  };
}

// No fluxo de accuracy test MANUAL (SettingsScreen), o `RunMeta` que a UI
// monta vinha com `minutosDeSessao: 0` hardcoded. O cuidador tinha que editar
// o select "Sessão (min)" toda vez para o relatório refletir a realidade.
//
// Contrato:
//   - Se `meta.minutosDeSessao` for `0` (default do state), substitui pelo
//     uptime real do engine e anota `observacoes` com a origem.
//   - Se o cuidador escolheu manualmente um valor (para simular deriva ou
//     testar curva de fadiga), a escolha manual é preservada — override
//     manual do humano SEMPRE vence auto.
//   - Não toca em outros campos (iluminação, óculos, distância, tela).
export function applyUptimeToRunMetaIfDefault(
  meta: RunMeta,
  sessionUptimeMs: number,
): RunMeta {
  if (meta.minutosDeSessao !== 0) return meta;
  const autoMinutos = Math.max(0, Math.round(sessionUptimeMs / 60_000));
  if (autoMinutos === 0) return meta; // uptime também é 0 — nada a preencher
  const suffix = ` (auto: uptime ${autoMinutos} min)`;
  return {
    ...meta,
    minutosDeSessao: autoMinutos,
    observacoes: (meta.observacoes ?? '') + suffix,
  };
}

/**
 * Traduz o veredito do posto de uso para os campos do `RunMeta`.
 *
 * `iluminacao` fica 'boa' apenas quando a checagem de luz E a de contraste
 * passam; qualquer aviso vira 'ruim'. É grosseiro de propósito — o campo é
 * binário no schema e mentir para o lado otimista é o que tornava o histórico
 * inútil. `oculos` passa a vir do reflexo especular medido, não da resposta
 * do cuidador, que descrevia a intenção e não o que a câmera via.
 */
export function readinessMetaFrom(r: ReadinessReport | null): Partial<RunMeta> {
  if (!r) return {};
  const statusOf = (id: string) => r.checks.find((c) => c.id === id)?.status;
  const luzOk = statusOf('lighting') === 'ok' && statusOf('contrast') === 'ok';
  const posturaOk = statusOf('headPose') === 'ok';
  const m = r.measured;
  return {
    iluminacao: luzOk ? 'boa' : 'ruim',
    oculos: m.glassesLikely,
    movimentoCabeca: posturaOk ? 'parada' : 'livre',
    observacoes:
      `auto (pré-calibração medida: rosto=${(m.iodFraction * 100).toFixed(1)}% do frame, ` +
      `brilho=${m.brightness.toFixed(3)}, contraste=${m.contrast.toFixed(3)}` +
      (m.estimatedDistanceCm !== null ? `, distância medida≈${m.estimatedDistanceCm.toFixed(0)}cm` : ', distância não medida') +
      `, avisos=${r.checks.filter((c) => c.status !== 'ok').map((c) => c.id).join('|') || 'nenhum'})`,
  };
}
