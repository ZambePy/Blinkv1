import React, { useEffect, useRef, useState } from 'react';
import { Play, Pause } from 'lucide-react';
import { GazePageLayout } from '../../components/ui/GazePageLayout';
import { GazeButton } from '../../components/ui/GazeButton';

type Phase = 'Inspire' | 'Segure' | 'Solte';

const FASES: Phase[] = ['Inspire', 'Segure', 'Solte'];
/** Cada fase dura 4 s: ciclo de 12 s, ritmo confortável para respiração guiada. */
const DURACAO_FASE_MS = 4000;

/**
 * Respiração guiada. O círculo cresce e encolhe de propósito (é o guia), mas
 * não é alvo: fica dentro de uma zona sem dwell. O único alvo é Iniciar/Pausar.
 */
export const MeditationScreen: React.FC = () => {
  const [fase, setFase] = useState<Phase>('Inspire');
  const [active, setActive] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!active) {
      setFase('Inspire');
      return;
    }
    let indice = 0;
    const proxima = () => {
      setFase(FASES[indice]);
      indice = (indice + 1) % FASES.length;
      timerRef.current = setTimeout(proxima, DURACAO_FASE_MS);
    };
    proxima();
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = null;
    };
  }, [active]);

  const escala = active && (fase === 'Inspire' || fase === 'Segure') ? 1.5 : 1;

  return (
    <GazePageLayout backRoute="/menu" title="Respiração guiada">
      <h1 className="sr-only">Meditação visual</h1>
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '2.5rem',
        }}
      >
        <div
          data-no-dwell="true"
          role="img"
          aria-label={active ? `Fase atual: ${fase}` : 'Círculo de respiração parado'}
          aria-live="polite"
          style={{
            width: 360,
            height: 360,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          <div
            aria-hidden="true"
            style={{
              width: 200,
              height: 200,
              borderRadius: '50%',
              background: 'radial-gradient(circle, var(--accent), var(--primary))',
              boxShadow: '0 0 60px color-mix(in srgb, var(--primary) 45%, transparent)',
              // Movimento intencional do guia de respiração (não é hover).
              transition: `transform ${DURACAO_FASE_MS}ms ease-in-out`,
              transform: `scale(${escala})`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: 'var(--on-primary)',
              fontSize: 'var(--fs-32)',
              fontWeight: 800,
            }}
          >
            {active ? fase : ''}
          </div>
        </div>

        <p data-no-dwell="true" style={{ fontSize: 'var(--fs-24)', color: 'var(--text-2)' }}>
          {active ? 'Acompanhe o círculo com a respiração.' : 'Inspire enquanto o círculo cresce, solte enquanto ele encolhe.'}
        </p>

        {!active ? (
          <GazeButton
            onClick={() => setActive(true)}
            size="xl"
            variant="primary"
            icon={<Play />}
            label="Iniciar"
            aria-label="Iniciar a respiração guiada"
          />
        ) : (
          <GazeButton
            onClick={() => setActive(false)}
            size="xl"
            variant="secondary"
            icon={<Pause color="var(--primary)" />}
            label="Pausar"
            aria-label="Pausar a respiração guiada"
          />
        )}
      </div>
    </GazePageLayout>
  );
};
