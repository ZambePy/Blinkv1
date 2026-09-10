import React, { useCallback, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Info, Newspaper, Volume2 } from 'lucide-react';
import { GazeButton } from '../../components/ui/GazeButton';
import { falar } from '../../services/voz';

/**
 * NOTÍCIAS — conteúdo de DEMONSTRAÇÃO.
 *
 * As três notícias são fixas no código e continuam assim de propósito: não há
 * fonte de notícias configurada, nenhuma requisição de rede é feita, e inventar
 * uma faria o app apresentar texto falso como se fosse jornal. Para quem
 * depende deste app para se informar, isso não é um detalhe de produto — é
 * desinformação. O aviso no topo da tela diz isso ao usuário, em vez de deixar
 * o comentário só no código.
 */
const NOTICIAS = [
  {
    id: 1,
    title: 'Avanços na Medicina',
    summary:
      'Nova tecnologia de eye-tracking permite maior independência para pacientes em UTIs.',
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
  const navigate = useNavigate();
  /** Id da notícia sendo lida, só para dar retorno visual — o paciente não tem
   *  como saber que o dwell "pegou" se nada mudar na tela. */
  const [lendo, setLendo] = useState<number | null>(null);

  const ler = useCallback((id: number, texto: string) => {
    setLendo(id);
    void falar(texto, { rate: 0.9 })
      .catch(() => {
        /* voz indisponível: o texto continua na tela, que é o essencial */
      })
      .finally(() => setLendo(null));
  }, []);

  return (
    <main
      role="main"
      aria-labelledby="news-title"
      style={{
        minHeight: '100vh',
        width: '100vw',
        boxSizing: 'border-box',
        background: 'var(--color-bg-base)',
        color: 'var(--color-text-base)',
        padding: '2rem 3rem 4rem 3rem',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', marginBottom: '1.5rem' }}>
        <GazeButton
          onClick={() => navigate('/games')}
          width={200}
          height={68}
          style={{
            borderRadius: '1.5rem',
            background: 'var(--color-card-bg)',
            border: '2px solid var(--color-card-border)',
            boxShadow: '0 6px 20px var(--color-card-shadow)',
          }}
          aria-label="Voltar para Ajuda e Lazer"
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', fontSize: '1.3rem', fontWeight: 800 }}>
            <ArrowLeft size={28} /> Voltar
          </span>
        </GazeButton>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
          <span
            aria-hidden="true"
            style={{
              width: 52,
              height: 52,
              borderRadius: '1rem',
              background: 'linear-gradient(135deg, #475569, #1e293b)',
              color: '#ffffff',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Newspaper size={30} />
          </span>
          <h1 id="news-title" style={{ fontSize: '2rem', fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>
            Jornal do Dia
          </h1>
        </div>
      </header>

      {/* Aviso de demonstração, visível na tela e não só no código. */}
      <div
        role="note"
        data-no-dwell="true"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.85rem',
          maxWidth: 900,
          margin: '0 auto 2rem auto',
          background: 'rgba(234, 179, 8, 0.14)',
          border: '2px solid rgba(234, 179, 8, 0.5)',
          borderRadius: '1.25rem',
          padding: '1rem 1.5rem',
          fontSize: '1.05rem',
          fontWeight: 700,
        }}
      >
        <Info size={26} aria-hidden="true" style={{ flexShrink: 0 }} />
        <span>
          Conteúdo de demonstração. Estes textos são exemplos fixos do aplicativo — não são
          notícias reais nem vêm de nenhum jornal.
        </span>
      </div>

      <ol
        aria-label="Notícias de demonstração"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '1.75rem',
          maxWidth: 900,
          margin: '0 auto',
          padding: 0,
          listStyle: 'none',
        }}
      >
        {NOTICIAS.map((item) => (
          <li key={item.id}>
            <article
              aria-labelledby={`news-${item.id}-title`}
              style={{
                background: 'var(--color-card-bg)',
                border: '2px solid var(--color-card-border)',
                padding: '2rem 2.25rem',
                borderRadius: '1.75rem',
                boxShadow: '0 10px 26px var(--color-card-shadow)',
              }}
            >
              <h2
                id={`news-${item.id}-title`}
                style={{ fontSize: '1.6rem', fontWeight: 900, margin: '0 0 0.75rem 0' }}
              >
                {item.title}
              </h2>
              <p style={{ fontSize: '1.3rem', lineHeight: 1.6, margin: 0, opacity: 0.9 }}>
                {item.summary}
              </p>

              <div style={{ marginTop: '1.5rem' }}>
                <GazeButton
                  onClick={() => ler(item.id, `${item.title}. ${item.summary}`)}
                  width={250}
                  height={72}
                  style={{
                    borderRadius: '1.5rem',
                    background: 'linear-gradient(135deg, #1b54a8, #2563eb)',
                    color: '#ffffff',
                    border: '2px solid rgba(255,255,255,0.3)',
                    boxShadow: '0 8px 22px rgba(27,84,168,0.3)',
                  }}
                  aria-label={`Ouvir a notícia ${item.title} em voz alta`}
                >
                  <span style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', fontSize: '1.25rem', fontWeight: 800 }}>
                    <Volume2 size={28} />
                    {lendo === item.id ? 'Lendo…' : 'Ouvir'}
                  </span>
                </GazeButton>
              </div>
            </article>
          </li>
        ))}
      </ol>
    </main>
  );
};
