import React, { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Delete, Play, RotateCcw } from 'lucide-react';
import { useSettings } from '../context/SettingsContext';
import { GazePageLayout } from '../components/ui/GazePageLayout';
import { GazeButton } from '../components/ui/GazeButton';

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
    <GazePageLayout showBack={true} backRoute="/menu">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          width: '100%',
          boxSizing: 'border-box',
          gap: '1.5rem',
        }}
      >
        {/* Barra superior de saída de texto e botão de Fala */}
        <div style={{ display: 'flex', gap: '1rem', height: '6rem', width: '100%' }}>
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              padding: '0 2rem',
              background: 'var(--color-card-bg)',
              borderRadius: '1.5rem',
              border: '2px solid var(--color-card-border)',
              fontSize: '2.5rem',
              fontWeight: 700,
              color: text ? 'var(--color-text-base)' : 'var(--color-card-border)',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            {text || 'Digite algo...'}
          </div>

          <GazeButton
            onClick={speak}
            disabled={!text.trim()}
            style={{
              width: '200px',
              height: '100%',
              background: text.trim() ? '#1B54A8' : 'rgba(255,255,255,0.05)',
              border: '2px solid var(--color-card-border)',
              borderRadius: '1.5rem',
              color: text.trim() ? 'white' : 'rgba(255,255,255,0.2)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.4rem', fontWeight: 800 }}>
              <Play size={28} fill={text.trim() ? 'white' : 'none'} stroke={text.trim() ? 'white' : 'rgba(255,255,255,0.2)'} /> Falar
            </div>
          </GazeButton>
        </div>

        {/* Teclado e Painel Lateral de Ações */}
        <div style={{ display: 'flex', gap: '1.5rem', flex: 1, minHeight: 0 }}>
          {/* Letras e Números */}
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            {rows.map((row, ri) => (
              <div key={ri} style={{ display: 'flex', gap: '0.75rem', flex: 1 }}>
                {row.map((k) => (
                  <GazeButton
                    key={k}
                    onClick={() => append(k)}
                    noWarn={true}
                    style={{
                      flex: 1,
                      height: '100%',
                      background: lastPressed === k ? 'rgba(27, 84, 168, 0.2)' : 'var(--color-card-bg)',
                      border: '2px solid',
                      borderColor: lastPressed === k ? '#1B54A8' : 'var(--color-card-border)',
                      borderRadius: '1rem',
                      fontSize: '2.5rem',
                      fontWeight: 700,
                      color: lastPressed === k ? '#1B54A8' : 'var(--color-text-base)',
                    }}
                  >
                    {k}
                  </GazeButton>
                ))}
              </div>
            ))}
          </div>

          {/* Controle Lateral */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '220px' }}>
            <GazeButton
              onClick={backspace}
              style={{
                flex: 1.5,
                background: 'rgba(239, 68, 68, 0.05)',
                border: '2px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '1.5rem',
                color: '#ef4444',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <Delete size={36} />
                <span style={{ fontSize: '1.3rem', fontWeight: 800 }}>Apagar</span>
              </div>
            </GazeButton>

            <GazeButton
              onClick={clear}
              style={{
                flex: 1,
                background: 'var(--color-card-bg)',
                border: '2px solid var(--color-card-border)',
                borderRadius: '1.5rem',
                color: 'var(--color-text-base)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <RotateCcw size={28} />
                <span style={{ fontSize: '1.15rem', fontWeight: 700 }}>Limpar</span>
              </div>
            </GazeButton>

            <GazeButton
              onClick={space}
              style={{
                flex: 2,
                background: 'rgba(27, 84, 168, 0.05)',
                border: '2px solid rgba(27, 84, 168, 0.3)',
                borderRadius: '1.5rem',
                color: '#1B54A8',
              }}
            >
              <span style={{ fontSize: '1.5rem', fontWeight: 800 }}>Espaço</span>
            </GazeButton>
          </div>
        </div>
      </div>
    </GazePageLayout>
  );
};
