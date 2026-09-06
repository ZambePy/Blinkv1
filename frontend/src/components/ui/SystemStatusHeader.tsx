import React from 'react';
import { Camera, Radio, Eye, CheckCircle2, AlertCircle } from 'lucide-react';
import { useGaze } from '../../context/GazeContext';

interface SystemStatusHeaderProps {
  cameraActive?: boolean;
  trackingActive?: boolean;
  calibrationDone?: boolean;
}

export const SystemStatusHeader: React.FC<SystemStatusHeaderProps> = ({
  cameraActive,
  trackingActive,
  calibrationDone,
}) => {
  const { state, calibration } = useGaze();

  const engineOnline = state !== 'idle' && state !== 'loading';
  const engineHasFace = state === 'tracking' || state === 'calibrating';

  const cameraOn = cameraActive ?? engineOnline;
  const trackingOn = trackingActive ?? engineHasFace;
  const calibrated = calibrationDone ?? calibration.isCalibrated();

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
            background: engineOnline ? '#10b981' : '#ef4444',
            boxShadow: engineOnline ? '0 0 8px rgba(16, 185, 129, 0.6)' : 'none',
          }}
        />
        <span style={{ color: '#1b54a8', fontWeight: 800, letterSpacing: '0.02em' }}>IrisFlow</span>
        <span style={{ color: '#94a3b8' }}>|</span>
        <span style={{ color: '#64748b', fontSize: '0.8rem' }}>Tecnologia Assistiva</span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '1.25rem' }}>
        {/* Câmera */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <Camera size={15} color={cameraOn ? '#059669' : '#94a3b8'} />
          <span style={{ color: cameraOn ? '#065f46' : '#64748b' }}>
            {cameraOn ? 'Câmera Ativa' : 'Câmera Inativa'}
          </span>
        </div>

        {/* Motor de gaze (substitui o antigo status de WS) */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <Radio size={15} color={engineOnline ? '#2563eb' : '#dc2626'} />
          <span style={{ color: engineOnline ? '#1e40af' : '#991b1b' }}>
            {engineOnline ? 'Motor Ativo' : 'Motor Inativo'}
          </span>
        </div>

        {/* Tracking */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          <Eye size={15} color={trackingOn ? '#8b5cf6' : '#94a3b8'} />
          <span style={{ color: trackingOn ? '#6d28d9' : '#64748b' }}>
            {trackingOn ? 'Tracking Ativo' : 'Tracking Standby'}
          </span>
        </div>

        {/* Calibração */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.35rem' }}>
          {calibrated ? (
            <CheckCircle2 size={15} color="#16a34a" />
          ) : (
            <AlertCircle size={15} color="#d97706" />
          )}
          <span style={{ color: calibrated ? '#15803d' : '#b45309' }}>
            {calibrated ? 'Calibrado' : 'Calibração Pendente'}
          </span>
        </div>
      </div>
    </div>
  );
};
