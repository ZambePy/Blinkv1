import React, { useEffect, useState } from 'react';
import {
  MessageSquare,
  Wind,
  BedDouble,
  Move,
  Tv,
  Snowflake,
  Music,
  Users,
  ChevronRight,
  ChevronLeft,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { GazePageLayout } from '../components/ui/GazePageLayout';
import { GazeGrid } from '../components/ui/GazeGrid';
import { GazeButton } from '../components/ui/GazeButton';
import { logSentence } from '../utils/clinicalLogger';
import { speak, stopSpeaking } from '../utils/speech';

interface Phrase {
  id: number;
  text: string;
  Icon: LucideIcon;
}

const PHRASES: Phrase[] = [
  { id: 1, text: 'Gostaria de conversar', Icon: MessageSquare },
  { id: 2, text: 'Pode abrir a janela?', Icon: Wind },
  { id: 3, text: 'Quero descansar agora', Icon: BedDouble },
  { id: 4, text: 'Pode mudar de posição?', Icon: Move },
  { id: 5, text: 'Pode ligar a televisão?', Icon: Tv },
  { id: 6, text: 'Preciso de um cobertor', Icon: Snowflake },
  { id: 7, text: 'Quero ouvir música', Icon: Music },
  { id: 8, text: 'Preciso que alguém fique aqui', Icon: Users },
];

/** Cinco frases por página: o sexto alvo da grade 3×2 é a paginação. */
const POR_PAGINA = 5;
const TOTAL_PAGINAS = Math.ceil(PHRASES.length / POR_PAGINA);

export const QuickPhrasesScreen: React.FC = () => {
  const [pagina, setPagina] = useState(0);
  /** Frase que está sendo falada agora: o alvo fica em destaque até o fim. */
  const [falando, setFalando] = useState<number | null>(null);

  useEffect(() => () => stopSpeaking(), []);

  const falar = (phrase: Phrase) => {
    setFalando(phrase.id);
    const ok = speak(phrase.text, { onEnd: () => setFalando(null) });
    if (!ok) setFalando(null);
    logSentence(phrase.text);
  };

  const visiveis = PHRASES.slice(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA);
  const temProxima = pagina < TOTAL_PAGINAS - 1;

  return (
    <GazePageLayout backRoute="/menu" title={`Frases · ${pagina + 1} de ${TOTAL_PAGINAS}`}>
      <h1 className="sr-only">Frases rápidas</h1>
      <GazeGrid columns={3} rows={2} gap={40}>
        {visiveis.map((phrase) => {
          const ativa = falando === phrase.id;
          return (
            <GazeButton
              key={phrase.id}
              onClick={() => falar(phrase)}
              size="xl"
              stacked
              variant={ativa ? 'primary' : 'secondary'}
              icon={<phrase.Icon color={ativa ? 'var(--on-primary)' : 'var(--primary)'} />}
              label={phrase.text}
              aria-label={`Falar: ${phrase.text}`}
              aria-pressed={ativa}
              style={{ width: '100%', height: '100%', padding: '1rem 1.5rem' }}
            />
          );
        })}

        {temProxima ? (
          <GazeButton
            onClick={() => setPagina((p) => p + 1)}
            size="xl"
            stacked
            variant="ghost"
            icon={<ChevronRight />}
            label="Mais frases"
            aria-label="Ver mais frases"
            style={{ width: '100%', height: '100%', borderColor: 'var(--border)' }}
          />
        ) : pagina > 0 && (
          <GazeButton
            onClick={() => setPagina((p) => p - 1)}
            size="xl"
            stacked
            variant="ghost"
            icon={<ChevronLeft />}
            label="Frases anteriores"
            aria-label="Voltar para as primeiras frases"
            style={{ width: '100%', height: '100%', borderColor: 'var(--border)' }}
          />
        )}
      </GazeGrid>
    </GazePageLayout>
  );
};
