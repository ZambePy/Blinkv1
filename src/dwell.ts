// Detecção de piscada (EAR) e dwell time para seleção em AAC (Adição D — §6D)
//
// EAR = (||P2-P6|| + ||P3-P5||) / (2 × ||P1-P4||)
// Threshold: EAR < 0.18 por ≥ 3 frames consecutivos = piscada intencional
//
// Dwell: cursor dentro do raio DWELL_RADIUS_PX por DWELL_TIME_MS ms → seleção

export interface DwellEvent {
  type: 'blink' | 'dwell';
  x: number;
  y: number;
}

const EAR_THRESHOLD    = 0.18;
const BLINK_MIN_FRAMES = 3;
export const DWELL_RADIUS_PX  = 40;   // px — configurável pelo terapeuta
export const DWELL_TIME_MS    = 800;  // ms — configurável pelo terapeuta

let consecutiveLow = 0;
let blinkCooldown  = 0;  // frames de cooldown após piscada (evita duplo-disparo)
let anchorX    = -1;
let anchorY    = -1;
let dwellStart = 0;
let dwellFired = false;

function dist2(ax: number, ay: number, bx: number, by: number): number {
  const dx = ax - bx, dy = ay - by;
  return Math.sqrt(dx * dx + dy * dy);
}

// Calcula EAR para um olho dado seus índices de landmark
function earFor(
  lm: { x: number; y: number }[],
  P1: number, P4: number,
  P2: number, P6: number,
  P3: number, P5: number
): number {
  const v1 = dist2(lm[P2].x, lm[P2].y, lm[P6].x, lm[P6].y);
  const v2 = dist2(lm[P3].x, lm[P3].y, lm[P5].x, lm[P5].y);
  const h  = dist2(lm[P1].x, lm[P1].y, lm[P4].x, lm[P4].y);
  return h < 1e-6 ? 1 : (v1 + v2) / (2 * h);
}

export function updateDwell(
  landmarks: { x: number; y: number; z: number }[],
  gazeX: number,
  gazeY: number,
  onEvent: (e: DwellEvent) => void
): void {
  // EAR médio dos dois olhos (olho direito do usuário = índices 33/133/160/144/158/153)
  const earR = earFor(landmarks, 33, 133, 160, 144, 158, 153);
  // EAR olho esquerdo do usuário (índices simétricos na malha MediaPipe 478)
  const earL = earFor(landmarks, 263, 362, 387, 373, 385, 380);
  const avgEAR = (earR + earL) / 2;

  // Detecção de piscada
  if (blinkCooldown > 0) {
    blinkCooldown--;
  } else if (avgEAR < EAR_THRESHOLD) {
    consecutiveLow++;
    if (consecutiveLow >= BLINK_MIN_FRAMES) {
      onEvent({ type: 'blink', x: gazeX, y: gazeY });
      consecutiveLow = 0;
      blinkCooldown  = 10; // ~300ms a 30fps — previne múltiplos disparos por piscada
    }
  } else {
    consecutiveLow = 0;
  }

  // Dwell time
  if (anchorX < 0) {
    anchorX    = gazeX;
    anchorY    = gazeY;
    dwellStart = performance.now();
    dwellFired = false;
  } else if (dist2(gazeX, gazeY, anchorX, anchorY) <= DWELL_RADIUS_PX) {
    if (!dwellFired && performance.now() - dwellStart >= DWELL_TIME_MS) {
      onEvent({ type: 'dwell', x: anchorX, y: anchorY });
      dwellFired = true;
    }
  } else {
    // Cursor saiu da zona de fixação — reinicia ancoragem
    anchorX    = gazeX;
    anchorY    = gazeY;
    dwellStart = performance.now();
    dwellFired = false;
  }
}

export function resetDwell(): void {
  consecutiveLow = 0;
  blinkCooldown  = 0;
  anchorX    = -1;
  anchorY    = -1;
  dwellFired = false;
}
