import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertOctagon } from 'lucide-react';
import { GazeButton } from '../components/ui/GazeButton';
import { useGaze } from './GazeContext';

interface EmergencyContextValue {
  isConfirming: boolean;
  cancelEmergency: () => void;
  triggerEmergencyImmediately: () => void;
}

const EmergencyContext = createContext<EmergencyContextValue | null>(null);

export const useEmergency = () => {
  const ctx = useContext(EmergencyContext);
  if (!ctx) throw new Error('useEmergency must be used inside <EmergencyProvider>');
  return ctx;
};

export const EmergencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isDegraded } = useGaze();

  const [isConfirming, setIsConfirming] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Determina se a tela atual é de uso do paciente
  const isPatientScreen = () => {
    const path = location.pathname;
    if (
      path === '/' ||
      path === '/login' ||
      path.startsWith('/caregiver') ||
      path.startsWith('/settings')
    ) {
      return false;
    }
    return true;
  };

  const playTickSound = () => {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      try {
        const ctx = new AudioCtx();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.frequency.value = 600;
        gain.gain.setValueAtTime(0.2, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
        osc.start();
        osc.stop(ctx.currentTime + 0.1);
      } catch (e) {}
    }
  };

  const startEmergencyCountdown = () => {
    if (isConfirming) return;
    setIsConfirming(true);
    setCountdown(5);
    playTickSound();
  };

  const cancelEmergency = () => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setIsConfirming(false);
    setCountdown(5);
    
    // Som de cancelamento (bip duplo rápido de confirmação de recuo)
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (AudioCtx) {
      try {
        const ctx = new AudioCtx();
        const playTone = (freq: number, start: number, duration: number) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.15, ctx.currentTime + start);
          gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + start + duration);
          osc.start(ctx.currentTime + start);
          osc.stop(ctx.currentTime + start + duration);
        };
        playTone(400, 0, 0.1);
        playTone(300, 0.12, 0.1);
      } catch (e) {}
    }
  };

  const triggerEmergencyImmediately = () => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setIsConfirming(false);
    navigate('/emergency?autoTrigger=other');
  };

  useEffect(() => {
    if (isConfirming) {
      countdownIntervalRef.current = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) {
            return 0;
          }
          playTickSound();
          return c - 1;
        });
      }, 1000);
    }

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [isConfirming]);

  useEffect(() => {
    if (isConfirming && countdown === 0) {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      setIsConfirming(false);
      navigate('/emergency?autoTrigger=other');
    }
  }, [isConfirming, countdown, navigate]);

  const showEmergencyButton = isPatientScreen() && location.pathname !== '/emergency';
  const showDegradedBanner =
    isPatientScreen() &&
    location.pathname !== '/calibration-check' &&
    location.pathname !== '/emergency' &&
    isDegraded;

  return (
    <EmergencyContext.Provider
      value={{
        isConfirming,
        cancelEmergency,
        triggerEmergencyImmediately,
      }}
    >
      {children}

      {/* Indicador de Rastreamento Degradado (B4-2) */}
      {showDegradedBanner && !isConfirming && (
        <div
          style={{
            position: 'fixed',
            top: '2rem',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 99980,
          }}
        >
          <GazeButton
            onClick={() => navigate('/calibration-check')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              background: '#fef3c7',
              border: '2px solid #f59e0b',
              borderRadius: '2rem',
              color: '#b45309',
              padding: '0.65rem 1.5rem',
              boxShadow: '0 10px 15px -3px rgba(245, 158, 11, 0.2)',
              cursor: 'pointer',
              height: 'auto',
              width: 'auto',
            }}
            noWarn
          >
            <AlertOctagon size={20} color="#d97706" />
            <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>
              Rastreamento impreciso — Recalibre aqui
            </span>
          </GazeButton>
        </div>
      )}

      {/* Botão de Emergência Fixo Canônico */}
      {showEmergencyButton && !isConfirming && (
        <div
          style={{
            position: 'fixed',
            top: '2rem',
            right: '3rem',
            zIndex: 99990,
          }}
        >
          <GazeButton
            emergency
            width={200}
            height={64}
            onClick={startEmergencyCountdown}
            data-dwell-ms={isDegraded ? 3600 : 2000}
            aria-label="Disparar Emergência Médica"
          >
            <AlertOctagon size={24} /> Emergência
          </GazeButton>
        </div>
      )}

      {/* Modal Fullscreen de Confirmação */}
      {isConfirming && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="emerg-confirm-title"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(239, 68, 68, 0.95)',
            zIndex: 999999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontFamily: "'Inter', sans-serif",
            animation: 'flashBg 0.5s infinite alternate',
          }}
        >
          <style>{`
            @keyframes flashBg {
              from { background-color: rgba(220, 38, 38, 0.95); }
              to { background-color: rgba(153, 27, 27, 0.95); }
            }
          `}</style>
          
          <AlertOctagon size={120} style={{ marginBottom: '2rem', filter: 'drop-shadow(0 10px 15px rgba(0,0,0,0.3))' }} />
          
          <h1
            id="emerg-confirm-title"
            style={{
              fontSize: '4.5rem',
              fontWeight: 900,
              margin: '0 0 1rem 0',
              textAlign: 'center',
              textShadow: '0 4px 10px rgba(0,0,0,0.3)',
            }}
          >
            EMERGÊNCIA ACIONADA
          </h1>
          
          <p
            style={{
              fontSize: '2rem',
              fontWeight: 700,
              margin: '0 0 4rem 0',
              textAlign: 'center',
              opacity: 0.9,
            }}
          >
            Enviando alerta de socorro em <strong style={{ fontSize: '3rem', color: '#fde047' }}>{countdown}</strong> segundos...
          </p>

          <GazeButton
            onClick={cancelEmergency}
            data-dwell-ms={1000} // dwell rápido para facilidade de cancelamento voluntário
            style={{
              width: '320px',
              height: '84px',
              background: '#ffffff',
              border: 'none',
              borderRadius: '2rem',
              color: '#dc2626',
              boxShadow: '0 15px 30px rgba(0,0,0,0.3)',
            }}
          >
            <span style={{ fontSize: '1.8rem', fontWeight: 900 }}>CANCELAR</span>
          </GazeButton>
        </div>
      )}
    </EmergencyContext.Provider>
  );
};
