import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export const BubblePopGame: React.FC = () => {
  const navigate = useNavigate();
  const [score, setScore] = useState(0);
  const [pos, setPos] = useState({ top: '45%', left: '45%' });

  const pop = () => {
    setScore((s) => s + 1);
    const top = `${Math.floor(Math.random() * 70) + 10}%`;
    const left = `${Math.floor(Math.random() * 70) + 10}%`;
    setPos({ top, left });
  };

  return (
    <main
      role="main"
      aria-labelledby="bubble-title"
      style={{
        position: 'relative',
        height: '100vh',
        background: 'linear-gradient(160deg, #eef2ff 0%, #c7d2fe 50%, #ede9fe 100%)',
        overflow: 'hidden',
      }}
    >
      <h1 id="bubble-title" className="sr-only">
        Estoura Bolhas
      </h1>

      <button
        type="button"
        onClick={() => navigate('/games')}
        aria-label="Sair e voltar aos mini-jogos"
        style={{
          position: 'absolute',
          top: '1.5rem',
          left: '1.5rem',
          zIndex: 50,
          display: 'flex',
          alignItems: 'center',
          gap: '0.5rem',
          padding: '0.75rem 1.5rem',
          background: 'rgba(255,255,255,0.7)',
          backdropFilter: 'blur(12px)',
          border: '2px solid rgba(255,255,255,0.8)',
          borderRadius: '999px',
          cursor: 'pointer',
          fontFamily: 'Boldonse, sans-serif',
          fontWeight: 700,
          fontSize: '1rem',
          color: '#4f46e5',
          boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
        }}
      >
        <ArrowLeft size={20} aria-hidden="true" /> Sair
      </button>

      <div
        role="status"
        aria-live="polite"
        aria-label={`Pontuação: ${score} pontos`}
        style={{
          position: 'absolute',
          top: '1.5rem',
          right: '1.5rem',
          zIndex: 50,
          background: 'rgba(255,255,255,0.7)',
          backdropFilter: 'blur(12px)',
          border: '2px solid rgba(255,255,255,0.8)',
          borderRadius: '999px',
          padding: '0.75rem 2rem',
          fontFamily: 'Boldonse, sans-serif',
          fontSize: '1.5rem',
          fontWeight: 700,
          color: '#312e81',
          boxShadow: '0 4px 16px rgba(0,0,0,0.1)',
        }}
      >
        <span aria-hidden="true">🎯 </span>
        {score} pontos
      </div>

      <p
        aria-hidden="true"
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          transform: 'translate(-50%, -50%)',
          color: 'rgba(79,70,229,0.2)',
          fontSize: '3rem',
          fontWeight: 900,
          whiteSpace: 'nowrap',
          pointerEvents: 'none',
          userSelect: 'none',
        }}
      >
        Clique na bolha!
      </p>

      <button
        type="button"
        onClick={pop}
        aria-label="Estourar bolha"
        style={{
          position: 'absolute',
          top: pos.top,
          left: pos.left,
          transform: 'translate(-50%, -50%)',
          width: '9rem',
          height: '9rem',
          borderRadius: '9999px',
          background:
            'radial-gradient(circle at 35% 35%, rgba(255,255,255,0.6), rgba(79,70,229,0.7) 70%, rgba(109,40,217,0.9))',
          border: '3px solid rgba(255,255,255,0.6)',
          cursor: 'pointer',
          boxShadow: '0 8px 40px rgba(79,70,229,0.5), inset 0 -6px 12px rgba(0,0,0,0.1)',
          transition:
            'top 0.5s cubic-bezier(0.4, 0, 0.2, 1), left 0.5s cubic-bezier(0.4, 0, 0.2, 1)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: '2.5rem',
        }}
      >
        <span aria-hidden="true">✨</span>
      </button>
    </main>
  );
};
