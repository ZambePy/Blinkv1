import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Target, Sparkles, Camera, Images, Palette, Brain } from 'lucide-react';
import { GazePageLayout } from '../components/ui/GazePageLayout';
import { GazeGrid } from '../components/ui/GazeGrid';
import { GazeButton } from '../components/ui/GazeButton';

interface Activity {
  route: string;
  title: string;
  icon: React.ReactNode;
}

const ACTIVITIES: Activity[] = [
  { route: '/photo', title: 'Tirar Foto', icon: <Camera color="var(--primary)" /> },
  { route: '/gallery', title: 'Galeria de Fotos', icon: <Images color="var(--primary)" /> },
  { route: '/games/bubble', title: 'Estoura Bolhas', icon: <Sparkles color="var(--primary)" /> },
  { route: '/games/memory', title: 'Jogo da Memória', icon: <Brain color="var(--primary)" /> },
  { route: '/games/follow', title: 'Siga o Alvo', icon: <Target color="var(--primary)" /> },
  { route: '/drawing', title: 'Desenho com Olhar', icon: <Palette color="var(--primary)" /> },
];

export const GamesMenu: React.FC = () => {
  const navigate = useNavigate();

  return (
    <GazePageLayout backRoute="/menu" title="Ajuda e Lazer">
      <GazeGrid columns={3} rows={2} gap={40}>
        {ACTIVITIES.map((activity) => (
          <GazeButton
            key={activity.route}
            onClick={() => navigate(activity.route)}
            size="xl"
            stacked
            icon={activity.icon}
            label={activity.title}
            aria-label={`Abrir ${activity.title}`}
            style={{ width: '100%', height: '100%' }}
          />
        ))}
      </GazeGrid>
    </GazePageLayout>
  );
};
