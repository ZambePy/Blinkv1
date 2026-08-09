import React from 'react';
import { BackButton } from '../../components/ui/BackButton';
import { Newspaper } from 'lucide-react';
import { TTSButton } from '../../components/TTSButton';

const NEWS_LIST = [
  {
    id: 1,
    title: 'Avanços na Medicina',
    summary: 'Nova tecnologia de eye-tracking permite maior independência para pacientes em UTIs.',
  },
  {
    id: 2,
    title: 'Clima para o Fim de Semana',
    summary:
      'Previsão de tempo ensolarado para o próximo final de semana em toda a região sul e sudeste.',
  },
  {
    id: 3,
    title: 'Esportes',
    summary:
      'Time local vence o campeonato regional em partida emocionante decidida nos últimos minutos.',
  },
];

export const NewsScreen: React.FC = () => {
  return (
    <main
      role="main"
      aria-labelledby="news-title"
      style={{ minHeight: '100vh', backgroundColor: '#f1f5f9', padding: '2rem' }}
    >
      <div style={{ display: 'flex', alignItems: 'center', marginBottom: '2rem', gap: '1rem' }}>
        <BackButton />
        <h1
          id="news-title"
          style={{
            fontSize: '2rem',
            color: '#0f172a',
            margin: 0,
            fontWeight: 800,
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
          }}
        >
          <Newspaper aria-hidden="true" /> Jornal do Dia
        </h1>
      </div>

      <ol
        aria-label="Lista de notícias"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1.5rem',
          maxWidth: 800,
          margin: '0 auto',
          padding: 0,
          listStyle: 'none',
        }}
      >
        {NEWS_LIST.map((item) => (
          <li key={item.id}>
            <article
              aria-labelledby={`news-${item.id}-title`}
              style={{
                background: 'white',
                padding: '2rem',
                borderRadius: '1.5rem',
                boxShadow: '0 4px 15px rgba(0,0,0,0.05)',
              }}
            >
              <h2
                id={`news-${item.id}-title`}
                style={{ fontSize: '1.5rem', margin: '0 0 1rem 0', color: '#1e293b' }}
              >
                {item.title}
              </h2>
              <p style={{ fontSize: '1.25rem', color: '#334155', lineHeight: 1.6 }}>
                {item.summary}
              </p>
              <div style={{ marginTop: '1.5rem', display: 'inline-block' }}>
                <TTSButton text={`${item.title}. ${item.summary}`} />
              </div>
            </article>
          </li>
        ))}
      </ol>
    </main>
  );
};
