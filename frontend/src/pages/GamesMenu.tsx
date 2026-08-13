import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Target, Sparkles } from 'lucide-react';

interface GameCard {
  route: string;
  title: string;
  subtitle: string;
  icon: React.ReactNode;
  gradient: string;
  shadow: string;
}

const GAMES: GameCard[] = [
  {
    route: '/games/bubble',
    title: 'Estoura Bolhas',
    subtitle: 'Treino de fixação ocular',
    icon: <Sparkles size={56} color="white" aria-hidden="true" />,
    gradient: 'linear-gradient(135deg, rgba(79,70,229,0.85), rgba(109,40,217,0.85))',
    shadow: 'rgba(79,70,229,0.4)',
  },
  {
    route: '/games/memory',
    title: 'Jogo da Memória',
    subtitle: 'Treino cognitivo',
    icon: (
      <span style={{ fontSize: '2rem' }} aria-hidden="true">
        🧠
      </span>
    ),
    gradient: 'linear-gradient(135deg, rgba(34,197,94,0.85), rgba(21,128,61,0.85))',
    shadow: 'rgba(34,197,94,0.4)',
  },
  {
    route: '/games/follow',
    title: 'Siga o Alvo',
    subtitle: 'Velocidade do olhar',
    icon: <Target size={56} color="white" aria-hidden="true" />,
    gradient: 'linear-gradient(135deg, rgba(239,68,68,0.85), rgba(185,28,28,0.85))',
    shadow: 'rgba(239,68,68,0.4)',
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
        background: 'var(--color-bg-base)',
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
          width: 400,
          height: 400,
          background: 'radial-gradient(circle, rgba(79,70,229,0.2), transparent)',
          top: '-10%',
          right: '-5%',
        }}
      />

      <div
        className="glass animate-fade-in"
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '1.25rem 2rem',
          borderRadius: '1.5rem',
          marginBottom: '2rem',
          gap: '1rem',
          zIndex: 10,
        }}
      >
        <Target size={32} color="#4f46e5" aria-hidden="true" />
        <h1
          id="games-title"
          style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-text-base)', margin: 0 }}
        >
          Mini-Jogos com Eye Tracking
        </h1>
      </div>

      <ul
        aria-label="Jogos disponíveis"
        className="animate-fade-in-up"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))',
          gap: '1.5rem',
          maxWidth: 900,
          margin: '0 auto',
          width: '100%',
          zIndex: 10,
          listStyle: 'none',
          padding: 0,
        }}
      >
        <li>
          <button
            type="button"
            onClick={() => navigate('/menu')}
            aria-label="Voltar ao menu principal"
            className="action-card glass"
            style={{ border: '2px solid var(--color-card-border)', width: '100%', background: 'var(--color-card-bg)' }}
          >
            <div
              className="card-icon"
              aria-hidden="true"
              style={{
                background: 'var(--color-bg-base)',
                boxShadow: '0 8px 24px var(--color-card-shadow)',
              }}
            >
              <ArrowLeft size={56} color="var(--color-text-base)" strokeWidth={2} />
            </div>
            <span style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--color-text-base)' }}>Voltar</span>
          </button>
        </li>

        {GAMES.map((game) => (
          <li key={game.route}>
            <button
              type="button"
              onClick={() => navigate(game.route)}
              aria-label={`Iniciar ${game.title} — ${game.subtitle}`}
              className="action-card"
              style={{
                background: game.gradient,
                backdropFilter: 'blur(16px)',
                border: '2px solid rgba(255,255,255,0.4)',
                width: '100%',
              }}
            >
              <div
                className="card-icon"
                aria-hidden="true"
                style={{
                  background: 'rgba(255,255,255,0.2)',
                  boxShadow: `0 8px 24px ${game.shadow}`,
                  border: '3px solid rgba(255,255,255,0.3)',
                }}
              >
                {game.icon}
              </div>
              <span
                style={{
                  fontSize: '1.25rem',
                  fontWeight: 700,
                  color: 'white',
                  textAlign: 'center',
                }}
              >
                {game.title}
              </span>
              <span
                style={{
                  fontSize: '0.85rem',
                  color: 'rgba(255,255,255,0.95)',
                  fontFamily: 'system-ui, sans-serif',
                  textAlign: 'center',
                }}
              >
                {game.subtitle}
              </span>
            </button>
          </li>
        ))}
      </ul>
    </main>
  );
};
