import React from 'react';
import { Play } from 'lucide-react';
import { falar } from '../services/voz';

interface TTSButtonProps {
  text: string;
  /** Mantido por compatibilidade: a escolha da voz é do serviço (`services/voz`). */
  voiceProfileId?: string;
}

export const TTSButton: React.FC<TTSButtonProps> = ({ text }) => {
  const speak = () => {
    if (!text.trim()) return;
    // Voz clonada do paciente quando pronta e liberada; senão a do sistema.
    void falar(text, { rate: 0.9 });
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
