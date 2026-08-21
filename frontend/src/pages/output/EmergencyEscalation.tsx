import React, { useState, useEffect } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { AlertOctagon, HeartPulse, ShieldAlert, Thermometer, Wind } from 'lucide-react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { GazePageLayout } from '../../components/ui/GazePageLayout';
import { GazeButton } from '../../components/ui/GazeButton';
import { GazeGrid } from '../../components/ui/GazeGrid';

const EMERGENCIES = [
  { id: 'pain', labelKey: 'emergency.items.pain', icon: HeartPulse },
  { id: 'breath', labelKey: 'emergency.items.breath', icon: Wind },
  { id: 'cold', labelKey: 'emergency.items.cold', icon: Thermometer },
  { id: 'other', labelKey: 'emergency.items.other', icon: ShieldAlert },
];

export const EmergencyEscalation: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const { currentProfile } = useAuth();
  const [triggered, setTriggered] = useState<string | null>(null);
  const [escalated, setEscalated] = useState(false);

  const triggerAlert = (_id: string, label: string) => {
    setTriggered(label);
    setEscalated(false);

    // Som de bip forte inicial
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      try {
        const audioCtx = new AudioCtx();
        const oscillator = audioCtx.createOscillator();
        oscillator.type = 'square';
        oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
        oscillator.connect(audioCtx.destination);
        oscillator.start();
        setTimeout(() => oscillator.stop(), 2000);
      } catch (e) {}
    }

    if ('speechSynthesis' in window && 'SpeechSynthesisUtterance' in window) {
      const u = new SpeechSynthesisUtterance(`ALERTA MÉDICO: ${label}`);
      u.lang = 'pt-BR';
      u.rate = 1.0;
      u.pitch = 1.5;
      u.volume = 1.0;
      window.speechSynthesis.speak(u);
    }

    api.sendHelpAlert(currentProfile?.id ?? 'anon', 'high').catch((e) => {
      console.warn('Falha ao enviar alerta de emergência ao backend:', e);
    });
  };

  // Efeito de escuta de parâmetro para auto-disparo
  useEffect(() => {
    const autoTrigger = searchParams.get('autoTrigger');
    if (autoTrigger && !triggered) {
      const item = EMERGENCIES.find((e) => e.id === autoTrigger) || EMERGENCIES[3];
      triggerAlert(item.id, t(item.labelKey));
    }
  }, [searchParams, t, triggered]);

  // Timer de Escalonamento de Emergência (15s se o cuidador não responder)
  useEffect(() => {
    if (!triggered || escalated) return;

    const timer = setTimeout(() => {
      setEscalated(true);
      api.sendHelpAlert(currentProfile?.id ?? 'anon', 'critical').catch((e) => {
        console.warn('Falha ao enviar alerta de escalonamento:', e);
      });
    }, 15000);

    return () => clearTimeout(timer);
  }, [triggered, escalated, currentProfile]);

  // Alarme contínuo de Escalonamento Crítico
  useEffect(() => {
    if (!escalated) return;

    // Bip estridente a cada 2s
    const soundInterval = setInterval(() => {
      const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
      if (AudioCtx) {
        try {
          const audioCtx = new AudioCtx();
          const oscillator = audioCtx.createOscillator();
          oscillator.type = 'sawtooth';
          oscillator.frequency.setValueAtTime(990, audioCtx.currentTime);
          oscillator.connect(audioCtx.destination);
          oscillator.start();
          setTimeout(() => oscillator.stop(), 500);
        } catch (e) {}
      }
    }, 2000);

    // Fala contínua a cada 5s
    const speechInterval = setInterval(() => {
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
        const u = new SpeechSynthesisUtterance("ALERTA CRÍTICO: O paciente precisa de socorro imediato!");
        u.lang = 'pt-BR';
        u.rate = 1.0;
        u.pitch = 1.3;
        u.volume = 1.0;
        window.speechSynthesis.speak(u);
      }
    }, 5000);

    return () => {
      clearInterval(soundInterval);
      clearInterval(speechInterval);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [escalated]);

  return (
    <GazePageLayout showBack={true} backRoute="/menu" showEmergency={false}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ marginBottom: '2.5rem', textAlign: 'center' }}>
          <h1
            style={{
              fontSize: '2.75rem',
              color: '#ef4444',
              margin: '0 0 0.5rem 0',
              fontWeight: 900,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '1rem',
            }}
          >
            <AlertOctagon size={44} /> {t('emergency.title')}
          </h1>
          <p style={{ fontSize: '1.25rem', color: 'var(--color-text-base)', opacity: 0.7, margin: 0, fontWeight: 500 }}>
            {triggered ? 'Seu alerta foi enviado. Aguarde atendimento.' : 'Selecione o tipo de ajuda necessário'}
          </p>
        </div>

        {triggered ? (
          <div
            role="alert"
            aria-live="assertive"
            style={{
              flex: 1,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              animation: escalated ? 'pulseBgEscalated 0.5s infinite alternate' : 'pulseBg 1s infinite',
              borderRadius: '2rem',
              border: escalated ? '6px dashed #b91c1c' : '3px solid #dc2626',
              background: escalated ? 'rgba(239, 68, 68, 0.15)' : 'rgba(220, 38, 38, 0.05)',
              padding: '2rem',
            }}
          >
            <AlertOctagon size={100} color="#dc2626" aria-hidden="true" style={{ animation: escalated ? 'shake 0.3s infinite' : 'none' }} />
            <h2 style={{ fontSize: '3rem', color: '#dc2626', textAlign: 'center', marginTop: '1.5rem', fontWeight: 800 }}>
              {escalated ? 'ALERTA ESCALADO' : t('emergency.alertSent')}
            </h2>
            <p style={{ fontSize: '1.75rem', color: '#991b1b', textAlign: 'center', marginTop: '0.5rem', fontWeight: 600 }}>
              {escalated
                ? 'Sinais críticos enviados repetidamente! Aguarde socorro imediato.'
                : t('emergency.waiting', { label: triggered })}
            </p>

            <GazeButton
              onClick={() => {
                setTriggered(null);
                setEscalated(false);
                navigate('/menu');
              }}
              style={{
                marginTop: '2.5rem',
                width: '340px',
                height: '80px',
                background: escalated ? '#dc2626' : '#3b82f6',
                border: 'none',
                borderRadius: '1.5rem',
                color: 'white',
                boxShadow: '0 10px 20px rgba(0,0,0,0.15)',
              }}
            >
              <span style={{ fontSize: '1.4rem', fontWeight: 800 }}>
                {t('emergency.cancelAndReturn')}
              </span>
            </GazeButton>
            <style>{`
              @keyframes pulseBg { 0% { background-color: rgba(220,38,38,0.05); } 50% { background-color: rgba(220,38,38,0.15); } 100% { background-color: rgba(220,38,38,0.05); } }
              @keyframes pulseBgEscalated { 0% { background-color: rgba(239, 68, 68, 0.15); } 100% { background-color: rgba(239, 68, 68, 0.4); } }
              @keyframes shake {
                0% { transform: translate(1px, 1px) rotate(0deg); }
                10% { transform: translate(-1px, -2px) rotate(-1deg); }
                20% { transform: translate(-3px, 0px) rotate(1deg); }
                30% { transform: translate(0px, 2px) rotate(0deg); }
                40% { transform: translate(1px, -1px) rotate(1deg); }
                50% { transform: translate(-1px, 2px) rotate(-1deg); }
                60% { transform: translate(-3px, 1px) rotate(0deg); }
                70% { transform: translate(2px, 1px) rotate(-1deg); }
                80% { transform: translate(-1px, -1px) rotate(1deg); }
                90% { transform: translate(2px, 2px) rotate(0deg); }
                100% { transform: translate(1px, -2px) rotate(-1deg); }
              }
            `}</style>
          </div>
        ) : (
          <div style={{ flex: 1, minHeight: 0 }}>
            <GazeGrid columns={2} rows={2}>
              {EMERGENCIES.map((item) => {
                const label = t(item.labelKey);
                return (
                  <GazeButton
                    key={item.id}
                    onClick={() => triggerAlert(item.id, label)}
                    style={{
                      height: '100%',
                      background: '#dc2626',
                      border: '3px solid #991b1b',
                      borderRadius: '2rem',
                      color: 'white',
                    }}
                  >
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
                      <item.icon size={80} color="white" />
                      <span style={{ fontSize: '2.2rem', fontWeight: 900 }}>{label}</span>
                    </div>
                  </GazeButton>
                );
              })}
            </GazeGrid>
          </div>
        )}
      </div>
    </GazePageLayout>
  );
};
