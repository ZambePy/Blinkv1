import React, { useCallback, useEffect, useState } from 'react';
import { ThumbsUp, Send } from 'lucide-react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { GazePageLayout } from '../../components/ui/GazePageLayout';
import { GazeButton } from '../../components/ui/GazeButton';

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
    <GazePageLayout showBack={true} backRoute="/menu">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            background: 'var(--color-card-bg)',
            padding: '3.5rem 3rem',
            borderRadius: '2.5rem',
            border: '2px solid var(--color-card-border)',
            boxShadow: '0 20px 40px rgba(0,0,0,0.05)',
            textAlign: 'center',
            maxWidth: 600,
            width: '100%',
            boxSizing: 'border-box',
          }}
        >
          <div style={{ display: 'inline-flex', background: 'rgba(22, 163, 74, 0.1)', padding: '1.5rem', borderRadius: '2rem', marginBottom: '1.5rem' }}>
            <ThumbsUp size={80} color="#16a34a" aria-hidden="true" />
          </div>
          
          <h1
            id="iamok-title"
            style={{ fontSize: '2.5rem', color: '#166534', margin: '0 0 1rem 0', fontWeight: 900 }}
          >
            Modo "Estou Bem"
          </h1>

          {sent ? (
            <div role="status" aria-live="polite" style={{ marginTop: '1.5rem' }}>
              <p style={{ fontSize: '1.6rem', color: '#15803d', fontWeight: 700 }}>
                Sinal enviado aos cuidadores com sucesso!
              </p>
              <div style={{ display: 'inline-flex', marginTop: '1.5rem', animation: 'bounce 2s infinite' }}>
                <Send size={48} color="#22c55e" aria-hidden="true" />
              </div>
            </div>
          ) : (
            <div style={{ marginTop: '1rem' }}>
              <p style={{ fontSize: '1.4rem', color: 'var(--color-text-base)', opacity: 0.9, fontWeight: 500 }}>
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

              <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
                <GazeButton
                  onClick={dispatchSignal}
                  disabled={sending}
                  style={{
                    width: '100%',
                    height: '76px',
                    background: '#16a34a',
                    border: 'none',
                    borderRadius: '1.25rem',
                    color: 'white',
                  }}
                >
                  <span style={{ fontSize: '1.4rem', fontWeight: 800 }}>
                    {sending ? 'Enviando…' : 'Enviar Agora'}
                  </span>
                </GazeButton>

                <GazeButton
                  onClick={() => window.history.back()}
                  style={{
                    width: '100%',
                    height: '76px',
                    background: 'rgba(239, 68, 68, 0.05)',
                    border: '2px solid rgba(239, 68, 68, 0.2)',
                    borderRadius: '1.25rem',
                    color: '#dc2626',
                  }}
                >
                  <span style={{ fontSize: '1.4rem', fontWeight: 800 }}>
                    Cancelar
                  </span>
                </GazeButton>
              </div>
            </div>
          )}
        </div>
      </div>
      <style>{`@keyframes bounce { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-10px); } }`}</style>
    </GazePageLayout>
  );
};
