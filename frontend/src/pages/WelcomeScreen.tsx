import React, { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

export const WelcomeScreen: React.FC = () => {
  const navigate = useNavigate();

  useEffect(() => {
    const timer = setTimeout(() => navigate('/menu'), 5000);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <main
      role="main"
      aria-labelledby="welcome-title"
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(135deg, #eef4ff 0%, #dbeafe 50%, #e0f2fe 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        aria-hidden="true"
        className="bg-orb animate-float"
        style={{
          width: 480,
          height: 480,
          background: 'radial-gradient(circle, rgba(27,84,168,0.25), transparent)',
          top: '-10%',
          left: '-8%',
        }}
      />
      <div
        aria-hidden="true"
        className="bg-orb animate-float"
        style={{
          width: 560,
          height: 560,
          background: 'radial-gradient(circle, rgba(20,180,180,0.18), transparent)',
          bottom: '-12%',
          right: '-8%',
          animationDelay: '2s',
        }}
      />
      <div
        aria-hidden="true"
        className="bg-orb animate-float"
        style={{
          width: 300,
          height: 300,
          background: 'radial-gradient(circle, rgba(27,84,168,0.12), transparent)',
          top: '60%',
          left: '60%',
          animationDelay: '3.5s',
        }}
      />

      <div
        className="glass animate-fade-in-up"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2rem',
          padding: '4rem 5rem',
          borderRadius: '3rem',
          maxWidth: 620,
          width: '90%',
          textAlign: 'center',
          position: 'relative',
          zIndex: 10,
        }}
      >
        <img
          src="/LOGO.png"
          alt=""
          aria-hidden="true"
          className="animate-float"
          style={{
            height: 130,
            width: 'auto',
            objectFit: 'contain',
            filter: 'drop-shadow(0 8px 24px rgba(27,84,168,0.3))',
          }}
          onError={(e) => (e.currentTarget.style.display = 'none')}
        />

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <h1
            id="welcome-title"
            style={{
              fontSize: '3.5rem',
              fontWeight: 900,
              fontStyle: 'italic',
              background: 'linear-gradient(135deg, #1B54A8, #2563eb)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              lineHeight: 1.1,
              margin: 0,
            }}
          >
            Bem vindo!
          </h1>
          <p
            style={{
              fontSize: '1.1rem',
              color: 'var(--color-text-base)', opacity: 0.9,
              fontWeight: 500,
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            Posicione-se em frente à câmera.
            <br />O sistema será iniciado em instantes...
          </p>
        </div>

        <button
          type="button"
          onClick={() => navigate('/menu')}
          aria-label="Iniciar agora e ir ao menu principal"
          style={{
            marginTop: '0.5rem',
            padding: '1rem 3rem',
            background: 'linear-gradient(135deg, #1B54A8, #2563eb)',
            color: 'white',
            border: 'none',
            borderRadius: '999px',
            fontSize: '1.25rem',
            fontWeight: 700,
            fontFamily: 'Boldonse, sans-serif',
            cursor: 'pointer',
            boxShadow: '0 8px 32px rgba(27,84,168,0.4)',
            transition: 'transform 0.2s ease, box-shadow 0.2s ease',
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.transform = 'translateY(-3px)';
            e.currentTarget.style.boxShadow = '0 16px 40px rgba(27,84,168,0.5)';
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.transform = 'translateY(0)';
            e.currentTarget.style.boxShadow = '0 8px 32px rgba(27,84,168,0.4)';
          }}
        >
          Iniciar Agora
        </button>
      </div>
    </main>
  );
};
