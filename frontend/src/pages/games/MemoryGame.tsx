import React, { useState, useEffect } from 'react';
import { BackButton } from '../../components/ui/BackButton';
import { Gamepad2 } from 'lucide-react';

const EMOJIS = ['🐶', '🐱', '🐭', '🐹', '🐰', '🦊', '🐻', '🐼'];

interface Card {
  id: number;
  emoji: string;
  isFlipped: boolean;
  isMatched: boolean;
}

export const MemoryGame: React.FC = () => {
  const [cards, setCards] = useState<Card[]>([]);
  const [flippedCards, setFlippedCards] = useState<number[]>([]);
  const [moves, setMoves] = useState(0);

  useEffect(() => {
    initializeGame();
  }, []);

  const initializeGame = () => {
    const shuffled: Card[] = [...EMOJIS, ...EMOJIS]
      .sort(() => Math.random() - 0.5)
      .map((emoji, index) => ({ id: index, emoji, isFlipped: false, isMatched: false }));
    setCards(shuffled);
    setFlippedCards([]);
    setMoves(0);
  };

  const handleCardClick = (index: number) => {
    if (cards[index].isFlipped || cards[index].isMatched || flippedCards.length === 2) return;

    const newCards = [...cards];
    newCards[index].isFlipped = true;
    setCards(newCards);
    setFlippedCards([...flippedCards, index]);

    if (flippedCards.length === 1) {
      setMoves((m) => m + 1);
      const firstIndex = flippedCards[0];
      if (newCards[firstIndex].emoji === newCards[index].emoji) {
        newCards[firstIndex].isMatched = true;
        newCards[index].isMatched = true;
        setCards(newCards);
        setFlippedCards([]);
      } else {
        setTimeout(() => {
          const revertCards = [...newCards];
          revertCards[firstIndex].isFlipped = false;
          revertCards[index].isFlipped = false;
          setCards(revertCards);
          setFlippedCards([]);
        }, 1000);
      }
    }
  };

  const allMatched = cards.length > 0 && cards.every((c) => c.isMatched);

  return (
    <main
      role="main"
      aria-labelledby="memory-title"
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(160deg, #dcfce7 0%, #bbf7d0 100%)',
        padding: '2rem',
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '2rem',
        }}
      >
        <BackButton />
        <div
          role="status"
          aria-live="polite"
          aria-label={`Movimentos realizados: ${moves}`}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            background: 'var(--color-card-bg)',
            padding: '0.5rem 1rem',
            borderRadius: '1rem',
            color: '#166534',
            fontWeight: 700,
          }}
        >
          <Gamepad2 aria-hidden="true" />
          <h1 id="memory-title" style={{ fontSize: '1rem', margin: 0, fontWeight: 700 }}>
            Jogo da Memória — Movimentos: {moves}
          </h1>
        </div>
      </div>

      <div
        role="grid"
        aria-label="Cartas do jogo da memória"
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: '1rem',
          maxWidth: 600,
          margin: '0 auto',
          width: '100%',
          flex: 1,
        }}
      >
        {cards.map((card, index) => (
          <button
            key={card.id}
            type="button"
            role="gridcell"
            aria-label={
              card.isFlipped || card.isMatched ? `Carta virada: ${card.emoji}` : 'Carta escondida'
            }
            onClick={() => handleCardClick(index)}
            style={{
              aspectRatio: '1',
              background:
                card.isFlipped || card.isMatched
                  ? 'white'
                  : 'linear-gradient(135deg, #22c55e, #16a34a)',
              borderRadius: '1rem',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: '3rem',
              border: 'none',
              cursor: card.isFlipped || card.isMatched ? 'default' : 'pointer',
              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
              transition: 'transform 0.3s',
            }}
          >
            <span aria-hidden={!(card.isFlipped || card.isMatched)}>
              {card.isFlipped || card.isMatched ? card.emoji : '?'}
            </span>
          </button>
        ))}
      </div>

      {allMatched && (
        <div role="alert" aria-live="assertive" style={{ textAlign: 'center', marginTop: '2rem' }}>
          <h2 style={{ color: '#166534' }}>Parabéns! Você encontrou todos os pares!</h2>
          <button
            type="button"
            onClick={initializeGame}
            aria-label="Iniciar novo jogo da memória"
            style={{
              padding: '1rem 2rem',
              background: '#22c55e',
              color: 'white',
              borderRadius: '1rem',
              border: 'none',
              fontSize: '1.2rem',
              fontWeight: 700,
              cursor: 'pointer',
              marginTop: '1rem',
            }}
          >
            Jogar Novamente
          </button>
        </div>
      )}
    </main>
  );
};
