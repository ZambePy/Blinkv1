export function speakText(text: string) {
  if (!text || text.trim() === '') return;
  
  if ('speechSynthesis' in window) {
    // Cancel any ongoing speech
    window.speechSynthesis.cancel();
    
    const utterance = new SpeechSynthesisUtterance(text);
    
    // Configurações amigáveis (pode ser ajustado)
    utterance.rate = 0.9; 
    utterance.pitch = 1.0;
    
    // Tenta encontrar uma voz em português
    const voices = window.speechSynthesis.getVoices();
    const ptVoice = voices.find(v => v.lang.startsWith('pt'));
    if (ptVoice) {
      utterance.voice = ptVoice;
    }
    
    window.speechSynthesis.speak(utterance);
  } else {
    console.warn("Speech Synthesis não suportado neste navegador.");
  }
}
