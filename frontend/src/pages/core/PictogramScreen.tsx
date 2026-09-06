import React, { useEffect, useState } from 'react';
import {
  Utensils,
  Droplets,
  Smile,
  Frown,
  Toilet,
  Phone,
  CircleAlert,
  Heart,
  ChevronRight,
  ChevronLeft,
  Volume2,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { GazePageLayout } from '../../components/ui/GazePageLayout';
import { GazeGrid } from '../../components/ui/GazeGrid';
import { GazeButton } from '../../components/ui/GazeButton';
import { speak, stopSpeaking } from '../../utils/speech';

interface Pictogram {
  id: number;
  label: string;
  Icon: LucideIcon;
  /** Token da cor do ícone. Os de alerta ficam em vermelho, o resto em azul. */
  tone: 'primary' | 'danger' | 'ok';
}

const PICTOGRAMS: Pictogram[] = [
  { id: 1, label: 'Quero comer', Icon: Utensils, tone: 'primary' },
  { id: 2, label: 'Estou com sede', Icon: Droplets, tone: 'primary' },
  { id: 3, label: 'Estou bem', Icon: Smile, tone: 'ok' },
  { id: 4, label: 'Estou com dor', Icon: CircleAlert, tone: 'danger' },
  { id: 5, label: 'Quero ir ao banheiro', Icon: Toilet, tone: 'primary' },
  { id: 6, label: 'Chamar a família', Icon: Phone, tone: 'primary' },
  { id: 7, label: 'Obrigado', Icon: Heart, tone: 'primary' },
  { id: 8, label: 'Não estou bem', Icon: Frown, tone: 'danger' },
];

const TONE_VAR: Record<Pictogram['tone'], string> = {
  primary: 'var(--primary)',
  danger: 'var(--danger)',
  ok: 'var(--ok)',
};

const POR_PAGINA = 5;
const TOTAL_PAGINAS = Math.ceil(PICTOGRAMS.length / POR_PAGINA);

export const PictogramScreen: React.FC = () => {
  const [selecionado, setSelecionado] = useState<Pictogram | null>(null);
  const [falando, setFalando] = useState(false);
  const [pagina, setPagina] = useState(0);

  useEffect(() => () => stopSpeaking(), []);

  const falar = (pic: Pictogram) => {
    setSelecionado(pic);
    setFalando(true);
    if (!speak(pic.label, { onEnd: () => setFalando(false) })) setFalando(false);
  };

  const visiveis = PICTOGRAMS.slice(pagina * POR_PAGINA, pagina * POR_PAGINA + POR_PAGINA);
  const temProxima = pagina < TOTAL_PAGINAS - 1;

  return (
    <GazePageLayout backRoute="/menu" title={`Pictogramas · ${pagina + 1} de ${TOTAL_PAGINAS}`}>
      <h1 className="sr-only">Pictogramas</h1>
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '1.25rem' }}>
        {/* Última escolha + repetir. A caixa de texto não é alvo. */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '1.5rem',
            minHeight: 120,
          }}
        >
          <div
            data-no-dwell="true"
            role="status"
            aria-live="polite"
            style={{
              flex: 1,
              minHeight: 120,
              display: 'flex',
              alignItems: 'center',
              padding: '0 2rem',
              borderRadius: 'var(--r-lg)',
              border: '2px solid var(--border)',
              background: 'var(--surface)',
              color: selecionado ? 'var(--primary)' : 'var(--text-3)',
              fontSize: 'var(--fs-32)',
              fontWeight: 800,
            }}
          >
            {selecionado ? selecionado.label : 'Olhe para um pictograma para falar'}
          </div>
          {selecionado && (
            <GazeButton
              onClick={() => falar(selecionado)}
              size="lg"
              variant="primary"
              icon={<Volume2 />}
              label={falando ? 'Falando' : 'Repetir'}
              aria-label={`Repetir: ${selecionado.label}`}
            />
          )}
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          <GazeGrid columns={3} rows={2} gap={32}>
            {visiveis.map((pic) => {
              const ativo = falando && selecionado?.id === pic.id;
              return (
                <GazeButton
                  key={pic.id}
                  onClick={() => falar(pic)}
                  size="xl"
                  stacked
                  variant={ativo ? 'primary' : 'secondary'}
                  icon={<pic.Icon color={ativo ? 'var(--on-primary)' : TONE_VAR[pic.tone]} />}
                  label={pic.label}
                  aria-label={`Falar: ${pic.label}`}
                  aria-pressed={ativo}
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
                label="Mais opções"
                aria-label="Ver mais pictogramas"
                style={{ width: '100%', height: '100%', borderColor: 'var(--border)' }}
              />
            ) : pagina > 0 && (
              <GazeButton
                onClick={() => setPagina((p) => p - 1)}
                size="xl"
                stacked
                variant="ghost"
                icon={<ChevronLeft />}
                label="Opções anteriores"
                aria-label="Voltar para os primeiros pictogramas"
                style={{ width: '100%', height: '100%', borderColor: 'var(--border)' }}
              />
            )}
          </GazeGrid>
        </div>
      </div>
    </GazePageLayout>
  );
};
