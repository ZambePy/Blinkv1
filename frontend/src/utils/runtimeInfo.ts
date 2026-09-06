// Snapshot do runtime para o relatório de precisão.
//
// Existia só dentro de `CalibrationCheck`, e o teste disparado por
// Configurações chamava `startAccuracyTest` com dois argumentos — sem runtime.
// O relatório saía com `pipeline.runtime: null`, ou seja, sem provider
// efetivo, sem `l2csFallback`, sem `stalePct` e sem fps: exatamente os campos
// que o protocolo manda ler ANTES de acreditar num número. Foi assim que os
// dois relatórios do histórico nasceram incomparáveis.
//
// Uma função só, usada pelos dois caminhos, para não voltar a divergir.
import type { RuntimeInfo } from '@tracker/accuracy';
import { EXPERIMENT } from '@tracker/config/experiment';

/** O que `getDiagnostics()` do GazeContext devolve, na parte que interessa. */
export interface DiagnosticosDeRuntime {
  l2cs?: {
    executionProvider?: string | null;
    fallback?: boolean;
    latencyMs?: number;
    stalePct?: number;
  } | null;
  filtro?: { efetivo?: string; preset?: string | null } | null;
  fpsRender?: number;
  video?: { width: number; height: number } | null;
}

export function buildRuntimeInfo(
  d: DiagnosticosDeRuntime | null | undefined,
): RuntimeInfo | undefined {
  if (!d) return undefined;
  return {
    l2csExecutionProvider: d.l2cs?.executionProvider ?? null,
    l2csFallback: d.l2cs?.fallback,
    l2csLatencyMs: d.l2cs?.latencyMs,
    l2csStalePct: d.l2cs?.stalePct,
    // O campo existia no tipo e nunca era preenchido, enquanto a §5 do
    // MEDICOES.md afirma que `runtime` traz o tamanho do recorte. Vem da flag
    // ativa, que é a mesma que o engine usa para montar o crop.
    l2csInputSize: EXPERIMENT.l2csInputSize,
    filterEffective: d.filtro?.efetivo,
    filterPreset: d.filtro?.preset ?? null,
    fpsRender: d.fpsRender,
    video: d.video ? { width: d.video.width, height: d.video.height } : undefined,
  };
}
