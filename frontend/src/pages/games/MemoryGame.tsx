import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Dog, Cat, Rabbit, Bird, Fish, Turtle, Squirrel, Snail, RotateCcw } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { GazePageLayout } from '../../components/ui/GazePageLayout';
import { GazeButton } from '../../components/ui/GazeButton';

/** Oito figuras, dois de cada: 16 cartas em 4×4. */
const FIGURAS: { id: string; nome: string; Icon: LucideIcon }[] = [
  { id: 'dog', nome: 'cachorro', Icon: Dog },
  { id: 'cat', nome: 'gato', Icon: Cat },
  { id: 'rabbit', nome: 'coelho', Icon: Rabbit },
  { id: 'bird', nome: 'passarinho', Icon: Bird },
  { id: 'fish', nome: 'peixe', Icon: Fish },
  { id: 'turtle', nome: 'tartaruga', Icon: Turtle },
  { id: 'squirrel', nome: 'esquilo', Icon: Squirrel },
  { id: 'snail', nome: 'caracol', Icon: Snail },
];

/** Tempo que um par errado fica à mostra antes de virar de novo. */
const TEMPO_ERRO_MS = 1200;

interface Card {
  id: number;
  figura: string;
  isFlipped: boolean;
  isMatched: boolean;
}

function embaralhar(): Card[] {
  return [...FIGURAS, ...FIGURAS]
    .map((f) => ({ f, ordem: Math.random() }))
    .sort((a, b) => a.ordem - b.ordem)
    .map(({ f }, index) => ({ id: index, figura: f.id, isFlipped: false, isMatched: false }));
}

export const MemoryGame: React.FC = () => {
  const [cards, setCards] = useState<Card[]>(() => embaralhar());
  const [flipped, setFlipped] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);
  const revertTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(
    () => () => {
      if (revertTimer.current) clearTimeout(revertTimer.current);
    },
    []
  );

  const reiniciar = useCallback(() => {
    if (revertTimer.current) clearTimeout(revertTimer.current);
    revertTimer.current = null;
    setCards(embaralhar());
    setFlipped([]);
    setMoves(0);
  }, []);

  const virar = (index: number) => {
    const carta = cards[index];
    if (!carta || carta.isFlipped || carta.isMatched || flipped.length === 2) return;

    const abertas = [...flipped, index];
    setCards((prev) => prev.map((c, i) => (i === index ? { ...c, isFlipped: true } : c)));
    setFlipped(abertas);

    if (abertas.length < 2) return;
    setMoves((m) => m + 1);

    const [a, b] = abertas;
    if (cards[a].figura === carta.figura) {
      setCards((prev) =>
        prev.map((c, i) => (i === a || i === b ? { ...c, isMatched: true } : c))
      );
      setFlipped([]);
    } else {
      revertTimer.current = setTimeout(() => {
        setCards((prev) =>
          prev.map((c, i) => (i === a || i === b ? { ...c, isFlipped: false } : c))
        );
        setFlipped([]);
        revertTimer.current = null;
      }, TEMPO_ERRO_MS);
    }
  };

  const allMatched = cards.every((c) => c.isMatched);

  return (
    <GazePageLayout backRoute="/games" title={`Memória · ${moves} ${moves === 1 ? 'jogada' : 'jogadas'}`}>
      <h1 className="sr-only">Jogo da Memória</h1>
      <div role="status" aria-live="polite" className="sr-only">
        Jogadas: {moves}
      </div>

      {allMatched ? (
        <div
          role="alert"
          style={{
            height: '100%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            gap: '2rem',
            textAlign: 'center',
          }}
        >
          <h2 style={{ color: 'var(--ok)' }}>Você encontrou todos os pares!</h2>
          <p style={{ fontSize: 'var(--fs-24)', color: 'var(--text-2)' }}>
            {moves} {moves === 1 ? 'jogada' : 'jogadas'}
          </p>
          <GazeButton
            onClick={reiniciar}
            size="xl"
            variant="primary"
            icon={<RotateCcw />}
            label="Jogar de novo"
            aria-label="Começar um novo jogo da memória"
          />
        </div>
      ) : (
        <div
          role="grid"
          aria-label="Cartas do jogo da memória"
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, minmax(0, 1fr))',
            gridTemplateRows: 'repeat(4, minmax(0, 1fr))',
            gap: 24,
            width: '100%',
            height: '100%',
            // A hit-area do GazeButton usa metade deste gap.
            '--gaze-grid-gap': '24px',
          } as React.CSSProperties}
        >
          {cards.map((card, index) => {
            const aberta = card.isFlipped || card.isMatched;
            const figura = FIGURAS.find((f) => f.id === card.figura)!;
            return (
              <GazeButton
                key={card.id}
                role="gridcell"
                onClick={() => virar(index)}
                disabled={aberta}
                noWarn
                variant={aberta ? 'secondary' : 'primary'}
                aria-label={aberta ? `Carta virada: ${figura.nome}` : 'Carta escondida'}
                style={{
                  width: '100%',
                  height: '100%',
                  minHeight: 0,
                  // Cartas viradas ficam claras e paradas; pares encontrados
                  // ganham a borda verde. Sem transform em nenhum estado.
                  opacity: 1,
                  borderColor: card.isMatched ? 'var(--ok)' : undefined,
                  background: card.isMatched ? 'var(--ok-soft)' : undefined,
                  color: card.isMatched ? 'var(--ok)' : aberta ? 'var(--primary)' : undefined,
                }}
              >
                {aberta ? (
                  <figura.Icon size={56} aria-hidden="true" />
                ) : (
                  <span aria-hidden="true" style={{ fontSize: 'var(--fs-40)', fontWeight: 800 }}>
                    ?
                  </span>
                )}
              </GazeButton>
            );
          })}
        </div>
      )}
    </GazePageLayout>
  );
};
