import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, MessageSquare, AlertCircle, Tv, Wind, Activity } from 'lucide-react';

const PHRASES = [
  {
    id: 1,
    text: 'Gostaria de conversar',
    Icon: MessageSquare,
    iconColor: '#0d9488',
    bg: 'linear-gradient(135deg, #ccfbf1, #f0fdfa)',
  },
  {
    id: 2,
    text: 'Pode abrir a janela?',
    Icon: Wind,
    iconColor: '#0284c7',
    bg: 'linear-gradient(135deg, #bae6fd, #f0f9ff)',
  },
  {
    id: 3,
    text: 'Quero descansar agora',
    Icon: Activity,
    iconColor: '#7c3aed',
    bg: 'linear-gradient(135deg, #ede9fe, #f5f3ff)',
  },
  {
    id: 4,
    text: 'Pode mudar de posição?',
    Icon: AlertCircle,
    iconColor: '#d97706',
    bg: 'linear-gradient(135deg, #fef3c7, #fffbeb)',
  },
  {
    id: 5,
    text: 'Pode ligar a televisão?',
    Icon: Tv,
    iconColor: '#4f46e5',
    bg: 'linear-gradient(135deg, #e0e7ff, #eef2ff)',
  },
  {
    id: 6,
    text: 'Preciso de um cobertor',
    Icon: Wind,
    iconColor: '#0891b2',
    bg: 'linear-gradient(135deg, #cffafe, #ecfeff)',
  },
  {
    id: 7,
    text: 'Quero ouvir música',
    Icon: MessageSquare,
    iconColor: '#db2777',
    bg: 'linear-gradient(135deg, #fce7f3, #fdf2f8)',
  },
  {
    id: 8,
    text: 'Preciso que alguém fique aqui',
    Icon: AlertCircle,
    iconColor: '#16a34a',
    bg: 'linear-gradient(135deg, #dcfce7, #f0fdf4)',
  },
];

export const QuickPhrasesScreen: React.FC = () => {
  const navigate = useNavigate();

  const handleSpeak = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'pt-BR';
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  };

  return (
    <main
      role="main"
      aria-labelledby="phrases-title"
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(160deg, #f0f4ff 0%, #e8f0fb 40%, #f1f5f9 100%)',
        display: 'flex',
        flexDirection: 'column',
        padding: '2rem',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        aria-hidden="true"
        className="bg-orb animate-float"
        style={{
          width: 450,
          height: 450,
          background: 'radial-gradient(circle, rgba(13,148,136,0.15), transparent)',
          top: '-10%',
          right: '-5%',
        }}
      />

      <div
        className="glass"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '1rem',
          padding: '1.25rem 2rem',
          borderRadius: '1.5rem',
          marginBottom: '2rem',
          zIndex: 10,
        }}
      >
        <MessageSquare size={28} color="#0d9488" aria-hidden="true" />
        <h1
          id="phrases-title"
          style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1e293b', margin: 0 }}
        >
          Frases rápidas
        </h1>
        <span style={{ color: '#94a3b8', margin: '0 0.5rem' }} aria-hidden="true">
          /
        </span>
        <span
          style={{ fontSize: '1.25rem', color: '#475569', fontFamily: 'system-ui, sans-serif' }}
        >
          Escolha uma frase
        </span>
      </div>

      <div
        role="group"
        aria-label="Lista de frases rápidas"
        className="animate-fade-in-up"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '1.5rem',
          flex: 1,
          maxWidth: '1200px',
          margin: '0 auto',
          width: '100%',
          zIndex: 10,
        }}
      >
        <button
          type="button"
          onClick={() => navigate('/menu')}
          className="action-card glass"
          aria-label="Voltar ao menu principal"
          style={{ border: '2px solid rgba(255,255,255,0.7)' }}
        >
          <div
            className="card-icon"
            aria-hidden="true"
            style={{
              background: 'linear-gradient(135deg, #e2e8f0, #f8fafc)',
              boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
            }}
          >
            <ArrowLeft size={56} color="#334155" strokeWidth={2} />
          </div>
          <span style={{ fontSize: '1.5rem', fontWeight: 700, color: '#1e293b' }}>Voltar</span>
        </button>

        {PHRASES.map(({ id, text, Icon, iconColor, bg }) => (
          <button
            key={id}
            type="button"
            onClick={() => handleSpeak(text)}
            aria-label={`Falar a frase: ${text}`}
            className="action-card glass"
            style={{ border: '2px solid rgba(255,255,255,0.7)' }}
          >
            <div
              className="card-icon"
              aria-hidden="true"
              style={{ background: bg, boxShadow: `0 8px 24px ${iconColor}33` }}
            >
              <Icon size={56} color={iconColor} strokeWidth={1.5} />
            </div>
            <span
              style={{
                fontSize: '1.25rem',
                fontWeight: 700,
                color: '#1e293b',
                textAlign: 'center',
                lineHeight: 1.3,
              }}
            >
              {text}
            </span>
          </button>
        ))}
      </div>
    </main>
  );
};
