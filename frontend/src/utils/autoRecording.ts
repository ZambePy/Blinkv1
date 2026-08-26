import type { OpticalCondition } from '@tracker/calibrationProfiles';

// Auto-gravação da sessão de calibração+precisão (D2, ROADMAP §5). Este
// módulo NÃO fala com o gravador — só decide o nome do arquivo e para
// onde escrever. Quem invoca (CalibrationCheck.tsx) já tem o JSONL em
// mãos vindo de `recording.exportAsJSONL()`.
//
// Roteamento:
//   - Rodando sob Electron (window.irisflowElectron presente) → IPC pro
//     main, que escreve na raiz do projeto (ver electron/main.ts).
//   - Browser puro → download via <a download> (mesmo fluxo do
//     SettingsScreen manual). Cai em ~/Downloads/ e o operador move
//     manualmente pra fixtures/replay/.

export interface AutoRecordingFilenameInput {
  opticalCondition: OpticalCondition;
  quick: boolean;
  // Injetável para testes. Default: agora.
  nowIso?: string;
}

// Timestamp compacto (YYYY-MM-DD_HH-mm-ss) — ISO com ':' e '.' trocados
// por '-' porque Windows não aceita ':' em nome de arquivo. Mesma
// convenção do SettingsScreen.exportRecording (linha ~245 pré-D2).
// 19 chars = "YYYY-MM-DD_HH-mm-ss" (10 data + 1 sep + 8 hora); truncar
// mais curto perde os segundos e gera colisão de nome se o cuidador
// calibrar duas vezes no mesmo minuto.
function stampFromIso(iso: string): string {
  return iso.replace(/[:.]/g, '-').replace('T', '_').replace(/Z$/, '').slice(0, 19);
}

// Nome canônico. Casa com a convenção documentada em
// fixtures/replay/README.md: <YYYY-MM-DD>_<condicao>_<comprimento>.jsonl,
// com timestamp completo (não só a data) pra permitir múltiplas
// gravações no mesmo dia sem sobrescrever.
export function buildAutoRecordingFilename(input: AutoRecordingFilenameInput): string {
  const iso = input.nowIso ?? new Date().toISOString();
  const stamp = stampFromIso(iso);
  const cond = input.opticalCondition;
  const kind = input.quick ? 'calib-quick+precisao' : 'calib+precisao';
  return `irisflow-recording-${stamp}_${cond}_${kind}.jsonl`;
}

export interface SaveOutcome {
  kind: 'electron' | 'download';
  absPath?: string;
  bytes: number;
  filename: string;
}

// Escreve o JSONL. Não lança em caminho feliz — retorna o resultado com
// discriminante `kind`. Erros do Electron IPC vazam como Promise reject
// (o consumidor decide como sinalizar ao usuário).
export async function saveAutoRecording(
  jsonl: string,
  filename: string,
): Promise<SaveOutcome> {
  const bytes = new Blob([jsonl]).size;
  const bridge = typeof window !== 'undefined' ? window.irisflowElectron : undefined;
  if (bridge && typeof bridge.saveRecording === 'function') {
    const result = await bridge.saveRecording(jsonl, filename);
    return { kind: 'electron', absPath: result.absPath, bytes: result.bytes, filename };
  }
  // Fallback browser puro — dispara download.
  const blob = new Blob([jsonl], { type: 'application/x-ndjson' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
  return { kind: 'download', bytes, filename };
}
