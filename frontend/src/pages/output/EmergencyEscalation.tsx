import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { OctagonAlert, HeartPulse, ShieldAlert, Thermometer, Wind, BellOff } from 'lucide-react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { GazePageLayout } from '../../components/ui/GazePageLayout';
import { GazeButton } from '../../components/ui/GazeButton';
import { GazeGrid } from '../../components/ui/GazeGrid';
import { playAlarmSound, playCancelSound } from '../../utils/emergencyAudio';
import { speak, stopSpeaking } from '../../utils/speech';

const EMERGENCIES = [
  { id: 'pain', labelKey: 'emergency.items.pain', icon: HeartPulse },
  { id: 'breath', labelKey: 'emergency.items.breath', icon: Wind },
  { id: 'cold', labelKey: 'emergency.items.cold', icon: Thermometer },
  { id: 'other', labelKey: 'emergency.items.other', icon: ShieldAlert },
];

/** Sem cancelamento em 15 s, o alarme fica contínuo. */
const ESCALAR_APOS_MS = 15000;
/** Cadência da sirene enquanto o alarme está ligado. */
const SIRENE_MS = 3000;
const SIRENE_ESCALADA_MS = 2000;
const FALA_MS = 8000;

/**
 * Alarme de emergência LOCAL: som pela caixa do aparelho, fala sintetizada e
 * tela vermelha, para chamar quem estiver por perto. O aparelho também tenta
 * avisar o serviço configurado, mas a tela nunca promete isso ao paciente —
 * não há garantia de que alguém receba.
 */
export const EmergencyEscalation: React.FC = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { t } = useTranslation();
  const { currentProfile } = useAuth();
  const [triggered, setTriggered] = useState<string | null>(null);
  const [escalated, setEscalated] = useState(false);
  const userId = currentProfile?.id ?? 'anon';
  const dispararRef = useRef(false);

  const triggerAlert = useCallback(
    (label: string) => {
      setTriggered(label);
      setEscalated(false);
      playAlarmSound(3);
      speak(t('emergency.spoken', { label }), { rate: 1, pitch: 1.2 });
      // Aviso ao serviço, se houver um configurado. Falha não muda a tela: o
      // alarme local já está ligado.
      api.sendHelpAlert(userId, 'high').catch((e) => {
        console.warn('Falha ao avisar o serviço de emergência:', e);
      });
    },
    [t, userId]
  );

  // Chegada por `?autoTrigger=` (botão de emergência global): dispara uma vez.
  useEffect(() => {
    const autoTrigger = searchParams.get('autoTrigger');
    if (!autoTrigger || dispararRef.current) return;
    dispararRef.current = true;
    const item = EMERGENCIES.find((e) => e.id === autoTrigger) ?? EMERGENCIES[3];
    triggerAlert(t(item.labelKey));
  }, [searchParams, t, triggerAlert]);

  // Escalonamento: ninguém cancelou em 15 s.
  useEffect(() => {
    if (!triggered || escalated) return;
    const timer = setTimeout(() => {
      setEscalated(true);
      api.sendHelpAlert(userId, 'critical').catch((e) => {
        console.warn('Falha ao avisar o serviço de emergência (crítico):', e);
      });
    }, ESCALAR_APOS_MS);
    return () => clearTimeout(timer);
  }, [triggered, escalated, userId]);

  // Sirene e fala repetidas enquanto o alarme estiver ligado.
  useEffect(() => {
    if (!triggered) return;
    const sirene = setInterval(
      () => playAlarmSound(escalated ? 3 : 2),
      escalated ? SIRENE_ESCALADA_MS : SIRENE_MS
    );
    const fala = escalated
      ? setInterval(() => speak(t('emergency.spokenEscalated'), { rate: 1, pitch: 1.2 }), FALA_MS)
      : null;
    return () => {
      clearInterval(sirene);
      if (fala) clearInterval(fala);
    };
  }, [triggered, escalated, t]);

  // Sair da tela desliga a fala.
  useEffect(() => () => stopSpeaking(), []);

  const cancelar = () => {
    setTriggered(null);
    setEscalated(false);
    stopSpeaking();
    playCancelSound();
    navigate('/menu');
  };

  return (
    <GazePageLayout backRoute="/menu" title={t('emergency.title')}>
      <h1 className="sr-only">{t('emergency.title')}</h1>

      {triggered ? (
        <div
          role="alert"
          aria-live="assertive"
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '1.5rem',
            padding: '2rem',
            textAlign: 'center',
            borderRadius: 'var(--r-lg)',
            border: `4px ${escalated ? 'dashed' : 'solid'} var(--danger)`,
            background: escalated ? 'color-mix(in srgb, var(--danger) 22%, var(--bg))' : 'var(--danger-soft)',
            transition: 'background-color 0.4s ease',
          }}
        >
          <OctagonAlert size={96} color="var(--danger)" aria-hidden="true" />
          <h2 style={{ color: 'var(--danger)', fontSize: 'var(--fs-40)' }}>
            {escalated ? t('emergency.escalated') : t('emergency.localAlarm')}
          </h2>
          <p data-no-dwell="true" style={{ fontSize: 'var(--fs-24)', color: 'var(--text)', maxWidth: 760, lineHeight: 1.45 }}>
            {escalated ? t('emergency.escalatedDetail') : t('emergency.localAlarmDetail', { label: triggered })}
          </p>

          <GazeButton
            onClick={cancelar}
            size="xl"
            variant="secondary"
            icon={<BellOff color="var(--danger)" />}
            label={t('emergency.cancelAlarm')}
            aria-label={t('emergency.cancelAlarm')}
            // Cancelar precisa ser fácil: dwell curto.
            dwellMs={1000}
            style={{ minWidth: 360, borderColor: 'var(--danger)' }}
          />
        </div>
      ) : (
        <div style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <p data-no-dwell="true" style={{ textAlign: 'center', fontSize: 'var(--fs-24)', color: 'var(--text-2)' }}>
            {t('emergency.choose')}
          </p>
          <div style={{ flex: 1, minHeight: 0 }}>
            <GazeGrid columns={2} rows={2} gap={32}>
              {EMERGENCIES.map((item) => {
                const label = t(item.labelKey);
                return (
                  <GazeButton
                    key={item.id}
                    onClick={() => triggerAlert(label)}
                    size="xl"
                    stacked
                    variant="danger"
                    icon={<item.icon />}
                    label={label}
                    style={{ width: '100%', height: '100%' }}
                  />
                );
              })}
            </GazeGrid>
          </div>
        </div>
      )}
    </GazePageLayout>
  );
};
