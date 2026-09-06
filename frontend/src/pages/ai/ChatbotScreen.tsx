import React, { useEffect, useRef, useState } from 'react';
import { Send, Bot, User, Volume2 } from 'lucide-react';
import { GazePageLayout } from '../../components/ui/GazePageLayout';
import { GazeButton } from '../../components/ui/GazeButton';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { api, ApiError } from '../../utils/api';
import { speak, stopSpeaking } from '../../utils/speech';

type Message = { role: 'user' | 'bot'; text: string };

/**
 * Assistente por texto. A digitação é do cuidador (mouse e teclado); o
 * paciente pode ouvir a última resposta olhando para "Ouvir resposta".
 */
export const ChatbotScreen: React.FC = () => {
  const { currentProfile } = useAuth();
  const toast = useToast();
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'bot', text: 'Olá! Como posso te ajudar hoje?' },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [lendo, setLendo] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading]);

  useEffect(() => () => stopSpeaking(), []);

  const sendMessage = async () => {
    const text = inputText.trim();
    if (!text || isLoading) return;

    setMessages((prev) => [...prev, { role: 'user', text }]);
    setInputText('');
    setIsLoading(true);

    try {
      const res = await api.chatbotMessage({ text, userId: currentProfile?.id });
      setMessages((prev) => [...prev, { role: 'bot', text: res.reply }]);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `Erro ${err.status} ao falar com o assistente.`
          : 'Não foi possível falar com o assistente. Verifique a conexão.';
      toast.error(msg);
      setMessages((prev) => [
        ...prev,
        { role: 'bot', text: 'Desculpe, estou com dificuldade para responder agora.' },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  const ultimaResposta = [...messages].reverse().find((m) => m.role === 'bot')?.text ?? '';

  const ouvir = () => {
    setLendo(true);
    if (!speak(ultimaResposta, { onEnd: () => setLendo(false) })) setLendo(false);
  };

  return (
    <GazePageLayout backRoute="/menu" title="Assistente">
      <h1 className="sr-only">Assistente Iris</h1>
      <div style={{ display: 'flex', gap: 24, height: '100%', minHeight: 0 }}>
        {/* Conversa + entrada (cuidador). Nada aqui é alvo de olhar. */}
        <div
          data-no-dwell="true"
          style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: '1rem', minHeight: 0 }}
        >
          <div
            ref={listRef}
            role="log"
            aria-live="polite"
            aria-label="Conversa com o assistente"
            style={{
              flex: 1,
              minHeight: 0,
              overflowY: 'auto',
              padding: '1.25rem',
              borderRadius: 'var(--r-lg)',
              border: '2px solid var(--border)',
              background: 'var(--surface)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.9rem',
            }}
          >
            {messages.map((msg, idx) => {
              const doUsuario = msg.role === 'user';
              return (
                <div
                  key={idx}
                  style={{
                    display: 'flex',
                    flexDirection: doUsuario ? 'row-reverse' : 'row',
                    alignItems: 'flex-end',
                    gap: '0.6rem',
                  }}
                >
                  <div
                    aria-hidden="true"
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: '50%',
                      flexShrink: 0,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      background: doUsuario ? 'var(--primary)' : 'var(--surface-2)',
                      color: doUsuario ? 'var(--on-primary)' : 'var(--text-2)',
                    }}
                  >
                    {doUsuario ? <User size={20} /> : <Bot size={20} />}
                  </div>
                  <p
                    style={{
                      maxWidth: '70%',
                      padding: '0.9rem 1.1rem',
                      borderRadius: 'var(--r-md)',
                      background: doUsuario ? 'var(--primary)' : 'var(--surface-2)',
                      color: doUsuario ? 'var(--on-primary)' : 'var(--text)',
                      fontSize: 'var(--fs-20)',
                      lineHeight: 1.45,
                    }}
                  >
                    <span className="sr-only">{doUsuario ? 'Você: ' : 'Assistente: '}</span>
                    {msg.text}
                  </p>
                </div>
              );
            })}
            {isLoading && (
              <div
                role="status"
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--text-2)', fontSize: 'var(--fs-18)' }}
              >
                <Bot size={20} aria-hidden="true" /> Escrevendo...
              </div>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void sendMessage();
            }}
            style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}
          >
            <label htmlFor="chatbot-input" className="sr-only">
              Digite sua mensagem
            </label>
            <input
              id="chatbot-input"
              type="text"
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Digite sua mensagem (cuidador)"
              data-no-dwell="true"
              style={{
                flex: 1,
                minHeight: 52,
                padding: '0.75rem 1.1rem',
                borderRadius: 'var(--r-md)',
                border: '1px solid var(--border)',
                background: 'var(--surface)',
                color: 'var(--text)',
                fontSize: 'var(--fs-18)',
              }}
            />
            <button
              type="submit"
              className="btn btn--primary"
              aria-label="Enviar mensagem"
              disabled={isLoading || !inputText.trim()}
              data-no-dwell="true"
              style={{ minHeight: 52 }}
            >
              <Send size={20} aria-hidden="true" /> Enviar
            </button>
          </form>
        </div>

        {/* Alvo do paciente */}
        <GazeButton
          onClick={ouvir}
          disabled={!ultimaResposta}
          size="xl"
          stacked
          variant={lendo ? 'primary' : 'secondary'}
          icon={<Volume2 color={lendo ? 'var(--on-primary)' : 'var(--primary)'} />}
          label={lendo ? 'Lendo' : 'Ouvir\nresposta'}
          aria-label="Ouvir a última resposta do assistente"
          style={{ width: 240, alignSelf: 'center' }}
        />
      </div>
    </GazePageLayout>
  );
};
