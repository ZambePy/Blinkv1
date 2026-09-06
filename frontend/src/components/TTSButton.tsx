import React from 'react';
import { Play } from 'lucide-react';

interface TTSButtonProps {
  text: string;
  voiceProfileId?: string; // futuro: voz clonada
}

export const TTSButton: React.FC<TTSButtonProps> = ({ text, voiceProfileId: _voiceProfileId }) => {
  const speak = () => {
    if (!text.trim()) return;
    window.speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = 'pt-BR';
    u.rate = 0.9;
    // Futuro: se voiceProfileId, buscar áudio do backend
    window.speechSynthesis.speak(u);
  };

  return (
    <button
      onClick={speak}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0 2rem',
        background: 'linear-gradient(135deg, #1B54A8, #2563eb)',
        borderRadius: '1.25rem',
        color: 'white',
        fontSize: '1.1rem',
        fontWeight: 700,
        border: 'none',
        cursor: 'pointer',
        boxShadow: '0 4px 20px rgba(27,84,168,0.4)',
      }}
    >
      <Play size={24} fill="white" /> FALAR
    </button>
  );
};
