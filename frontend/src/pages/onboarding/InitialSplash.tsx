import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Eye, ArrowRight } from 'lucide-react';

export const InitialSplash: React.FC = () => {
  const navigate = useNavigate();
  const [imageError, setImageError] = useState(false);

  return (
    <main
      role="main"
      aria-labelledby="splash-title"
      style={{
        minHeight: '100vh',
        background: 'var(--color-bg-base)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        position: 'relative',
        overflow: 'hidden',
        padding: '2rem',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}
    >
      <div
        className="animate-fade-in-up"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2.5rem',
          textAlign: 'center',
          maxWidth: 600,
          zIndex: 10,
        }}
      >
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
          {!imageError ? (
            <img
              src="/LOGO.png"
              alt="IrisFlow"
              style={{
                width: '320px',
                height: 'auto',
                filter: 'drop-shadow(0 20px 40px rgba(27,84,168,0.12))',
              }}
              onError={() => setImageError(true)}
            />
          ) : (
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '1rem',
                color: '#1B54A8',
              }}
            >
              <Eye size={48} color="#1B54A8" />
              <span style={{ fontSize: '3rem', fontWeight: 900, letterSpacing: '0.02em' }}>
                IrisFlow
              </span>
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', marginTop: '1rem' }}>
          <h1
            id="splash-title"
            style={{
              fontSize: '2.2rem',
              color: 'var(--color-text-base)',
              fontWeight: 800,
              margin: 0,
              lineHeight: 1.2,
            }}
          >
            Tecnologia assistiva pelo olhar
          </h1>
          <p style={{ color: 'var(--color-text-base)', opacity: 0.8, fontSize: '1.25rem', margin: 0, fontWeight: 500 }}>
            Comunicação e autonomia sem barreiras.
          </p>
        </div>

        <div className="animate-scale-in" style={{ animationDelay: '0.4s', marginTop: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.25rem' }}>
          <button
            type="button"
            onClick={() => navigate('/tutorial')}
            aria-label="Vamos começar?"
            style={{
              background: '#1B54A8',
              color: 'white',
              border: 'none',
              padding: '1.4rem 3.5rem',
              borderRadius: '2rem',
              fontSize: '1.4rem',
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '1rem',
              boxShadow: '0 12px 32px rgba(27, 84, 168, 0.3)',
              transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.transform = 'translateY(-4px)';
              e.currentTarget.style.boxShadow = '0 16px 40px rgba(27, 84, 168, 0.4)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.transform = 'translateY(0)';
              e.currentTarget.style.boxShadow = '0 12px 32px rgba(27, 84, 168, 0.3)';
            }}
            onMouseDown={(e) => {
              e.currentTarget.style.transform = 'translateY(2px)';
            }}
          >
            Vamos começar? <ArrowRight size={28} />
          </button>

          <button
            type="button"
            onClick={() => navigate('/menu')}
            style={{
              background: 'rgba(255, 255, 255, 0.08)',
              border: '2px solid rgba(27, 84, 168, 0.3)',
              color: '#3b82f6',
              padding: '1rem 2.5rem',
              borderRadius: '1.5rem',
              fontSize: '1.15rem',
              fontWeight: 700,
              cursor: 'pointer',
              transition: 'all 0.2s',
            }}
            onMouseOver={(e) => {
              e.currentTarget.style.background = 'rgba(27, 84, 168, 0.15)';
              e.currentTarget.style.transform = 'translateY(-2px)';
            }}
            onMouseOut={(e) => {
              e.currentTarget.style.background = 'rgba(255, 255, 255, 0.08)';
              e.currentTarget.style.transform = 'translateY(0)';
            }}
          >
            Modo Desenvolvedor
          </button>
        </div>
      </div>
      
      {/* Decorações visuais sutis */}
      <div 
        className="animate-float"
        style={{
          position: 'absolute',
          top: '15%',
          left: '10%',
          width: '300px',
          height: '300px',
          background: 'radial-gradient(circle, rgba(27, 84, 168, 0.03) 0%, rgba(255,255,255,0) 70%)',
          borderRadius: '50%',
          zIndex: 1,
          pointerEvents: 'none',
        }}
      />
      <div 
        className="animate-float"
        style={{
          position: 'absolute',
          bottom: '10%',
          right: '5%',
          width: '400px',
          height: '400px',
          background: 'radial-gradient(circle, rgba(27, 84, 168, 0.04) 0%, rgba(255,255,255,0) 70%)',
          borderRadius: '50%',
          zIndex: 1,
          animationDelay: '2s',
          pointerEvents: 'none',
        }}
      />
    </main>
  );
};


