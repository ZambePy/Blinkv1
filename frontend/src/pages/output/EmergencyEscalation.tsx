import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
  const { t } = useTranslation();
  const { currentProfile } = useAuth();
  const [triggered, setTriggered] = useState<string | null>(null);

  const triggerAlert = (_id: string, label: string) => {
    setTriggered(label);

    // Som de bip forte
    const AudioCtx =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (AudioCtx) {
      const audioCtx = new AudioCtx();
      const oscillator = audioCtx.createOscillator();
      oscillator.type = 'square';
      oscillator.frequency.setValueAtTime(880, audioCtx.currentTime);
      oscillator.connect(audioCtx.destination);
      oscillator.start();
      setTimeout(() => oscillator.stop(), 2000);
    }

    const u = new SpeechSynthesisUtterance(`ALERTA MÉDICO: ${label}`);
    u.lang = 'pt-BR';
    u.rate = 1.0;
    u.pitch = 1.5;
    u.volume = 1.0;
    window.speechSynthesis.speak(u);

    api.sendHelpAlert(currentProfile?.id ?? 'anon').catch((e) => {
      console.warn('Falha ao enviar alerta de emergência ao backend:', e);
    });
  };

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
          <p style={{ fontSize: '1.25rem', color: 'rgba(255,255,255,0.7)', margin: 0, fontWeight: 500 }}>
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
              animation: 'pulseBg 1s infinite',
              borderRadius: '2rem',
              border: '3px solid #dc2626',
              background: 'rgba(220, 38, 38, 0.05)',
              padding: '2rem',
            }}
          >
            <AlertOctagon size={100} color="#dc2626" aria-hidden="true" />
            <h2 style={{ fontSize: '3rem', color: '#dc2626', textAlign: 'center', marginTop: '1.5rem', fontWeight: 800 }}>
              {t('emergency.alertSent')}
            </h2>
            <p style={{ fontSize: '1.75rem', color: '#fca5a5', textAlign: 'center', marginTop: '0.5rem', fontWeight: 600 }}>
              {t('emergency.waiting', { label: triggered })}
            </p>

            <GazeButton
              onClick={() => {
                setTriggered(null);
                navigate('/menu');
              }}
              style={{
                marginTop: '2.5rem',
                width: '340px',
                height: '80px',
                background: '#3b82f6',
                border: 'none',
                borderRadius: '1.5rem',
                color: 'white',
              }}
            >
              <span style={{ fontSize: '1.4rem', fontWeight: 800 }}>
                {t('emergency.cancelAndReturn')}
              </span>
            </GazeButton>
            <style>{`@keyframes pulseBg { 0% { background-color: rgba(220,38,38,0.05); } 50% { background-color: rgba(220,38,38,0.15); } 100% { background-color: rgba(220,38,38,0.05); } }`}</style>
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
