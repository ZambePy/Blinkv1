import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router-dom';
import { BookOpen, LayoutDashboard, Settings } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { CaregiverPageLayout } from '../components/ui/CaregiverPageLayout';
import { PageHeader } from '../components/ui/PageHeader';
import { CaregiverPinGate } from './caregiver/CaregiverPinGate';
import { getClinicalData, hasConsent } from '../utils/clinicalLogger';
import { TrackingSection } from './settings/TrackingSection';
import { DisplaySection } from './settings/DisplaySection';
import { CalibrationSection } from './settings/CalibrationSection';
import { VoiceSection } from './settings/VoiceSection';
import { CaregiverSection } from './settings/CaregiverSection';
import { DataSection } from './settings/DataSection';
import { DiagnosticsSection } from './settings/DiagnosticsSection';
import './caregiver/caregiver.css';

const SECTIONS = [
  { id: 'sec-tracking', key: 'tracking' },
  { id: 'sec-display', key: 'display' },
  { id: 'sec-calibration', key: 'calibration' },
  { id: 'sec-voice', key: 'voice' },
  { id: 'sec-caregiver', key: 'caregiver' },
  { id: 'sec-data', key: 'data' },
  { id: 'sec-diagnostics', key: 'diagnostics' },
] as const;

/**
 * Configurações do cuidador. Protegida por PIN; cada seção vive em
 * `./settings/*`. O histórico clínico é lido aqui porque duas seções mexem
 * nele (o teste de precisão grava, a de dados mostra e apaga).
 */
export const SettingsScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { isCaregiver } = useAuth();

  const [consent, setConsent] = useState(hasConsent);
  const [clinical, setClinical] = useState(getClinicalData);
  const refreshClinical = (nextConsent: boolean = consent) => {
    setConsent(nextConsent);
    setClinical(getClinicalData());
  };

  if (!isCaregiver) {
    return (
      <CaregiverPinGate
        title={t('settings.auth.title')}
        hint={t('settings.auth.hint')}
        errorText={t('settings.auth.pinError')}
        submitLabel={t('settings.auth.submit')}
        cancelLabel={t('common.cancel')}
      />
    );
  }

  return (
    <CaregiverPageLayout title={t('settings.title')}>
      <div className="cg-stack">
        <PageHeader
          title={t('settings.title')}
          subtitle={t('settings.subtitle')}
          icon={<Settings size={28} aria-hidden="true" />}
          showBack={false}
          actions={
            <>
              <button type="button" className="btn btn--secondary" onClick={() => navigate('/caregiver')} data-no-dwell="true">
                <LayoutDashboard size={18} aria-hidden="true" /> {t('settings.nav.dashboard')}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => navigate('/caregiver/guide?from=/settings')}
                data-no-dwell="true"
              >
                <BookOpen size={18} aria-hidden="true" /> {t('settings.nav.guide')}
              </button>
            </>
          }
        />

        {/* Botões, não `<a href="#id">`: sob HashRouter o hash É a rota, e um
            link de âncora navegaria para uma rota inexistente (tela vazia). */}
        <nav className="cg-subnav" aria-label={t('settings.nav.sections')}>
          {SECTIONS.map((s) => (
            <button
              key={s.id}
              type="button"
              className="btn btn--ghost"
              data-no-dwell="true"
              onClick={() => document.getElementById(s.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              {t(`settings.${s.key}.title`)}
            </button>
          ))}
        </nav>

        <TrackingSection />
        <DisplaySection />
        <CalibrationSection onAccuracyLogged={() => refreshClinical()} />
        <VoiceSection />
        <CaregiverSection />
        <DataSection consent={consent} data={clinical} onChange={refreshClinical} />
        <DiagnosticsSection />
      </div>
    </CaregiverPageLayout>
  );
};
