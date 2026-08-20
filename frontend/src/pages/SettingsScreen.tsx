import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import {
  UserCog,
  Clock,
  Mic,
  Keyboard as KeyboardIcon,
  Volume2,
  VolumeX,
  Download,
  Target,
  Moon,
  Sun,
  Video,
  Square,
  FileText,
  Activity,
  Plus,
  Trash2,
} from 'lucide-react';
import { env } from '../config/env';
import { useSettings } from '../context/SettingsContext';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';
import { api, ApiError } from '../utils/api';
import { LanguageSwitcher } from '../components/ui/LanguageSwitcher';
import { useGaze } from '../context/GazeContext';
import { useReminders } from '../context/ReminderContext';
import { CaregiverPageLayout } from '../components/ui/CaregiverPageLayout';
import { startAccuracyTest } from '@tracker/accuracy';
import type { AccuracyResult, RunMeta } from '@tracker/accuracy';
import type { FilterPreset } from '@tracker/oneEuroFilter';

const cardStyle: React.CSSProperties = {
  background: 'var(--color-card-bg, rgba(255,255,255,0.75))',
  backdropFilter: 'blur(16px)',
  WebkitBackdropFilter: 'blur(16px)',
  border: '1px solid var(--color-card-border, rgba(255,255,255,0.7))',
  borderRadius: '1.5rem',
  padding: '2rem',
  boxShadow: '0 8px 32px var(--color-card-shadow, rgba(27,84,168,0.08))',
  transition: 'background 0.4s ease, border-color 0.4s ease, box-shadow 0.4s ease',
};

export const SettingsScreen: React.FC = () => {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { settings, updateSettings } = useSettings();
  const { isCaregiver, loginCaregiver, currentProfile } = useAuth();
  const toast = useToast();

  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

  const [voiceStatus, setVoiceStatus] = useState<
    'idle' | 'uploading' | 'processing' | 'ready' | 'error'
  >('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const { calibration, recording, setFilterPreset } = useGaze();
  const [filterPreset, setFilterPresetState] = useState<FilterPreset>('balanceado');

  // Fase 0.1 — estado local do gravador de sessão. `active` é derivado do
  // singleton do recorder, mas mantido em state pra o botão trocar de rótulo
  // sem esperar o poll; `stats` é atualizado por setInterval enquanto
  // gravando (o singleton não é reativo).
  const [recActive, setRecActive] = useState(false);
  const [recStats, setRecStats] = useState<{ frames: number; dropped: number }>(
    { frames: 0, dropped: 0 },
  );

  const [newReminderTitle, setNewReminderTitle] = useState('');
  const [newReminderTime, setNewReminderTime] = useState('');
  const { reminders, addReminder, deleteReminder } = useReminders();

  const handleAddReminder = (e: React.FormEvent) => {
    e.preventDefault();
    if (!newReminderTitle.trim() || !newReminderTime.trim()) {
      toast.error('Por favor, preencha o título e o horário.');
      return;
    }
    addReminder({
      title: newReminderTitle.trim(),
      time: newReminderTime,
    });
    setNewReminderTitle('');
    setNewReminderTime('');
    toast.success('Lembrete adicionado com sucesso!');
  };
  useEffect(() => {
    if (!recActive) {
      // Após parar, atualiza uma última vez pra o painel refletir o total
      // final. Sem intervalo — não precisa continuar polling.
      setRecStats(recording.getStats());
      return;
    }
    const id = setInterval(() => {
      setRecStats(recording.getStats());
    }, 500);
    return () => clearInterval(id);
  }, [recActive, recording]);

  const toggleRecording = () => {
    if (recActive) {
      recording.stop();
      setRecActive(false);
      toast.success(`Gravação parada com ${recording.getStats().frames} frames.`);
    } else {
      recording.start();
      setRecActive(true);
      toast.success('Gravação iniciada.');
    }
  };

  const exportRecording = () => {
    const jsonl = recording.exportAsJSONL();
    if (!jsonl) {
      toast.error('Nada para exportar — inicie uma gravação primeiro.');
      return;
    }
    const blob = new Blob([jsonl], { type: 'application/x-ndjson' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // ISO com ':' trocado por '-' pra o filesystem aceitar (Windows não
    // permite ':' em nomes de arquivo).
    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    a.download = `irisflow-recording-${stamp}.jsonl`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exportado ${recording.getStats().frames} frames.`);
  };

  const clearRecording = () => {
    recording.clear();
    setRecActive(false);
    setRecStats({ frames: 0, dropped: 0 });
    toast.success('Gravação descartada.');
  };


  const chooseFilterPreset = (preset: FilterPreset) => {
    setFilterPresetState(preset);
    setFilterPreset(preset);
  };
  const [accuracyRunning, setAccuracyRunning] = useState(false);
  const [lastAccuracy, setLastAccuracy] = useState<AccuracyResult | null>(null);
  const [accuracyMeta, setAccuracyMeta] = useState<RunMeta>({
    data: new Date().toISOString().slice(0, 10),
    iluminacao: 'boa',
    oculos: false,
    movimentoCabeca: 'parada',
    minutosDeSessao: 0,
    distanciaCm: 60,
    telaPolegadas: 15.6,
  });
  const [onlineCalibration, setOnlineCalibration] = useState(false);

  const toggleOnlineCalibration = () => {
    const next = !onlineCalibration;
    setOnlineCalibration(next);
    calibration.setOnlineCalibrationEnabled(next);
  };

  const handleAccuracyTest = () => {
    if (!calibration.isCalibrated()) {
      toast.error('Calibre primeiro para rodar o teste de precisão.');
      return;
    }
    setAccuracyRunning(true);
    startAccuracyTest((r) => {
      setAccuracyRunning(false);
      setLastAccuracy(r);
      toast.success(
        `Precisão: ${Math.round(r.meanError)}px médio (${r.meanErrorDeg.toFixed(2)}°) — ${r.score}`,
      );
    }, accuracyMeta);
  };

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginCaregiver(pin)) {
      setPinError(null);
      setPin('');
    } else {
      setPinError(t('settings.auth.pinError'));
      setPin('');
    }
  };

  const handleUpload = async (file: File) => {
    if (!currentProfile) {
      const msg = 'Selecione um perfil antes de clonar a voz.';
      setVoiceError(msg);
      setVoiceStatus('error');
      toast.error(msg);
      return;
    }
    setVoiceStatus('uploading');
    setVoiceError(null);
    try {
      const res = await api.cloneVoice(file, currentProfile.id);
      setVoiceStatus('processing');
      const status = await api.voiceStatus(res.task_id);
      if (status.voice_profile_id) {
        updateSettings({ voiceProfileId: status.voice_profile_id, voiceGender: 'cloned' });
      }
      setVoiceStatus('ready');
      toast.success('Voz personalizada ativada com sucesso.');
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `Erro ${err.status} ao processar áudio`
          : 'Falha ao enviar áudio. Verifique a conexão com o backend.';
      setVoiceError(msg);
      setVoiceStatus('error');
      toast.error(msg);
    }
  };

  const handleBackup = () => {
    const data = JSON.stringify(settings, null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'irisflow_backup.json';
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Backup exportado.');
  };

  if (!isCaregiver) {
    return (
      <main
        role="main"
        aria-labelledby="settings-auth-title"
        style={{
          minHeight: '100vh',
          background: 'var(--settings-bg, linear-gradient(160deg, #f0f4ff 0%, #e8f0fb 50%, #f1f5f9 100%))',
          transition: 'background 0.4s ease',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
        }}
      >
        <div
          className="glass animate-fade-in-up"
          style={{
            padding: '3rem',
            borderRadius: '2.5rem',
            maxWidth: 480,
            width: '100%',
            textAlign: 'center',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: '5rem',
              height: '5rem',
              background: 'linear-gradient(135deg, #dbeafe, #eff6ff)',
              borderRadius: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              margin: '0 auto 1.5rem',
            }}
          >
            <UserCog size={40} color="#1B54A8" />
          </div>
          <h2
            id="settings-auth-title"
            style={{ fontSize: '2rem', fontWeight: 700, color: '#1e293b', marginBottom: '0.5rem' }}
          >
            {t('settings.auth.title')}
          </h2>
          <p
            style={{ color: 'var(--color-text-base)', opacity: 0.9, marginBottom: '2rem', fontFamily: 'system-ui, sans-serif' }}
          >
            {t('settings.auth.hint')}
          </p>

          <form
            onSubmit={handleLogin}
            style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
          >
            <label htmlFor="caregiver-pin" className="sr-only">
              {t('settings.auth.pinLabel')}
            </label>
            <input
              id="caregiver-pin"
              type="password"
              value={pin}
              onChange={(e) => setPin(e.target.value)}
              maxLength={8}
              autoComplete="one-time-code"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="••••"
              aria-invalid={pinError ? true : undefined}
              aria-describedby={pinError ? 'pin-error' : undefined}
              style={{
                textAlign: 'center',
                fontSize: '3rem',
                letterSpacing: '1rem',
                padding: '1rem',
                borderRadius: '1rem',
                border: pinError ? '2px solid #dc2626' : '2px solid #e2e8f0',
                outline: 'none',
                fontFamily: 'Boldonse, sans-serif',
              }}
            />
            {pinError && (
              <p id="pin-error" role="alert" style={{ color: '#dc2626', fontSize: '0.9rem' }}>
                {pinError}
              </p>
            )}
            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                onClick={() => navigate('/menu')}
                aria-label={t('common.cancel')}
                style={{
                  flex: 1,
                  padding: '1rem',
                  background: '#f1f5f9',
                  borderRadius: '1rem',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  fontWeight: 700,
                  color: 'var(--color-text-base)', opacity: 0.9,
                }}
              >
                {t('common.cancel')}
              </button>
              <button
                type="submit"
                aria-label={t('settings.auth.submit')}
                style={{
                  flex: 1,
                  padding: '1rem',
                  background: 'linear-gradient(135deg, #1B54A8, #2563eb)',
                  borderRadius: '1rem',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1rem',
                  fontWeight: 700,
                  color: 'white',
                  boxShadow: '0 4px 16px rgba(27,84,168,0.3)',
                }}
              >
                {t('settings.auth.submit')}
              </button>
            </div>
          </form>
        </div>
      </main>
    );
  }

  const dwellOptions: { key: 'slow' | 'normal' | 'fast'; label: string; value: string }[] = [
    { key: 'slow', label: t('settings.dwell.slow'), value: '2.5s' },
    { key: 'normal', label: t('settings.dwell.normal'), value: '1.5s' },
    { key: 'fast', label: t('settings.dwell.fast'), value: '0.8s' },
  ];
  const layoutOptions: { key: 'frequency' | 'alphabetical' | 'qwerty' | 'hierarchical'; label: string }[] = [
    { key: 'frequency', label: t('settings.layout.frequency') },
    { key: 'alphabetical', label: t('settings.layout.alphabetical') },
    { key: 'qwerty', label: t('settings.layout.qwerty') },
    { key: 'hierarchical', label: t('settings.layout.hierarchical') },
  ];

  return (
    <CaregiverPageLayout title={t('settings.title')}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem',
          maxWidth: 900,
          margin: '0 auto',
          width: '100%',
        }}
      >
        {/* Card de Acesso ao Painel do Cuidador */}
        <section
          aria-labelledby="dashboard-link-title"
          style={{
            ...cardStyle,
            background: 'rgba(34, 197, 94, 0.08)',
            borderColor: 'rgba(34, 197, 94, 0.2)',
          }}
        >
          <h2
            id="dashboard-link-title"
            style={{
              fontSize: '1.25rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: '#4ade80',
              marginTop: 0,
            }}
          >
            <Activity size={24} /> Painel de Acompanhamento (Rotina & Diário)
          </h2>
          <p style={{ color: '#cbd5e1', opacity: 0.9, marginBottom: '1.5rem', fontSize: '1rem', fontFamily: 'system-ui, sans-serif' }}>
            Acesse a rotina diária de cuidados, registro clínico de sintomas e histórico recente do paciente.
          </p>
          <button
            onClick={() => navigate('/caregiver')}
            style={{
              padding: '0.8rem 1.8rem',
              background: '#22c55e',
              border: 'none',
              color: 'white',
              borderRadius: '0.75rem',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 12px rgba(34, 197, 94, 0.3)',
              fontSize: '1rem',
              transition: 'background 0.2s',
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = '#15803d')}
            onMouseOut={(e) => (e.currentTarget.style.background = '#22c55e')}
          >
            Abrir Painel do Cuidador
          </button>
        </section>
        {/* Temporizador */}
        <section aria-labelledby="dwell-title" style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.25rem',
            }}
          >
            <Clock size={28} color="#1B54A8" aria-hidden="true" />
            <h2 id="dwell-title" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>
              {t('settings.dwell.title')}
            </h2>
          </div>
          <div
            role="radiogroup"
            aria-labelledby="dwell-title"
            style={{ display: 'flex', gap: '1rem' }}
          >
            {dwellOptions.map(({ key, label, value }) => {
              const active = settings.dwellSpeed === key;
              return (
                <button
                  key={key}
                  role="radio"
                  aria-checked={active}
                  onClick={() => updateSettings({ dwellSpeed: key })}
                  style={{
                    flex: 1,
                    padding: '1rem',
                    borderRadius: '1rem',
                    cursor: 'pointer',
                    fontSize: '0.95rem',
                    fontWeight: 700,
                    border: '2px solid',
                    background: active ? 'linear-gradient(135deg, #1B54A8, #2563eb)' : 'white',
                    color: active ? 'white' : '#475569',
                    borderColor: active ? '#1B54A8' : '#e2e8f0',
                    boxShadow: active ? '0 4px 16px rgba(27,84,168,0.3)' : 'none',
                  }}
                >
                  {label} ({value})
                </button>
              );
            })}
          </div>
        </section>

        {/* Layout Teclado */}
        <section aria-labelledby="layout-title" style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.25rem',
            }}
          >
            <KeyboardIcon size={28} color="#1B54A8" aria-hidden="true" />
            <h2
              id="layout-title"
              style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}
            >
              {t('settings.layout.title')}
            </h2>
          </div>
          <div
            role="radiogroup"
            aria-labelledby="layout-title"
            style={{ display: 'flex', gap: '1rem' }}
          >
            {layoutOptions.map(({ key, label }) => {
              const active = settings.keyboardLayout === key;
              return (
                <button
                  key={key}
                  role="radio"
                  aria-checked={active}
                  onClick={() => updateSettings({ keyboardLayout: key })}
                  style={{
                    flex: 1,
                    padding: '1rem',
                    borderRadius: '1rem',
                    cursor: 'pointer',
                    fontWeight: 700,
                    border: '2px solid',
                    background: active ? '#1B54A8' : 'white',
                    color: active ? 'white' : '#475569',
                    borderColor: active ? '#1B54A8' : '#e2e8f0',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Som */}
        <section aria-labelledby="sound-title" style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.25rem',
            }}
          >
            {settings.soundEnabled ? (
              <Volume2 size={28} color="#1B54A8" aria-hidden="true" />
            ) : (
              <VolumeX size={28} color="#64748b" aria-hidden="true" />
            )}
            <h2 id="sound-title" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>
              {t('settings.sound.title')}
            </h2>
          </div>
          <button
            role="switch"
            aria-checked={settings.soundEnabled}
            onClick={() => updateSettings({ soundEnabled: !settings.soundEnabled })}
            style={{
              padding: '1rem 1.5rem',
              borderRadius: '1rem',
              border: '2px solid var(--color-card-border)',
              background: settings.soundEnabled ? '#1B54A8' : 'white',
              color: settings.soundEnabled ? 'white' : '#475569',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            {t(settings.soundEnabled ? 'settings.sound.on' : 'settings.sound.off')}
          </button>
        </section>

        {/* Tema */}
        <section aria-labelledby="theme-title" style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.25rem',
            }}
          >
            {settings.theme === 'dark' ? (
              <Moon size={28} color="#1B54A8" aria-hidden="true" />
            ) : (
              <Sun size={28} color="#1B54A8" aria-hidden="true" />
            )}
            <h2 id="theme-title" style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--color-text-base, #1e293b)' }}>
              Tema Visual
            </h2>
          </div>
          <div role="radiogroup" aria-labelledby="theme-title" style={{ display: 'flex', gap: '1rem' }}>
            {[
              { key: 'light', label: 'Modo Claro', icon: <Sun size={20} /> },
              { key: 'dark', label: 'Modo Escuro', icon: <Moon size={20} /> }
            ].map(({ key, label, icon }) => {
              const active = settings.theme === key;
              return (
                <button
                  key={key}
                  role="radio"
                  aria-checked={active}
                  onClick={() => updateSettings({ theme: key as 'light' | 'dark' })}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    padding: '1rem',
                    borderRadius: '1rem',
                    cursor: 'pointer',
                    fontWeight: 700,
                    border: '2px solid',
                    background: active ? '#1B54A8' : 'transparent',
                    color: active ? 'white' : 'var(--color-text-base, #475569)',
                    borderColor: active ? '#1B54A8' : '#e2e8f0',
                  }}
                >
                  {icon} {label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Idioma */}
        <section aria-labelledby="language-title" style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.25rem',
            }}
          >
            <h2
              id="language-title"
              style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}
            >
              {t('settings.language.title')}
            </h2>
          </div>
          <LanguageSwitcher />
        </section>

        {/* Clonagem de Voz */}
        <section aria-labelledby="voice-title" style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.25rem',
            }}
          >
            <Mic size={28} color="#1B54A8" aria-hidden="true" />
            <h2 id="voice-title" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>
              {t('settings.voice.title')}
            </h2>
          </div>
          <p
            style={{
              color: 'var(--color-text-base)', opacity: 0.9,
              marginBottom: '1.25rem',
              fontFamily: 'system-ui, sans-serif',
              lineHeight: 1.6,
            }}
          >
            {t('settings.voice.description')}
          </p>
          <input
            ref={fileInputRef}
            type="file"
            accept="audio/wav,audio/mpeg,audio/*"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleUpload(file);
            }}
            style={{ display: 'none' }}
            aria-label="Selecionar arquivo de áudio para clonagem de voz"
          />
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={voiceStatus === 'uploading' || voiceStatus === 'processing'}
              aria-label="Enviar arquivo de áudio para clonagem"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                padding: '0.85rem 1.5rem',
                background: '#1e293b',
                color: 'white',
                border: 'none',
                borderRadius: '1rem',
                cursor: 'pointer',
                fontWeight: 700,
                opacity: voiceStatus === 'uploading' || voiceStatus === 'processing' ? 0.6 : 1,
              }}
            >
              <Mic size={20} aria-hidden="true" /> {t('settings.voice.upload')}
            </button>
            {voiceStatus === 'uploading' && (
              <span role="status" style={{ alignSelf: 'center', color: 'var(--color-text-base)', opacity: 0.9 }}>
                {t('settings.voice.uploading')}
              </span>
            )}
            {voiceStatus === 'processing' && (
              <span role="status" style={{ alignSelf: 'center', color: 'var(--color-text-base)', opacity: 0.9 }}>
                {t('settings.voice.processing')}
              </span>
            )}
            {voiceStatus === 'ready' && (
              <span
                role="status"
                style={{ alignSelf: 'center', color: '#16a34a', fontWeight: 700 }}
              >
                {t('settings.voice.ready')}
              </span>
            )}
            {voiceStatus === 'error' && voiceError && (
              <span role="alert" style={{ alignSelf: 'center', color: '#dc2626' }}>
                {voiceError}
              </span>
            )}
          </div>
          <div
            style={{
              marginTop: '1.25rem',
              padding: '1rem 1.25rem',
              background: '#fffbeb',
              border: '1px solid #fde68a',
              borderRadius: '1rem',
              color: '#92400e',
              fontSize: '0.85rem',
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            {t('settings.voice.lgpd')}
          </div>
        </section>

        {/* Suavização (Sprint 5) */}
        <section aria-labelledby="filter-title" style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.25rem',
            }}
          >
            <Clock size={28} color="#1B54A8" aria-hidden="true" />
            <h2
              id="filter-title"
              style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}
            >
              Suavização do cursor
            </h2>
          </div>
          <p
            style={{
              color: 'var(--color-text-base)', opacity: 0.9,
              marginBottom: '1.25rem',
              fontFamily: 'system-ui, sans-serif',
              lineHeight: 1.6,
            }}
          >
            Preset do filtro temporal. <strong>Estável</strong>: jitter baixo,
            ideal para leitura. <strong>Responsivo</strong>: lag baixo, ideal
            para teclado virtual e jogos.
          </p>
          <div role="radiogroup" aria-labelledby="filter-title" style={{ display: 'flex', gap: '1rem' }}>
            {(['estavel', 'balanceado', 'responsivo'] as FilterPreset[]).map((preset) => {
              const active = filterPreset === preset;
              const label = preset === 'estavel' ? 'Estável' : preset === 'balanceado' ? 'Balanceado' : 'Responsivo';
              return (
                <button
                  key={preset}
                  role="radio"
                  aria-checked={active}
                  onClick={() => chooseFilterPreset(preset)}
                  style={{
                    flex: 1,
                    padding: '1rem',
                    borderRadius: '1rem',
                    cursor: 'pointer',
                    fontWeight: 700,
                    border: '2px solid',
                    background: active ? 'linear-gradient(135deg, #1B54A8, #2563eb)' : 'white',
                    color: active ? 'white' : '#475569',
                    borderColor: active ? '#1B54A8' : '#e2e8f0',
                  }}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </section>

        {/* Teste de Precisão (Sprint 0 — coleta de baseline) */}
        <section aria-labelledby="accuracy-title" style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.25rem',
            }}
          >
            <Target size={28} color="#1B54A8" aria-hidden="true" />
            <h2
              id="accuracy-title"
              style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}
            >
              Teste de precisão
            </h2>
          </div>
          <p
            style={{
              color: 'var(--color-text-base)', opacity: 0.9,
              marginBottom: '1.25rem',
              fontFamily: 'system-ui, sans-serif',
              lineHeight: 1.6,
            }}
          >
            Roda a matriz de 13 pontos de validação e exporta o JSON com métricas
            (mean/median/p90/jitter) + metadados. Preencha a condição abaixo antes
            de iniciar — ela vira parte do relatório.
          </p>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
              gap: '1rem',
              marginBottom: '1.25rem',
            }}
          >
            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-base)', opacity: 0.9 }}>
                Iluminação
              </span>
              <select
                value={accuracyMeta.iluminacao}
                onChange={(e) =>
                  setAccuracyMeta({
                    ...accuracyMeta,
                    iluminacao: e.target.value as 'boa' | 'ruim',
                  })
                }
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.75rem',
                  border: '2px solid var(--color-card-border)',
                  fontSize: '0.95rem',
                }}
              >
                <option value="boa">Boa</option>
                <option value="ruim">Ruim</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-base)', opacity: 0.9 }}>
                Movimento da cabeça
              </span>
              <select
                value={accuracyMeta.movimentoCabeca}
                onChange={(e) =>
                  setAccuracyMeta({
                    ...accuracyMeta,
                    movimentoCabeca: e.target.value as 'parada' | 'livre',
                  })
                }
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.75rem',
                  border: '2px solid var(--color-card-border)',
                  fontSize: '0.95rem',
                }}
              >
                <option value="parada">Parada</option>
                <option value="livre">Livre</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-base)', opacity: 0.9 }}>
                Óculos
              </span>
              <select
                value={accuracyMeta.oculos ? 'sim' : 'nao'}
                onChange={(e) =>
                  setAccuracyMeta({ ...accuracyMeta, oculos: e.target.value === 'sim' })
                }
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.75rem',
                  border: '2px solid var(--color-card-border)',
                  fontSize: '0.95rem',
                }}
              >
                <option value="nao">Não</option>
                <option value="sim">Sim</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-base)', opacity: 0.9 }}>
                Sessão (min)
              </span>
              <select
                value={String(accuracyMeta.minutosDeSessao)}
                onChange={(e) =>
                  setAccuracyMeta({
                    ...accuracyMeta,
                    minutosDeSessao: Number(e.target.value),
                  })
                }
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.75rem',
                  border: '2px solid var(--color-card-border)',
                  fontSize: '0.95rem',
                }}
              >
                <option value="0">0 (recém calibrado)</option>
                <option value="20">20</option>
                <option value="40">40</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-base)', opacity: 0.9 }}>
                Distância (cm)
              </span>
              <input
                type="number"
                value={accuracyMeta.distanciaCm}
                onChange={(e) => setAccuracyMeta({ ...accuracyMeta, distanciaCm: Number(e.target.value) })}
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.75rem',
                  border: '2px solid var(--color-card-border)',
                  fontSize: '0.95rem',
                }}
              />
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
              <span style={{ fontSize: '0.85rem', fontWeight: 600, color: 'var(--color-text-base)', opacity: 0.9 }}>
                Tela (polegadas)
              </span>
              <input
                type="number"
                step="0.1"
                value={accuracyMeta.telaPolegadas}
                onChange={(e) => setAccuracyMeta({ ...accuracyMeta, telaPolegadas: Number(e.target.value) })}
                style={{
                  padding: '0.75rem',
                  borderRadius: '0.75rem',
                  border: '2px solid var(--color-card-border)',
                  fontSize: '0.95rem',
                }}
              />
            </label>
          </div>

          <button
            type="button"
            onClick={handleAccuracyTest}
            disabled={accuracyRunning}
            aria-label="Testar precisão"
            style={{
              padding: '1rem 1.5rem',
              borderRadius: '1rem',
              border: 'none',
              background: accuracyRunning
                ? '#94a3b8'
                : 'linear-gradient(135deg, #1B54A8, #2563eb)',
              color: 'white',
              fontWeight: 700,
              cursor: accuracyRunning ? 'not-allowed' : 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <Target size={20} aria-hidden="true" />{' '}
            {accuracyRunning ? 'Rodando…' : 'Testar precisão'}
          </button>

          {lastAccuracy && (
            <div
              style={{
                marginTop: '1.25rem',
                padding: '1rem 1.25rem',
                background: '#f0f9ff',
                border: '1px solid #bae6fd',
                borderRadius: '1rem',
                color: '#0c4a6e',
                fontSize: '0.9rem',
                fontFamily: 'system-ui, sans-serif',
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: '0.35rem' }}>
                Último resultado — {lastAccuracy.score}
              </div>
              <div>
                mean = {Math.round(lastAccuracy.meanError)}px ·{' '}
                median = {Math.round(lastAccuracy.medianError)}px ·{' '}
                p90 = {Math.round(lastAccuracy.p90Error)}px ·{' '}
                jitter = {lastAccuracy.jitterRMS.toFixed(1)}px ·{' '}
                {lastAccuracy.meanErrorDeg.toFixed(2)}°
              </div>
            </div>
          )}

          {/* Sprint 4 — feature flag da recalibração online */}
          <div
            style={{
              marginTop: '1.25rem',
              padding: '1rem 1.25rem',
              background: 'rgba(255,255,255,0.6)',
              border: '1px solid var(--color-card-border)',
              borderRadius: '1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: '1rem',
            }}
          >
            <div>
              <div style={{ fontWeight: 700, color: 'var(--color-text-base)', opacity: 0.9 }}>
                Recalibração implícita
              </div>
              <div
                style={{
                  fontSize: '0.85rem',
                  color: 'var(--color-text-base)', opacity: 0.8,
                  fontFamily: 'system-ui, sans-serif',
                }}
              >
                Ajusta continuamente o modelo com base nos dwell clicks
                confirmados. Experimental — desligado por padrão.
              </div>
            </div>
            <button
              role="switch"
              aria-checked={onlineCalibration}
              onClick={toggleOnlineCalibration}
              style={{
                padding: '0.75rem 1.25rem',
                borderRadius: '999px',
                border: '2px solid',
                borderColor: onlineCalibration ? '#1B54A8' : '#e2e8f0',
                background: onlineCalibration ? '#1B54A8' : 'white',
                color: onlineCalibration ? 'white' : '#475569',
                cursor: 'pointer',
                fontWeight: 700,
              }}
            >
              {onlineCalibration ? 'Ligado' : 'Desligado'}
            </button>
          </div>
        </section>

        {/* Gravador de sessão (Fase 0.1 do SPRINTSELA.MD) */}
        <section aria-labelledby="recorder-title" style={cardStyle}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', marginBottom: '1.25rem' }}>
            <Video size={28} color="#1B54A8" aria-hidden="true" />
            <h2 id="recorder-title" style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}>
              Gravador de sessão
            </h2>
          </div>
          <p style={{ color: 'var(--color-text-base)', opacity: 0.9, marginBottom: '1.25rem', fontFamily: 'system-ui, sans-serif', lineHeight: 1.6 }}>
            Grava landmarks, saída do L2CS, features e ponto predito em
            JSONL — <strong>sem vídeo</strong>. Consumido pelo replay offline
            para reexecutar o pipeline sem câmera. Use para depurar sem se
            preocupar em reproduzir a sessão.
          </p>

          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap', alignItems: 'center' }}>
            <button
              type="button"
              onClick={toggleRecording}
              aria-label={recActive ? 'Parar gravação' : 'Iniciar gravação'}
              style={{
                padding: '1rem 1.5rem',
                borderRadius: '1rem',
                border: 'none',
                background: recActive
                  ? 'linear-gradient(135deg, #dc2626, #b91c1c)'
                  : 'linear-gradient(135deg, #1B54A8, #2563eb)',
                color: 'white',
                fontWeight: 700,
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              {recActive ? <Square size={20} aria-hidden="true" /> : <Video size={20} aria-hidden="true" />}
              {recActive ? 'Parar gravação' : 'Iniciar gravação'}
            </button>

            <button
              type="button"
              onClick={exportRecording}
              disabled={recStats.frames === 0}
              aria-label="Exportar gravação em JSONL"
              style={{
                padding: '1rem 1.5rem',
                borderRadius: '1rem',
                border: '2px solid var(--color-card-border)',
                background: recStats.frames === 0 ? '#e2e8f0' : 'var(--color-card-bg)',
                color: 'var(--color-text-base)',
                opacity: recStats.frames === 0 ? 0.5 : 0.9,
                fontWeight: 700,
                cursor: recStats.frames === 0 ? 'not-allowed' : 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
              }}
            >
              <FileText size={20} aria-hidden="true" /> Exportar (.jsonl)
            </button>

            <button
              type="button"
              onClick={clearRecording}
              disabled={recStats.frames === 0}
              aria-label="Descartar gravação atual"
              style={{
                padding: '1rem 1.5rem',
                borderRadius: '1rem',
                border: '2px solid var(--color-card-border)',
                background: 'transparent',
                color: 'var(--color-text-base)',
                opacity: recStats.frames === 0 ? 0.4 : 0.9,
                fontWeight: 700,
                cursor: recStats.frames === 0 ? 'not-allowed' : 'pointer',
              }}
            >
              Descartar
            </button>

            <div
              role="status"
              aria-live="polite"
              style={{
                marginLeft: 'auto',
                padding: '0.75rem 1.25rem',
                background: recActive ? '#fef2f2' : '#f1f5f9',
                border: `1px solid ${recActive ? '#fecaca' : '#e2e8f0'}`,
                borderRadius: '0.75rem',
                fontSize: '0.9rem',
                fontFamily: 'system-ui, sans-serif',
                color: recActive ? '#991b1b' : '#475569',
                fontWeight: 600,
              }}
            >
              {recActive ? '● Gravando · ' : ''}
              {recStats.frames} frames
              {recStats.dropped > 0 && ` (${recStats.dropped} descartados — buffer cheio)`}
            </div>
          </div>
        </section>

        {/* Lembretes e Rotinas do Paciente (B3-4) */}
        <section aria-labelledby="reminders-title" style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.5rem',
            }}
          >
            <Clock size={28} color="#1B54A8" aria-hidden="true" />
            <h2
              id="reminders-title"
              style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}
            >
              Lembretes e Rotina Diária
            </h2>
          </div>

          {/* Form para Adicionar Lembrete */}
          <form
            onSubmit={handleAddReminder}
            style={{
              display: 'flex',
              gap: '1rem',
              marginBottom: '2rem',
              alignItems: 'flex-end',
              flexWrap: 'wrap',
            }}
          >
            <div style={{ flex: 2, display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
              <label htmlFor="reminder-title" style={{ fontSize: '0.9rem', fontWeight: 600, color: '#475569' }}>
                Atividade / Lembrete
              </label>
              <input
                id="reminder-title"
                type="text"
                value={newReminderTitle}
                onChange={(e) => setNewReminderTitle(e.target.value)}
                placeholder="Ex: Tomar água, Fisioterapia, etc."
                style={{
                  padding: '0.85rem 1.25rem',
                  borderRadius: '0.75rem',
                  border: '2px solid var(--color-card-border)',
                  background: 'var(--color-card-bg)',
                  color: 'var(--color-text-base)',
                  fontSize: '1rem',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.5rem', minWidth: '130px' }}>
              <label htmlFor="reminder-time" style={{ fontSize: '0.9rem', fontWeight: 600, color: '#475569' }}>
                Horário
              </label>
              <input
                id="reminder-time"
                type="time"
                value={newReminderTime}
                onChange={(e) => setNewReminderTime(e.target.value)}
                style={{
                  padding: '0.85rem 1.25rem',
                  borderRadius: '0.75rem',
                  border: '2px solid var(--color-card-border)',
                  background: 'var(--color-card-bg)',
                  color: 'var(--color-text-base)',
                  fontSize: '1rem',
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              />
            </div>

            <button
              type="submit"
              style={{
                padding: '0.85rem 1.5rem',
                borderRadius: '0.75rem',
                border: 'none',
                background: '#1B54A8',
                color: '#ffffff',
                fontWeight: 700,
                fontSize: '1rem',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: '0.5rem',
                height: '47px',
              }}
            >
              <Plus size={20} /> Adicionar
            </button>
          </form>

          {/* Lista de Lembretes Ativos */}
          <div>
            <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#475569', marginBottom: '1rem' }}>
              Lembretes Agendados ({reminders.length})
            </h3>
            {reminders.length === 0 ? (
              <p style={{ fontSize: '0.95rem', color: '#94a3b8', fontStyle: 'italic', margin: 0 }}>
                Nenhum lembrete configurado no momento.
              </p>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                {reminders.map((r) => (
                  <div
                    key={r.id}
                    style={{
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center',
                      padding: '1rem 1.25rem',
                      background: 'var(--color-bg-base)',
                      border: '1.5px solid var(--color-card-border)',
                      borderRadius: '1rem',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                      <div
                        style={{
                          width: '40px',
                          height: '40px',
                          borderRadius: '50%',
                          background: 'rgba(27, 84, 168, 0.05)',
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'center',
                          color: '#1B54A8',
                          fontWeight: 700,
                          fontSize: '0.9rem',
                        }}
                      >
                        {r.time}
                      </div>
                      <span style={{ fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-text-base)' }}>
                        {r.title}
                      </span>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        deleteReminder(r.id);
                        toast.success('Lembrete removido com sucesso!');
                      }}
                      aria-label={`Excluir lembrete ${r.title}`}
                      style={{
                        background: 'transparent',
                        border: 'none',
                        color: '#ef4444',
                        cursor: 'pointer',
                        padding: '0.5rem',
                        borderRadius: '0.5rem',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        transition: 'background 0.2s',
                      }}
                      onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)')}
                      onMouseOut={(e) => (e.currentTarget.style.background = 'transparent')}
                      onFocus={(e) => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.08)')}
                      onBlur={(e) => (e.currentTarget.style.background = 'transparent')}
                    >
                      <Trash2 size={20} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>

        {/* Backup */}
        <section aria-labelledby="backup-title" style={cardStyle}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              marginBottom: '1.25rem',
            }}
          >
            <Download size={28} color="#1B54A8" aria-hidden="true" />
            <h2
              id="backup-title"
              style={{ fontSize: '1.25rem', fontWeight: 700, color: '#1e293b' }}
            >
              {t('settings.backup.title')}
            </h2>
          </div>
          <button
            type="button"
            onClick={handleBackup}
            aria-label={t('settings.backup.export')}
            style={{
              padding: '1rem 1.5rem',
              borderRadius: '1rem',
              border: '2px solid var(--color-card-border)',
              background: 'var(--color-card-bg)',
              color: 'var(--color-text-base)', opacity: 0.9,
              fontWeight: 700,
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <Download size={20} aria-hidden="true" /> {t('settings.backup.export')}
          </button>
        </section>

        <p
          style={{
            fontSize: '0.75rem',
            color: '#94a3b8',
            fontFamily: 'system-ui, sans-serif',
            textAlign: 'center',
          }}
        >
          PIN atual: configurado via <code>VITE_CAREGIVER_PIN</code> (env:{' '}
          {env.caregiverPin ? '***' : 'default'}). Substituir por autenticação no backend antes de
          produção.
        </p>
      </div>
    </CaregiverPageLayout>
  );
};
