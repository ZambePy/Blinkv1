/**
 * Fala local (Web Speech API) usada pelas telas do paciente.
 *
 * Uma única função em vez de cinco cópias: sempre cancela o que estava sendo
 * dito antes, para o paciente não ouvir duas frases sobrepostas quando aciona
 * dois alvos em sequência.
 */
export interface SpeakOptions {
  rate?: number;
  pitch?: number;
  onEnd?: () => void;
}

export function canSpeak(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

export function speak(text: string, { rate = 0.9, pitch = 1, onEnd }: SpeakOptions = {}): boolean {
  const limpo = text.trim();
  if (!limpo || !canSpeak()) return false;
  try {
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(limpo);
    u.lang = 'pt-BR';
    u.rate = rate;
    u.pitch = pitch;
    if (onEnd) {
      u.onend = onEnd;
      u.onerror = onEnd;
    }
    window.speechSynthesis.speak(u);
    return true;
  } catch {
    onEnd?.();
    return false;
  }
}

export function stopSpeaking(): void {
  if (canSpeak()) {
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* sem síntese disponível */
    }
  }
}
