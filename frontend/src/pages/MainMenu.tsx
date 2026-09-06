import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MessageSquare, Keyboard, Monitor, Settings, Heart, Moon } from 'lucide-react';
import { GazePageLayout } from '../components/ui/GazePageLayout';
import { GazeGrid } from '../components/ui/GazeGrid';
import { GazeButton } from '../components/ui/GazeButton';

interface MenuItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  route: string;
  /** Cor do ícone, sempre por token. */
  tone?: 'primary' | 'quiet';
}

/**
 * Seis alvos, um por célula: é o máximo que cabe sem apertar. A emergência não
 * entra aqui porque é o botão global do canto superior direito, presente em
 * toda tela do paciente.
 */
const ITEMS: MenuItem[] = [
  { id: 'phrases', label: 'Frases', icon: <MessageSquare color="var(--primary)" />, route: '/phrases' },
  { id: 'keyboard', label: 'Teclado', icon: <Keyboard color="var(--primary)" />, route: '/keyboard' },
  { id: 'computer', label: 'Computador', icon: <Monitor color="var(--primary)" />, route: '/virtual-mouse' },
  { id: 'leisure', label: 'Ajuda e Lazer', icon: <Heart color="var(--primary)" />, route: '/games' },
  { id: 'settings', label: 'Opções', icon: <Settings color="var(--primary)" />, route: '/settings' },
  { id: 'rest', label: 'Descanso', icon: <Moon color="var(--text-2)" />, route: '/rest', tone: 'quiet' },
];

export const MainMenu: React.FC = () => {
  const navigate = useNavigate();

  return (
    <GazePageLayout showBack={false} title="Menu">
      <h1 className="sr-only">Menu principal</h1>
      <GazeGrid columns={3} rows={2} gap={40}>
        {ITEMS.map((item) => (
          <GazeButton
            key={item.id}
            onClick={() => navigate(item.route)}
            size="xl"
            stacked
            icon={item.icon}
            label={item.label}
            aria-label={`Abrir ${item.label}`}
            style={{
              width: '100%',
              height: '100%',
              color: item.tone === 'quiet' ? 'var(--text-2)' : 'var(--text)',
            }}
          />
        ))}
      </GazeGrid>
    </GazePageLayout>
  );
};
