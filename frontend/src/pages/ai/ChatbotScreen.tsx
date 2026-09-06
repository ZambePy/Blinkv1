import React, { useEffect, useRef, useState } from 'react';

import { Send, Bot, User } from 'lucide-react';
import { BackButton } from '../../components/ui/BackButton';
import { TTSButton } from '../../components/TTSButton';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { api, ApiError } from '../../utils/api';

type Message = { role: 'user' | 'bot'; text: string };

export const ChatbotScreen: React.FC = () => {
  const { currentProfile } = useAuth();
  const toast = useToast();
  const [inputText, setInputText] = useState('');
  const [messages, setMessages] = useState<Message[]>([
    { role: 'bot', text: 'Olá! Como posso te ajudar hoje?' },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isLoading]);

  const sendMessage = async () => {
    const text = inputText.trim();
    if (!text || isLoading) return;

    const nextMessages: Message[] = [...messages, { role: 'user', text }];
    setMessages(nextMessages);
    setInputText('');
    setIsLoading(true);

    try {
      const res = await api.chatbotMessage({ text, userId: currentProfile?.id });
      setMessages((prev) => [...prev, { role: 'bot', text: res.reply }]);
    } catch (err) {
      const msg =
        err instanceof ApiError
          ? `Erro ${err.status} ao contactar o assistente.`
          : 'Não foi possível contactar o assistente. Verifique a conexão.';
      toast.error(msg);
      setMessages((prev) => [
        ...prev,
        { role: 'bot', text: 'Desculpe, estou com dificuldade para responder agora.' },
      ]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main
      role="main"
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(160deg, #f8fafc 0%, #e2e8f0 100%)',
        display: 'flex',
        flexDirection: 'column',
        padding: '2rem',
        position: 'relative',
      }}
    >
      <div
        style={{
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          maxWidth: '800px',
          margin: '0 auto',
          width: '100%',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.5rem',
          }}
        >
          <BackButton />
          <div
            aria-label="Assistente Iris"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              background: 'var(--color-card-bg)',
              padding: '0.5rem 1rem',
              borderRadius: '1rem',
              boxShadow: '0 4px 12px rgba(0,0,0,0.05)',
            }}
          >
            <Bot color="#3b82f6" aria-hidden="true" />
            <span style={{ fontWeight: 600, color: '#1e293b' }}>Assistente Iris</span>
          </div>
        </div>

        <div
          ref={listRef}
          role="log"
          aria-live="polite"
          aria-label="Conversa com o assistente"
          style={{
            flex: 1,
            background: 'rgba(255,255,255,0.85)',
            backdropFilter: 'blur(12px)',
            borderRadius: '1.5rem',
            padding: '1.5rem',
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            boxShadow: '0 8px 32px rgba(0,0,0,0.05)',
            marginBottom: '1rem',
          }}
        >
          {messages.map((msg, idx) => (
            <div
              key={idx}
              style={{
                display: 'flex',
                flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                alignItems: 'flex-end',
                gap: '0.5rem',
              }}
            >
              <div
                aria-hidden="true"
                style={{
                  background: msg.role === 'user' ? '#3b82f6' : '#e2e8f0',
                  padding: '0.5rem',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                {msg.role === 'user' ? (
                  <User size={20} color="white" />
                ) : (
                  <Bot size={20} color="#475569" />
                )}
              </div>
              <div
                style={{
                  background: msg.role === 'user' ? '#3b82f6' : 'white',
                  color: msg.role === 'user' ? 'white' : '#1e293b',
                  padding: '1rem',
                  borderRadius: '1rem',
                  borderBottomRightRadius: msg.role === 'user' ? 0 : '1rem',
                  borderBottomLeftRadius: msg.role === 'bot' ? 0 : '1rem',
                  maxWidth: '70%',
                  boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
                }}
              >
                <span style={{ display: 'block' }}>
                  <span className="sr-only">{msg.role === 'user' ? 'Você: ' : 'Assistente: '}</span>
                  {msg.text}
                </span>
              </div>
            </div>
          ))}
          {isLoading && (
            <div
              role="status"
              style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', color: 'var(--color-text-base)', opacity: 0.9 }}
            >
              <Bot size={20} aria-hidden="true" /> Digitando…
            </div>
          )}
        </div>

        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <label htmlFor="chatbot-input" className="sr-only">
            Digite sua mensagem
          </label>
          <input
            id="chatbot-input"
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && sendMessage()}
            placeholder="Digite sua mensagem..."
            aria-label="Mensagem para o assistente"
            style={{
              flex: 1,
              padding: '1.25rem',
              borderRadius: '1.5rem',
              border: '2px solid transparent',
              background: 'var(--color-card-bg)',
              fontSize: '1.1rem',
              outline: 'none',
              boxShadow: '0 4px 16px rgba(0,0,0,0.05)',
            }}
          />
          <button
            onClick={sendMessage}
            aria-label="Enviar mensagem"
            disabled={isLoading || !inputText.trim()}
            style={{
              background: '#3b82f6',
              border: 'none',
              padding: '1.25rem',
              borderRadius: '1.5rem',
              color: 'white',
              cursor: isLoading ? 'not-allowed' : 'pointer',
              opacity: isLoading || !inputText.trim() ? 0.5 : 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              boxShadow: '0 4px 16px rgba(59, 130, 246, 0.3)',
            }}
          >
            <Send size={24} aria-hidden="true" />
          </button>
          <TTSButton text={messages[messages.length - 1]?.text || ''} />
        </div>
      </div>
    </main>
  );
};
