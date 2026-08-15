// Gravador de sessão (Fase 0.1 do SPRINTSELA.MD).
//
// Puro / sem DOM / testável em Node. Singleton de módulo — uma gravação por
// vez. O consumidor típico (engine.ts) chama `isRecording()` no hot loop
// para evitar alocar objetos quando o modo está desligado; o custo por
// frame com gravação OFF é uma leitura de boolean.
//
// Contrato mínimo:
//   startRecording(header) → limpa buffer + ativa captura
//   recordFrame(frame)     → empurra se ativo; no-op se não; conta em
//                            droppedFrames se buffer estiver cheio
//   stopRecording()        → só desativa; buffer continua exportável
//   exportAsJSONL()        → serializa como JSON Lines (header + frames)
//   parseJSONL(text)       → inverso, usado pelo replay
//   clearRecording()       → zera tudo (usado entre gravações)
//
// Persistência (Blob, download, fs.writeFile) NÃO é responsabilidade daqui.
// A UI que chama exportAsJSONL() decide como escrever o resultado.

import {
  MAX_FRAMES,
  RECORDING_FORMAT_VERSION,
  type RecordedFrame,
  type Recording,
  type RecordingHeader,
} from './types';

let active = false;
let header: RecordingHeader | null = null;
let frames: RecordedFrame[] = [];
let dropped = 0;

export function isRecording(): boolean {
  return active;
}

// Header parcial — formatVersion e startedAt são preenchidos aqui para o
// caller não conseguir gravar um valor errado por engano.
export type StartRecordingInput = Omit<RecordingHeader, 'formatVersion' | 'startedAt'>;

export function startRecording(input: StartRecordingInput): void {
  frames = [];
  dropped = 0;
  header = {
    formatVersion: RECORDING_FORMAT_VERSION,
    startedAt: new Date().toISOString(),
    ...input,
  };
  active = true;
}

export function stopRecording(): void {
  active = false;
}

export function recordFrame(frame: RecordedFrame): void {
  if (!active) return;
  if (frames.length >= MAX_FRAMES) {
    dropped++;
    return;
  }
  frames.push(frame);
}

export function getFrameCount(): number {
  return frames.length;
}

export function getDroppedCount(): number {
  return dropped;
}

export function getRecording(): Recording | null {
  if (!header) return null;
  return { header, frames: frames.slice(), droppedFrames: dropped };
}

export function clearRecording(): void {
  active = false;
  header = null;
  frames = [];
  dropped = 0;
}

// Serializa em JSON Lines. Primeira linha = header (com droppedFrames
// injetado para que a truncagem seja legível pelo replay); linhas seguintes
// = um frame cada. Sem indentação — o replay parseia linha a linha.
export function exportAsJSONL(): string {
  if (!header) return '';
  const lines: string[] = [];
  const headerLine = { ...header, droppedFrames: dropped };
  lines.push(JSON.stringify(headerLine));
  for (const f of frames) {
    lines.push(JSON.stringify(f));
  }
  return lines.join('\n');
}

// Parser inverso — usado pelo replay (Fase 0.2) e pelos testes do gravador.
// Retorna null quando o texto não é um JSONL válido no formato esperado
// (sem header, formatVersion ausente/errado, JSON inválido).
export function parseJSONL(text: string): Recording | null {
  const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
  if (lines.length === 0) return null;
  let parsedHeader: RecordingHeader & { droppedFrames?: number };
  try {
    parsedHeader = JSON.parse(lines[0]) as RecordingHeader & { droppedFrames?: number };
  } catch {
    return null;
  }
  if (typeof parsedHeader.formatVersion !== 'number') return null;

  const parsedFrames: RecordedFrame[] = [];
  for (let i = 1; i < lines.length; i++) {
    try {
      parsedFrames.push(JSON.parse(lines[i]) as RecordedFrame);
    } catch {
      // Uma linha corrompida invalida a gravação inteira — o replay não pode
      // saltar frames silenciosamente. Falha explícita.
      return null;
    }
  }

  return {
    header: parsedHeader,
    frames: parsedFrames,
    droppedFrames: parsedHeader.droppedFrames ?? 0,
  };
}
