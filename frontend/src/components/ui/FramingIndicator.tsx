import React, { useEffect, useState } from 'react';
import { useGaze } from '../../context/GazeContext';
import { AlertTriangle } from 'lucide-react';

export const FramingIndicator: React.FC = () => {
  const { getDiagnostics, state } = useGaze();
  const [metrics, setMetrics] = useState<{
    hasFace: boolean;
    iod: number;
    faceCenter: { x: number; y: number };
    specularRatio: number;
  } | null>(null);

  useEffect(() => {
    // Consulta os diagnósticos a 10Hz para fluidez sem sobrecarga
    const interval = setInterval(() => {
      const diag = getDiagnostics();
      if (diag && diag.framing) {
        setMetrics(diag.framing);
      } else {
        setMetrics(null);
      }
    }, 100);

    return () => clearInterval(interval);
  }, [getDiagnostics]);

  // Só exibe se o engine estiver ativo (não-idle)
  if (state === 'idle') return null;

  if (!metrics || !metrics.hasFace) {
    return (
      <div style={containerStyle}>
        <div style={titleStyle}>👁️ Enquadramento</div>
        <div style={warningBoxStyle}>
          <AlertTriangle size={20} color="#ef4444" />
          <span>Rosto não detectado. Centralize-se na câmera.</span>
        </div>
      </div>
    );
  }

  // 1. Distância (via IOD)
  // Faixa ideal: [0.18, 0.26]
  const iod = metrics.iod;
  let distanceText = 'Distância Ideal';
  let distanceColor = '#22c55e';

  if (iod < 0.18) {
    distanceText = 'Muito longe (Aproxime-se)';
    distanceColor = '#eab308';
  } else if (iod > 0.26) {
    distanceText = 'Muito perto (Afaste-se)';
    distanceColor = '#eab308';
  }

  // 2. Centralização
  // Faixa ideal: x em [0.4, 0.6], y em [0.35, 0.65]
  const { x, y } = metrics.faceCenter;
  const isCentered = x >= 0.4 && x <= 0.6 && y >= 0.35 && y <= 0.65;
  const centerText = isCentered ? 'Alinhamento OK' : 'Centralize o rosto';
  const centerColor = isCentered ? '#22c55e' : '#eab308';

  // 3. Reflexo (specularRatio)
  // Threshold: 0.02
  const specular = metrics.specularRatio;
  const hasSpecularReflection = specular > 0.02;

  return (
    <div style={containerStyle} className="framing-indicator-card">
      <div style={titleStyle}>👁️ Enquadramento Ocular</div>

      <div style={gridStyle}>
        {/* Card de Distância */}
        <div style={{ ...cardStyle, borderColor: distanceColor + '33' }}>
          <div style={labelStyle}>Distância da Tela</div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: distanceColor }}>{distanceText}</div>
          <div style={progressBarContainerStyle}>
            <div style={{
              position: 'absolute',
              left: `${Math.max(0, Math.min(100, (iod / 0.4) * 100))}%`,
              width: '10px',
              height: '10px',
              background: distanceColor,
              borderRadius: '50%',
              top: '-3px',
              transform: 'translateX(-50%)',
              transition: 'left 0.1s ease-out'
            }} />
          </div>
        </div>

        {/* Card de Centralização */}
        <div style={{ ...cardStyle, borderColor: centerColor + '33' }}>
          <div style={labelStyle}>Centralização</div>
          <div style={{ fontSize: '0.95rem', fontWeight: 700, color: centerColor }}>{centerText}</div>
          <div style={{ display: 'flex', justifyContent: 'center', marginTop: '0.6rem' }}>
            {/* Radar Visual */}
            <div style={radarContainerStyle}>
              {/* Centro de referência */}
              <div style={radarCenterStyle} />
              {/* Ponto do rosto do paciente */}
              <div style={{
                position: 'absolute',
                left: `${(1 - x) * 100}%`, // espelhado para comportamento de espelho natural
                top: `${y * 100}%`,
                width: '8px',
                height: '8px',
                background: centerColor,
                borderRadius: '50%',
                transform: 'translate(-50%, -50%)',
                boxShadow: `0 0 8px ${centerColor}`,
                transition: 'left 0.15s ease-out, top 0.15s ease-out'
              }} />
            </div>
          </div>
        </div>
      </div>

      {/* Alerta de Reflexo Ocular */}
      {hasSpecularReflection && (
        <div style={specularBoxStyle}>
          <AlertTriangle size={18} color="#ef4444" style={{ flexShrink: 0 }} />
          <div style={{ fontSize: '0.85rem', color: '#ef4444', fontWeight: 700 }}>
            Reflexo detectado! Ajuste a luz ou mude a inclinação.
          </div>
        </div>
      )}
    </div>
  );
};

const containerStyle: React.CSSProperties = {
  background: 'rgba(15, 23, 42, 0.85)',
  border: '1px solid rgba(255, 255, 255, 0.1)',
  borderRadius: '1.25rem',
  padding: '1.25rem',
  width: '320px',
  boxSizing: 'border-box',
  backdropFilter: 'blur(16px)',
  color: '#ffffff',
  boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
};

const titleStyle: React.CSSProperties = {
  fontSize: '0.9rem',
  fontWeight: 800,
  marginBottom: '1rem',
  textTransform: 'uppercase',
  letterSpacing: '0.08em',
  color: 'rgba(255,255,255,0.7)',
  borderBottom: '1px solid rgba(255,255,255,0.08)',
  paddingBottom: '0.5rem',
};

const gridStyle: React.CSSProperties = {
  display: 'flex',
  flexDirection: 'column',
  gap: '0.75rem',
};

const cardStyle: React.CSSProperties = {
  background: 'rgba(255, 255, 255, 0.02)',
  border: '1px solid transparent',
  borderRadius: '0.75rem',
  padding: '0.75rem',
};

const labelStyle: React.CSSProperties = {
  fontSize: '0.75rem',
  color: 'rgba(255,255,255,0.4)',
  marginBottom: '0.2rem',
  fontWeight: 600,
};

const progressBarContainerStyle: React.CSSProperties = {
  height: '4px',
  background: 'rgba(255, 255, 255, 0.08)',
  borderRadius: '2px',
  marginTop: '0.6rem',
  position: 'relative',
};

const radarContainerStyle: React.CSSProperties = {
  width: '50px',
  height: '50px',
  borderRadius: '50%',
  border: '1px solid rgba(255,255,255,0.15)',
  position: 'relative',
  background: 'rgba(255,255,255,0.02)',
};

const radarCenterStyle: React.CSSProperties = {
  position: 'absolute',
  top: '50%',
  left: '50%',
  width: '6px',
  height: '6px',
  background: 'rgba(255,255,255,0.2)',
  borderRadius: '50%',
  transform: 'translate(-50%, -50%)',
};

const warningBoxStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.75rem',
  background: 'rgba(239, 68, 68, 0.1)',
  border: '1px solid rgba(239, 68, 68, 0.25)',
  borderRadius: '0.75rem',
  padding: '0.75rem',
  color: '#ef4444',
  fontSize: '0.9rem',
  fontWeight: 600,
  lineHeight: 1.4,
};

const specularBoxStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  gap: '0.5rem',
  background: 'rgba(239, 68, 68, 0.08)',
  border: '1px solid rgba(239, 68, 68, 0.2)',
  borderRadius: '0.75rem',
  padding: '0.6rem 0.75rem',
  marginTop: '0.75rem',
};
