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

  const rows = useMemo(() => LAYOUTS[settings.keyboardLayout], [settings.keyboardLayout]);

  const append = (char: string) => setText((t) => t + char);
  const backspace = () => setText((t) => t.slice(0, -1));
  const clear = () => setText('');
  const space = () => setText((t) => t + ' ');

  const speak = () => {
    if ('speechSynthesis' in window && text.trim()) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pt-BR';
      u.rate = 0.9;
      window.speechSynthesis.speak(u);
    }
  };

  const btnBase: React.CSSProperties = {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    cursor: 'pointer',
    border: 'none',
    fontFamily: 'Boldonse, sans-serif',
    transition: 'transform 0.1s ease, box-shadow 0.1s ease',
    userSelect: 'none',
  };

  return (
    <main
      role="main"
      aria-labelledby="kb-title"
      style={{
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: 'linear-gradient(160deg, #f0f4ff 0%, #e8f0fb 50%, #f1f5f9 100%)',
        padding: '1rem',
        gap: '0.75rem',
      }}
    >
      <h1 id="kb-title" className="sr-only">
        Teclado virtual — layout {settings.keyboardLayout}
      </h1>

      <div style={{ display: 'flex', gap: '0.75rem', height: '6rem' }}>
        <button
          type="button"
          onClick={() => navigate('/menu')}
          aria-label="Voltar ao menu"
          style={{
            ...btnBase,
            gap: '0.5rem',
            padding: '0 1.5rem',
            background: 'white',
            borderRadius: '1.25rem',
            color: '#1B54A8',
            fontSize: '1rem',
            fontWeight: 700,
            boxShadow: '0 4px 16px rgba(27,84,168,0.12)',
            minWidth: '8rem',
          }}
        >
          <ArrowLeft size={28} aria-hidden="true" /> Voltar
        </button>

        <div
          role="textbox"
          aria-live="polite"
          aria-label={text ? `Texto atual: ${text}` : 'Comece a escrever'}
          style={{
            flex: 1,
            display: 'flex',
            alignItems: 'center',
            padding: '0 1.5rem',
            background: 'white',
            borderRadius: '1.25rem',
            border: '3px solid',
            borderColor: text ? '#1B54A8' : '#e2e8f0',
            boxShadow: '0 4px 16px rgba(27,84,168,0.08)',
            fontSize: '2rem',
            fontWeight: 700,
            color: text ? '#1e293b' : '#94a3b8',
            fontFamily: 'Boldonse, sans-serif',
            overflow: 'hidden',
            whiteSpace: 'nowrap',
          }}
        >
          {text || 'Comece a escrever...'}
        </div>

        <button
          type="button"
          onClick={backspace}
          aria-label="Apagar último caractere"
          style={{
            ...btnBase,
            gap: '0.5rem',
            padding: '0 1.5rem',
            background: 'white',
            borderRadius: '1.25rem',
            color: '#ea580c',
            fontSize: '1rem',
            fontWeight: 700,
            boxShadow: '0 4px 16px rgba(234,88,12,0.12)',
            minWidth: '8rem',
          }}
        >
          <Delete size={28} aria-hidden="true" /> Apagar
        </button>

        <button
          type="button"
          onClick={speak}
          aria-label="Falar texto em voz alta"
          disabled={!text.trim()}
          style={{
            ...btnBase,
            gap: '0.5rem',
            padding: '0 2rem',
            background: 'linear-gradient(135deg, #1B54A8, #2563eb)',
            borderRadius: '1.25rem',
            color: 'white',
            fontSize: '1.1rem',
            fontWeight: 700,
            boxShadow: '0 4px 20px rgba(27,84,168,0.4)',
            minWidth: '9rem',
            opacity: text.trim() ? 1 : 0.5,
            cursor: text.trim() ? 'pointer' : 'not-allowed',
          }}
        >
          <Play size={28} fill="white" aria-hidden="true" /> FALAR
        </button>
      </div>

      <div style={{ display: 'flex', gap: '0.75rem', height: '4rem' }}>
        <button
          type="button"
          onClick={clear}
          aria-label="Apagar todo o texto"
          style={{
            ...btnBase,
            padding: '0 1.5rem',
            background: 'white',
            borderRadius: '1rem',
            color: '#475569',
            fontSize: '1rem',
            fontWeight: 700,
            boxShadow: '0 2px 8px rgba(0,0,0,0.06)',
            minWidth: '10rem',
          }}
        >
          Apagar Tudo
        </button>
        <button
          type="button"
          onClick={space}
          aria-label="Adicionar espaço"
          style={{
            ...btnBase,
            flex: 1,
            background: 'white',
            borderRadius: '1rem',
            color: '#1B54A8',
            fontSize: '1.1rem',
            fontWeight: 700,
            boxShadow: '0 2px 8px rgba(27,84,168,0.1)',
            borderBottom: '4px solid #1B54A8',
          }}
        >
          <span aria-hidden="true">⎵</span> Espaço
        </button>
      </div>

      <div
        role="grid"
        aria-label="Teclado alfanumérico"
        style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}
      >
        {rows.map((row, ri) => (
          <div key={ri} role="row" style={{ display: 'flex', gap: '0.5rem', flex: 1 }}>
            {row.map((k) => (
              <button
                key={k}
                type="button"
                role="gridcell"
                aria-label={`Tecla ${k}`}
                onClick={() => append(k)}
                className="key-btn"
                style={{ flex: 1, fontFamily: 'Boldonse, sans-serif' }}
              >
                {k}
              </button>
            ))}
          </div>
        ))}
      </div>
    </main>
  );
};
