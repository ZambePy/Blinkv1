// Ponte entre `EngineDiagnostics` e `ReadinessSnapshot`.
//
// Os dois formatos são diferentes, e a conversão mora aqui — pura, testável
// sem DOM — em vez de dentro do componente React.

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
 * Devolve `null` quando os campos de qualidade não foram medidos:
 * `brightness`/`contrast` são `undefined` quando o `qualityAnalyzer` não
 * conseguiu ler o crop, e `evaluateReadiness` exige números. Preencher com
 * zero faria a tela de prontidão reprovar a iluminação a partir de uma
 * não-leitura.
 *
 * `null` significa "ainda não dá para avaliar" — a UI mostra "medindo…" em vez
 * de um veredito falso.
 */
export function snapshotFromDiagnostics(
  d: EngineDiagnostics,
  viewport: ViewportInfo,
): ReadinessSnapshot | null {
  const { brightness, contrast, detectorConfidence } = d.quality;
  const specularRatio = d.framing.specularRatio;
  if (
    typeof brightness !== 'number' ||
    typeof contrast !== 'number' ||
    typeof detectorConfidence !== 'number' ||
    typeof specularRatio !== 'number'
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
    specularRatio,
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
