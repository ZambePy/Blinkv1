import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Keyboard, Monitor, Settings, Heart, LogOut } from 'lucide-react';
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
    icon: <MessageSquare size={56} />,
    color: '#1B54A8', // Azul principal
    route: '/phrases',
    description: 'Frases rápidas e pictogramas',
  },
  {
    id: 'keyboard',
    title: 'Teclado Virtual',
    icon: <Keyboard size={56} />,
    color: '#16a34a', // Verde
    route: '/keyboard',
    description: 'Digite livremente',
  },
  {
    id: 'computer',
    title: 'Computador',
    icon: <Monitor size={56} />,
    color: '#8b5cf6', // Roxo
    route: '/virtual-mouse',
    description: 'Mouse virtual e sistema',
  },
  {
    id: 'settings',
    title: 'Configurações',
    icon: <Settings size={56} />,
    color: '#f59e0b', // Laranja
    route: '/settings',
    description: 'Ajustes e calibração',
  },
  {
    id: 'leisure',
    title: 'Ajuda e Lazer',
    icon: <Heart size={56} />,
    color: '#e11d48', // Vermelho/Rosa
    route: '/games',
    description: 'Jogos e relaxamento',
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
        <div style={{ marginBottom: '2.5rem', textAlign: 'center' }}>
          <h1 
            style={{ 
              fontSize: '2.75rem', 
              fontWeight: 800, 
              color: 'var(--color-text-base)', 
              margin: '0 0 0.5rem 0', 
              letterSpacing: '-0.02em',
              fontFamily: "'Inter', sans-serif"
            }}
          >
            Menu Principal
          </h1>
          <p 
            style={{ 
              fontSize: '1.25rem', 
              color: 'var(--color-text-base)', 
              opacity: 0.7,
              margin: 0, 
              fontWeight: 500,
              fontFamily: "'Inter', sans-serif"
            }}
          >
            Olhe para o botão desejado para selecioná-lo.
          </p>
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          <GazeGrid columns={3} rows={2}>
            {MODULES.map((module) => (
              <GazeButton
                key={module.id}
                onClick={() => navigate(module.route)}
                style={{ height: '100%', borderRadius: '2rem' }}
              >
                <div 
                  style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    textAlign: 'center', 
                    padding: '1rem',
                    width: '100%'
                  }}
                >
                  <div style={{ color: module.color, marginBottom: '0.75rem' }}>
                    {module.icon}
                  </div>
                  <div style={{ fontSize: '1.8rem', fontWeight: 800, color: 'var(--color-text-base)' }}>
                    {module.title}
                  </div>
                  <div style={{ fontSize: '1.1rem', opacity: 0.7, marginTop: '0.5rem', fontWeight: 500, color: 'var(--color-text-base)' }}>
                    {module.description}
                  </div>
                </div>
              </GazeButton>
            ))}

            {/* Sexto alvo: Sair */}
            <GazeButton
              onClick={() => navigate('/login')}
              style={{
                height: '100%',
                borderRadius: '2rem',
                border: '2px solid rgba(239, 68, 68, 0.3)',
                background: 'rgba(239, 68, 68, 0.05)',
              }}
            >
              <div 
                style={{ 
                  display: 'flex', 
                  flexDirection: 'column', 
                  alignItems: 'center', 
                  justifyContent: 'center', 
                  textAlign: 'center', 
                  padding: '1rem',
                  width: '100%'
                }}
              >
                <div style={{ color: '#ef4444', marginBottom: '0.75rem' }}>
                  <LogOut size={56} />
                </div>
                <div style={{ fontSize: '1.8rem', fontWeight: 800, color: '#ef4444' }}>
                  Sair
                </div>
                <div style={{ fontSize: '1.1rem', opacity: 0.7, marginTop: '0.5rem', fontWeight: 500, color: '#ef4444' }}>
                  Encerrar sessão de comunicação
                </div>
              </div>
            </GazeButton>
          </GazeGrid>
        </div>
      </div>
    </GazePageLayout>
  );
};
