import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

export type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

interface ToastContextData {
  toast: (kind: ToastKind, message: string, durationMs?: number) => void;
  success: (message: string, durationMs?: number) => void;
  error: (message: string, durationMs?: number) => void;
  info: (message: string, durationMs?: number) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<ToastContextData>({
  toast: () => {},
  success: () => {},
  error: () => {},
  info: () => {},
  dismiss: () => {},
});

export const useToast = () => useContext(ToastContext);

const ICON: Record<ToastKind, React.ReactNode> = {
  success: <CheckCircle2 size={22} aria-hidden="true" />,
  error: <AlertTriangle size={22} aria-hidden="true" />,
  info: <Info size={22} aria-hidden="true" />,
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  // Timers pendentes, para cancelar no unmount e ao fechar manualmente.
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const dismiss = useCallback((id: string) => {
    const t = timersRef.current.get(id);
    if (t) {
      clearTimeout(t);
      timersRef.current.delete(id);
    }
    setToasts((prev) => prev.filter((x) => x.id !== id));
  }, []);

  const toast = useCallback(
    (kind: ToastKind, message: string, durationMs = 4000) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, kind, message }]);
      if (durationMs > 0) {
        timersRef.current.set(
          id,
          setTimeout(() => dismiss(id), durationMs)
        );
      }
    },
    [dismiss]
  );

  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      timers.forEach((t) => clearTimeout(t));
      timers.clear();
    };
  }, []);

  const success = useCallback((m: string, d?: number) => toast('success', m, d), [toast]);
  const error = useCallback((m: string, d?: number) => toast('error', m, d), [toast]);
  const info = useCallback((m: string, d?: number) => toast('info', m, d), [toast]);

  const value = useMemo(
    () => ({ toast, success, error, info, dismiss }),
    [toast, success, error, info, dismiss]
  );

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div role="region" aria-label="Notificações" aria-live="polite" className="toast-region">
        {toasts.map((t) => (
          <div
            key={t.id}
            role={t.kind === 'error' ? 'alert' : 'status'}
            className={`toast toast--${t.kind}`}
          >
            <span className="toast__icon">{ICON[t.kind]}</span>
            <span className="toast__message">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Fechar notificação"
              className="toast__close"
            >
              <X size={20} aria-hidden="true" />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};
