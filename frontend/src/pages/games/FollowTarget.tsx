import React, { useState, useEffect } from 'react';
import { Target } from 'lucide-react';
import { GazePageLayout } from '../../components/ui/GazePageLayout';
import { GazeButton } from '../../components/ui/GazeButton';

/** Diâmetro do alvo: acima do mínimo de 160 px. */
const ALVO_PX = 176;
/** O alvo troca de lugar sozinho a cada 3 s, dê tempo de acioná-lo ou não. */
const INTERVALO_MS = 3000;

function novaPosicao(): { top: string; left: string } {
  const top = 15 + Math.random() * 70;
  const left = 12 + Math.random() * 76;
  return { top: `${top.toFixed(1)}%`, left: `${left.toFixed(1)}%` };
}

/**
 * Siga o Alvo: treino de velocidade. O alvo é o único elemento que se move;
 * Voltar e emergência ficam no cabeçalho fixo.
 */
export const FollowTarget: React.FC = () => {
  const [position, setPosition] = useState({ top: '50%', left: '50%' });
  const [score, setScore] = useState(0);

  const acertar = () => {
    setScore((s) => s + 1);
    setPosition(novaPosicao());
  };

  useEffect(() => {
    const timer = setInterval(() => setPosition(novaPosicao()), INTERVALO_MS);
    return () => clearInterval(timer);
  }, []);

  return (
    <GazePageLayout backRoute="/games" title={`Siga o Alvo · ${score} ${score === 1 ? 'acerto' : 'acertos'}`}>
      <h1 className="sr-only">Siga o Alvo</h1>
      <div role="status" aria-live="polite" className="sr-only">
        Alvos atingidos: {score}
      </div>

      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          borderRadius: 'var(--r-lg)',
          border: '2px solid var(--border)',
          background: 'var(--surface)',
          overflow: 'hidden',
        }}
      >
        <p
          aria-hidden="true"
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: '1.25rem',
            textAlign: 'center',
            color: 'var(--text-3)',
            fontSize: 'var(--fs-20)',
            fontWeight: 600,
            pointerEvents: 'none',
            userSelect: 'none',
          }}
        >
          Acompanhe o alvo com o olhar
        </p>

        <GazeButton
          onClick={acertar}
          aria-label="Acertar o alvo"
          variant="danger"
          width={ALVO_PX}
          height={ALVO_PX}
          icon={<Target />}
          style={{
            position: 'absolute',
            top: position.top,
            left: position.left,
            marginTop: -ALVO_PX / 2,
            marginLeft: -ALVO_PX / 2,
            borderRadius: '50%',
            padding: 0,
            // Deslocamento intencional do jogo (não é hover).
            transition:
              'top 0.5s ease-out, left 0.5s ease-out, box-shadow 0.15s ease, border-color 0.15s ease',
          }}
        />
      </div>
    </GazePageLayout>
  );
};
