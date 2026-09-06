import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Crosshair, RefreshCw, Target } from 'lucide-react';
import { startAccuracyTest } from '@tracker/accuracy';
import type { AccuracyResult, RunMeta } from '@tracker/accuracy';
import { resolveCalibrationDistances } from '@tracker/calibrationDistances';
import type { OpticalCondition } from '@tracker/calibrationProfiles';
import { useSettings } from '../../context/SettingsContext';
import { useGaze } from '../../context/GazeContext';
import { useToast } from '../../context/ToastContext';
import { applyUptimeToRunMetaIfDefault } from '../../utils/autoTestMeta';
import { logCalibrationAccuracy } from '../../utils/clinicalLogger';
import { Badge, Card, Field, KV, Note, Section } from '../caregiver/CaregiverControls';

/** Métrica em px que pode não ter sido medida: "—" em vez de 0 fabricado. */
const px = (v: number | null) => (v === null ? '—' : `${Math.round(v)} px`);
const deg = (v: number | null) => (v === null ? '—' : `${v.toFixed(2)}°`);

const OPTICAL_KEY: Record<OpticalCondition, string> = {
  sem_oculos: 'noGlasses',
  oculos_simples: 'glasses',
  oculos_progressivo: 'progressive',
  lentes_contato: 'contacts',
  desconhecido: 'unknown',
};

interface Props {
  /** Avisa a seção de dados que o histórico clínico mudou. */
  onAccuracyLogged?: () => void;
}

export const CalibrationSection: React.FC<Props> = ({ onAccuracyLogged }) => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const toast = useToast();
  const { settings } = useSettings();
  const { calibration, getSessionUptimeMs, state } = useGaze();

  // Estado da calibração é lido do engine (não é reativo); 1 Hz basta.
  const [calState, setCalState] = useState(() => ({
    calibrated: calibration.isCalibrated(),
    optical: calibration.getActiveOpticalCondition(),
    distances: calibration.getCalibrationDistancesCm(),
  }));
  useEffect(() => {
    const id = setInterval(() => {
      setCalState({
        calibrated: calibration.isCalibrated(),
        optical: calibration.getActiveOpticalCondition(),
        distances: calibration.getCalibrationDistancesCm(),
      });
    }, 1000);
    return () => clearInterval(id);
  }, [calibration]);

  const [running, setRunning] = useState(false);
  const [last, setLast] = useState<AccuracyResult | null>(null);
  const [meta, setMeta] = useState<RunMeta>({
    data: new Date().toISOString().slice(0, 10),
    iluminacao: 'boa',
    oculos: false,
    movimentoCabeca: 'parada',
    minutosDeSessao: 0,
    distanciaCm: settings.viewingDistanceCm,
    telaPolegadas: settings.screenDiagonalIn,
  });

  const runAccuracyTest = () => {
    if (!calibration.isCalibrated()) {
      toast.error(t('settings.calibration.accuracy.needCalibration'));
      return;
    }
    // A distância da TELA é a configurada, nunca a medida pela câmera: a
    // câmera fica mais perto do que a tela, e o erro angular sairia inflado.
    const { screenCm } = resolveCalibrationDistances({
      measuredCameraDistanceCm: null,
      configuredViewingDistanceCm: settings.viewingDistanceCm,
    });
    // "Sessão (min)" em 0 é preenchido com o tempo real do engine; uma
    // escolha manual (para simular deriva) é preservada.
    const metaWithUptime = applyUptimeToRunMetaIfDefault(
      {
        ...meta,
        distanciaCm: screenCm,
        telaPolegadas: settings.screenDiagonalIn,
        screenScaleFactor: settings.screenScaleFactor,
        screenGeometrySource: settings.screenGeometrySource,
      },
      getSessionUptimeMs(),
    );
    setRunning(true);
    startAccuracyTest((r) => {
      setRunning(false);
      setLast(r);
      // Só entra no histórico clínico quando houve medição de verdade.
      if (r.meanErrorDeg !== null) {
        logCalibrationAccuracy(r.meanErrorDeg);
        onAccuracyLogged?.();
      }
      if (r.meanError === null || r.meanErrorDeg === null) {
        toast.error(
          t('settings.calibration.accuracy.noSamples', {
            missing: r.pontosNaoMedidos,
            total: r.pontosMedidos + r.pontosNaoMedidos,
          }),
        );
      } else {
        toast.success(
          t('settings.calibration.accuracy.result', {
            px: Math.round(r.meanError),
            deg: r.meanErrorDeg.toFixed(2),
            score: r.score,
          }),
        );
      }
    }, metaWithUptime);
  };

  const engineBusy = state === 'calibrating';

  return (
    <Section id="sec-calibration" title={t('settings.calibration.title')} icon={<Crosshair size={26} aria-hidden="true" />}>
      <div className="cg-grid">
        <Card
          id="calibration-state"
          title={t('settings.calibration.state.title')}
          description={t('settings.calibration.state.description')}
          icon={<Crosshair size={24} />}
          iconTone={calState.calibrated ? 'ok' : 'warn'}
          aside={
            <Badge tone={calState.calibrated ? 'ok' : 'warn'}>
              {calState.calibrated ? t('settings.calibration.state.calibrated') : t('settings.calibration.state.notCalibrated')}
            </Badge>
          }
        >
          <KV
            items={[
              {
                key: t('settings.calibration.state.profile'),
                value: t(`settings.calibration.optical.${OPTICAL_KEY[calState.optical]}`),
              },
              {
                key: t('settings.calibration.state.distance'),
                value:
                  calState.distances.screenCm !== null
                    ? `${Math.round(calState.distances.screenCm)} cm`
                    : '—',
              },
            ]}
          />
          <div className="cg-card__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => navigate('/calibration-check')}
              disabled={engineBusy}
              data-no-dwell="true"
            >
              <RefreshCw size={18} aria-hidden="true" /> {t('settings.calibration.recalibrate')}
            </button>
          </div>
          <p className="cg-hint" style={{ marginTop: '0.75rem' }}>
            {t('settings.calibration.recalibrateHint')}
          </p>
        </Card>

        <Card
          id="accuracy"
          title={t('settings.calibration.accuracy.title')}
          description={t('settings.calibration.accuracy.description')}
          icon={<Target size={24} />}
        >
          <div className="cg-grid cg-grid--tight">
            <Field label={t('settings.calibration.accuracy.lighting')} htmlFor="acc-light">
              <select
                id="acc-light"
                className="cg-select"
                value={meta.iluminacao}
                onChange={(e) => setMeta({ ...meta, iluminacao: e.target.value as 'boa' | 'ruim' })}
                data-no-dwell="true"
              >
                <option value="boa">{t('settings.calibration.accuracy.lightingGood')}</option>
                <option value="ruim">{t('settings.calibration.accuracy.lightingPoor')}</option>
              </select>
            </Field>
            <Field label={t('settings.calibration.accuracy.head')} htmlFor="acc-head">
              <select
                id="acc-head"
                className="cg-select"
                value={meta.movimentoCabeca}
                onChange={(e) => setMeta({ ...meta, movimentoCabeca: e.target.value as 'parada' | 'livre' })}
                data-no-dwell="true"
              >
                <option value="parada">{t('settings.calibration.accuracy.headStill')}</option>
                <option value="livre">{t('settings.calibration.accuracy.headFree')}</option>
              </select>
            </Field>
            <Field label={t('settings.calibration.accuracy.glasses')} htmlFor="acc-glasses">
              <select
                id="acc-glasses"
                className="cg-select"
                value={meta.oculos ? 'sim' : 'nao'}
                onChange={(e) => setMeta({ ...meta, oculos: e.target.value === 'sim' })}
                data-no-dwell="true"
              >
                <option value="nao">{t('common.no')}</option>
                <option value="sim">{t('common.yes')}</option>
              </select>
            </Field>
            <Field label={t('settings.calibration.accuracy.session')} htmlFor="acc-session">
              <select
                id="acc-session"
                className="cg-select"
                value={String(meta.minutosDeSessao)}
                onChange={(e) => setMeta({ ...meta, minutosDeSessao: Number(e.target.value) })}
                data-no-dwell="true"
              >
                <option value="0">{t('settings.calibration.accuracy.sessionAuto')}</option>
                <option value="20">20</option>
                <option value="40">40</option>
              </select>
            </Field>
          </div>

          <div className="cg-card__actions">
            <button
              type="button"
              className="btn btn--primary"
              onClick={runAccuracyTest}
              disabled={running || engineBusy}
              data-no-dwell="true"
            >
              <Target size={18} aria-hidden="true" />{' '}
              {running ? t('settings.calibration.accuracy.running') : t('settings.calibration.accuracy.run')}
            </button>
          </div>

          {last && (
            <div style={{ marginTop: '1rem' }}>
              <Note tone={last.meanErrorDeg === null ? 'warn' : 'info'} title={`${t('settings.calibration.accuracy.last')} — ${last.score}`}>
                <KV
                  items={[
                    { key: t('settings.calibration.accuracy.meanDeg'), value: deg(last.meanErrorDeg) },
                    { key: t('settings.calibration.accuracy.meanPx'), value: px(last.meanError) },
                    { key: t('settings.calibration.accuracy.medianPx'), value: px(last.medianError) },
                    { key: t('settings.calibration.accuracy.p90Px'), value: px(last.p90Error) },
                    {
                      key: t('settings.calibration.accuracy.jitter'),
                      value: last.jitterRMS === null ? '—' : `${last.jitterRMS.toFixed(1)} px`,
                    },
                    {
                      key: t('settings.calibration.accuracy.points'),
                      value: `${last.pontosMedidos}/${last.pontosMedidos + last.pontosNaoMedidos}`,
                    },
                  ]}
                />
              </Note>
            </div>
          )}
        </Card>
      </div>
    </Section>
  );
};
