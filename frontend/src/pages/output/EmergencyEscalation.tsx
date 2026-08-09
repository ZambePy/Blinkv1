import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { BackButton } from '../../components/ui/BackButton';
import { AlertOctagon, HeartPulse, ShieldAlert, Thermometer, Wind } from 'lucide-react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';

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

    // Dispara som de alarme forte nativo (beep)
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
    <main
      role="main"
      aria-labelledby="emergency-title"
      style={{
        minHeight: '100vh',
        backgroundColor: '#fef2f2',
        padding: '2rem',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2rem', gap: '1rem' }}>
        <BackButton />
        <h1
          id="emergency-title"
          style={{
            fontSize: '2.5rem',
            color: '#dc2626',
            margin: 0,
            fontWeight: 900,
            display: 'flex',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <AlertOctagon size={48} aria-hidden="true" /> {t('emergency.title')}
        </h1>
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
          }}
        >
          <AlertOctagon size={120} color="#dc2626" aria-hidden="true" />
          <h2
            style={{ fontSize: '4rem', color: '#dc2626', textAlign: 'center', marginTop: '2rem' }}
          >
            {t('emergency.alertSent')}
          </h2>
          <p style={{ fontSize: '2rem', color: '#7f1d1d', textAlign: 'center' }}>
            {t('emergency.waiting', { label: triggered })}
          </p>
          <button
            onClick={() => {
              setTriggered(null);
              navigate('/menu');
            }}
            aria-label={t('emergency.cancelAndReturn')}
            style={{
              marginTop: '3rem',
              padding: '1.5rem 4rem',
              fontSize: '1.5rem',
              background: '#3b82f6',
              color: 'white',
              border: 'none',
              borderRadius: '1rem',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            {t('emergency.cancelAndReturn')}
          </button>
          <style>{`@keyframes pulseBg { 0% { background-color: #fef2f2; } 50% { background-color: #fecaca; } 100% { background-color: #fef2f2; } }`}</style>
        </div>
      ) : (
        <div
          role="group"
          aria-label={t('emergency.chooseType')}
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '2rem',
            flex: 1,
          }}
        >
          {EMERGENCIES.map((item) => {
            const label = t(item.labelKey);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => triggerAlert(item.id, label)}
                aria-label={t('emergency.triggerAria', { label })}
                style={{
                  background: '#dc2626',
                  border: '4px solid #991b1b',
                  borderRadius: '2rem',
                  color: 'white',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '1.5rem',
                  cursor: 'pointer',
                  boxShadow: '0 12px 40px rgba(220,38,38,0.4)',
                  transition: 'transform 0.1s',
                }}
                onMouseOver={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
                onMouseOut={(e) => (e.currentTarget.style.transform = 'scale(1)')}
                onFocus={(e) => (e.currentTarget.style.transform = 'scale(1.02)')}
                onBlur={(e) => (e.currentTarget.style.transform = 'scale(1)')}
              >
                <item.icon size={100} color="white" aria-hidden="true" />
                <span style={{ fontSize: '2.5rem', fontWeight: 900 }}>{label}</span>
              </button>
            );
          })}
        </div>
      )}
    </main>
  );
};
