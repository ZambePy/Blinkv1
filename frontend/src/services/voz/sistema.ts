/**
 * Voz do SISTEMA (`speechSynthesis` do Chromium/Windows).
 *
 * É a voz de reserva de tudo: sem plano Voz, sem voz importada, motor
 * ocupado ou fora do ar, ela fala. Uma promessa que resolve quando a fala
 * termina (ou quando o Chromium esquece de avisar — há um teto por tamanho
 * do texto, senão `message.spoken` para o cuidador nunca sairia).
 */

export interface OpcoesDaVozDoSistema {
  rate?: number;
  pitch?: number;
  volume?: number;
  lang?: string;
}

export function vozDoSistemaDisponivel(): boolean {
  return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
}

export function pararVozDoSistema(): void {
  if (!vozDoSistemaDisponivel()) return;
  try {
    window.speechSynthesis.cancel();
  } catch { /* nada a parar */ }
}

export function falarComVozDoSistema(texto: string, opcoes: OpcoesDaVozDoSistema = {}): Promise<void> {
  return new Promise((resolve) => {
    if (!vozDoSistemaDisponivel() || !texto.trim()) { resolve(); return; }
    try {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(texto);
      u.lang = opcoes.lang ?? 'pt-BR';
      u.rate = opcoes.rate ?? 0.9;
      if (opcoes.pitch !== undefined) u.pitch = opcoes.pitch;
      if (opcoes.volume !== undefined) u.volume = opcoes.volume;
      let terminou = false;
      const fim = () => { if (!terminou) { terminou = true; resolve(); } };
      u.onend = fim;
      u.onerror = fim;
      window.speechSynthesis.speak(u);
      setTimeout(fim, Math.min(20_000, 2_000 + texto.length * 80));
    } catch {
      resolve();
    }
  });
}
