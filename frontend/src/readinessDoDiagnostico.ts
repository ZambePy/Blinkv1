import {
  evaluateReadiness, aggregateSnapshots,
  type ReadinessSnapshot, type ReadinessReport, type CheckStatus,
} from '@tracker/setupReadiness';
import type { EngineDiagnostics } from './context/GazeContext';
import type { NivelPreflight, ItemPreflight } from '@tracker/diagnostics/preflight';

// Ponte entre o diagnóstico do engine e o `setupReadiness` (distância,
// enquadramento, postura, iluminação, contraste, reflexo de óculos).
//
// A avaliação roda sobre uma JANELA de quadros, não sobre um só: iluminação e
// contraste de um quadro são ruído, e `specularPersistence` só existe no
// agregado — é ela que separa o reflexo persistente de uma lente de um brilho
// passageiro.

const NIVEL: Record<CheckStatus, NivelPreflight> = {
  ok: 'ok',
  warn: 'atencao',
  fail: 'bloqueio',
  // "Não medido" não é "está bom". Avisa sem bloquear.
  unknown: 'atencao',
};

const ROTULO: Record<string, string> = {
  face: 'rosto',
  distance: 'distância',
  centering: 'enquadramento',
  headPose: 'postura',
  lighting: 'iluminação',
  contrast: 'contraste',
  glasses: 'reflexo/óculos',
  flicker: 'cintilação',
  distanceRange: 'faixa de distância',
  viewport: 'viewport (setup)',
  resolution: 'resolução (setup)',
};

/** Converte um diagnóstico do engine num snapshot de prontidão. */
export function snapshotDe(d: EngineDiagnostics): ReadinessSnapshot {
  return {
    hasFace: d.framing.hasFace,
    iod: d.framing.iodPx,
    videoWidth: d.video.width,
    videoHeight: d.video.height,
    faceCenter: d.framing.faceCenter,
    pose: { yaw: d.pose.yaw, pitch: d.pose.pitch, roll: d.pose.roll },
    // `?? NaN` e não `?? 0`: zero é uma leitura válida de brilho, e fabricá-la
    // faria "não medido" virar "está escuro".
    brightness: d.quality.brightness ?? NaN,
    contrast: d.quality.contrast ?? NaN,
    detectorConfidence: d.quality.detectorConfidence ?? NaN,
    specularRatio: d.framing.specularRatio ?? NaN,
    viewportWidth: document.documentElement.clientWidth,
    viewportHeight: document.documentElement.clientHeight,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
  };
}

/**
 * Roda a avaliação sobre uma janela de snapshots e traduz para itens do
 * preflight.
 *
 * `viewport` e `resolution` são descartados: o preflight já os verifica com
 * critérios próprios (assimétrico por eixo, ancorado no que consome cada um).
 * Dois vereditos para a mesma pergunta ensinariam o operador a escolher o que
 * lhe convém.
 */
export function itensDeProntidao(
  janela: readonly ReadinessSnapshot[],
  horizontalFovDeg: number | null,
): { itens: ItemPreflight[]; relatorio: ReadinessReport | null } {
  const agregado = aggregateSnapshots(janela);
  if (!agregado) return { itens: [], relatorio: null };

  const relatorio = evaluateReadiness(agregado, { horizontalFovDeg });
  const itens = relatorio.checks
    .filter((c) => c.id !== 'viewport' && c.id !== 'resolution')
    .map<ItemPreflight>((c) => ({
      item: ROTULO[c.id] ?? c.id,
      nivel: NIVEL[c.status],
      detalhe: c.value !== null && Number.isFinite(c.value)
        ? `${c.message} (${c.value.toFixed(2)})`
        : c.message,
      // A mensagem do `setupReadiness` já é acionável por contrato — o
      // cabeçalho dele exige "o que fazer, não o que houve".
      acao: c.status === 'ok' ? null : c.message,
    }));

  return { itens, relatorio };
}
