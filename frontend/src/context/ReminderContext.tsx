import React, { createContext, useContext, useState, useEffect } from 'react';
import { useGaze } from './GazeContext';

export interface Reminder {
  id: string;
  title: string;
  time: string; // no formato "HH:MM"
}

interface ReminderContextValue {
  reminders: Reminder[];
  addReminder: (reminder: Omit<Reminder, 'id'>) => void;
  deleteReminder: (id: string) => void;
  activeReminder: Reminder | null;
  dismissActiveReminder: () => void;
}

const ReminderContext = createContext<ReminderContextValue>({
  reminders: [],
  addReminder: () => {},
  deleteReminder: () => {},
  activeReminder: null,
  dismissActiveReminder: () => {},
});

export const useReminders = () => useContext(ReminderContext);

const REMINDERS_KEY = 'irisflow_reminders';
const TRIGGERED_KEY = 'irisflow_triggered_reminders';

const DEFAULT_REMINDERS: Reminder[] = [
  { id: '1', title: 'Tomar água', time: '10:00' },
  { id: '2', title: 'Mudar de posição', time: '14:00' },
  { id: '3', title: 'Medicação da tarde', time: '16:00' },
];

/** Lê JSON do localStorage sem nunca lançar; valor inválido cai no fallback. */
function lerJson<T>(key: string, fallback: T, valido: (v: unknown) => v is T): T {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return valido(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

const ehListaDeLembretes = (v: unknown): v is Reminder[] =>
  Array.isArray(v) &&
  v.every(
    (r) =>
      r &&
      typeof r === 'object' &&
      typeof r.id === 'string' &&
      typeof r.title === 'string' &&
      typeof r.time === 'string'
  );

const ehRegistro = (v: unknown): v is Record<string, string> =>
  !!v && typeof v === 'object' && !Array.isArray(v);

function salvarJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Quota cheia ou storage bloqueado: o lembrete continua valendo na sessão.
  }
}

export const ReminderProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [reminders, setReminders] = useState<Reminder[]>(() =>
    lerJson(REMINDERS_KEY, DEFAULT_REMINDERS, ehListaDeLembretes)
  );

  const { isComposing } = useGaze();
  const [activeReminder, setActiveReminder] = useState<Reminder | null>(null);

  // Registra qual lembrete foi disparado em qual data para evitar repetição no mesmo minuto (id -> 'AAAA-MM-DD')
  const [triggeredLog, setTriggeredLog] = useState<Record<string, string>>(() =>
    lerJson(TRIGGERED_KEY, {}, ehRegistro)
  );

  // Fila de lembretes disparados enquanto o usuário escrevia
  const [queue, setQueue] = useState<Reminder[]>([]);

  const addReminder = (r: Omit<Reminder, 'id'>) => {
    const next = [...reminders, { ...r, id: crypto.randomUUID() }];
    setReminders(next);
    salvarJson(REMINDERS_KEY, next);
  };

  const deleteReminder = (id: string) => {
    const next = reminders.filter((r) => r.id !== id);
    setReminders(next);
    salvarJson(REMINDERS_KEY, next);
  };

  const dismissActiveReminder = () => {
    setActiveReminder(null);
  };

  // Salvar registro de disparo
  useEffect(() => {
    salvarJson(TRIGGERED_KEY, triggeredLog);
  }, [triggeredLog]);

  // Loop de background: verifica a cada 10s
  useEffect(() => {
    const interval = setInterval(() => {
      const now = new Date();
      const HH = String(now.getHours()).padStart(2, '0');
      const MM = String(now.getMinutes()).padStart(2, '0');
      const timeStr = `${HH}:${MM}`;
      const todayStr = now.toISOString().split('T')[0];

      reminders.forEach((r) => {
        if (r.time === timeStr && triggeredLog[r.id] !== todayStr) {
          setTriggeredLog((prev) => ({ ...prev, [r.id]: todayStr }));

          if (isComposing) {
            setQueue((prev) => [...prev, r]);
          } else {
            setActiveReminder(r);
          }
        }
      });
    }, 10000);

    return () => clearInterval(interval);
  }, [reminders, triggeredLog, isComposing]);

  // Se o usuário parar de compor, e houver lembrete na fila, exibe o próximo
  useEffect(() => {
    if (!isComposing && queue.length > 0 && !activeReminder) {
      const next = queue[0];
      setQueue((prev) => prev.slice(1));
      setActiveReminder(next);
    }
  }, [isComposing, queue, activeReminder]);

  return (
    <ReminderContext.Provider
      value={{
        reminders,
        addReminder,
        deleteReminder,
        activeReminder,
        dismissActiveReminder,
      }}
    >
      {children}
    </ReminderContext.Provider>
  );
};
