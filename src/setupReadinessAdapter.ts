// Ponte entre `EngineDiagnostics` e `setupReadiness` — B3.16.
//
// ## Por que existe
//
// `evaluateReadiness` e `aggregateSnapshots` **não tinham chamador de
// produção** — só testes. O README destaca "verificação de prontidão ao vivo"
// como recurso, e o módulo inteiro estava lá, testado e correto, sem nunca
// rodar.
//
// O que o paciente e o cuidador perdiam:
//   • a checagem de VIEWPORT, que é a única defesa contra o erro angular
//     inflado por rodar em janela não-maximizada (ver B2.9/B2.10);
//   • a avaliação de `distanceRange`;
//   • o aviso de cintilação;
//   • e o `RunMeta` voltava a ser digitado à mão em vez de vir de medição.
//
// A peça que faltava era esta: `EngineDiagnostics` e `ReadinessSnapshot` têm
// formatos diferentes, e ninguém tinha escrito a conversão. O adaptador é
// puro, então dá para testá-lo sem DOM — e é por isso que ele mora em `src/`
// e não dentro do componente React.

import type { EngineDiagnostics } from './tracker/engine';
import type { ReadinessSnapshot } from './setupReadiness';

/** Dimensões que só o DOM conhece. Passadas de fora para o adaptador
 *  continuar puro. */
export interface ViewportInfo {
  viewportWidth: number;
  viewportHeight: number;
  screenWidth: number;
  screenHeight: number;
}

/**
 * Converte um `EngineDiagnostics` em `ReadinessSnapshot`.
 *
 * Devolve `null` quando os campos de qualidade não foram medidos — decisão
 * herdada de B3.3: `brightness`/`contrast` são `undefined` quando o
 * `qualityAnalyzer` não conseguiu ler o crop, e `evaluateReadiness` exige
 * números. Preencher com zero faria a tela de prontidão reprovar a iluminação
 * a partir de uma não-leitura, que é exatamente o defeito que B3.3 corrigiu
 * do outro lado.
 *
 * `null` significa "ainda não dá para avaliar" — a UI mostra "medindo…" em vez
 * de um veredito falso.
 */
export function snapshotFromDiagnostics(
  d: EngineDiagnostics,
  viewport: ViewportInfo,
): ReadinessSnapshot | null {
  const { brightness, contrast, detectorConfidence } = d.quality;
  if (
    typeof brightness !== 'number' ||
    typeof contrast !== 'number' ||
    typeof detectorConfidence !== 'number'
  ) {
    return null;
  }
  if (!(d.video.width > 0) || !(d.video.height > 0)) return null;

  return {
    hasFace: d.framing.hasFace,
    iod: d.framing.iodPx,
    videoWidth: d.video.width,
    videoHeight: d.video.height,
    faceCenter: d.framing.faceCenter,
    pose: d.pose,
    brightness,
    contrast,
    detectorConfidence,
    specularRatio: d.framing.specularRatio,
    viewportWidth: viewport.viewportWidth,
    viewportHeight: viewport.viewportHeight,
    screenWidth: viewport.screenWidth,
    screenHeight: viewport.screenHeight,
  };
}

/** Lê o viewport do DOM. Isolada para o adaptador acima continuar testável. */
export function lerViewport(): ViewportInfo {
  if (typeof document === 'undefined' || typeof window === 'undefined') {
    return { viewportWidth: 0, viewportHeight: 0, screenWidth: 0, screenHeight: 0 };
  }
  return {
    viewportWidth: document.documentElement.clientWidth,
    viewportHeight: document.documentElement.clientHeight,
    screenWidth: window.screen.width,
    screenHeight: window.screen.height,
  };
}
