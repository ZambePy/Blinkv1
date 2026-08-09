import React, { useCallback, useEffect, useState } from 'react';
import { BackButton } from '../../components/ui/BackButton';
import { ThumbsUp, Send } from 'lucide-react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';

export const IAmOkScreen: React.FC = () => {
  const { currentProfile } = useAuth();
  const toast = useToast();
  const [timeLeft, setTimeLeft] = useState(30);
  const [sent, setSent] = useState(false);
  const [sending, setSending] = useState(false);

  const dispatchSignal = useCallback(async () => {
    if (sending || sent) return;
    setSending(true);
    try {
      await api.sendIAmOk(currentProfile?.id ?? 'anon');
      toast.success('Sinal "Estou Bem" enviado.');
    } catch (err) {
      console.warn('Falha ao enviar sinal "Estou Bem":', err);
      toast.error('Falha ao enviar sinal. Tente novamente.');
    } finally {
      setSent(true);
      setSending(false);
    }
  }, [sending, sent, currentProfile, toast]);

  useEffect(() => {
    if (sent) return;
    if (timeLeft === 0) {
      dispatchSignal();
      return;
    }
    const timer = setInterval(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearInterval(timer);
  }, [timeLeft, sent, dispatchSignal]);

  return (
    <main
      role="main"
      aria-labelledby="iamok-title"
      style={{
        minHeight: '100vh',
        backgroundColor: '#f0fdf4',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <div style={{ position: 'absolute', top: '2rem', left: '2rem' }}>
        <BackButton />
      </div>

      <div
        style={{
          background: 'white',
          padding: '4rem',
          borderRadius: '2rem',
          boxShadow: '0 20px 40px rgba(0,0,0,0.05)',
          textAlign: 'center',
          maxWidth: 600,
        }}
      >
        <ThumbsUp size={100} color="#16a34a" style={{ marginBottom: '2rem' }} aria-hidden="true" />
        <h1
          id="iamok-title"
          style={{ fontSize: '2.5rem', color: '#166534', margin: 0, fontWeight: 900 }}
        >
          Modo "Estou Bem"
        </h1>

        {sent ? (
          <div role="status" aria-live="polite" style={{ marginTop: '2rem' }}>
            <p style={{ fontSize: '1.5rem', color: '#15803d', fontWeight: 600 }}>
              Sinal enviado aos cuidadores com sucesso!
            </p>
            <Send
              size={48}
              color="#22c55e"
              style={{ marginTop: '1rem', animation: 'bounce 2s infinite' }}
              aria-hidden="true"
            />
          </div>
        ) : (
          <div style={{ marginTop: '2rem' }}>
            <p style={{ fontSize: '1.5rem', color: '#475569' }}>
              Enviando notificação automática em:
            </p>
            <div
              role="timer"
              aria-live="polite"
              aria-atomic="true"
              style={{ fontSize: '5rem', fontWeight: 900, color: '#16a34a', margin: '1rem 0' }}
            >
              {timeLeft}s
            </div>
            <button
              type="button"
              onClick={dispatchSignal}
              aria-label="Enviar sinal 'Estou Bem' agora"
              disabled={sending}
              style={{
                width: '100%',
                padding: '1.5rem',
                background: '#16a34a',
                color: 'white',
                border: 'none',
                borderRadius: '1rem',
                fontSize: '1.5rem',
                fontWeight: 700,
                cursor: sending ? 'wait' : 'pointer',
                boxShadow: '0 8px 20px rgba(22,163,74,0.3)',
                marginBottom: '1rem',
                opacity: sending ? 0.7 : 1,
              }}
            >
              {sending ? 'Enviando…' : 'Enviar Agora'}
            </button>
            <button
              type="button"
              onClick={() => window.history.back()}
              aria-label="Cancelar envio"
              style={{
                width: '100%',
                padding: '1.5rem',
                background: '#fef2f2',
                color: '#dc2626',
                border: 'none',
                borderRadius: '1rem',
                fontSize: '1.5rem',
                fontWeight: 700,
                cursor: 'pointer',
              }}
            >
              Cancelar
            </button>
          </div>
        )}
      </div>
      <style>{`@keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }`}</style>
    </main>
  );
};
