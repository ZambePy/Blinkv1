// Construção do `RunMeta` para o teste de precisão automático pós-calibração.
// Função pura, fora da árvore React, para ser testável sem montar o
// `GazeProvider` — e para o relatório refletir a sessão real (uptime, condição
// óptica) em vez de valores fixos.
import type { RunMeta } from '@tracker/accuracy';
import type { OpticalCondition } from '@tracker/calibrationProfiles';
import type { ReadinessReport } from '@tracker/setupReadiness';
import { ultimaProntidao, idadeDaProntidaoMin } from '../ultimaProntidao';
import { proximoBloco } from '../registroDaSessao';

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
   * De onde veio `telaPolegadas`: `'default'` (hardcode 23,6″), `'auto'`
   * (EDID) ou `'manual'` (o cuidador mediu). O erro angular é calculado sobre
   * a diagonal, então o relatório precisa saber se ela foi medida ou assumida.
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
    // Ausente é tratado como 'default' pelo consumidor — o pior caso honesto.
    screenGeometrySource: input.screenGeometrySource ?? 'default',
  };
}

// Preenche `minutosDeSessao` com o uptime real do engine quando o cuidador
// deixou o select no default (0). Um valor escolhido manualmente é preservado
// — override humano sempre vence o automático. Não toca em outros campos.
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

/**
 * Monta o `RunMeta` completo de uma rodada de medição.
 *
 * Junta três fontes que antes não se falavam:
 *
 *   1. a condição da sessão (uptime, condição óptica, geometria da tela);
 *   2. a PRONTIDÃO MEDIDA — iluminação, postura e reflexo de óculos saíam
 *      hardcoded como `'boa'`/`'parada'`/dropdown em todo relatório, inclusive
 *      nas sessões ruins;
 *   3. o registro da sessão — o número do bloco, derivado do instante do
 *      treino em vez de anotado à mão.
 *
 * Síncrona de propósito: o caminho pós-calibração monta o meta dentro de um
 * `try/catch` que transforma falha em diálogo na tela, e um `await` escaparia
 * desse catch.
 *
 * **Incrementa a contagem de blocos** — chamar uma vez por rodada, no início.
 */
export function montarMetaDeMedicao(
  input: AutoTestMetaInput & { calibTs: number | null },
): RunMeta {
  const meta = buildAutoTestMeta(input);

  const bloco = proximoBloco(input.calibTs);
  if (bloco !== null) meta.blocoDeMedicao = bloco;

  const prontidao = ultimaProntidao();
  if (prontidao) {
    const medido = readinessMetaFrom(prontidao);
    const idade = idadeDaProntidaoMin();
    Object.assign(meta, medido);
    meta.observacoes =
      `${medido.observacoes ?? ''} [prontidão medida há ${(idade ?? 0).toFixed(1)} min]`;
  } else {
    // Sem medição, os campos binários do schema continuam com o default — mas
    // o relatório passa a DIZER isso. Antes, `iluminacao: 'boa'` era gravado
    // com a mesma cara de um valor medido, e depois não havia como separar as
    // sessões em que alguém verificou das em que ninguém verificou.
    meta.observacoes =
      `${meta.observacoes ?? ''} [prontidão não medida: iluminação e postura ` +
      `são o DEFAULT do schema, não uma medição]`;
  }

  return meta;
}
