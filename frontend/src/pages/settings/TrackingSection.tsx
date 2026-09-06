import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Clock, Eye, MousePointer2, RefreshCw, SlidersHorizontal, Waves } from 'lucide-react';
import { EXPERIMENT_RANGES } from '@tracker/config/experiment';
import type { FilterPresetV2 } from '@tracker/oneEuroFilter';
import { useSettings } from '../../context/SettingsContext';
import { useGaze } from '../../context/GazeContext';
import { Card, Field, Note, Section, Segmented, SwitchRow } from '../caregiver/CaregiverControls';
import {
  activeExperiment,
  pendingDiff,
  pendingExperiment,
  saveExperiment,
  type ExperimentPatch,
} from '../../utils/experimentFlags';

const PRESETS: FilterPresetV2[] = ['estavel-v2', 'balanceado-v2', 'responsivo-v2'];

/**
 * Rastreamento: tempo de fixação, suavização, olho dominante e as opções do
 * pipeline (filtro, cursor, piscada, varredura, fallback). As últimas só
 * passam a valer depois de recarregar — o engine lê a configuração no boot.
 */
export const TrackingSection: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettings();
  const { setFilterPreset, getDiagnostics } = useGaze();

  const [preset, setPreset] = useState<FilterPresetV2>(() => {
    const atual = getDiagnostics()?.filtro.preset;
    return PRESETS.includes(atual as FilterPresetV2) ? (atual as FilterPresetV2) : 'balanceado-v2';
  });
  const [pending, setPending] = useState(pendingExperiment);
  const active = useMemo(activeExperiment, []);
  const diff = pendingDiff(pending);

  const patch = (p: ExperimentPatch) => setPending(saveExperiment(p));

  const choosePreset = (p: FilterPresetV2) => {
    setPreset(p);
    setFilterPreset(p);
  };

  // Presets parametrizam só o One Euro; com Kalman ativo a troca é ignorada.
  const presetsValem = active.filterMode === 'oneEuro';

  return (
    <Section id="sec-tracking" title={t('settings.tracking.title')} icon={<Eye size={26} aria-hidden="true" />}>
      <div className="cg-grid">
        <Card
          id="dwell"
          title={t('settings.dwell.title')}
          description={t('settings.dwell.description')}
          icon={<Clock size={24} />}
        >
          <Segmented
            ariaLabelledBy="dwell-title"
            value={settings.dwellSpeed}
            onChange={(v) => updateSettings({ dwellSpeed: v })}
            options={[
              { value: 'slow', label: t('settings.dwell.slow'), sub: '2,5 s' },
              { value: 'normal', label: t('settings.dwell.normal'), sub: '1,5 s' },
              { value: 'fast', label: t('settings.dwell.fast'), sub: '0,8 s' },
            ]}
          />
        </Card>

        <Card
          id="eye-dominance"
          title={t('settings.tracking.eye.title')}
          description={t('settings.tracking.eye.description')}
          icon={<Eye size={24} />}
        >
          <Segmented
            ariaLabelledBy="eye-dominance-title"
            value={settings.eyeDominance}
            onChange={(v) => updateSettings({ eyeDominance: v })}
            options={[
              { value: 'both', label: t('settings.tracking.eye.both') },
              { value: 'left', label: t('settings.tracking.eye.left') },
              { value: 'right', label: t('settings.tracking.eye.right') },
            ]}
          />
        </Card>

        <Card
          id="smoothing"
          title={t('settings.tracking.smoothing.title')}
          description={t('settings.tracking.smoothing.description')}
          icon={<Waves size={24} />}
          className="cg-span-all"
        >
          <Segmented
            ariaLabelledBy="smoothing-title"
            value={preset}
            onChange={choosePreset}
            options={[
              { value: 'estavel-v2', label: t('settings.tracking.smoothing.stable'), sub: t('settings.tracking.smoothing.stableSub') },
              { value: 'balanceado-v2', label: t('settings.tracking.smoothing.balanced'), sub: t('settings.tracking.smoothing.balancedSub') },
              { value: 'responsivo-v2', label: t('settings.tracking.smoothing.responsive'), sub: t('settings.tracking.smoothing.responsiveSub') },
            ]}
          />
          {!presetsValem && (
            <Note tone="warn" className="mt-4">
              {t('settings.tracking.smoothing.kalmanNote')}
            </Note>
          )}
        </Card>

        <Card
          id="pipeline"
          title={t('settings.tracking.advanced.title')}
          description={t('settings.tracking.advanced.description')}
          icon={<SlidersHorizontal size={24} />}
          className="cg-span-all"
        >
          <div className="cg-card__body">
            <Field label={t('settings.tracking.filter.label')} hint={t('settings.tracking.filter.hint')}>
              <Segmented
                ariaLabel={t('settings.tracking.filter.label')}
                value={pending.filterMode}
                onChange={(v) => patch({ filterMode: v })}
                options={[
                  { value: 'oneEuro', label: 'One Euro', sub: t('settings.tracking.filter.default') },
                  { value: 'kalman', label: 'Kalman', sub: t('settings.tracking.filter.compare') },
                  { value: 'kalmanEma', label: 'Kalman + EMA', sub: t('settings.tracking.filter.compare') },
                ]}
              />
            </Field>

            <Field
              label={t('settings.tracking.cursorSize.label')}
              htmlFor="cursor-size"
              value={`${pending.cursorSizePx} px`}
              hint={t('settings.tracking.cursorSize.hint')}
            >
              <input
                id="cursor-size"
                type="range"
                className="cg-range"
                min={EXPERIMENT_RANGES.cursorSizePx.min}
                max={EXPERIMENT_RANGES.cursorSizePx.max}
                step={4}
                value={pending.cursorSizePx}
                onChange={(e) => patch({ cursorSizePx: Number(e.target.value) })}
                data-no-dwell="true"
              />
              <div className="cg-range-scale" aria-hidden="true">
                <span>{EXPERIMENT_RANGES.cursorSizePx.min} px</span>
                <span>{EXPERIMENT_RANGES.cursorSizePx.max} px</span>
              </div>
            </Field>

            <SwitchRow
              id="flag-ring"
              icon={<MousePointer2 size={20} />}
              title={t('settings.tracking.ring.title')}
              description={t('settings.tracking.ring.description')}
              checked={pending.dwellRingOnCursor}
              onChange={(v) => patch({ dwellRingOnCursor: v })}
            />
            <SwitchRow
              id="flag-blink"
              title={t('settings.tracking.blink.title')}
              description={t('settings.tracking.blink.description')}
              checked={pending.blinkClick}
              onChange={(v) => patch({ blinkClick: v })}
            />
            <SwitchRow
              id="flag-scanning"
              title={t('settings.tracking.scanning.title')}
              description={t('settings.tracking.scanning.description')}
              checked={pending.scanningMode}
              onChange={(v) => patch({ scanningMode: v })}
            />
            <SwitchRow
              id="flag-lost"
              title={t('settings.tracking.lost.title')}
              description={t('settings.tracking.lost.description')}
              checked={pending.gazeLostFallback}
              onChange={(v) => patch({ gazeLostFallback: v })}
            />

            {diff.length > 0 && (
              <Note tone="warn" title={t('settings.tracking.pending.title')} role="status">
                <span>{t('settings.tracking.pending.body')}</span>
                <div className="cg-card__actions" style={{ marginTop: '0.6rem' }}>
                  <button
                    type="button"
                    className="btn btn--primary"
                    onClick={() => window.location.reload()}
                    data-no-dwell="true"
                  >
                    <RefreshCw size={18} aria-hidden="true" /> {t('settings.tracking.pending.apply')}
                  </button>
                </div>
              </Note>
            )}
          </div>
        </Card>
      </div>
    </Section>
  );
};
