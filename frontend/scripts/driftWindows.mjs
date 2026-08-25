// D7.3 (ROADMAP §5) — parse do argumento `--drift-curve` do measure_baseline.
//
// Extraído em módulo próprio para permitir teste unitário sem espera de
// fixture — a lógica de parse é 100% determinística e não depende de I/O.
// O `measure_baseline.mjs` importa daqui.
//
// FORMATO: lista de janelas separadas por vírgula, cada janela como
// `startMin-endMin` em MINUTOS. Ex.: "0-5,20-25,40-45".
//
// Escolha da unidade (minutos, não segundos): a curva de deriva do plano
// original (0/20/40min) opera em escala de minutos; expressar segundos
// (0-300, 1200-1500) obscurece o significado. O conversor para segundos
// só é feito antes de passar para `--time-window` do replay, que aceita
// segundos porque `captureTs` é ms.

export const DEFAULT_DRIFT_WINDOWS_MIN = '0-5,20-25,40-45';

export function parseDriftWindows(raw) {
  const src = raw ?? DEFAULT_DRIFT_WINDOWS_MIN;
  const windows = [];
  for (const chunk of src.split(',')) {
    const trimmed = chunk.trim();
    if (!trimmed) continue;
    const parts = trimmed.split('-').map((s) => Number(s.trim()));
    if (parts.length !== 2 || parts.some((n) => !Number.isFinite(n)) || parts[0] < 0 || parts[1] <= parts[0]) {
      throw new Error(`--drift-curve espera "startMin-endMin,...". Segmento inválido: "${trimmed}"`);
    }
    windows.push({ startMin: parts[0], endMin: parts[1] });
  }
  if (windows.length === 0) {
    throw new Error(`--drift-curve não produziu janela alguma a partir de "${src}"`);
  }
  return windows;
}

export function buildDriftCurveVariants(rawArg) {
  const windows = parseDriftWindows(rawArg);
  return windows.map((w) => ({
    name: `drift: ${w.startMin}-${w.endMin} min`,
    filter: 'balanceado-v2',
    recomputeFeatures: false,
    timeWindow: `${w.startMin * 60},${w.endMin * 60}`,
  }));
}
