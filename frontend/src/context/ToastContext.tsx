import React, { createContext, useCallback, useContext, useState } from 'react';
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

const palette: Record<ToastKind, { bg: string; color: string; icon: React.ReactNode }> = {
  success: {
    bg: '#dcfce7',
    color: '#065f46',
    icon: <CheckCircle2 size={22} color="#16a34a" aria-hidden="true" />,
  },
  error: {
    bg: '#fee2e2',
    color: '#991b1b',
    icon: <AlertTriangle size={22} color="#dc2626" aria-hidden="true" />,
  },
  info: {
    bg: '#dbeafe',
    color: '#1e3a8a',
    icon: <Info size={22} color="#1B54A8" aria-hidden="true" />,
  },
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const toast = useCallback(
    (kind: ToastKind, message: string, durationMs = 4000) => {
      const id = crypto.randomUUID();
      setToasts((prev) => [...prev, { id, kind, message }]);
      if (durationMs > 0) {
        setTimeout(() => dismiss(id), durationMs);
      }
    },
    [dismiss]
  );

  const success = useCallback((m: string, d?: number) => toast('success', m, d), [toast]);
  const error = useCallback((m: string, d?: number) => toast('error', m, d), [toast]);
  const info = useCallback((m: string, d?: number) => toast('info', m, d), [toast]);

  return (
    <ToastContext.Provider value={{ toast, success, error, info, dismiss }}>
      {children}
      <div
        role="region"
        aria-label="Notificações"
        aria-live="polite"
        style={{
          position: 'fixed',
          top: '1.5rem',
          right: '1.5rem',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.75rem',
          pointerEvents: 'none',
          maxWidth: 380,
        }}
      >
        {toasts.map((t) => {
          const style = palette[t.kind];
          return (
            <div
              key={t.id}
              role={t.kind === 'error' ? 'alert' : 'status'}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: '0.75rem',
                background: style.bg,
                color: style.color,
                padding: '0.9rem 1rem',
                borderRadius: '0.9rem',
                boxShadow: '0 10px 30px rgba(0,0,0,0.12)',
                pointerEvents: 'auto',
                fontFamily: 'system-ui, sans-serif',
                fontSize: '0.95rem',
                lineHeight: 1.4,
                animation: 'toastIn 0.25s ease-out',
              }}
            >
              <span style={{ flexShrink: 0, marginTop: 1 }}>{style.icon}</span>
              <span style={{ flex: 1 }}>{t.message}</span>
              <button
                type="button"
                onClick={() => dismiss(t.id)}
                aria-label="Fechar notificação"
                style={{
                  background: 'transparent',
                  border: 'none',
                  color: style.color,
                  cursor: 'pointer',
                  padding: 0,
                  display: 'flex',
                  alignItems: 'center',
                }}
              >
                <X size={18} aria-hidden="true" />
              </button>
            </div>
          );
        })}
      </div>
      <style>{`
        @keyframes toastIn {
          from { opacity: 0; transform: translateY(-8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </ToastContext.Provider>
  );
};
