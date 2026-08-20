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

export const ReminderProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [reminders, setReminders] = useState<Reminder[]>(() => {
    const saved = localStorage.getItem('irisflow_reminders');
    return saved
      ? JSON.parse(saved)
      : [
          { id: '1', title: 'Tomar água', time: '10:00' },
          { id: '2', title: 'Mudar de posição', time: '14:00' },
          { id: '3', title: 'Medicação da tarde', time: '16:00' },
        ];
  });

  const { isComposing } = useGaze();
  const [activeReminder, setActiveReminder] = useState<Reminder | null>(null);

  // Registra qual lembrete foi disparado em qual data para evitar repetição no mesmo minuto (id -> 'AAAA-MM-DD')
  const [triggeredLog, setTriggeredLog] = useState<Record<string, string>>(() => {
    const saved = localStorage.getItem('irisflow_triggered_reminders');
    return saved ? JSON.parse(saved) : {};
  });

  // Fila de lembretes disparados enquanto o usuário escrevia
  const [queue, setQueue] = useState<Reminder[]>([]);

  const addReminder = (r: Omit<Reminder, 'id'>) => {
    const next = [...reminders, { ...r, id: crypto.randomUUID() }];
    setReminders(next);
    localStorage.setItem('irisflow_reminders', JSON.stringify(next));
  };

  const deleteReminder = (id: string) => {
    const next = reminders.filter((r) => r.id !== id);
    setReminders(next);
    localStorage.setItem('irisflow_reminders', JSON.stringify(next));
  };

  const dismissActiveReminder = () => {
    setActiveReminder(null);
  };

  // Salvar registro de disparo
  useEffect(() => {
    localStorage.setItem('irisflow_triggered_reminders', JSON.stringify(triggeredLog));
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
