import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Droplet, Globe, Monitor, Moon, Ruler, Sun, SunDim, Volume2, VolumeX } from 'lucide-react';
import { deriveHorizontalFovDeg } from '@tracker/cameraTuner';
import { useSettings } from '../../context/SettingsContext';
import { useGaze } from '../../context/GazeContext';
import { useToast } from '../../context/ToastContext';
import { LanguageSwitcher } from '../../components/ui/LanguageSwitcher';
import { Badge, Card, Field, Note, Section, Segmented, SwitchRow } from '../caregiver/CaregiverControls';

/**
 * Brilho físico do monitor — só existe quando o Electron expõe o IPC
 * (Windows via WMI). No navegador o componente some em vez de mostrar um
 * controle que não faz nada.
 */
const MonitorBrightnessField: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettings();
  const [available, setAvailable] = useState<boolean | null>(null);
  const [current, setCurrent] = useState<number | null>(settings.monitorBrightness);

  useEffect(() => {
    const api = (window as unknown as {
      electronBrightness?: {
        get: () => Promise<{ ok: boolean; value?: number; error?: string }>;
        set: (pct: number) => Promise<{ ok: boolean; error?: string }>;
      };
    }).electronBrightness;
    if (!api) {
      setAvailable(false);
      return;
    }
    api
      .get()
      .then((r) => {
        if (r.ok && typeof r.value === 'number') {
          setAvailable(true);
          // Preferência salva ganha do valor lido: o cuidador já escolheu.
          setCurrent((c) => c ?? r.value ?? null);
        } else {
          console.warn('[monitor-brightness] IPC disponível mas o driver não respondeu:', r.error);
          setAvailable(false);
        }
      })
      .catch((e) => {
        console.warn('[monitor-brightness] erro no IPC get:', e);
        setAvailable(false);
      });
  }, []);

  if (available !== true) return null;
  const value = current ?? 100;

  return (
    <Field
      label={t('settings.display.monitorBrightness.label')}
      htmlFor="brightness-monitor"
      value={`${value}%`}
      hint={t('settings.display.monitorBrightness.hint')}
    >
      <input
        id="brightness-monitor"
        type="range"
        className="cg-range"
        min={10}
        max={100}
        step={5}
        value={value}
        onChange={(e) => {
          const v = parseInt(e.target.value, 10);
          setCurrent(v);
          updateSettings({ monitorBrightness: v });
        }}
        data-no-dwell="true"
      />
    </Field>
  );
};

export const DisplaySection: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettings();
  const { getDiagnostics } = useGaze();
  const toast = useToast();

  const brightnessPct = Math.round(settings.brightnessLevel * 100);

  const calibrateFov = () => {
    const d = getDiagnostics();
    if (!d || !d.framing.hasFace || d.video.width <= 0) {
      toast.error(t('settings.display.fov.noFace'));
      return;
    }
    const fov = deriveHorizontalFovDeg(d.framing.iodPx, d.video.width, settings.viewingDistanceCm);
    if (fov === null) {
      toast.error(t('settings.display.fov.failed'));
      return;
    }
    updateSettings({ cameraHorizontalFovDeg: fov });
    toast.success(t('settings.display.fov.done', { fov: fov.toFixed(1) }));
  };

  const sourceLabel = t(`settings.display.geometry.source.${settings.screenGeometrySource}`);

  return (
    <Section id="sec-display" title={t('settings.display.title')} icon={<Monitor size={26} aria-hidden="true" />}>
      <div className="cg-grid">
        <Card id="theme" title={t('settings.display.theme.title')} icon={settings.theme === 'dark' ? <Moon size={24} /> : <Sun size={24} />}>
          <Segmented
            ariaLabelledBy="theme-title"
            value={settings.theme}
            onChange={(v) => updateSettings({ theme: v })}
            options={[
              { value: 'light', label: t('settings.display.theme.light'), icon: <Sun size={18} /> },
              { value: 'dark', label: t('settings.display.theme.dark'), icon: <Moon size={18} /> },
            ]}
          />
          <p className="cg-hint" style={{ marginTop: '0.75rem' }}>
            {t('settings.display.theme.hint')}
          </p>
        </Card>

        <Card id="language" title={t('settings.language.title')} icon={<Globe size={24} />}>
          <LanguageSwitcher />
        </Card>

        <Card
          id="sound"
          title={t('settings.sound.title')}
          icon={settings.soundEnabled ? <Volume2 size={24} /> : <VolumeX size={24} />}
        >
          <SwitchRow
            id="sound-switch"
            title={t(settings.soundEnabled ? 'settings.sound.on' : 'settings.sound.off')}
            description={t('settings.sound.description')}
            checked={settings.soundEnabled}
            onChange={(v) => updateSettings({ soundEnabled: v })}
          />
        </Card>

        <Card
          id="comfort"
          title={t('settings.display.comfort.title')}
          description={t('settings.display.comfort.description')}
          icon={<SunDim size={24} />}
          className="cg-span-all"
        >
          <div className="cg-card__body">
            <Field
              label={t('settings.display.comfort.uiBrightness')}
              htmlFor="brightness-ui"
              value={`${brightnessPct}%`}
            >
              <input
                id="brightness-ui"
                type="range"
                className="cg-range"
                min={40}
                max={100}
                step={5}
                value={brightnessPct}
                onChange={(e) => updateSettings({ brightnessLevel: parseInt(e.target.value, 10) / 100 })}
                data-no-dwell="true"
              />
              <div className="cg-range-scale" aria-hidden="true">
                <span>40% · {t('settings.display.comfort.darkest')}</span>
                <span>100% · {t('settings.display.comfort.normal')}</span>
              </div>
            </Field>

            <MonitorBrightnessField />

            <SwitchRow
              id="amber-switch"
              icon={<Droplet size={20} />}
              title={t('settings.display.comfort.amber')}
              description={t('settings.display.comfort.amberHint')}
              checked={settings.amberFilter}
              onChange={(v) => updateSettings({ amberFilter: v })}
            />
          </div>
        </Card>

        <Card
          id="geometry"
          title={t('settings.display.geometry.title')}
          description={t('settings.display.geometry.description')}
          icon={<Ruler size={24} />}
          aside={<Badge tone={settings.screenGeometrySource === 'default' ? 'warn' : 'ok'}>{sourceLabel}</Badge>}
          className="cg-span-all"
        >
          <div className="cg-grid cg-grid--tight">
            <Field label={t('settings.display.geometry.diagonal')} htmlFor="screen-diagonal" hint={t('settings.display.geometry.diagonalHint')}>
              <input
                id="screen-diagonal"
                type="number"
                className="cg-input"
                min={7}
                max={100}
                step={0.1}
                value={settings.screenDiagonalIn}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v) || v <= 0) return;
                  // Digitado à mão vale mais que o lido do sistema.
                  updateSettings({ screenDiagonalIn: v, screenGeometrySource: 'manual' });
                }}
                data-no-dwell="true"
              />
            </Field>
            <Field label={t('settings.display.geometry.distance')} htmlFor="viewing-distance" hint={t('settings.display.geometry.distanceHint')}>
              <input
                id="viewing-distance"
                type="number"
                className="cg-input"
                min={20}
                max={300}
                step={1}
                value={settings.viewingDistanceCm}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (!Number.isFinite(v) || v <= 0) return;
                  updateSettings({ viewingDistanceCm: v });
                }}
                data-no-dwell="true"
              />
            </Field>
          </div>

          {settings.screenGeometrySource === 'default' && (
            <Note tone="warn" className="mt-4">
              {t('settings.display.geometry.defaultWarning')}
            </Note>
          )}

          <div className="cg-card__foot">
            <strong style={{ color: 'var(--text)' }}>{t('settings.display.fov.title')}</strong>
            <p style={{ marginTop: '0.25rem' }}>
              {settings.cameraHorizontalFovDeg !== null
                ? t('settings.display.fov.calibrated', { fov: settings.cameraHorizontalFovDeg.toFixed(1) })
                : t('settings.display.fov.notCalibrated')}
            </p>
            <div className="cg-card__actions" style={{ marginTop: '0.75rem' }}>
              <button type="button" className="btn btn--secondary" onClick={calibrateFov} data-no-dwell="true">
                {t('settings.display.fov.button')}
              </button>
              {settings.cameraHorizontalFovDeg !== null && (
                <button
                  type="button"
                  className="btn btn--ghost"
                  onClick={() => updateSettings({ cameraHorizontalFovDeg: null })}
                  data-no-dwell="true"
                >
                  {t('settings.display.fov.clear')}
                </button>
              )}
            </div>
          </div>
        </Card>
      </div>
    </Section>
  );
};
