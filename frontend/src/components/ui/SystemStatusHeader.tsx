import React from 'react';
import { Camera, Radio, Eye, CheckCircle2, AlertCircle } from 'lucide-react';
import { useWebSocket } from '../../context/WebSocketContext';

interface SystemStatusHeaderProps {
  cameraActive?: boolean;
  trackingActive?: boolean;
  calibrationDone?: boolean;
}

export const SystemStatusHeader: React.FC<SystemStatusHeaderProps> = ({
  cameraActive = true,
  trackingActive = false,
  calibrationDone = true,
}) => {
  const { isConnected } = useWebSocket();

  return (
    <div
      role="region"
      aria-label="Status do Sistema"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '0.6rem 1.5rem',
        background: 'rgba(255, 255, 255, 0.85)',
        backdropFilter: 'blur(12px)',
        WebkitBackdropFilter: 'blur(12px)',
        borderBottom: '1px solid rgba(226, 232, 240, 0.8)',
        fontSize: '0.875rem',
        fontWeight: 600,
        color: '#334155',
        boxShadow: '0 2px 10px rgba(0, 0, 0, 0.02)',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: '50%',
            background: isConnected ? '#10b981' : '#ef4444',
            boxShadow: isConnected ? '0 0 8px rgba(16, 185, 129, 0.6)' : 'none',
          }}
        />
        <span style={{ color: '#1b54a8', fontWeight: 800, tracking: '0.02em' }}>IrisFlow</span>
        <span style={{ color: '#94a3b8' }}>|</span>
        <span style={{ color: '#64748b', fontSize: '0.8rem' }}>Tecnologia Assistiva</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
        {/* Câmera */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <Camera size={15} color={cameraActive ? '#059669' : '#94a3b8'} />
          <span style={{ color: cameraActive ? '#065f46' : '#64748b' }}>
            {cameraActive ? 'Câmera Ativa' : 'Câmera Inativa'}
          </span>
        </div>

        {/* Conexão WS */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <Radio size={15} color={isConnected ? '#2563eb' : '#dc2626'} />
          <span style={{ color: isConnected ? '#1e40af' : '#991b1b' }}>
            {isConnected ? 'Conectado' : 'Desconectado'}
          </span>
        </div>

        {/* Tracking */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <Eye size={15} color={trackingActive ? '#8b5cf6' : '#94a3b8'} />
          <span style={{ color: trackingActive ? '#6d28d9' : '#64748b' }}>
            {trackingActive ? 'Tracking Ativo' : 'Tracking Standby'}
          </span>
        </div>

        {/* Calibração */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          {calibrationDone ? (
            <CheckCircle2 size={15} color="#16a34a" />
          ) : (
            <AlertCircle size={15} color="#d97706" />
          )}
          <span style={{ color: calibrationDone ? '#15803d' : '#b45309' }}>
            {calibrationDone ? 'Calibrado' : 'Calibração Pendente'}
          </span>
        </div>
      </div>
    </div>
  );
};
