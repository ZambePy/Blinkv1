import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Moon } from 'lucide-react';
import { GazeButton } from '../../components/ui/GazeButton';

export const RestScreen: React.FC = () => {
  const navigate = useNavigate();

  return (
    <main
      role="main"
      aria-labelledby="rest-title"
      style={{
        width: '100vw',
        height: '100vh',
        background: '#020617', // Fundo ultra-escuro (Slate-950) para descanso do olhar
        color: '#f8fafc',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '2.5rem',
        overflow: 'hidden',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.25rem',
          textAlign: 'center',
          maxWidth: '500px',
          animation: 'fadeIn 0.6s ease-out',
        }}
      >
        <div
          style={{
            width: '90px',
            height: '90px',
            borderRadius: '50%',
            background: 'rgba(59, 130, 246, 0.08)',
            border: '2px solid rgba(59, 130, 246, 0.25)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: '#3b82f6',
            boxShadow: '0 0 40px rgba(59, 130, 246, 0.1)',
            marginBottom: '1rem',
          }}
        >
          <Moon size={44} className="animate-float" />
        </div>

        <h1
          id="rest-title"
          style={{
            fontSize: '2rem',
            fontWeight: 800,
            margin: 0,
            color: '#f1f5f9',
          }}
        >
          Modo Descanso
        </h1>
        <p
          style={{
            fontSize: '1.15rem',
            opacity: 0.65,
            lineHeight: 1.5,
            margin: 0,
            fontWeight: 500,
          }}
        >
          O rastreamento ocular de ações foi pausado.
          <br />
          Olhe fixamente para o botão abaixo para acordar.
        </p>
      </div>

      <GazeButton
        onClick={() => navigate('/menu')}
        style={{
          width: '320px',
          height: '96px',
          background: 'rgba(255, 255, 255, 0.04)',
          border: '2px solid rgba(255, 255, 255, 0.12)',
          borderRadius: '2rem',
          color: '#ffffff',
          boxShadow: '0 10px 30px rgba(0,0,0,0.3)',
          transition: 'all 0.3s ease',
        }}
        data-dwell-ms={3000} // Tempo absoluto customizado: 3.0s
      >
        <span style={{ fontSize: '1.5rem', fontWeight: 800, letterSpacing: '0.02em' }}>
          Acordar Tela (3s)
        </span>
      </GazeButton>
    </main>
  );
};
