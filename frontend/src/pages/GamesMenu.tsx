import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Target, Sparkles, Camera, Image as ImageIcon, Palette, Heart } from 'lucide-react';
import { GazeButton } from '../components/ui/GazeButton';

interface ActivityCard {
  route: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  gradient: string;
  shadow: string;
  badge?: string;
}

const ACTIVITIES: ActivityCard[] = [
  {
    route: '/photo',
    title: 'Tirar Foto',
    subtitle: 'Câmera divertida e memórias',
    icon: <Camera size={64} color="white" aria-hidden="true" />,
    gradient: 'linear-gradient(135deg, rgba(14, 165, 233, 0.9), rgba(37, 99, 235, 0.9))',
    shadow: 'rgba(14, 165, 233, 0.45)',
    badge: 'Novo ✨',
  },
  {
    route: '/gallery',
    title: 'Galeria de Fotos',
    subtitle: 'Álbum e recordações salvas',
    icon: <ImageIcon size={64} color="white" aria-hidden="true" />,
    gradient: 'linear-gradient(135deg, rgba(147, 51, 234, 0.9), rgba(109, 40, 217, 0.9))',
    shadow: 'rgba(147, 51, 234, 0.45)',
  },
  {
    route: '/games/bubble',
    title: 'Estoura Bolhas',
    subtitle: 'Treino de fixação ocular',
    icon: <Sparkles size={64} color="white" aria-hidden="true" />,
    gradient: 'linear-gradient(135deg, rgba(99, 102, 241, 0.9), rgba(79, 70, 229, 0.9))',
    shadow: 'rgba(99, 102, 241, 0.45)',
  },
  {
    route: '/games/memory',
    title: 'Jogo da Memória',
    subtitle: 'Treino cognitivo e atenção',
    icon: (
      <span style={{ fontSize: '3.5rem' }} aria-hidden="true">
        🧠
      </span>
    ),
    gradient: 'linear-gradient(135deg, rgba(34, 197, 94, 0.9), rgba(21, 128, 61, 0.9))',
    shadow: 'rgba(34, 197, 94, 0.45)',
  },
  {
    route: '/games/follow',
    title: 'Siga o Alvo',
    subtitle: 'Velocidade e rastreamento',
    icon: <Target size={64} color="white" aria-hidden="true" />,
    gradient: 'linear-gradient(135deg, rgba(239, 68, 68, 0.9), rgba(185, 28, 28, 0.9))',
    shadow: 'rgba(239, 68, 68, 0.45)',
  },
  {
    route: '/drawing',
    title: 'Desenho com Olhar',
    subtitle: 'Expressão artística livre',
    icon: <Palette size={64} color="white" aria-hidden="true" />,
    gradient: 'linear-gradient(135deg, rgba(245, 158, 11, 0.9), rgba(217, 119, 6, 0.9))',
    shadow: 'rgba(245, 158, 11, 0.45)',
  },
];

export const GamesMenu: React.FC = () => {
  const navigate = useNavigate();

  return (
    <main
      role="main"
      aria-labelledby="games-title"
      style={{
        minHeight: '100vh',
        width: '100vw',
        background: 'var(--color-bg-base)',
        display: 'flex',
        flexDirection: 'column',
        padding: '2rem 3rem',
        boxSizing: 'border-box',
        position: 'relative',
        overflowX: 'hidden',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* Luz ambiente decorativa */}
      <div
        aria-hidden="true"
        className="bg-orb animate-float"
        style={{
          width: 500,
          height: 500,
          background: 'radial-gradient(circle, rgba(37, 99, 235, 0.2), transparent)',
          top: '-10%',
          right: '-5%',
        }}
      />
      <div
        aria-hidden="true"
        className="bg-orb animate-float"
        style={{
          width: 450,
          height: 450,
          background: 'radial-gradient(circle, rgba(147, 51, 234, 0.15), transparent)',
          bottom: '-10%',
          left: '-5%',
          animationDelay: '-3s',
        }}
      />

      {/* Barra Superior / Header com Botão Voltar Ampliado */}
      <header
        className="animate-fade-in"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '2rem',
          zIndex: 10,
          width: '100%',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: '1.5rem' }}>
          <GazeButton
            onClick={() => navigate('/menu')}
            width={220}
            height={72}
            style={{
              borderRadius: '1.75rem',
              border: '2px solid var(--color-card-border)',
              background: 'var(--color-card-bg)',
              boxShadow: '0 8px 24px var(--color-card-shadow)',
            }}
            aria-label="Voltar ao menu principal"
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem', fontSize: '1.4rem', fontWeight: 800 }}>
              <ArrowLeft size={30} />
              <span>Voltar</span>
            </div>
          </GazeButton>

          <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '1.25rem',
                background: 'linear-gradient(135deg, #e11d48, #be123c)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                color: 'white',
                boxShadow: '0 8px 20px rgba(225, 29, 72, 0.35)',
              }}
            >
              <Heart size={32} />
            </div>
            <div>
              <h1
                id="games-title"
                style={{
                  fontSize: '2.25rem',
                  fontWeight: 900,
                  color: 'var(--color-text-base)',
                  margin: 0,
                  letterSpacing: '-0.02em',
                }}
              >
                Ajuda e Lazer
              </h1>
              <p
                style={{
                  fontSize: '1.15rem',
                  color: 'var(--color-text-base)',
                  opacity: 0.75,
                  margin: '0.2rem 0 0 0',
                  fontWeight: 500,
                }}
              >
                Escolha uma atividade ou tire uma foto com seu olhar
              </p>
            </div>
          </div>
        </div>
      </header>

      {/* Grade Ampliada de Atividades e Jogos (Layout Grande e Confortável) */}
      <div
        style={{
          flex: 1,
          width: '100%',
          maxWidth: '1600px',
          margin: '0 auto',
          zIndex: 10,
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
        }}
      >
        <ul
          aria-label="Opções de Ajuda e Lazer"
          className="animate-fade-in-up"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))',
            gap: '2rem',
            width: '100%',
            listStyle: 'none',
            padding: 0,
            margin: 0,
          }}
        >
          {ACTIVITIES.map((activity) => (
            <li key={activity.route} style={{ display: 'flex' }}>
              <button
                type="button"
                onClick={() => navigate(activity.route)}
                aria-label={`Abrir ${activity.title} — ${activity.subtitle}`}
                className="action-card"
                style={{
                  background: activity.gradient,
                  backdropFilter: 'blur(20px)',
                  border: '3px solid rgba(255, 255, 255, 0.35)',
                  borderRadius: '2.5rem',
                  width: '100%',
                  minHeight: '280px',
                  padding: '2.25rem 2rem',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '1.25rem',
                  boxShadow: `0 16px 36px -8px ${activity.shadow}`,
                  position: 'relative',
                  overflow: 'hidden',
                  cursor: 'pointer',
                }}
              >
                {/* Badge opcional */}
                {activity.badge && (
                  <div
                    style={{
                      position: 'absolute',
                      top: '1.25rem',
                      right: '1.25rem',
                      background: 'rgba(255, 255, 255, 0.3)',
                      backdropFilter: 'blur(10px)',
                      color: '#ffffff',
                      padding: '0.35rem 0.9rem',
                      borderRadius: '999px',
                      fontSize: '0.95rem',
                      fontWeight: 800,
                      border: '1px solid rgba(255, 255, 255, 0.4)',
                    }}
                  >
                    {activity.badge}
                  </div>
                )}

                {/* Ícone Gigante */}
                <div
                  className="card-icon"
                  aria-hidden="true"
                  style={{
                    width: '6.5rem',
                    height: '6.5rem',
                    borderRadius: '1.75rem',
                    background: 'rgba(255, 255, 255, 0.22)',
                    boxShadow: `0 10px 28px ${activity.shadow}`,
                    border: '3px solid rgba(255, 255, 255, 0.45)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {activity.icon}
                </div>

                {/* Títulos e Subtítulos em Tamanho Grande */}
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    textAlign: 'center',
                    gap: '0.35rem',
                  }}
                >
                  <span
                    style={{
                      fontSize: '1.75rem',
                      fontWeight: 900,
                      color: '#ffffff',
                      letterSpacing: '-0.01em',
                      textShadow: '0 2px 10px rgba(0,0,0,0.2)',
                    }}
                  >
                    {activity.title}
                  </span>
                  <span
                    style={{
                      fontSize: '1.15rem',
                      color: 'rgba(255, 255, 255, 0.92)',
                      fontWeight: 600,
                      maxWidth: '300px',
                    }}
                  >
                    {activity.subtitle}
                  </span>
                </div>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
};
