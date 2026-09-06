import React, { useEffect, useState } from 'react';
import { Volume2 } from 'lucide-react';
import { GazePageLayout } from '../../components/ui/GazePageLayout';
import { GazeButton } from '../../components/ui/GazeButton';
import { speak, stopSpeaking } from '../../utils/speech';

/** Notícias de demonstração: o app ainda não busca um jornal de verdade. */
const NEWS_LIST = [
  {
    id: 1,
    title: 'Avanços na Medicina',
    summary: 'Nova tecnologia de rastreamento ocular permite maior independência para pacientes em UTIs.',
  },
  {
    id: 2,
    title: 'Clima para o Fim de Semana',
    summary: 'Previsão de tempo ensolarado para o próximo fim de semana em toda a região sul e sudeste.',
  },
  {
    id: 3,
    title: 'Esportes',
    summary: 'Time local vence o campeonato regional em partida decidida nos últimos minutos.',
  },
];

export const NewsScreen: React.FC = () => {
  const [lendo, setLendo] = useState<number | null>(null);

  useEffect(() => () => stopSpeaking(), []);

  const ouvir = (item: (typeof NEWS_LIST)[number]) => {
    setLendo(item.id);
    if (!speak(`${item.title}. ${item.summary}`, { onEnd: () => setLendo(null) })) setLendo(null);
  };

  return (
    <GazePageLayout backRoute="/menu" title="Jornal do Dia">
      <h1 className="sr-only">Jornal do Dia</h1>
      <ol
        aria-label="Notícias"
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'grid',
          gridTemplateRows: `repeat(${NEWS_LIST.length}, minmax(0, 1fr))`,
          gap: 24,
          height: '100%',
          '--gaze-grid-gap': '24px',
        } as React.CSSProperties}
      >
        {NEWS_LIST.map((item) => {
          const ativa = lendo === item.id;
          return (
            <li key={item.id} style={{ display: 'flex', gap: 24, minHeight: 0 }}>
              <article
                aria-labelledby={`news-${item.id}-title`}
                data-no-dwell="true"
                style={{
                  flex: 1,
                  minWidth: 0,
                  padding: '1.25rem 2rem',
                  borderRadius: 'var(--r-lg)',
                  border: `2px solid ${ativa ? 'var(--primary)' : 'var(--border)'}`,
                  background: 'var(--surface)',
                  display: 'flex',
                  flexDirection: 'column',
                  justifyContent: 'center',
                  gap: '0.5rem',
                  overflow: 'hidden',
                }}
              >
                <h2 id={`news-${item.id}-title`} style={{ fontSize: 'var(--fs-24)', color: 'var(--text)' }}>
                  {item.title}
                </h2>
                <p style={{ fontSize: 'var(--fs-20)', color: 'var(--text-2)', lineHeight: 1.5 }}>
                  {item.summary}
                </p>
              </article>
              <GazeButton
                onClick={() => ouvir(item)}
                size="lg"
                stacked
                variant={ativa ? 'primary' : 'secondary'}
                icon={<Volume2 color={ativa ? 'var(--on-primary)' : 'var(--primary)'} />}
                label={ativa ? 'Lendo' : 'Ouvir'}
                aria-label={`Ouvir: ${item.title}`}
                aria-pressed={ativa}
                style={{ width: 220, height: '100%' }}
              />
            </li>
          );
        })}
      </ol>
    </GazePageLayout>
  );
};
