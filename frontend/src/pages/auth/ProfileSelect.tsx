import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth, type Profile } from '../../context/AuthContext';
import { Users, UserCircle, ArrowRight } from 'lucide-react';

export const ProfileSelect: React.FC = () => {
  const { profiles, selectProfile } = useAuth();
  const navigate = useNavigate();

  const handleSelect = (profile: Profile) => {
    selectProfile(profile);
    navigate('/calibration-check');
  };

  return (
    <>
      <div
        style={{
          minHeight: '100vh',
          background: 'linear-gradient(160deg, #f0f4ff 0%, #e8f0fb 50%, #f1f5f9 100%)',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2.5rem 2rem',
          position: 'relative',
          overflow: 'hidden',
        }}
      >
        <div
          className="animate-fade-in-up"
          style={{
            zIndex: 10,
            maxWidth: 820,
            width: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '2.5rem',
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              textAlign: 'center',
              gap: '0.75rem',
            }}
          >
            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.75rem',
                background: 'rgba(27, 84, 168, 0.1)',
                color: '#1B54A8',
                padding: '0.5rem 1.25rem',
                borderRadius: '2rem',
                fontSize: '0.9rem',
                fontWeight: 700,
              }}
            >
              <Users size={18} color="#1B54A8" />
              <span>Selecione seu Perfil</span>
            </div>
            <h1 style={{ fontSize: '2.2rem', color: 'var(--color-text-base)', fontWeight: 800, margin: 0 }}>
              Quem vai navegar com o olhar hoje?
            </h1>
            <p style={{ color: 'var(--color-text-base)', opacity: 0.8, fontSize: '1.05rem', margin: 0, maxWidth: 500 }}>
              Selecione o perfil do usuário para carregar suas calibrações e vocabulários salvos.
            </p>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
              gap: '1.75rem',
              width: '100%',
            }}
          >
            {profiles.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => handleSelect(p)}
                className="glass-card"
                style={{
                  background: 'rgba(255, 255, 255, 0.92)',
                  borderRadius: '1.75rem',
                  padding: '2.25rem 1.5rem',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '1.25rem',
                  cursor: 'pointer',
                  textAlign: 'center',
                  boxShadow: '0 8px 24px rgba(27, 84, 168, 0.06)',
                }}
              >
                {p.avatar ? (
                  <img
                    src={p.avatar}
                    alt={p.name}
                    style={{
                      width: 90,
                      height: 90,
                      borderRadius: '50%',
                      border: '3px solid #ffffff',
                      boxShadow: '0 8px 20px rgba(27, 84, 168, 0.15)',
                      objectFit: 'cover',
                    }}
                  />
                ) : (
                  <div
                    style={{
                      width: 90,
                      height: 90,
                      borderRadius: '50%',
                      background: 'rgba(27, 84, 168, 0.1)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <UserCircle size={60} color="#1B54A8" />
                  </div>
                )}
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
                  <span style={{ fontSize: '1.25rem', fontWeight: 800, color: 'var(--color-text-base)' }}>
                    {p.name}
                  </span>
                  <span
                    style={{
                      fontSize: '0.85rem',
                      color: '#1B54A8',
                      fontWeight: 700,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      gap: '0.25rem',
                    }}
                  >
                    Iniciar sessão <ArrowRight size={14} />
                  </span>
                </div>
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
};

