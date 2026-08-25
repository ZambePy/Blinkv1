import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Keyboard, Monitor, Settings, Heart, Moon } from 'lucide-react';
import { GazePageLayout } from '../components/ui/GazePageLayout';
import { GazeGrid } from '../components/ui/GazeGrid';
import { GazeButton } from '../components/ui/GazeButton';

interface AppModule {
  id: string;
  title: string;
  icon: React.ReactNode;
  color: string;
  route: string;
  description: string;
}

const MODULES: AppModule[] = [
  {
    id: 'communication',
    title: 'Comunicação',
    icon: <MessageSquare size={64} />,
    color: '#1B54A8', // Azul principal
    route: '/phrases',
    description: 'Frases rápidas e pictogramas',
  },
  {
    id: 'keyboard',
    title: 'Teclado Virtual',
    icon: <Keyboard size={64} />,
    color: '#16a34a', // Verde
    route: '/keyboard',
    description: 'Digite livremente',
  },
  {
    id: 'computer',
    title: 'Computador',
    icon: <Monitor size={64} />,
    color: '#8b5cf6', // Roxo
    route: '/virtual-mouse',
    description: 'Mouse virtual e sistema',
  },
  {
    id: 'settings',
    title: 'Configurações',
    icon: <Settings size={64} />,
    color: '#f59e0b', // Laranja
    route: '/settings',
    description: 'Ajustes e calibração',
  },
  {
    id: 'leisure',
    title: 'Ajuda e Lazer',
    icon: <Heart size={64} />,
    color: '#e11d48', // Vermelho/Rosa
    route: '/games',
    description: 'Câmera, fotos e jogos',
  },
];

export const MainMenu: React.FC = () => {
  const navigate = useNavigate();

  return (
    <GazePageLayout showBack={false} showEmergency={true}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ marginBottom: '2rem', textAlign: 'center' }}>
          <h1
            style={{
              fontSize: '3rem',
              fontWeight: 900,
              color: 'var(--color-text-base)',
              margin: '0 0 0.5rem 0',
              letterSpacing: '-0.02em',
              fontFamily: "'Inter', sans-serif",
            }}
          >
            Menu Principal
          </h1>
          <p
            style={{
              fontSize: '1.35rem',
              color: 'var(--color-text-base)',
              opacity: 0.75,
              margin: 0,
              fontWeight: 500,
              fontFamily: "'Inter', sans-serif",
            }}
          >
            Olhe para o botão desejado para selecioná-lo.
          </p>
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          <GazeGrid columns={3} rows={2} gap={40}>
            {MODULES.map((module) => (
              <GazeButton
                key={module.id}
                onClick={() => navigate(module.route)}
                style={{
                  height: '100%',
                  borderRadius: '2.25rem',
                  boxShadow: '0 10px 30px var(--color-card-shadow)',
                  border: '2.5px solid var(--color-card-border)',
                }}
              >
                <div
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    textAlign: 'center',
                    padding: '1.5rem',
                    width: '100%',
                  }}
                >
                  <div
                    style={{
                      color: module.color,
                      marginBottom: '0.85rem',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {module.icon}
                  </div>
                  <div
                    style={{
                      fontSize: '2rem',
                      fontWeight: 800,
                      color: 'var(--color-text-base)',
                      letterSpacing: '-0.01em',
                    }}
                  >
                    {module.title}
                  </div>
                  <div
                    style={{
                      fontSize: '1.2rem',
                      opacity: 0.75,
                      marginTop: '0.5rem',
                      fontWeight: 600,
                      color: 'var(--color-text-base)',
                    }}
                  >
                    {module.description}
                  </div>
                </div>
              </GazeButton>
            ))}

            {/* Sexto alvo: Modo Descanso (B3-3) */}
            <GazeButton
              onClick={() => navigate('/rest')}
              style={{
                height: '100%',
                borderRadius: '2.25rem',
                border: '2.5px solid rgba(71, 85, 105, 0.3)',
                background: 'rgba(71, 85, 105, 0.05)',
                boxShadow: '0 10px 30px var(--color-card-shadow)',
              }}
            >
              <div
                style={{
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'center',
                  justifyContent: 'center',
                  textAlign: 'center',
                  padding: '1.5rem',
                  width: '100%',
                }}
              >
                <div
                  style={{
                    color: '#475569',
                    marginBottom: '0.85rem',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  <Moon size={64} />
                </div>
                <div
                  style={{
                    fontSize: '2rem',
                    fontWeight: 800,
                    color: 'var(--color-text-base)',
                    letterSpacing: '-0.01em',
                  }}
                >
                  Modo Descanso
                </div>
                <div
                  style={{
                    fontSize: '1.2rem',
                    opacity: 0.75,
                    marginTop: '0.5rem',
                    fontWeight: 600,
                    color: 'var(--color-text-base)',
                  }}
                >
                  Pausar tela e descansar olhar
                </div>
              </div>
            </GazeButton>
          </GazeGrid>
        </div>
      </div>
    </GazePageLayout>
  );
};
