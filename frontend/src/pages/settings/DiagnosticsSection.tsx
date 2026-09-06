import React, { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Activity, FileText, Square, Stethoscope, Trash2, Video } from 'lucide-react';
import type { EngineDiagnostics } from '../../context/GazeContext';
import { useGaze } from '../../context/GazeContext';
import { useToast } from '../../context/ToastContext';
import { Badge, Card, KV, Note, Section } from '../caregiver/CaregiverControls';

const pct = (v: number | undefined) => (v === undefined ? '—' : `${Math.round(v * 100)}%`);

/**
 * Leituras ao vivo do rastreador e o gravador de sessão. Tudo que vem do
 * engine pode ser `null`/`undefined` (não medido): mostramos "—", nunca 0.
 */
export const DiagnosticsSection: React.FC = () => {
  const { t } = useTranslation();
  const toast = useToast();
  const { state, l2csStatus, getDiagnostics, recording, cameraError } = useGaze();

  const [diag, setDiag] = useState<EngineDiagnostics | null>(null);
  useEffect(() => {
    // 2 Hz: legível e barato. A 30 Hz os números piscariam sem parar.
    const id = setInterval(() => setDiag(getDiagnostics()), 500);
    return () => clearInterval(id);
  }, [getDiagnostics]);

  const [recActive, setRecActive] = useState(() => recording.isActive());
  const [recStats, setRecStats] = useState(() => recording.getStats());
  useEffect(() => {
    if (!recActive) {
      setRecStats(recording.getStats());
      return;
    }
    const id = setInterval(() => setRecStats(recording.getStats()), 500);
    return () => clearInterval(id);
  }, [recActive, recording]);

  const toggleRecording = () => {
    if (recActive) {
      recording.stop();
      setRecActive(false);
      toast.success(t('settings.diagnostics.recorder.stopped', { frames: recording.getStats().frames }));
    } else {
      recording.start();
      setRecActive(true);
      toast.success(t('settings.diagnostics.recorder.started'));
    }
  };

  const exportRecording = () => {
    const jsonl = recording.exportAsJSONL();
    if (!jsonl) {
      toast.error(t('settings.diagnostics.recorder.nothing'));
      return;
    }
    const blob = new Blob([jsonl], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // ':' não é aceito em nome de arquivo no Windows.
    a.download = `irisflow-recording-${new Date().toISOString().replace(/[:.]/g, '-')}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(t('settings.diagnostics.recorder.exported', { frames: recording.getStats().frames }));
  };

  const clearRecording = () => {
    recording.clear();
    setRecActive(false);
    setRecStats({ frames: 0, dropped: 0 });
    toast.success(t('settings.diagnostics.recorder.discarded'));
  };

  const stateTone = state === 'tracking' ? 'ok' : state === 'error' || state === 'degraded' ? 'danger' : 'warn';
  const modelTone = l2csStatus === 'ready' ? 'ok' : l2csStatus === 'error' ? 'danger' : undefined;

  return (
    <Section id="sec-diagnostics" title={t('settings.diagnostics.title')} icon={<Stethoscope size={26} aria-hidden="true" />}>
      <div className="cg-grid">
        <Card
          id="live"
          title={t('settings.diagnostics.live.title')}
          description={t('settings.diagnostics.live.description')}
          icon={<Activity size={24} />}
          aside={<Badge tone={stateTone}>{t(`settings.diagnostics.state.${state}`)}</Badge>}
          className="cg-span-all"
        >
          {cameraError && (
            <Note tone="danger" role="alert" className="mb-4">
              {cameraError}
            </Note>
          )}
          <KV
            items={[
              {
                key: t('settings.diagnostics.live.fps'),
                value: diag ? diag.fpsRender.toFixed(0) : '—',
                tone: diag && diag.fpsRender < 20 ? 'warn' : undefined,
              },
              {
                key: t('settings.diagnostics.live.camera'),
                value: diag && diag.video.width > 0 ? `${diag.video.width}×${diag.video.height}` : '—',
                tone: diag && diag.video.width > 0 && diag.video.width < 1280 ? 'warn' : undefined,
              },
              {
                key: t('settings.diagnostics.live.face'),
                value: diag ? (diag.framing.hasFace ? t('common.yes') : t('common.no')) : '—',
                tone: diag ? (diag.framing.hasFace ? 'ok' : 'danger') : undefined,
              },
              { key: t('settings.diagnostics.live.brightness'), value: pct(diag?.quality.brightness) },
              { key: t('settings.diagnostics.live.contrast'), value: pct(diag?.quality.contrast) },
              {
                key: t('settings.diagnostics.live.model'),
                value: t(`settings.diagnostics.model.${l2csStatus}`),
                tone: modelTone,
              },
              {
                key: t('settings.diagnostics.live.modelRate'),
                value: diag && diag.l2cs.status === 'ready' ? `${diag.l2cs.hz.toFixed(1)} Hz · ${diag.l2cs.latencyMs.toFixed(0)} ms` : '—',
              },
              {
                key: t('settings.diagnostics.live.filter'),
                value: diag
                  ? `${diag.filtro.efetivo}${diag.filtro.preset ? ` · ${diag.filtro.preset.replace('-v2', '')}` : ''}`
                  : '—',
                tone: diag?.filtro.degradado ? 'warn' : undefined,
              },
              {
                key: t('settings.diagnostics.live.samples'),
                value: diag ? String(diag.calibration.samples) : '—',
              },
              {
                key: t('settings.diagnostics.live.loopErrors'),
                value: diag ? String(diag.loop.errorsConsecutive) : '—',
                tone: diag && diag.loop.errorsConsecutive > 0 ? 'danger' : undefined,
              },
            ]}
          />
        </Card>

        <Card
          id="recorder"
          title={t('settings.diagnostics.recorder.title')}
          description={t('settings.diagnostics.recorder.description')}
          icon={<Video size={24} />}
          aside={
            <Badge tone={recActive ? 'danger' : 'neutral'}>
              {recActive ? t('settings.diagnostics.recorder.recording') : t('settings.diagnostics.recorder.idle')} · {recStats.frames}
              {recStats.dropped > 0 && ` (${t('settings.diagnostics.recorder.dropped', { count: recStats.dropped })})`}
            </Badge>
          }
          className="cg-span-all"
        >
          <div className="cg-card__actions" style={{ marginTop: 0 }} role="group" aria-live="polite">
            <button
              type="button"
              className={`btn ${recActive ? 'btn--danger' : 'btn--primary'}`}
              onClick={toggleRecording}
              data-no-dwell="true"
            >
              {recActive ? <Square size={18} aria-hidden="true" /> : <Video size={18} aria-hidden="true" />}
              {recActive ? t('settings.diagnostics.recorder.stop') : t('settings.diagnostics.recorder.start')}
            </button>
            <button
              type="button"
              className="btn btn--secondary"
              onClick={exportRecording}
              disabled={recStats.frames === 0}
              data-no-dwell="true"
            >
              <FileText size={18} aria-hidden="true" /> {t('settings.diagnostics.recorder.export')}
            </button>
            <button
              type="button"
              className="btn btn--ghost"
              onClick={clearRecording}
              disabled={recStats.frames === 0}
              data-no-dwell="true"
            >
              <Trash2 size={18} aria-hidden="true" /> {t('settings.diagnostics.recorder.discard')}
            </button>
          </div>
          <p className="cg-card__foot">
            {t('settings.diagnostics.pinNote')}
          </p>
        </Card>
      </div>
    </Section>
  );
};
