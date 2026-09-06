import React, { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { GazePageLayout } from '../components/ui/GazePageLayout';
import { GazeButton } from '../components/ui/GazeButton';

/** Diâmetro da bolha: acima do mínimo de alvo (160 px) com folga. */
const BOLHA_PX = 184;

/**
 * Sorteia uma posição dentro da área de jogo, mantendo a bolha inteira visível
 * e longe das bordas (em percentual do container).
 */
function novaPosicao(): { top: string; left: string } {
  const top = 15 + Math.random() * 70;
  const left = 12 + Math.random() * 76;
  return { top: `${top.toFixed(1)}%`, left: `${left.toFixed(1)}%` };
}

/**
 * Estoura Bolhas: treino de fixação. A bolha é o único elemento que se move,
 * e só depois de ser acionada. Voltar e emergência ficam no cabeçalho fixo.
 */
export const BubblePopGame: React.FC = () => {
  const [score, setScore] = useState(0);
  const [pos, setPos] = useState({ top: '50%', left: '50%' });

  const pop = () => {
    setScore((s) => s + 1);
    setPos(novaPosicao());
  };

  return (
    <GazePageLayout backRoute="/games" title={`Bolhas · ${score} ${score === 1 ? 'ponto' : 'pontos'}`}>
      <h1 className="sr-only">Estoura Bolhas</h1>
      <div
        role="status"
        aria-live="polite"
        className="sr-only"
      >
        Pontuação: {score} pontos
      </div>

      <div
        style={{
          position: 'relative',
          width: '100%',
          height: '100%',
          borderRadius: 'var(--r-lg)',
          border: '2px solid var(--border)',
          background:
            'radial-gradient(ellipse at 30% 20%, color-mix(in srgb, var(--primary) 12%, var(--surface)) 0%, var(--surface) 65%)',
          overflow: 'hidden',
        }}
      >
        <p
          aria-hidden="true"
          data-no-dwell="true"
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
          Olhe para a bolha até ela estourar
        </p>

        <GazeButton
          onClick={pop}
          aria-label="Estourar bolha"
          variant="primary"
          width={BOLHA_PX}
          height={BOLHA_PX}
          icon={<Sparkles />}
          style={{
            position: 'absolute',
            top: pos.top,
            left: pos.left,
            marginTop: -BOLHA_PX / 2,
            marginLeft: -BOLHA_PX / 2,
            borderRadius: '50%',
            padding: 0,
            borderColor: 'color-mix(in srgb, var(--on-primary) 70%, transparent)',
            background:
              'radial-gradient(circle at 35% 35%, color-mix(in srgb, var(--on-primary) 55%, transparent), var(--accent) 60%, var(--primary) 100%)',
            // A bolha "voa" para o próximo lugar depois de estourar — movimento
            // intencional, que só acontece após o acionamento.
            transition:
              'top 0.45s cubic-bezier(0.4, 0, 0.2, 1), left 0.45s cubic-bezier(0.4, 0, 0.2, 1), box-shadow 0.15s ease, border-color 0.15s ease',
          }}
        />
      </div>
    </GazePageLayout>
  );
};
