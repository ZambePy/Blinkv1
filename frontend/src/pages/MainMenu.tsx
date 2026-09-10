import React from 'react';
import { useNavigate } from 'react-router-dom';
import {
  MessageSquare,
  Keyboard,
  Monitor,
  Settings,
  Gamepad2,
  MessageCircle,
  Moon,
  Mic,
  Accessibility,
} from 'lucide-react';
import { useCloud } from '../cloud/CloudContext';
import { GazePageLayout } from '../components/ui/GazePageLayout';
import { GazeGrid } from '../components/ui/GazeGrid';
import { GazeButton } from '../components/ui/GazeButton';
import { EstadoDaSessao } from '../components/ui/EstadoDaSessao';

/**
 * Menu principal: nove cartões em grade 3×3, cada um com um selo circular
 * colorido e o ícone escuro por cima. Sem título — o paciente já sabe onde
 * está, e o espaço vale mais como alvo do que como texto.
 *
 * O selo é a única cor do cartão: o fundo é o da tela, e o cartão só ganha
 * o contorno azul quando o olhar entra (comportamento padrão do GazeButton).
 */

interface AppModule {
  id: string;
  title: string;
  icon: React.ReactNode;
  /** Cor do selo circular atrás do ícone. */
  badge: string;
  route: string;
  description: string;
}

const ICONE = 46;

const MODULES: AppModule[] = [
  { id: 'communication', title: 'Comunicação', icon: <MessageSquare size={ICONE} />, badge: '#FF8A8A', route: '/phrases', description: 'Frases rápidas e pictogramas' },
  { id: 'keyboard', title: 'Teclado Virtual', icon: <Keyboard size={ICONE} />, badge: '#6EE7A0', route: '/keyboard', description: 'Digite livremente' },
  { id: 'computer', title: 'Computador', icon: <Monitor size={ICONE} />, badge: '#C4A5F5', route: '/virtual-mouse', description: 'Mouse virtual e sistema' },
  { id: 'settings', title: 'Configurações', icon: <Settings size={ICONE} />, badge: '#FBBF5B', route: '/settings', description: 'Ajustes e calibração' },
  { id: 'leisure', title: 'Ajuda e Lazer', icon: <Gamepad2 size={ICONE} />, badge: '#7DB4F5', route: '/games', description: 'Câmera, fotos e jogos' },
  { id: 'conversation', title: 'Conversa', icon: <MessageCircle size={ICONE} />, badge: '#67E0E0', route: '/conversation', description: 'Mensagens do cuidador' },
  { id: 'rest', title: 'Modo Descanso', icon: <Moon size={ICONE} />, badge: '#C89BF7', route: '/rest', description: 'Pausar tela e descansar olhar' },
  { id: 'voice', title: 'Controle de Voz', icon: <Mic size={ICONE} />, badge: '#5EEAD4', route: '/voice', description: 'Comandos por voz' },
  { id: 'accessibility', title: 'Acessibilidade', icon: <Accessibility size={ICONE} />, badge: '#6CB6F5', route: '/accessibility', description: 'Recursos inclusivos' },
];

export const MainMenu: React.FC = () => {
  const navigate = useNavigate();
  const { naoFaladas } = useCloud();

  return (
    <GazePageLayout showBack={false}>
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        {/* Estado da sessao: quando foi a ultima calibracao, e se a licenca
            esta em tolerancia offline. So o que muda uma decisao do cuidador —
            esta e a tela do paciente, e enche-la de informacao atrapalha
            justamente quem ela existe para servir. */}
        <EstadoDaSessao />

        <div style={{ flex: 1, minHeight: 0, maxWidth: 1280, width: '100%', margin: '0 auto' }}>
          <GazeGrid columns={3} rows={3} gap={28}>
            {MODULES.map((module) => (
              <GazeButton
                key={module.id}
                onClick={() => navigate(module.route)}
                aria-label={`${module.title}: ${module.description}`}
                style={{
                  height: '100%',
                  borderRadius: '1.6rem',
                  background: 'var(--color-card-bg)',
                  border: '2px solid var(--color-card-border)',
                  boxShadow: '0 8px 24px var(--color-card-shadow)',
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
                    width: '100%',
                  }}
                >
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'relative',
                      width: 88,
                      height: 88,
                      borderRadius: '50%',
                      background: module.badge,
                      color: '#0f172a',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginBottom: '1rem',
                      boxShadow: '0 6px 18px rgba(0, 0, 0, 0.25)',
                    }}
                  >
                    {module.icon}
                    {module.id === 'conversation' && naoFaladas > 0 && (
                      <span
                        aria-hidden="false"
                        aria-label={`${naoFaladas} mensagens novas`}
                        style={{
                          position: 'absolute', top: -6, right: -10, minWidth: 30, height: 30, padding: '0 8px',
                          borderRadius: 15, background: '#dc2626', color: '#fff', fontSize: '1rem', fontWeight: 900,
                          display: 'flex', alignItems: 'center', justifyContent: 'center',
                          border: '3px solid var(--color-card-bg)',
                        }}
                      >
                        {naoFaladas}
                      </span>
                    )}
                  </div>
                  <div
                    style={{
                      fontSize: '1.7rem',
                      fontWeight: 800,
                      color: 'var(--color-text-base)',
                      letterSpacing: '-0.01em',
                      lineHeight: 1.15,
                    }}
                  >
                    {module.title}
                  </div>
                  <div
                    style={{
                      fontSize: '1.05rem',
                      opacity: 0.7,
                      marginTop: '0.45rem',
                      fontWeight: 500,
                      color: 'var(--color-text-base)',
                    }}
                  >
                    {module.description}
                  </div>
                </div>
              </GazeButton>
            ))}
          </GazeGrid>
        </div>
      </div>
    </GazePageLayout>
  );
};
