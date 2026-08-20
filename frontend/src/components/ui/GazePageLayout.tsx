import React from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertOctagon } from 'lucide-react';
import { BackButton } from './BackButton';
import { GazeButton } from './GazeButton';

interface GazePageLayoutProps {
  children: React.ReactNode;
  showBack?: boolean;
  showEmergency?: boolean;
  backRoute?: string;
}

export const GazePageLayout: React.FC<GazePageLayoutProps> = ({
  children,
  showBack = true,
  showEmergency = true,
  backRoute,
}) => {
  const navigate = useNavigate();

  return (
    <div
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        background: '#000000', // Padrão escuro CAA para descanso ocular
        color: '#ffffff',
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
            background: 'rgba(255, 255, 255, 0.05)',
            border: '2px dashed rgba(255, 255, 255, 0.15)',
            borderRadius: '1.5rem',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'rgba(255, 255, 255, 0.6)',
            fontSize: '1rem',
            fontWeight: 700,
            cursor: 'default',
            userSelect: 'none',
          }}
        >
          👁 Zona de Descanso (Sem clique)
        </div>

        {/* Emergência Canônica */}
        {showEmergency ? (
          <GazeButton
            emergency
            width={200}
            height={64}
            onClick={() => navigate('/emergency')}
            aria-label="Disparar Emergência Médica"
          >
            <AlertOctagon size={24} /> Emergência
          </GazeButton>
        ) : (
          <div style={{ width: 200 }} />
        )}
      </div>

      {/* Conteúdo Principal */}
      <div style={{ width: '100%', height: '100%', position: 'relative' }}>
        {children}
      </div>
    </div>
  );
};
