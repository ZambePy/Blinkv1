import React, { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, Upload } from 'lucide-react';
import { useSettings } from '../../context/SettingsContext';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { api, ApiError } from '../../utils/api';
import { Badge, Card, Note, Section } from '../caregiver/CaregiverControls';

type VoiceStatus = 'idle' | 'uploading' | 'processing' | 'ready' | 'error';

/** Clonagem de voz: envia um áudio do paciente ao backend e ativa o perfil. */
export const VoiceSection: React.FC = () => {
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettings();
  const { currentProfile } = useAuth();
  const toast = useToast();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<VoiceStatus>('idle');
  const [error, setError] = useState<string | null>(null);

  const busy = status === 'uploading' || status === 'processing';

  const upload = async (file: File) => {
    if (!currentProfile) {
      const msg = t('settings.voice.noProfile');
      setError(msg);
      setStatus('error');
      toast.error(msg);
      return;
    }
    setStatus('uploading');
    setError(null);
    try {
      const res = await api.cloneVoice(file, currentProfile.id);
      setStatus('processing');
      const st = await api.voiceStatus(res.task_id);
      if (st.voice_profile_id) {
        updateSettings({ voiceProfileId: st.voice_profile_id, voiceGender: 'cloned' });
      }
      setStatus('ready');
      toast.success(t('settings.voice.ready'));
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? t('settings.voice.apiError', { status: err.status })
          : t('settings.voice.networkError');
      setError(msg);
      setStatus('error');
      toast.error(msg);
    }
  };

  return (
    <Section id="sec-voice" title={t('settings.voice.title')} icon={<Mic size={26} aria-hidden="true" />}>
      <Card
        id="voice-clone"
        title={t('settings.voice.cardTitle')}
        description={t('settings.voice.description')}
        icon={<Mic size={24} />}
        aside={
          settings.voiceGender === 'cloned' && settings.voiceProfileId ? (
            <Badge tone="ok">{t('settings.voice.active')}</Badge>
          ) : undefined
        }
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="audio/wav,audio/mpeg,audio/*"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void upload(file);
            e.target.value = '';
          }}
          style={{ display: 'none' }}
          aria-label={t('settings.voice.upload')}
        />
        <div className="cg-card__actions" style={{ marginTop: 0 }}>
          <button
            type="button"
            className="btn btn--primary"
            onClick={() => fileInputRef.current?.click()}
            disabled={busy}
            data-no-dwell="true"
          >
            <Upload size={18} aria-hidden="true" /> {t('settings.voice.upload')}
          </button>
          {status === 'uploading' && <span role="status" className="cg-hint">{t('settings.voice.uploading')}</span>}
          {status === 'processing' && <span role="status" className="cg-hint">{t('settings.voice.processing')}</span>}
          {status === 'ready' && <Badge tone="ok">{t('settings.voice.ready')}</Badge>}
        </div>
        {status === 'error' && error && (
          <Note tone="danger" role="alert" className="mt-4">
            {error}
          </Note>
        )}
        <Note tone="warn" className="mt-4">
          {t('settings.voice.lgpd')}
        </Note>
      </Card>
    </Section>
  );
};
