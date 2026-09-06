import React, { useEffect, useState } from 'react';
import { BackButton } from '../../components/ui/BackButton';

type Phase = 'Inale' | 'Segure' | 'Exale';

export const MeditationScreen: React.FC = () => {
  const [phase, setPhase] = useState<Phase>('Inale');
  const [scale, setScale] = useState(1);
  const [active, setActive] = useState(false);

  useEffect(() => {
    if (!active) return;
    let cancelled = false;

    let currentPhase: Phase = 'Inale';
    const cycle = () => {
      if (cancelled) return;
      if (currentPhase === 'Inale') {
        setPhase('Inale');
        setScale(1.5);
        setTimeout(() => {
          currentPhase = 'Segure';
          cycle();
        }, 4000);
      } else if (currentPhase === 'Segure') {
        setPhase('Segure');
        setTimeout(() => {
          currentPhase = 'Exale';
          cycle();
        }, 4000);
      } else {
        setPhase('Exale');
        setScale(1);
        setTimeout(() => {
          currentPhase = 'Inale';
          cycle();
        }, 4000);
      }
    };

    cycle();
    return () => {
      cancelled = true;
      setScale(1);
    };
  }, [active]);

  return (
    <main
      role="main"
      aria-labelledby="meditation-title"
      style={{
        minHeight: '100vh',
        backgroundColor: '#fdf4ff',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
      }}
    >
      <div style={{ position: 'absolute', top: '2rem', left: '2rem', zIndex: 10 }}>
        <BackButton />
      </div>

      <div style={{ textAlign: 'center', marginBottom: '3rem', zIndex: 10 }}>
        <h1
          id="meditation-title"
          style={{ fontSize: '2.5rem', color: '#86198f', margin: 0, fontWeight: 900 }}
        >
          Meditação Visual
        </h1>
        <p style={{ fontSize: '1.25rem', color: '#a21caf', marginTop: '0.5rem' }}>
          Siga o círculo com a respiração
        </p>
      </div>

      <div
        role="img"
        aria-label={active ? `Fase atual: ${phase}` : 'Círculo de respiração parado'}
        aria-live="polite"
        style={{
          width: 300,
          height: 300,
          position: 'relative',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 200,
            height: 200,
            borderRadius: '50%',
            background: 'radial-gradient(circle, #e879f9, #c026d3)',
            transition: 'transform 4s ease-in-out',
            transform: `scale(${scale})`,
            boxShadow: '0 0 50px rgba(192,38,211,0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {active && (
            <span
              style={{
                color: 'white',
                fontSize: '2rem',
                fontWeight: 900,
                textShadow: '0 2px 4px rgba(0,0,0,0.3)',
              }}
            >
              {phase}
            </span>
          )}
        </div>
      </div>

      {!active ? (
        <button
          type="button"
          onClick={() => setActive(true)}
          aria-label="Iniciar sessão de meditação guiada"
          style={{
            marginTop: '4rem',
            padding: '1.5rem 4rem',
            fontSize: '1.5rem',
            background: '#c026d3',
            color: 'white',
            border: 'none',
            borderRadius: '1.5rem',
            fontWeight: 700,
            cursor: 'pointer',
            zIndex: 10,
            boxShadow: '0 8px 25px rgba(192,38,211,0.4)',
          }}
        >
          Iniciar Sessão
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setActive(false)}
          aria-label="Pausar sessão de meditação"
          style={{
            marginTop: '4rem',
            padding: '1.5rem 4rem',
            fontSize: '1.5rem',
            background: 'var(--color-card-bg)',
            color: '#86198f',
            border: '2px solid #c026d3',
            borderRadius: '1.5rem',
            fontWeight: 700,
            cursor: 'pointer',
            zIndex: 10,
          }}
        >
          Pausar
        </button>
      )}
    </main>
  );
};
