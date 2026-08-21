import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Circle, Activity, Frown, Smile, HeartPulse, Save } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { CaregiverPageLayout } from '../../components/ui/CaregiverPageLayout';

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
  const { currentProfile, isCaregiver, loginCaregiver } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const userId = currentProfile?.id ?? 'guest';
  const initial = useMemo(() => loadState(userId), [userId]);

  const [tasks, setTasks] = useState<Task[]>(initial.tasks);
  const [entries, setEntries] = useState<DiaryEntry[]>(initial.entries);
  const [painLevel, setPainLevel] = useState(0);
  const [mood, setMood] = useState<'good' | 'bad' | null>(null);

  const [pin, setPin] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);

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

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    if (loginCaregiver(pin)) {
      setPinError(null);
      setPin('');
    } else {
      setPinError('PIN inválido');
      setPin('');
    }
  };

  if (!isCaregiver) {
    return (
      <main
        style={{
          minHeight: '100vh',
          backgroundColor: '#0f172a',
          color: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '2rem',
          fontFamily: "'Inter', sans-serif",
        }}
      >
        <div
          style={{
            background: '#1e293b',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '3rem',
            borderRadius: '2rem',
            textAlign: 'center',
            maxWidth: '450px',
            width: '100%',
            boxShadow: '0 20px 40px rgba(0,0,0,0.3)',
          }}
        >
          <h2 style={{ fontSize: '2rem', fontWeight: 800, color: '#f8fafc', margin: '0 0 0.5rem 0' }}>
            Acesso Restrito ao Cuidador
          </h2>
          <p style={{ fontSize: '1.1rem', color: '#94a3b8', lineHeight: 1.5, margin: '0 0 2.0rem 0' }}>
            Por favor, digite o PIN numérico do cuidador para acessar o dashboard de atividades e dados clínicos.
          </p>

          <form
            onSubmit={handleLogin}
            style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}
          >
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
              style={{
                textAlign: 'center',
                fontSize: '2.5rem',
                letterSpacing: '0.8rem',
                padding: '0.75rem',
                borderRadius: '1rem',
                border: pinError ? '2px solid #ef4444' : '2px solid #334155',
                background: '#0f172a',
                color: '#f8fafc',
                outline: 'none',
              }}
            />
            {pinError && (
              <p role="alert" style={{ color: '#ef4444', fontSize: '0.95rem', fontWeight: 600, margin: '0.25rem 0' }}>
                {pinError}
              </p>
            )}

            {/* Teclado Numérico Virtual (B4-3) */}
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, 1fr)',
                gap: '0.75rem',
                margin: '1.5rem 0',
                width: '100%',
              }}
            >
              {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((num) => (
                <button
                  key={num}
                  type="button"
                  onClick={() => pin.length < 8 && setPin((p) => p + num)}
                  style={{
                    height: '55px',
                    borderRadius: '0.75rem',
                    background: '#334155',
                    border: 'none',
                    fontSize: '1.35rem',
                    fontWeight: 800,
                    cursor: 'pointer',
                    color: '#f8fafc',
                    boxShadow: '0 2px 4px rgba(0,0,0,0.1)',
                  }}
                >
                  {num}
                </button>
              ))}
              <button
                type="button"
                onClick={() => setPin('')}
                style={{
                  height: '55px',
                  borderRadius: '0.75rem',
                  background: 'rgba(239, 68, 68, 0.15)',
                  border: 'none',
                  fontSize: '1.0rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  color: '#ef4444',
                }}
              >
                Limpar
              </button>
              <button
                type="button"
                onClick={() => pin.length < 8 && setPin((p) => p + '0')}
                style={{
                  height: '55px',
                  borderRadius: '0.75rem',
                  background: '#334155',
                  border: 'none',
                  fontSize: '1.35rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  color: '#f8fafc',
                }}
              >
                0
              </button>
              <button
                type="button"
                onClick={() => setPin((p) => p.slice(0, -1))}
                style={{
                  height: '55px',
                  borderRadius: '0.75rem',
                  background: '#475569',
                  border: 'none',
                  fontSize: '1.0rem',
                  fontWeight: 800,
                  cursor: 'pointer',
                  color: '#cbd5e1',
                }}
              >
                Apagar
              </button>
            </div>

            <div style={{ display: 'flex', gap: '1rem', marginTop: '0.5rem' }}>
              <button
                type="button"
                onClick={() => navigate('/menu')}
                style={{
                  flex: 1,
                  padding: '0.85rem',
                  background: '#334155',
                  borderRadius: '0.75rem',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1.0rem',
                  fontWeight: 700,
                  color: '#cbd5e1',
                }}
              >
                Voltar
              </button>
              <button
                type="submit"
                style={{
                  flex: 1,
                  padding: '0.85rem',
                  background: 'linear-gradient(135deg, #1B54A8, #2563eb)',
                  borderRadius: '0.75rem',
                  border: 'none',
                  cursor: 'pointer',
                  fontSize: '1.0rem',
                  fontWeight: 700,
                  color: 'white',
                  boxShadow: '0 4px 16px rgba(27,84,168,0.3)',
                }}
              >
                Entrar
              </button>
            </div>
          </form>
        </div>
      </main>
    );
  }

  return (
    <CaregiverPageLayout title="Painel do Cuidador">
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
            background: '#1e293b',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '2rem',
            borderRadius: '2rem',
            boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
          }}
        >
          <h2
            id="tasks-title"
            style={{
              fontSize: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              color: '#f8fafc',
              marginTop: 0,
            }}
          >
            <Activity color="#38bdf8" aria-hidden="true" /> Rotina Diária
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
                    background: task.done ? 'rgba(34, 197, 94, 0.1)' : '#334155',
                    cursor: 'pointer',
                    transition: 'all 0.2s',
                    boxShadow: task.done ? 'inset 0 0 0 2px #22c55e' : 'none',
                    width: '100%',
                    textAlign: 'left',
                    color: task.done ? '#4ade80' : '#cbd5e1',
                  }}
                >
                  {task.done ? (
                    <CheckCircle2 size={32} color="#22c55e" aria-hidden="true" />
                  ) : (
                    <Circle size={32} color="#64748b" aria-hidden="true" />
                  )}
                  <span
                    style={{
                      fontSize: '1.15rem',
                      fontWeight: 600,
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
            background: '#1e293b',
            border: '1px solid rgba(255, 255, 255, 0.08)',
            padding: '2rem',
            borderRadius: '2rem',
            boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
          }}
        >
          <h2
            id="diary-title"
            style={{
              fontSize: '1.5rem',
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              color: '#f8fafc',
              marginTop: 0,
            }}
          >
            <HeartPulse color="#f87171" aria-hidden="true" /> Registro de Sintomas
          </h2>

          <div style={{ marginTop: '2rem' }}>
            <label
              htmlFor="pain-slider"
              style={{ fontSize: '1.15rem', fontWeight: 600, color: '#cbd5e1' }}
            >
              Nível de Dor Atual: <strong style={{ color: '#f87171' }}>{painLevel}</strong>
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
                color: '#64748b',
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
                color: '#cbd5e1',
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
                  background: mood === 'bad' ? 'rgba(239, 68, 68, 0.15)' : '#334155',
                  border: mood === 'bad' ? '2px solid #ef4444' : '2px solid transparent',
                  borderRadius: '1rem',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.5rem',
                  color: '#fca5a5',
                }}
              >
                <Frown size={48} color="#ef4444" aria-hidden="true" />
                <span style={{ fontWeight: 700 }}>Mal</span>
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={mood === 'good'}
                onClick={() => setMood('good')}
                style={{
                  flex: 1,
                  padding: '1.5rem',
                  background: mood === 'good' ? 'rgba(34, 197, 94, 0.15)' : '#334155',
                  border: mood === 'good' ? '2px solid #22c55e' : '2px solid transparent',
                  borderRadius: '1rem',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  gap: '0.5rem',
                  color: '#86efac',
                }}
              >
                <Smile size={48} color="#22c55e" aria-hidden="true" />
                <span style={{ fontWeight: 700 }}>Bem</span>
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
              transition: 'background 0.2s',
            }}
            onMouseOver={(e) => (e.currentTarget.style.background = '#2563eb')}
            onMouseOut={(e) => (e.currentTarget.style.background = '#1B54A8')}
          >
            <Save size={20} aria-hidden="true" /> Salvar Diário
          </button>
        </section>

        {entries.length > 0 && (
          <section
            aria-labelledby="history-title"
            style={{
              background: '#1e293b',
              border: '1px solid rgba(255, 255, 255, 0.08)',
              padding: '2rem',
              borderRadius: '2rem',
              boxShadow: '0 10px 30px rgba(0,0,0,0.1)',
              gridColumn: '1 / -1',
            }}
          >
            <h2
              id="history-title"
              style={{ fontSize: '1.35rem', color: '#f8fafc', marginTop: 0, marginBottom: '1rem', fontWeight: 700 }}
            >
              Histórico recente ({entries.length})
            </h2>
            <ul
              style={{
                listStyle: 'none',
                padding: 0,
                display: 'grid',
                gap: '0.75rem',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
              }}
            >
              {entries.slice(0, 12).map((e) => (
                <li
                  key={e.timestamp}
                  style={{
                    padding: '1rem',
                    background: '#334155',
                    borderRadius: '0.75rem',
                    fontSize: '0.95rem',
                    color: '#cbd5e1',
                  }}
                >
                  <div style={{ fontWeight: 700, color: '#f8fafc', marginBottom: '0.25rem' }}>
                    {new Date(e.timestamp).toLocaleString('pt-BR')}
                  </div>
                  <div>
                    Dor: <strong style={{ color: '#f87171' }}>{e.painLevel}/10</strong> · Humor:{' '}
                    <strong style={{ color: e.mood === 'good' ? '#86efac' : '#fca5a5' }}>
                      {e.mood === 'good' ? 'Bem' : e.mood === 'bad' ? 'Mal' : 'não registrado'}
                    </strong>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}
      </div>
    </CaregiverPageLayout>
  );
};
