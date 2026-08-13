import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Delete, Play } from 'lucide-react';
import { useSettings } from '../context/SettingsContext';

const LAYOUTS: Record<'frequency' | 'alphabetical' | 'qwerty', string[][]> = {
  frequency: [
    ['A', 'E', 'O', 'S', 'R', 'I', 'N', 'D', 'M', 'U'],
    ['T', 'C', 'L', 'P', 'V', 'G', 'H', 'Q', 'B', 'F'],
    ['Z', 'J', 'X', 'K', 'W', 'Y', '1', '2', '3', '4'],
    ['5', '6', '7', '8', '9', '0', ',', '.', '?', '!'],
  ],
  alphabetical: [
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
    ['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'],
    ['U', 'V', 'W', 'X', 'Y', 'Z', '1', '2', '3', '4'],
    ['5', '6', '7', '8', '9', '0', ',', '.', '?', '!'],
  ],
  qwerty: [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'M'],
    ['Z', 'X', 'C', 'V', 'B', 'N', ',', '.', '?', '!'],
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ],
};

export const KeyboardScreen: React.FC = () => {
  const navigate = useNavigate();
  const { settings } = useSettings();
  const [text, setText] = useState('');
  const [lastPressed, setLastPressed] = useState<string | null>(null);

  const rows = useMemo(() => LAYOUTS[settings.keyboardLayout], [settings.keyboardLayout]);

  const triggerFeedback = (key: string) => {
    setLastPressed(key);
    setTimeout(() => setLastPressed(null), 200);
  };

  const append = (char: string) => {
    setText((t) => t + char);
    triggerFeedback(char);
  };
  const backspace = () => {
    setText((t) => t.slice(0, -1));
    triggerFeedback('backspace');
  };
  const clear = () => {
    setText('');
    triggerFeedback('clear');
  };
  const space = () => {
    setText((t) => t + ' ');
    triggerFeedback('space');
  };

  const speak = () => {
    if ('speechSynthesis' in window && text.trim()) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pt-BR';
      u.rate = 0.9;
      window.speechSynthesis.speak(u);
      triggerFeedback('speak');
    }
  };

  return (
    <main
      role="main"
      style={{
        height: '100vh',
        width: '100vw',
        display: 'flex',
        flexDirection: 'column',
        background: 'var(--color-bg-base)',
        padding: '2rem',
        gap: '2rem',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}
    >
      <div style={{ display: 'flex', gap: '1rem', height: '8rem', width: '100%' }}>
        <button
          type="button"
          onClick={() => navigate('/menu')}
          style={{
            flex: '0 0 120px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--color-card-bg)',
            border: '2px solid var(--color-card-border)',
            borderRadius: '1.5rem',
            color: 'var(--color-text-base)', opacity: 0.9,
            cursor: 'pointer',
            transition: 'all 0.2s',
          }}
          onMouseOver={(e) => { e.currentTarget.style.background = 'var(--color-bg-base)'; }}
          onMouseOut={(e) => { e.currentTarget.style.background = 'var(--color-card-bg)'; }}
        >
          <ArrowLeft size={48} />
        </button>

        <div
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            padding: '0 2rem',
            background: 'var(--color-card-bg)',
            borderRadius: '1.5rem',
            border: '2px solid var(--color-card-border)',
            fontSize: '3rem',
            fontWeight: 700,
            color: text ? 'var(--color-text-base)' : 'var(--color-card-border)',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}
        >
          {text || 'Digite algo...'}
        </div>

        <button
          type="button"
          onClick={speak}
          disabled={!text.trim()}
          style={{
            flex: '0 0 200px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1rem',
            background: text.trim() ? '#1B54A8' : '#cbd5e1',
            borderRadius: '1.5rem',
            border: 'none',
            color: 'white',
            fontSize: '1.5rem',
            fontWeight: 800,
            cursor: text.trim() ? 'pointer' : 'not-allowed',
            transition: 'all 0.2s',
            transform: lastPressed === 'speak' ? 'scale(0.95)' : 'scale(1)',
          }}
        >
          <Play size={36} fill="white" /> Falar
        </button>
      </div>

      <div style={{ display: 'flex', gap: '1rem', flex: 1, width: '100%' }}>
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {rows.map((row, ri) => (
            <div key={ri} style={{ display: 'flex', gap: '1rem', flex: 1 }}>
              {row.map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => append(k)}
                  style={{
                    flex: 1,
                    background: lastPressed === k ? 'var(--color-primary-light)' : 'var(--color-card-bg)',
                    border: '2px solid',
                    borderColor: lastPressed === k ? 'var(--color-primary)' : 'var(--color-card-border)',
                    borderRadius: '1rem',
                    fontSize: '3rem',
                    fontWeight: 700,
                    color: lastPressed === k ? 'var(--color-primary)' : 'var(--color-text-base)',
                    cursor: 'pointer',
                    transition: 'all 0.1s',
                    transform: lastPressed === k ? 'scale(0.96)' : 'scale(1)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                  onMouseOver={(e) => { e.currentTarget.style.borderColor = 'var(--color-primary)'; }}
                  onMouseOut={(e) => { e.currentTarget.style.borderColor = lastPressed === k ? 'var(--color-primary)' : 'var(--color-card-border)'; }}
                >
                  {k}
                </button>
              ))}
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', flex: '0 0 200px' }}>
          <button
            type="button"
            onClick={backspace}
            style={{
              flex: 1,
              background: lastPressed === 'backspace' ? '#ef4444' : 'transparent',
              border: '2px solid #ef4444',
              borderRadius: '1.5rem',
              color: lastPressed === 'backspace' ? 'white' : '#ef4444',
              fontSize: '1.5rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '1rem',
              transition: 'all 0.1s',
              transform: lastPressed === 'backspace' ? 'scale(0.95)' : 'scale(1)',
            }}
          >
            <Delete size={48} /> Apagar
          </button>

          <button
            type="button"
            onClick={clear}
            style={{
              flex: 1,
              background: 'var(--color-card-bg)',
              border: '2px solid var(--color-card-border)',
              borderRadius: '1.5rem',
              color: 'var(--color-text-base)', opacity: 0.8,
              fontSize: '1.25rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.1s',
              transform: lastPressed === 'clear' ? 'scale(0.95)' : 'scale(1)',
            }}
          >
            Limpar
          </button>

          <button
            type="button"
            onClick={space}
            style={{
              flex: 2,
              background: 'var(--color-bg-base)',
              border: '2px solid var(--color-card-border)',
              borderRadius: '1.5rem',
              color: '#1B54A8',
              fontSize: '1.5rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              transition: 'all 0.1s',
              transform: lastPressed === 'space' ? 'scale(0.95)' : 'scale(1)',
            }}
          >
            Espaço
          </button>
        </div>
      </div>
    </main>
  );
};
