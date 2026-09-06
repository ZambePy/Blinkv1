import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Activity,
  ArrowLeft,
  BellRing,
  BookOpen,
  CheckCircle2,
  Circle,
  Crosshair,
  Eye,
  Frown,
  HeartPulse,
  History,
  RefreshCw,
  Save,
  Settings,
  Smile,
  Target,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { useGaze } from '../../context/GazeContext';
import { useReminders } from '../../context/ReminderContext';
import { getClinicalData, hasConsent } from '../../utils/clinicalLogger';
import { CaregiverPageLayout } from '../../components/ui/CaregiverPageLayout';
import { PageHeader } from '../../components/ui/PageHeader';
import { CaregiverPinGate } from './CaregiverPinGate';
import { Badge, Card, KV, Note, Segmented } from './CaregiverControls';
import './caregiver.css';

interface Task {
  id: number;
  label: string;
  done: boolean;
}

interface DiaryEntry {
  timestamp: string;
  painLevel: number;
  mood: 'good' | 'bad' | null;
}

interface CaregiverState {
  tasks: Task[];
  entries: DiaryEntry[];
}

const DEFAULT_TASKS: Task[] = [
  { id: 1, label: 'Tomar medicação da manhã', done: false },
  { id: 2, label: 'Fisioterapia (14h)', done: false },
  { id: 3, label: 'Beber 500ml de água', done: false },
];

const storageKey = (userId: string) => `irisflow_caregiver_${userId}`;

const loadState = (userId: string): CaregiverState => {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return { tasks: DEFAULT_TASKS, entries: [] };
    const parsed = JSON.parse(raw) as Partial<CaregiverState>;
    return {
      tasks: Array.isArray(parsed.tasks) ? parsed.tasks : DEFAULT_TASKS,
      entries: Array.isArray(parsed.entries) ? parsed.entries : [],
    };
  } catch {
    return { tasks: DEFAULT_TASKS, entries: [] };
  }
};

const STATE_LABEL: Record<string, string> = {
  idle: 'Parado',
  loading: 'Iniciando',
  tracking: 'Rastreando',
  calibrating: 'Calibrando',
  no_face: 'Sem rosto',
  degraded: 'Degradado',
  uncalibrated: 'Sem calibração',
  error: 'Erro',
};

const MODEL_LABEL: Record<string, string> = {
  loading: 'carregando',
  ready: 'pronto',
  error: 'com erro',
  disabled: 'desligado',
};

const fmtDate = (iso: string) => new Date(iso).toLocaleString('pt-BR');

/**
 * Painel do cuidador: estado do rastreamento, alertas e eventos recentes,
 * atalhos, rotina diária e diário de sintomas. Rotina e diário persistem
 * por perfil no localStorage.
 */
export const CaregiverDashboard: React.FC = () => {
  const { currentProfile, isCaregiver } = useAuth();
  const toast = useToast();

  if (!isCaregiver) {
    return (
      <CaregiverPinGate
        title="Acesso Restrito ao Cuidador"
        hint="Digite o PIN do cuidador para abrir o painel de rotina, diário e estado do rastreamento."
        errorText="PIN inválido"
        submitLabel="Entrar"
        cancelLabel="Voltar"
      />
    );
  }

  return <Dashboard userId={currentProfile?.id ?? 'guest'} profileName={currentProfile?.name} toast={toast} />;
};

interface DashboardProps {
  userId: string;
  profileName?: string;
  toast: ReturnType<typeof useToast>;
}

const Dashboard: React.FC<DashboardProps> = ({ userId, profileName, toast }) => {
  const navigate = useNavigate();
  const { state, l2csStatus, isDegraded, cameraError, calibrationInvalidated, gazeLostMessage, calibration, getDiagnostics } =
    useGaze();
  const { reminders } = useReminders();

  const initial = useMemo(() => loadState(userId), [userId]);
  const [tasks, setTasks] = useState<Task[]>(initial.tasks);
  const [entries, setEntries] = useState<DiaryEntry[]>(initial.entries);
  const [painLevel, setPainLevel] = useState(0);
  const [mood, setMood] = useState<'good' | 'bad' | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(storageKey(userId), JSON.stringify({ tasks, entries }));
    } catch {
      // Sem storage o painel vale só nesta sessão.
    }
  }, [tasks, entries, userId]);

  // Leituras do engine não são reativas: 1 Hz é suficiente para um painel.
  const [live, setLive] = useState(() => ({
    calibrated: calibration.isCalibrated(),
    fps: null as number | null,
    hasFace: null as boolean | null,
    distance: calibration.getDistanceRange(),
  }));
  useEffect(() => {
    // Só pelo intervalo: chamar no mount faria o efeito realimentar o render
    // se o contexto vier sem memoização (como nos testes).
    const id = setInterval(() => {
      const d = getDiagnostics();
      setLive({
        calibrated: calibration.isCalibrated(),
        fps: d ? d.fpsRender : null,
        hasFace: d ? d.framing.hasFace : null,
        distance: calibration.getDistanceRange(),
      });
    }, 1000);
    return () => clearInterval(id);
  }, [calibration, getDiagnostics]);

  const clinical = useMemo(() => (hasConsent() ? getClinicalData() : null), []);

  const toggleTask = (id: number) =>
    setTasks((t) => t.map((task) => (task.id === id ? { ...task, done: !task.done } : task)));

  const saveEntry = () => {
    const entry: DiaryEntry = { timestamp: new Date().toISOString(), painLevel, mood };
    setEntries((e) => [entry, ...e].slice(0, 30));
    toast.success('Diário salvo.');
  };

  // Alertas ativos, do mais grave para o menos.
  const alerts: { tone: 'danger' | 'warn'; text: string }[] = [];
  if (cameraError) alerts.push({ tone: 'danger', text: cameraError });
  if (calibrationInvalidated) alerts.push({ tone: 'danger', text: calibrationInvalidated });
  if (!live.calibrated && !calibrationInvalidated) {
    alerts.push({ tone: 'warn', text: 'Sem calibração: o paciente não consegue clicar com o olhar. Use "Recalibrar".' });
  }
  if (isDegraded) alerts.push({ tone: 'warn', text: 'O rastreamento está degradado. Confira luz e distância; se persistir, recalibre.' });
  if (gazeLostMessage) alerts.push({ tone: 'warn', text: gazeLostMessage });
  if (live.distance && (live.distance.status === 'out' || live.distance.status === 'warn')) {
    alerts.push({ tone: live.distance.status === 'out' ? 'danger' : 'warn', text: live.distance.message });
  }

  // Eventos recentes: testes de precisão (com consentimento) e diário.
  const events = [
    ...(clinical?.calibrations ?? []).map((c) => ({
      at: c.timestamp,
      icon: <Target size={20} aria-hidden="true" />,
      text: `Teste de precisão: ${c.errorDeg.toFixed(2)}° de erro médio`,
      tone: c.errorDeg >= 1.5 ? ('warn' as const) : ('ok' as const),
    })),
    ...entries.map((e) => ({
      at: e.timestamp,
      icon: <HeartPulse size={20} aria-hidden="true" />,
      text: `Diário: dor ${e.painLevel}/10 · humor ${e.mood === 'good' ? 'bem' : e.mood === 'bad' ? 'mal' : 'não registrado'}`,
      tone: e.painLevel >= 7 || e.mood === 'bad' ? ('warn' as const) : ('ok' as const),
    })),
  ]
    .sort((a, b) => b.at.localeCompare(a.at))
    .slice(0, 6);

  const nextReminders = [...reminders].sort((a, b) => a.time.localeCompare(b.time)).slice(0, 3);
  const doneCount = tasks.filter((t) => t.done).length;

  const stateTone = state === 'tracking' ? 'ok' : state === 'error' || state === 'degraded' ? 'danger' : 'warn';

  return (
    <CaregiverPageLayout title="Painel do Cuidador">
      <div className="cg-stack">
        <PageHeader
          title="Visão geral"
          subtitle={profileName ? `Acompanhamento de ${profileName}` : 'Estado do rastreamento, rotina e diário do paciente'}
          icon={<Activity size={28} aria-hidden="true" />}
          showBack={false}
        />

        {/* Atalhos: alvos grandes. "Voltar ao menu" é dwell-ável — o
            paciente pode precisar sair daqui sozinho. */}
        <div className="cg-grid cg-grid--tight" role="navigation" aria-label="Atalhos">
          <button type="button" className="cg-tile cg-tile--primary" onClick={() => navigate('/menu')}>
            <span className="cg-tile__icon" aria-hidden="true">
              <ArrowLeft size={26} />
            </span>
            <span className="cg-tile__title">Voltar ao menu do paciente</span>
            <span className="cg-tile__desc">Devolve a tela ao uso pelo olhar.</span>
          </button>
          <button type="button" className="cg-tile" onClick={() => navigate('/calibration-check')} data-no-dwell="true">
            <span className="cg-tile__icon" aria-hidden="true">
              <RefreshCw size={26} />
            </span>
            <span className="cg-tile__title">Recalibrar</span>
            <span className="cg-tile__desc">Preparação, calibração e teste de precisão.</span>
          </button>
          <button type="button" className="cg-tile" onClick={() => navigate('/settings')} data-no-dwell="true">
            <span className="cg-tile__icon" aria-hidden="true">
              <Settings size={26} />
            </span>
            <span className="cg-tile__title">Configurações</span>
            <span className="cg-tile__desc">Tempo de fixação, tela, voz e dados.</span>
          </button>
          <button
            type="button"
            className="cg-tile"
            onClick={() => navigate('/caregiver/guide?from=/caregiver')}
            data-no-dwell="true"
          >
            <span className="cg-tile__icon" aria-hidden="true">
              <BookOpen size={26} />
            </span>
            <span className="cg-tile__title">Guia do cuidador</span>
            <span className="cg-tile__desc">Câmera, luz, distância e o que fazer quando piora.</span>
          </button>
        </div>

        <div className="cg-grid">
          <Card
            id="tracking-status"
            title="Rastreamento"
            description="Estado do olhar neste momento."
            icon={<Eye size={24} />}
            iconTone={stateTone === 'ok' ? 'ok' : stateTone === 'danger' ? 'danger' : 'warn'}
            aside={<Badge tone={stateTone}>{STATE_LABEL[state] ?? state}</Badge>}
          >
            <KV
              items={[
                {
                  key: 'Calibração',
                  value: live.calibrated ? 'Pronta' : 'Ausente',
                  tone: live.calibrated ? 'ok' : 'warn',
                },
                {
                  key: 'Rosto na câmera',
                  value: live.hasFace === null ? '—' : live.hasFace ? 'Sim' : 'Não',
                  tone: live.hasFace === null ? undefined : live.hasFace ? 'ok' : 'danger',
                },
                {
                  key: 'Quadros por segundo',
                  value: live.fps === null ? '—' : live.fps.toFixed(0),
                  tone: live.fps !== null && live.fps < 20 ? 'warn' : undefined,
                },
                { key: 'Modelo de olhar', value: MODEL_LABEL[l2csStatus] ?? l2csStatus, tone: l2csStatus === 'ready' ? 'ok' : l2csStatus === 'error' ? 'danger' : undefined },
                {
                  key: 'Distância',
                  value:
                    live.distance?.screenDistanceNowCm != null ? `${Math.round(live.distance.screenDistanceNowCm)} cm` : '—',
                  tone: live.distance?.status === 'out' ? 'danger' : live.distance?.status === 'warn' ? 'warn' : undefined,
                },
              ]}
            />
          </Card>

          <Card
            id="alerts"
            title="Alertas"
            description={alerts.length === 0 ? 'Nenhum alerta ativo.' : `${alerts.length} ponto(s) de atenção.`}
            icon={<Crosshair size={24} />}
            iconTone={alerts.length === 0 ? 'ok' : alerts.some((a) => a.tone === 'danger') ? 'danger' : 'warn'}
          >
            {alerts.length === 0 ? (
              <Note tone="ok">O rastreamento está em condições de uso.</Note>
            ) : (
              <div className="cg-card__body">
                {alerts.map((a) => (
                  <Note key={a.text} tone={a.tone} role="status">
                    {a.text}
                  </Note>
                ))}
              </div>
            )}
          </Card>

          <Card
            id="events"
            title="Eventos recentes"
            description={clinical ? 'Testes de precisão e registros do diário.' : 'Registros do diário. Autorize o histórico clínico em Configurações para ver os testes de precisão.'}
            icon={<History size={24} />}
          >
            {events.length === 0 ? (
              <p className="cg-empty">Nenhum evento registrado ainda.</p>
            ) : (
              <ul className="cg-list">
                {events.map((e) => (
                  <li key={`${e.at}-${e.text}`} className={`cg-list__item ${e.tone === 'warn' ? 'cg-list__item--warn' : ''}`.trim()}>
                    <div className="cg-list__lead">
                      <span style={{ color: e.tone === 'warn' ? 'var(--warn)' : 'var(--ok)', display: 'inline-flex' }}>{e.icon}</span>
                      <div>
                        <div className="cg-list__title">{e.text}</div>
                        <div className="cg-list__meta">{fmtDate(e.at)}</div>
                      </div>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            id="next-reminders"
            title="Próximos lembretes"
            description="Configurados em Configurações → Cuidador."
            icon={<BellRing size={24} />}
          >
            {nextReminders.length === 0 ? (
              <p className="cg-empty">Nenhum lembrete configurado.</p>
            ) : (
              <ul className="cg-list">
                {nextReminders.map((r) => (
                  <li key={r.id} className="cg-list__item">
                    <div className="cg-list__lead">
                      <span className="cg-list__time">{r.time}</span>
                      <span className="cg-list__title">{r.title}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Card>

          <Card
            id="tasks"
            title="Rotina diária"
            description={`${doneCount} de ${tasks.length} concluídas.`}
            icon={<CheckCircle2 size={24} />}
            iconTone={doneCount === tasks.length && tasks.length > 0 ? 'ok' : 'primary'}
          >
            <ul className="cg-list">
              {tasks.map((task) => (
                <li key={task.id}>
                  <button
                    type="button"
                    role="checkbox"
                    aria-checked={task.done}
                    onClick={() => toggleTask(task.id)}
                    aria-label={`${task.done ? 'Desmarcar' : 'Marcar'} tarefa: ${task.label}`}
                    className="cg-check"
                    data-no-dwell="true"
                  >
                    <span className="cg-check__icon">
                      {task.done ? <CheckCircle2 size={28} aria-hidden="true" /> : <Circle size={28} aria-hidden="true" />}
                    </span>
                    <span>{task.label}</span>
                  </button>
                </li>
              ))}
            </ul>
          </Card>

          <Card id="diary" title="Registro de sintomas" description="Anote dor e humor de hoje." icon={<HeartPulse size={24} />} iconTone="danger">
            <div className="cg-card__body">
              <div className="cg-field">
                <label htmlFor="pain-slider" className="cg-label">
                  <span>Nível de dor</span>
                  <span className="cg-label__value" style={{ color: painLevel >= 7 ? 'var(--danger)' : undefined }}>
                    {painLevel}/10
                  </span>
                </label>
                <input
                  id="pain-slider"
                  type="range"
                  className="cg-range"
                  min={0}
                  max={10}
                  value={painLevel}
                  onChange={(e) => setPainLevel(parseInt(e.target.value, 10))}
                  data-no-dwell="true"
                />
                <div className="cg-range-scale" aria-hidden="true">
                  <span>0 · sem dor</span>
                  <span>10 · dor máxima</span>
                </div>
              </div>

              <div className="cg-field">
                <span className="cg-label" id="mood-label">
                  Humor / bem-estar
                </span>
                <Segmented
                  ariaLabelledBy="mood-label"
                  value={mood ?? ''}
                  onChange={(v) => setMood(v === '' ? null : v)}
                  options={[
                    { value: 'bad', label: 'Mal', icon: <Frown size={20} /> },
                    { value: 'good', label: 'Bem', icon: <Smile size={20} /> },
                  ]}
                />
              </div>

              <button type="button" className="btn btn--primary btn--block" onClick={saveEntry} data-no-dwell="true">
                <Save size={18} aria-hidden="true" /> Salvar diário
              </button>
            </div>
          </Card>

          {entries.length > 0 && (
            <Card id="history" title={`Histórico do diário (${entries.length})`} icon={<History size={24} />} className="cg-span-all">
              <ul className="cg-list" style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 260px), 1fr))' }}>
                {entries.slice(0, 12).map((e) => (
                  <li key={e.timestamp} className="cg-list__item" style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '0.25rem' }}>
                    <span className="cg-list__meta">{fmtDate(e.timestamp)}</span>
                    <span>
                      Dor <strong style={{ color: e.painLevel >= 7 ? 'var(--danger)' : 'var(--text)' }}>{e.painLevel}/10</strong> · Humor{' '}
                      <strong style={{ color: e.mood === 'good' ? 'var(--ok)' : e.mood === 'bad' ? 'var(--danger)' : 'var(--text-3)' }}>
                        {e.mood === 'good' ? 'bem' : e.mood === 'bad' ? 'mal' : 'não registrado'}
                      </strong>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </CaregiverPageLayout>
  );
};
