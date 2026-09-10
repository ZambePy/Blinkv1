import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RotateCcw } from 'lucide-react';
import { GazeButton } from '../../components/ui/GazeButton';

/**
 * JOGO DA MEMÓRIA — operável só com o olhar.
 *
 * Cada carta é um `GazeButton`, então o dwell global a vira do mesmo jeito que
 * um clique de mouse viraria.
 *
 * ⚠️ A versão anterior mutava o array do state em cima
 * (`newCards[index].isFlipped = true` sobre os MESMOS objetos guardados no
 * state) e só depois chamava `setCards`. Como os objetos eram compartilhados
 * entre o array antigo e o novo, o React 19 podia pular o re-render — e o
 * `setTimeout` de desvirar operava sobre objetos já alterados por um clique
 * posterior, deixando cartas viradas para sempre. Aqui toda transição cria
 * objetos novos para as cartas que mudam.
 */

/** Seis pares numa grade 4×3. Mais que isso e as cartas ficariam menores que o
 *  alvo mínimo de 5°, além de estourar a memória de trabalho do exercício. */
const PARES = ['🐶', '🐱', '🦊', '🐻', '🐼', '🦁'];
const COLUNAS = 4;
const LINHAS = 3;

/** Fixação para virar uma carta. Mais longa que o dwell de navegação porque
 *  virar a carta errada custa uma jogada — e o paciente não pode desfazer. */
const DWELL_DA_CARTA_MS = 900;

/** Quanto tempo o par errado fica visível antes de desvirar. Abaixo de ~1,2 s
 *  quem tem sacádicos lentos não termina de ler a segunda carta antes de ela
 *  sumir, e o jogo passa a testar velocidade em vez de memória. */
const TEMPO_OLHANDO_O_PAR_MS = 1400;

interface Carta {
  id: number;
  emoji: string;
  virada: boolean;
  encontrada: boolean;
}

function novoBaralho(): Carta[] {
  return [...PARES, ...PARES]
    .map((emoji, i) => ({ emoji, ordem: Math.random(), id: i }))
    .sort((a, b) => a.ordem - b.ordem)
    .map((c, i) => ({ id: i, emoji: c.emoji, virada: false, encontrada: false }));
}

export const MemoryGame: React.FC = () => {
  const navigate = useNavigate();
  const [cartas, setCartas] = useState<Carta[]>(novoBaralho);
  /** Ids das cartas viradas e ainda não resolvidas (0, 1 ou 2). */
  const [viradas, setViradas] = useState<number[]>([]);
  const [jogadas, setJogadas] = useState(0);
  /** Trava enquanto o par errado está exposto: sem ela uma terceira carta
   *  entraria na comparação e o baralho ficaria inconsistente. */
  const [travado, setTravado] = useState(false);
  const timeoutRef = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    },
    []
  );

  const reiniciar = useCallback(() => {
    if (timeoutRef.current !== null) window.clearTimeout(timeoutRef.current);
    setCartas(novoBaralho());
    setViradas([]);
    setJogadas(0);
    setTravado(false);
  }, []);

  const virar = useCallback(
    (id: number) => {
      if (travado) return;
      const carta = cartas.find((c) => c.id === id);
      if (!carta || carta.virada || carta.encontrada) return;

      // Sempre um array NOVO com objetos NOVOS para as cartas que mudam.
      const comAVirada = cartas.map((c) => (c.id === id ? { ...c, virada: true } : c));
      const agoraViradas = [...viradas, id];

      if (agoraViradas.length < 2) {
        setCartas(comAVirada);
        setViradas(agoraViradas);
        return;
      }

      // Segunda carta: fecha a jogada.
      setJogadas((m) => m + 1);
      const [primeiroId] = agoraViradas;
      const primeira = comAVirada.find((c) => c.id === primeiroId)!;
      const segunda = comAVirada.find((c) => c.id === id)!;

      if (primeira.emoji === segunda.emoji) {
        setCartas(
          comAVirada.map((c) =>
            c.id === primeiroId || c.id === id ? { ...c, encontrada: true } : c
          )
        );
        setViradas([]);
        return;
      }

      // Par errado: mostra as duas e desvira depois do prazo.
      setCartas(comAVirada);
      setViradas(agoraViradas);
      setTravado(true);
      timeoutRef.current = window.setTimeout(() => {
        setCartas((atuais) =>
          atuais.map((c) => (c.id === primeiroId || c.id === id ? { ...c, virada: false } : c))
        );
        setViradas([]);
        setTravado(false);
        timeoutRef.current = null;
      }, TEMPO_OLHANDO_O_PAR_MS);
    },
    [cartas, viradas, travado]
  );

  const paresEncontrados = cartas.filter((c) => c.encontrada).length / 2;
  const venceu = paresEncontrados === PARES.length;

  return (
    <main
      role="main"
      aria-labelledby="memory-title"
      style={{
        minHeight: '100vh',
        width: '100vw',
        boxSizing: 'border-box',
        background:
          'radial-gradient(circle at 15% 10%, rgba(34,197,94,0.16), transparent 55%), var(--color-bg-base)',
        color: 'var(--color-text-base)',
        padding: '2rem 3rem',
        display: 'flex',
        flexDirection: 'column',
        gap: '1.75rem',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      <header style={{ display: 'flex', alignItems: 'center', gap: '1.5rem', flexWrap: 'wrap' }}>
        <GazeButton
          onClick={() => navigate('/games')}
          width={200}
          height={68}
          isolado
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

        <h1 id="memory-title" style={{ fontSize: '1.9rem', fontWeight: 900, margin: 0 }}>
          Jogo da Memória
        </h1>

        <div
          role="status"
          aria-live="polite"
          aria-label={`Pares encontrados: ${paresEncontrados} de ${PARES.length}. Jogadas: ${jogadas}.`}
          data-no-dwell="true"
          style={{
            marginLeft: 'auto',
            display: 'flex',
            gap: '2rem',
            background: 'var(--color-card-bg)',
            border: '2px solid var(--color-card-border)',
            borderRadius: '1.25rem',
            padding: '0.75rem 1.75rem',
            fontWeight: 800,
            fontSize: '1.2rem',
          }}
        >
          <span>
            Pares encontrados: {paresEncontrados}/{PARES.length}
          </span>
          <span>Jogadas: {jogadas}</span>
        </div>
      </header>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: `repeat(${COLUNAS}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${LINHAS}, minmax(0, 1fr))`,
          gap: '1.5rem',
          width: '100%',
          maxWidth: 1080,
          margin: '0 auto',
          flex: 1,
        }}
      >
        {cartas.map((carta) => {
          const aberta = carta.virada || carta.encontrada;
          return (
            <GazeButton
              key={carta.id}
              onClick={() => virar(carta.id)}
              disabled={aberta || travado}
              data-dwell-ms={DWELL_DA_CARTA_MS}
              // O tamanho vem do grid, não de props: `minHeight` garante o
              // piso, mas `offsetHeight` é 0 em ambiente de teste e dispararia
              // um aviso falso a cada render.
              noWarn
              aria-label={
                carta.encontrada
                  ? `Carta ${carta.id + 1}: ${carta.emoji}, par encontrado`
                  : carta.virada
                    ? `Carta ${carta.id + 1}: ${carta.emoji}`
                    : `Carta ${carta.id + 1}, escondida`
              }
              style={{
                minHeight: 170,
                width: '100%',
                height: '100%',
                borderRadius: '1.75rem',
                fontSize: '4.5rem',
                border: carta.encontrada ? '4px solid #16a34a' : '3px solid rgba(255,255,255,0.5)',
                background: aberta
                  ? 'var(--color-card-bg)'
                  : 'linear-gradient(135deg, #22c55e, #15803d)',
                color: 'var(--color-text-base)',
                boxShadow: carta.encontrada
                  ? '0 10px 28px rgba(22,163,74,0.3)'
                  : '0 10px 26px rgba(0,0,0,0.12)',
                opacity: carta.encontrada ? 0.85 : 1,
                cursor: aberta ? 'default' : 'pointer',
              }}
            >
              <span aria-hidden="true" style={{ fontSize: '4.5rem', lineHeight: 1 }}>
                {aberta ? carta.emoji : '❔'}
              </span>
            </GazeButton>
          );
        })}
      </div>

      {venceu && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="memory-fim-title"
          style={{
            position: 'fixed',
            inset: 0,
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(2,6,23,0.55)',
            backdropFilter: 'blur(8px)',
          }}
        >
          <div
            style={{
              background: 'var(--color-card-bg)',
              border: '3px solid #16a34a',
              borderRadius: '2.5rem',
              padding: '3rem 3.5rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1.5rem',
              maxWidth: 680,
              textAlign: 'center',
            }}
          >
            <span aria-hidden="true" style={{ fontSize: '4rem' }}>
              🎉
            </span>
            <h2 id="memory-fim-title" style={{ fontSize: '2.3rem', fontWeight: 900, margin: 0 }}>
              Você encontrou todos os pares!
            </h2>
            <p style={{ fontSize: '1.4rem', margin: 0, fontWeight: 700 }}>
              Foram {jogadas} {jogadas === 1 ? 'jogada' : 'jogadas'}.
            </p>

            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              <GazeButton
                onClick={reiniciar}
                width={280}
                height={84}
                style={{
                  borderRadius: '1.75rem',
                  background: 'linear-gradient(135deg, #22c55e, #15803d)',
                  color: '#ffffff',
                  border: '2px solid rgba(255,255,255,0.3)',
                }}
                aria-label="Jogar novamente"
              >
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.35rem', fontWeight: 800 }}>
                  <RotateCcw size={28} /> Jogar de novo
                </span>
              </GazeButton>

              <GazeButton
                onClick={() => navigate('/games')}
                width={260}
                height={84}
                style={{
                  borderRadius: '1.75rem',
                  background: 'var(--color-card-bg)',
                  border: '2px solid var(--color-primary)',
                  color: 'var(--color-primary)',
                }}
                aria-label="Voltar para Ajuda e Lazer"
              >
                <span style={{ fontSize: '1.3rem', fontWeight: 800 }}>Voltar ao menu</span>
              </GazeButton>
            </div>
          </div>
        </div>
      )}
    </main>
  );
};
