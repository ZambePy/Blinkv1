import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, ArrowRight } from 'lucide-react';

export const InitialSplash: React.FC = () => {
  const navigate = useNavigate();
  const [imageError, setImageError] = useState(false);

  useEffect(() => {
    const timer = setTimeout(() => {
      navigate('/login');
    }, 3200);
    return () => clearTimeout(timer);
  }, [navigate]);

  return (
    <main
      role="main"
      aria-labelledby="splash-title"
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(160deg, #f0f4ff 0%, #e8f0fb 50%, #f1f5f9 100%)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
        padding: '2rem',
      }}
    >
      <div
        className="animate-fade-in-up"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.5rem',
          textAlign: 'center',
          maxWidth: 480,
        }}
      >
        {!imageError ? (
          <img
            src="/LOGO.png"
            alt="IrisFlow"
            style={{
              width: '260px',
              height: 'auto',
              filter: 'drop-shadow(0 12px 24px rgba(27,84,168,0.18))',
            }}
            onError={() => setImageError(true)}
          />
        ) : (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              background: '#1B54A8',
              color: 'white',
              padding: '0.85rem 1.75rem',
              borderRadius: '2rem',
              boxShadow: '0 10px 25px rgba(27, 84, 168, 0.3)',
            }}
          >
            <Eye size={36} color="white" />
            <span style={{ fontSize: '2.5rem', fontWeight: 900, letterSpacing: '0.02em' }}>
              IrisFlow
            </span>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
          <h1
            id="splash-title"
            style={{
              fontSize: '1.75rem',
              color: '#0f172a',
              fontWeight: 800,
              margin: 0,
              lineHeight: 1.3,
            }}
          >
            Plataforma de Tecnologia Assistiva
          </h1>
          <p style={{ color: '#64748b', fontSize: '1.05rem', margin: 0, fontWeight: 500 }}>
            Comunicação e autonomia através do rastreamento ocular
          </p>
        </div>

        {/* Indicador de carregamento discreto e elegante */}
        <div
          style={{
            marginTop: '1.5rem',
            width: '180px',
            height: '4px',
            background: 'rgba(27, 84, 168, 0.15)',
            borderRadius: '2px',
            overflow: 'hidden',
            position: 'relative',
          }}
        >
          <div
            style={{
              width: '40%',
              height: '100%',
              background: '#1B54A8',
              borderRadius: '2px',
              animation: 'loadingProgress 2s ease-in-out infinite',
            }}
          />
        </div>
      </div>

      <button
        type="button"
        onClick={() => navigate('/login')}
        aria-label="Avançar diretamente para o login"
        style={{
          position: 'absolute',
          bottom: '2.5rem',
          background: 'rgba(255, 255, 255, 0.8)',
          backdropFilter: 'blur(10px)',
          border: '1px solid rgba(226, 232, 240, 0.9)',
          padding: '0.6rem 1.25rem',
          borderRadius: '1rem',
          color: '#1B54A8',
          fontSize: '0.9rem',
          fontWeight: 700,
          cursor: 'pointer',
          display: 'flex',
          alignItems: 'center',
          gap: '0.4rem',
          boxShadow: '0 4px 12px rgba(0,0,0,0.04)',
          transition: 'all 0.2s ease',
        }}
      >
        Acessar sistema <ArrowRight size={16} />
      </button>

      <style>{`
        @keyframes loadingProgress {
          0% { transform: translateX(-100%); }
          50% { transform: translateX(150%); }
          100% { transform: translateX(300%); }
        }
      `}</style>
    </main>
  );
};

