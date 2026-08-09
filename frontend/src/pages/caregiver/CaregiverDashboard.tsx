import React, { useEffect, useMemo, useState } from 'react';
import { BackButton } from '../../components/ui/BackButton';
import { CheckCircle2, Circle, Activity, Frown, Smile, HeartPulse, Save } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

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
      tasks: parsed.tasks ?? DEFAULT_TASKS,
      entries: parsed.entries ?? [],
    };
  } catch {
    return { tasks: DEFAULT_TASKS, entries: [] };
  }
};

export const CaregiverDashboard: React.FC = () => {
  const { currentProfile } = useAuth();
  const toast = useToast();
  const userId = currentProfile?.id ?? 'guest';
  const initial = useMemo(() => loadState(userId), [userId]);

  const [tasks, setTasks] = useState<Task[]>(initial.tasks);
  const [entries, setEntries] = useState<DiaryEntry[]>(initial.entries);
  const [painLevel, setPainLevel] = useState(0);
  const [mood, setMood] = useState<'good' | 'bad' | null>(null);

  useEffect(() => {
    localStorage.setItem(storageKey(userId), JSON.stringify({ tasks, entries }));
  }, [tasks, entries, userId]);

  const toggleTask = (id: number) => {
    setTasks((t) => t.map((task) => (task.id === id ? { ...task, done: !task.done } : task)));
  };

  const saveEntry = () => {
    const entry: DiaryEntry = { timestamp: new Date().toISOString(), painLevel, mood };
    setEntries((e) => [entry, ...e].slice(0, 30));
    toast.success('Diário salvo.');
  };

  return (
    <main
      role="main"
      aria-labelledby="caregiver-title"
      style={{ minHeight: '100vh', backgroundColor: '#f8fafc', padding: '2rem' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2rem', gap: '1rem' }}>
        <BackButton />
        <h1
          id="caregiver-title"
          style={{ fontSize: '2rem', color: '#1e293b', margin: 0, fontWeight: 800 }}
        >
          Painel do Cuidador
        </h1>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
          gap: '2rem',
        }}
      >
        <section
          aria-labelledby="tasks-title"
          style={{
            background: 'white',
            padding: '2rem',
            borderRadius: '2rem',
            boxShadow: '0 10px 30px rgba(0,0,0,0.05)',
          }}
        >
          <h2
            id="tasks-title"
            style={{
              fontSize: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: '#334155',
              marginTop: 0,
            }}
          >
            <Activity color="#2563eb" aria-hidden="true" /> Rotina Diária
          </h2>
          <ul
            style={{
              listStyle: 'none',
              padding: 0,
              display: 'flex',
              flexDirection: 'column',
              gap: '1rem',
              marginTop: '1.5rem',
            }}
          >
            {tasks.map((task) => (
              <li key={task.id}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={task.done}
                  onClick={() => toggleTask(task.id)}
                  aria-label={`${task.done ? 'Desmarcar' : 'Marcar'} tarefa: ${task.label}`}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '1rem',
                    padding: '1.25rem',
                    borderRadius: '1rem',
                    border: 'none',
                    background: task.done ? '#f0fdf4' : '#f1f5f9',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    boxShadow: task.done ? 'inset 0 0 0 2px #22c55e' : 'none',
                    width: '100%',
                    textAlign: 'left',
                  }}
                >
                  {task.done ? (
                    <CheckCircle2 size={32} color="#22c55e" aria-hidden="true" />
                  ) : (
                    <Circle size={32} color="#94a3b8" aria-hidden="true" />
                  )}
                  <span
                    style={{
                      fontSize: '1.15rem',
                      fontWeight: 600,
                      color: task.done ? '#166534' : '#475569',
                      textDecoration: task.done ? 'line-through' : 'none',
                    }}
                  >
                    {task.label}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section
          aria-labelledby="diary-title"
          style={{
            background: 'white',
            padding: '2rem',
            borderRadius: '2rem',
            boxShadow: '0 10px 30px rgba(0,0,0,0.05)',
          }}
        >
          <h2
            id="diary-title"
            style={{
              fontSize: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              color: '#334155',
              marginTop: 0,
            }}
          >
            <HeartPulse color="#ef4444" aria-hidden="true" /> Registro de Sintomas
          </h2>

          <div style={{ marginTop: '2rem' }}>
            <label
              htmlFor="pain-slider"
              style={{ fontSize: '1.15rem', fontWeight: 600, color: '#475569' }}
            >
              Nível de Dor Atual: <strong>{painLevel}</strong>
            </label>
            <input
              id="pain-slider"
              type="range"
              min={0}
              max={10}
              value={painLevel}
              onChange={(e) => setPainLevel(parseInt(e.target.value, 10))}
              aria-valuemin={0}
              aria-valuemax={10}
              aria-valuenow={painLevel}
              style={{ width: '100%', height: '20px', cursor: 'pointer', marginTop: '0.75rem' }}
            />
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                marginTop: '0.5rem',
                color: '#94a3b8',
              }}
            >
              <span>0 (Sem dor)</span>
              <span>10 (Dor máxima)</span>
            </div>
          </div>

          <fieldset style={{ marginTop: '2rem', border: 'none', padding: 0 }}>
            <legend
              style={{
                fontSize: '1.15rem',
                fontWeight: 600,
                color: '#475569',
                marginBottom: '0.75rem',
              }}
            >
              Humor / Bem-Estar
            </legend>
            <div
              role="radiogroup"
              aria-label="Humor atual"
              style={{ display: 'flex', gap: '1rem' }}
            >
              <button
                type="button"
                role="radio"
                aria-checked={mood === 'bad'}
                onClick={() => setMood('bad')}
                style={{
                  flex: 1,
                  padding: '1.5rem',
                  background: mood === 'bad' ? '#fee2e2' : '#fef2f2',
                  border: mood === 'bad' ? '2px solid #ef4444' : '2px solid transparent',
                  borderRadius: '1rem',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <Frown size={48} color="#ef4444" aria-hidden="true" />
                <span style={{ fontWeight: 700, color: '#b91c1c' }}>Mal</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mood === 'good'}
                onClick={() => setMood('good')}
                style={{
                  flex: 1,
                  padding: '1.5rem',
                  background: mood === 'good' ? '#dcfce7' : '#f0fdf4',
                  border: mood === 'good' ? '2px solid #22c55e' : '2px solid transparent',
                  borderRadius: '1rem',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.5rem',
                }}
              >
                <Smile size={48} color="#22c55e" aria-hidden="true" />
                <span style={{ fontWeight: 700, color: '#15803d' }}>Bem</span>
              </button>
            </div>
          </fieldset>

          <button
            type="button"
            onClick={saveEntry}
            aria-label="Salvar diário do dia"
            style={{
              width: '100%',
              padding: '1.25rem',
              marginTop: '2rem',
              background: '#1B54A8',
              color: 'white',
              border: 'none',
              borderRadius: '1rem',
              fontSize: '1.15rem',
              fontWeight: 700,
              cursor: 'pointer',
              boxShadow: '0 4px 15px rgba(27,84,168,0.3)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '0.5rem',
            }}
          >
            <Save size={20} aria-hidden="true" /> Salvar Diário
          </button>
        </section>

        {entries.length > 0 && (
          <section
            aria-labelledby="history-title"
            style={{
              background: 'white',
              padding: '2rem',
              borderRadius: '2rem',
              boxShadow: '0 10px 30px rgba(0,0,0,0.05)',
              gridColumn: '1 / -1',
            }}
          >
            <h2
              id="history-title"
              style={{ fontSize: '1.35rem', color: '#334155', marginTop: 0, marginBottom: '1rem' }}
            >
              Histórico recente ({entries.length})
            </h2>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                display: 'grid',
                gap: '0.5rem',
                gridTemplateColumns: 'repeat(auto-fill, minmax(250px, 1fr))',
              }}
            >
              {entries.slice(0, 12).map((e) => (
                <li
                  key={e.timestamp}
                  style={{
                    padding: '0.75rem 1rem',
                    background: '#f8fafc',
                    borderRadius: '0.75rem',
                    fontSize: '0.9rem',
                    color: '#475569',
                    fontFamily: 'system-ui, sans-serif',
                  }}
                >
                  <div style={{ fontWeight: 700 }}>
                    {new Date(e.timestamp).toLocaleString('pt-BR')}
                  </div>
                  <div>
                    Dor: {e.painLevel}/10 · Humor: {e.mood ?? 'não registrado'}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </main>
  );
};
