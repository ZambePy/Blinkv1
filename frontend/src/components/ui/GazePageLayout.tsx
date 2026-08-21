import React from 'react';
import { Bell } from 'lucide-react';
import { BackButton } from './BackButton';
import { GazeButton } from './GazeButton';
import { useReminders } from '../../context/ReminderContext';

interface GazePageLayoutProps {
  children: React.ReactNode;
  showBack?: boolean;
  showEmergency?: boolean;
  backRoute?: string;
}

export const GazePageLayout: React.FC<GazePageLayoutProps> = ({
  children,
  showBack = true,
  backRoute,
}) => {
  const { activeReminder, dismissActiveReminder } = useReminders();

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        background: 'var(--color-bg-base)', // Agora usa fundo branco/claro do tema
        color: 'var(--color-text-base)',
        overflow: 'hidden',
        boxSizing: 'border-box',
        padding: '8.5rem 3rem 3rem 3rem', // Espaço para a barra superior
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
      }}
    >
      {/* Cabeçalho de Navegação e Emergência Canônica (B1-4) */}
      <div
        style={{
          position: 'absolute',
          top: '2rem',
          left: '3rem',
          right: '3rem',
          height: '4.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          zIndex: 9990,
        }}
      >
        {/* Voltar Canônico */}
        {showBack ? (
          <BackButton to={backRoute} />
        ) : (
          <div style={{ width: 180 }} />
        )}

        {/* Zona de Descanso Neutra (B1-5) */}
        <div
          data-no-dwell="true"
          className="gaze-rest-zone"
          style={{
            width: '320px', // Equivalente a 8.0° (GAZE_TOKENS.restZoneMinDeg)
            height: '100%',
            background: 'rgba(15, 23, 42, 0.03)',
            border: '2px dashed rgba(15, 23, 42, 0.15)',
            borderRadius: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(15, 23, 42, 0.6)',
            fontSize: '1rem',
            fontWeight: 700,
            cursor: 'default',
            userSelect: 'none',
          }}
        >
          👁 Zona de Descanso (Sem clique)
        </div>

        {/* Emergência Canônica (Gerenciada globalmente pelo EmergencyProvider) */}
        <div style={{ width: 200 }} />
      </div>

      {/* Conteúdo Principal */}
      <div style={{ width: '100%', height: '100%', position: 'relative' }}>
        {children}
      </div>

      {/* Lembretes e Rotina (B3-4) */}
      {activeReminder && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(2, 6, 23, 0.8)',
            backdropFilter: 'blur(4px)',
            zIndex: 99999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: "'Inter', sans-serif",
          }}
        >
          <div
            style={{
              background: 'var(--color-card-bg)',
              border: '3px solid var(--color-primary)',
              borderRadius: '2.5rem',
              padding: '3rem',
              maxWidth: '550px',
              width: '90%',
              textAlign: 'center',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '2rem',
              boxShadow: '0 25px 50px -12px rgba(0, 0, 0, 0.5)',
            }}
          >
            <div
              style={{
                width: '80px',
                height: '80px',
                borderRadius: '50%',
                background: 'rgba(27, 84, 168, 0.08)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'var(--color-primary)',
              }}
            >
              <Bell size={40} />
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <span style={{ fontSize: '1.2rem', opacity: 0.6, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                Lembrete de Rotina
              </span>
              <h2 style={{ fontSize: '2.2rem', fontWeight: 900, margin: 0, color: 'var(--color-text-base)' }}>
                {activeReminder.title}
              </h2>
              <span style={{ fontSize: '1.25rem', opacity: 0.7, fontWeight: 600 }}>
                Horário agendado: {activeReminder.time}
              </span>
            </div>

            <GazeButton
              onClick={dismissActiveReminder}
              style={{
                width: '280px',
                height: '76px',
                borderRadius: '1.75rem',
                background: 'var(--color-primary)',
                color: '#ffffff',
                boxShadow: '0 10px 20px rgba(27, 84, 168, 0.25)',
              }}
            >
              <span style={{ fontSize: '1.4rem', fontWeight: 800 }}>Confirmar</span>
            </GazeButton>
          </div>
        </div>
      )}
    </div>
  );
};
