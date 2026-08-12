import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Keyboard, Monitor, Settings, Heart, LogOut } from 'lucide-react';

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
    description: 'Voz, frases rápidas e pictogramas',
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
    description: 'Velocidade e sensibilidade',
  },
  {
    id: 'leisure',
    title: 'Ajuda e Lazer',
    icon: <Heart size={64} />,
    color: '#e11d48', // Vermelho/Rosa
    route: '/games',
    description: 'Jogos e relaxamento',
  },
];

export const MainMenu: React.FC = () => {
  const navigate = useNavigate();

  return (
    <>
      <main
        style={{
          width: '100vw',
          height: '100vh',
          background: '#f8fafc',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '3rem',
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
          overflow: 'hidden',
          position: 'relative',
        }}
      >
        <div 
          className="animate-fade-in-up" 
          style={{ 
            width: '100%', 
            maxWidth: '1200px', 
            display: 'flex', 
            flexDirection: 'column',
            gap: '3rem',
            zIndex: 10,
          }}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', padding: '0 1rem' }}>
            <div>
              <h1 style={{ fontSize: '3rem', fontWeight: 800, color: '#0f172a', margin: '0 0 0.5rem 0', letterSpacing: '-0.02em' }}>
                O que você deseja fazer?
              </h1>
              <p style={{ fontSize: '1.4rem', color: '#64748b', margin: 0, fontWeight: 500 }}>
                Olhe para o bloco desejado para selecioná-lo.
              </p>
            </div>
            
            <button
              onClick={() => navigate('/login')}
              style={{
                background: 'white',
                border: '2px solid #e2e8f0',
                borderRadius: '1.5rem',
                padding: '1rem 1.5rem',
                display: 'flex',
                alignItems: 'center',
                gap: '0.75rem',
                color: '#64748b',
                fontWeight: 700,
                fontSize: '1.1rem',
                cursor: 'pointer',
                transition: 'all 0.2s'
              }}
              onMouseOver={(e) => {
                e.currentTarget.style.color = '#ef4444';
                e.currentTarget.style.borderColor = '#fecaca';
                e.currentTarget.style.background = '#fef2f2';
              }}
              onMouseOut={(e) => {
                e.currentTarget.style.color = '#64748b';
                e.currentTarget.style.borderColor = '#e2e8f0';
                e.currentTarget.style.background = 'white';
              }}
            >
              <LogOut size={24} /> Sair
            </button>
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
              gap: '2rem',
              width: '100%',
            }}
          >
            {MODULES.map((module, idx) => (
              <button
                key={module.id}
                onClick={() => navigate(module.route)}
                className="animate-fade-in-up"
                style={{
                  animationDelay: `${idx * 0.1}s`,
                  background: 'white',
                  borderRadius: '2.5rem',
                  padding: '2.5rem 2rem',
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  gap: '1.5rem',
                  border: 'none',
                  boxShadow: '0 10px 30px rgba(0,0,0,0.04)',
                  cursor: 'pointer',
                  textAlign: 'left',
                  transition: 'transform 0.2s cubic-bezier(0.16, 1, 0.3, 1), box-shadow 0.2s',
                  position: 'relative',
                  overflow: 'hidden',
                }}
              >
                <div style={{
                  background: `${module.color}15`,
                  color: module.color,
                  padding: '1.25rem',
                  borderRadius: '1.5rem',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}>
                  {module.icon}
                </div>
                
                <div>
                  <h2 style={{ fontSize: '2.2rem', fontWeight: 800, color: '#0f172a', margin: '0 0 0.5rem 0' }}>
                    {module.title}
                  </h2>
                  <p style={{ fontSize: '1.25rem', color: '#64748b', margin: 0, fontWeight: 500 }}>
                    {module.description}
                  </p>
                </div>
              </button>
            ))}
          </div>
        </div>
        
        {/* Decorative background elements */}
        <div style={{ position: 'absolute', top: '-10%', right: '-5%', width: '600px', height: '600px', background: 'radial-gradient(circle, rgba(27, 84, 168, 0.03) 0%, rgba(255,255,255,0) 70%)', borderRadius: '50%', pointerEvents: 'none', zIndex: 0 }} />
        <div style={{ position: 'absolute', bottom: '-20%', left: '-10%', width: '800px', height: '800px', background: 'radial-gradient(circle, rgba(22, 163, 74, 0.03) 0%, rgba(255,255,255,0) 70%)', borderRadius: '50%', pointerEvents: 'none', zIndex: 0 }} />
      </main>
    </>
  );
};
