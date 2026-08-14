// Flags de rollout do pipeline L2CS.
//
// Ficam em módulo dedicado (não em engine.ts) para:
//   1. Facilitar grep — quem procurar "USE_L2CS" acha o único lugar.
//   2. Facilitar promoção futura para config runtime (SettingsScreen) sem mexer
//      em engine/extractor.

// Default de compilação. Usado quando não há override via localStorage.
const DEFAULT_USE_L2CS_ANGLES = true;

// Chave de override runtime — permite trocar sem rebuild para A/B via
// startAccuracyTest (§5 do L2CS-NET.md). No console do DevTools:
//   localStorage.setItem('l2cs.enabled', 'true');  location.reload();
//   localStorage.setItem('l2cs.enabled', 'false'); location.reload();
//   localStorage.removeItem('l2cs.enabled');       location.reload();  // volta ao default
const OVERRIDE_KEY = 'l2cs.enabled';

function resolveUseL2CSAngles(): boolean {
  // Testes em Node/jsdom têm localStorage vazio → cai no default.
  // Electron/browser: honra o override quando presente.
  try {
    if (typeof localStorage === 'undefined') return DEFAULT_USE_L2CS_ANGLES;
    const v = localStorage.getItem(OVERRIDE_KEY);
    if (v === 'true') return true;
    if (v === 'false') return false;
  } catch {
    // localStorage pode lançar em sandboxes restritos — silencia e cai no default.
  }
  return DEFAULT_USE_L2CS_ANGLES;
}

// Liga o pipeline L2CS (crop 448 → ONNX no worker → 7 dims em cada vetor de
// olho). Resolvido na CARGA do módulo — trocar o override em runtime requer
// reload da página. Isso é intencional: mid-session, o vetor mudaria de 31 p/
// 38 dims e uma calibração já feita ficaria inconsistente (predictRidge
// devolve {0,0} em size mismatch, mas melhor evitar UX quebrada).
//
// Rollback: rebuild com DEFAULT_USE_L2CS_ANGLES=false OU
// localStorage.removeItem('l2cs.enabled').
export const USE_L2CS_ANGLES = resolveUseL2CSAngles();
