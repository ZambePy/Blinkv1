import React, { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ThumbsUp, Send, Check, TriangleAlert, RotateCcw, X } from 'lucide-react';
import { api } from '../../utils/api';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { GazePageLayout } from '../../components/ui/GazePageLayout';
import { GazeButton } from '../../components/ui/GazeButton';

/** Segundos até o sinal sair sozinho, se o paciente não fizer nada. */
const CONTAGEM_S = 30;

type Resultado = 'ok' | 'falha' | null;

/**
 * Sinal "Estou bem": envia um aviso ao serviço configurado. Se o envio falhar,
 * a tela diz que falhou e oferece tentar de novo, em vez de fingir sucesso.
 */
export const IAmOkScreen: React.FC = () => {
  const navigate = useNavigate();
  const { currentProfile } = useAuth();
  const toast = useToast();
  const [timeLeft, setTimeLeft] = useState(CONTAGEM_S);
  const [sending, setSending] = useState(false);
  const [resultado, setResultado] = useState<Resultado>(null);

  const enviar = useCallback(async () => {
    if (sending) return;
    setSending(true);
    try {
      await api.sendIAmOk(currentProfile?.id ?? 'anon');
      setResultado('ok');
      toast.success('Sinal "Estou bem" enviado.');
    } catch (err) {
      console.warn('Falha ao enviar sinal "Estou bem":', err);
      setResultado('falha');
      toast.error('Não foi possível enviar o sinal.');
    } finally {
      setSending(false);
    }
  }, [sending, currentProfile, toast]);

  // Contagem regressiva: para assim que houver um resultado (ou um envio em curso).
  useEffect(() => {
    if (resultado !== null || sending) return;
    if (timeLeft <= 0) {
      void enviar();
      return;
    }
    const timer = setTimeout(() => setTimeLeft((t) => t - 1), 1000);
    return () => clearTimeout(timer);
  }, [timeLeft, resultado, sending, enviar]);

  const tentarDeNovo = () => {
    setResultado(null);
    setTimeLeft(CONTAGEM_S);
  };

  return (
    <GazePageLayout backRoute="/menu" title="Estou bem">
      <h1 className="sr-only">Sinal "Estou bem"</h1>
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '2rem',
          textAlign: 'center',
        }}
      >
        {resultado === 'ok' && (
          <div role="status" aria-live="polite" data-no-dwell="true" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
            <Check size={96} color="var(--ok)" aria-hidden="true" />
            <p style={{ fontSize: 'var(--fs-32)', fontWeight: 800, color: 'var(--ok)' }}>Sinal enviado</p>
            <p style={{ fontSize: 'var(--fs-20)', color: 'var(--text-2)' }}>
              Avisamos que você está bem.
            </p>
          </div>
        )}

        {resultado === 'falha' && (
          <div role="alert" data-no-dwell="true" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1rem' }}>
            <TriangleAlert size={96} color="var(--danger)" aria-hidden="true" />
            <p style={{ fontSize: 'var(--fs-32)', fontWeight: 800, color: 'var(--danger)' }}>Não foi possível enviar</p>
            <p style={{ fontSize: 'var(--fs-20)', color: 'var(--text-2)' }}>
              O aparelho não conseguiu falar com o serviço. Peça ajuda ou tente de novo.
            </p>
          </div>
        )}

        {resultado === null && (
          <div data-no-dwell="true" style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.75rem' }}>
            <ThumbsUp size={80} color="var(--ok)" aria-hidden="true" />
            <p style={{ fontSize: 'var(--fs-24)', color: 'var(--text-2)' }}>
              {sending ? 'Enviando o sinal...' : 'O sinal "Estou bem" será enviado em'}
            </p>
            {!sending && (
              <div
                role="timer"
                aria-live="polite"
                aria-atomic="true"
                style={{ fontSize: 'var(--fs-56)', fontWeight: 900, color: 'var(--ok)', lineHeight: 1.1 }}
              >
                {timeLeft} s
              </div>
            )}
          </div>
        )}

        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', justifyContent: 'center' }}>
          {resultado === null && (
            <>
              <GazeButton
                onClick={() => void enviar()}
                disabled={sending}
                size="xl"
                variant="primary"
                icon={<Send />}
                label="Enviar agora"
                aria-label="Enviar o sinal Estou bem agora"
              />
              <GazeButton
                onClick={() => navigate(-1)}
                disabled={sending}
                size="xl"
                variant="secondary"
                icon={<X color="var(--danger)" />}
                label="Cancelar"
                aria-label="Cancelar e voltar"
              />
            </>
          )}
          {resultado === 'falha' && (
            <GazeButton
              onClick={tentarDeNovo}
              size="xl"
              variant="primary"
              icon={<RotateCcw />}
              label="Tentar de novo"
            />
          )}
          {resultado !== null && (
            <GazeButton
              onClick={() => navigate('/menu')}
              size="xl"
              variant="secondary"
              label="Voltar ao menu"
            />
          )}
        </div>
      </div>
    </GazePageLayout>
  );
};
