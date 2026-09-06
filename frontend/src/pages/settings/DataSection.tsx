import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, Clock, Database, Download, MessageSquare, ShieldCheck, Trash2 } from 'lucide-react';
import { useSettings } from '../../context/SettingsContext';
import { useToast } from '../../context/ToastContext';
import {
  clearClinicalData,
  getActivityByHour,
  getMostUsedPhrases,
  setConsent,
  type ClinicalData,
} from '../../utils/clinicalLogger';
import { Badge, Card, Note, Section } from '../caregiver/CaregiverControls';

/** Baixa um texto como arquivo. Revoga a URL em seguida. */
function downloadText(content: string, filename: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Erro angular a partir do qual o teste entra como "alto" no histórico. */
const HIGH_ERROR_DEG = 1.5;

interface Props {
  consent: boolean;
  data: ClinicalData;
  onChange: (consent: boolean) => void;
}

/** Histórico clínico local (com consentimento) e backup das configurações. */
export const DataSection: React.FC<Props> = ({ consent, data, onChange }) => {
  const { t, i18n } = useTranslation();
  const { settings } = useSettings();
  const toast = useToast();

  const toggleConsent = (next: boolean) => {
    setConsent(next);
    onChange(next);
    toast.success(next ? t('settings.data.consentOn') : t('settings.data.consentOff'));
  };

  // Exclusão em dois cliques: o primeiro arma, o segundo apaga. Desarma
  // sozinho em 6 s para não ficar um botão destrutivo armado na tela.
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return;
    const id = setTimeout(() => setArmed(false), 6000);
    return () => clearTimeout(id);
  }, [armed]);

  const clearAll = () => {
    if (!armed) {
      setArmed(true);
      return;
    }
    setArmed(false);
    clearClinicalData();
    onChange(consent);
    toast.success(t('settings.data.cleared'));
  };

  const exportClinical = () => {
    downloadText(
      JSON.stringify(data, null, 2),
      `relatorio-clinico-paciente-${new Date().toISOString().slice(0, 10)}.json`,
      'application/json',
    );
    toast.success(t('settings.data.exported'));
  };

  const exportBackup = () => {
    downloadText(JSON.stringify(settings, null, 2), 'irisflow_backup.json', 'application/json');
    toast.success(t('settings.backup.done'));
  };

  const hourly = getActivityByHour();
  const periods = [
    { key: 'night', count: hourly.slice(0, 6).reduce((a, b) => a + b, 0) },
    { key: 'morning', count: hourly.slice(6, 12).reduce((a, b) => a + b, 0) },
    { key: 'afternoon', count: hourly.slice(12, 18).reduce((a, b) => a + b, 0) },
    { key: 'evening', count: hourly.slice(18, 24).reduce((a, b) => a + b, 0) },
  ];
  const locale = i18n.resolvedLanguage === 'en' ? 'en-US' : 'pt-BR';

  return (
    <Section id="sec-data" title={t('settings.data.title')} icon={<Database size={26} aria-hidden="true" />}>
      <div className="cg-grid">
        <Card
          id="clinical"
          title={t('settings.data.clinical.title')}
          description={t('settings.data.clinical.description')}
          icon={<ShieldCheck size={24} />}
          className="cg-span-all"
        >
          <Note tone="info" title={t('settings.data.clinical.lgpdTitle')}>
            <span>{t('settings.data.clinical.lgpdBody')}</span>
            <label className="cg-check-label" style={{ marginTop: '0.85rem' }}>
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => toggleConsent(e.target.checked)}
                data-no-dwell="true"
              />
              {t('settings.data.clinical.consent')}
            </label>
          </Note>

          {!consent ? (
            <p className="cg-empty" style={{ marginTop: '1rem' }}>
              {t('settings.data.clinical.locked')}
            </p>
          ) : (
            <>
              <div className="cg-grid" style={{ marginTop: '1.25rem' }}>
                <Card
                  variant="soft"
                  title={t('settings.data.clinical.calibrations', { count: data.calibrations.length })}
                  icon={<Activity size={22} />}
                >
                  {data.calibrations.length === 0 ? (
                    <p className="cg-empty">{t('settings.data.clinical.noCalibrations')}</p>
                  ) : (
                    <ul className="cg-list cg-list--scroll">
                      {[...data.calibrations].reverse().map((c) => {
                        const high = c.errorDeg >= HIGH_ERROR_DEG;
                        return (
                          <li key={c.id} className={`cg-list__item ${high ? 'cg-list__item--warn' : ''}`.trim()}>
                            <span className="cg-list__meta">{new Date(c.timestamp).toLocaleString(locale)}</span>
                            <Badge tone={high ? 'warn' : 'ok'}>
                              {c.errorDeg.toFixed(2)}° · {high ? t('settings.data.clinical.high') : t('settings.data.clinical.good')}
                            </Badge>
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  {data.calibrations.length > 2 && (
                    <p className="cg-hint" style={{ marginTop: '0.75rem' }}>
                      {t('settings.data.clinical.trendHint')}
                    </p>
                  )}
                </Card>

                <Card variant="soft" title={t('settings.data.clinical.phrases')} icon={<MessageSquare size={22} />}>
                  {data.sentences.length === 0 ? (
                    <p className="cg-empty">{t('settings.data.clinical.noPhrases')}</p>
                  ) : (
                    <ul className="cg-list">
                      {getMostUsedPhrases(4).map((p) => (
                        <li key={p.text} className="cg-list__item">
                          <span className="cg-list__title" style={{ fontStyle: 'italic' }}>
                            “{p.text}”
                          </span>
                          <Badge tone="info">{p.count}x</Badge>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>

                <Card variant="soft" title={t('settings.data.clinical.activity')} icon={<Clock size={22} />}>
                  {data.sentences.length === 0 ? (
                    <p className="cg-empty">{t('settings.data.clinical.noActivity')}</p>
                  ) : (
                    <ul className="cg-list">
                      {periods.map((p) => (
                        <li key={p.key} className="cg-list__item">
                          <span className="cg-list__title">{t(`settings.data.clinical.periods.${p.key}`)}</span>
                          <strong style={{ color: 'var(--primary)' }}>
                            {t('settings.data.clinical.utterances', { count: p.count })}
                          </strong>
                        </li>
                      ))}
                    </ul>
                  )}
                </Card>
              </div>

              <div className="cg-card__actions">
                <button type="button" className="btn btn--primary" onClick={exportClinical} data-no-dwell="true">
                  <Download size={18} aria-hidden="true" /> {t('settings.data.clinical.export')}
                </button>
                <button
                  type="button"
                  className={`btn ${armed ? 'btn--danger' : 'btn--ghost'}`}
                  onClick={clearAll}
                  aria-live="polite"
                  data-no-dwell="true"
                >
                  <Trash2 size={18} aria-hidden="true" />{' '}
                  {armed ? t('settings.data.clearConfirm') : t('settings.data.clinical.clear')}
                </button>
              </div>
            </>
          )}
        </Card>

        <Card
          id="backup"
          title={t('settings.backup.title')}
          description={t('settings.backup.description')}
          icon={<Download size={24} />}
        >
          <div className="cg-card__actions" style={{ marginTop: 0 }}>
            <button type="button" className="btn btn--secondary" onClick={exportBackup} data-no-dwell="true">
              <Download size={18} aria-hidden="true" /> {t('settings.backup.export')}
            </button>
          </div>
        </Card>
      </div>
    </Section>
  );
};
