import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, RotateCcw, Timer, Trophy } from 'lucide-react';
import { GazeButton } from '../components/ui/GazeButton';

/**
 * ESTOURA BOLHAS — treino de fixação.
 *
 * O jogo é acionado pelo dwell global: cada bolha é um `<button>` de verdade,
 * então o dispatcher do `GazeContext` encontra a bolha sob o olhar com
 * `elementFromPoint` e dispara um `click()`. Não há nada específico de mouse
 * aqui — o mouse continua funcionando porque é o MESMO evento.
 */

/** Duração da rodada. Longo o bastante para o placar significar algo e curto o
 *  bastante para não cansar: fixação sustentada é esforço real para quem tem
 *  controle ocular reduzido. */
const DURACAO_DA_RODADA_S = 60;

/** Bolhas simultâneas. Mais que isto e o paciente passa a escolher em vez de
 *  fixar, o que muda o exercício de precisão para busca visual. */
const BOLHAS_SIMULTANEAS = 3;

/**
 * Tempo de fixação para estourar.
 *
 * 750 ms fica acima da faixa de 200–400 ms em que o olho pousa de passagem
 * enquanto procura o próximo alvo — abaixo disso, atravessar a tela estouraria
 * bolhas sozinho e o placar mentiria. E fica bem abaixo do dwell padrão de
 * navegação: numa rodada de 60 s o paciente precisa conseguir muitos acertos,
 * senão o jogo vira uma fila de espera.
 */
const DWELL_DA_BOLHA_MS = 750;

/** Tamanho inicial: confortavelmente acima do alvo mínimo de 5°, para o
 *  primeiro acerto acontecer sem esforço e o jogo começar com uma vitória. */
const TAMANHO_INICIAL_PX = 220;

/**
 * Piso do tamanho.
 *
 * Cada acerto encolhe a bolha — é isso que faz o treino de precisão. O piso
 * existe porque abaixo de ~130 px (≈3,3° a 60 cm) o alvo fica menor que o
 * ruído típico do rastreador, e aí acertar vira sorte. Um jogo em que o
 * esforço não muda o resultado não treina nada: só frustra.
 */
const TAMANHO_MINIMO_PX = 130;

/** Quanto cada acerto encolhe a próxima bolha. */
const ENCOLHIMENTO_POR_ACERTO_PX = 8;

/** Faixa livre no topo: o botão de voltar e o de emergência vivem ali, e uma
 *  bolha nascendo por cima deles roubaria a saída do paciente. */
const FAIXA_SEGURA_TOPO_PX = 190;
/** Respiro nas bordas para a bolha nunca nascer cortada. */
const MARGEM_DA_BORDA_PX = 28;
/** Vão mínimo entre bolhas: sem ele duas bolhas encostadas viram um alvo só
 *  para o `elementFromPoint`, e o paciente estoura a que não estava olhando. */
const VAO_ENTRE_BOLHAS_PX = 36;

/**
 * Recorde da SESSÃO.
 *
 * Módulo, não `localStorage`: o placar não deve sobreviver ao fim do dia. Um
 * recorde antigo comparado com um dia ruim (fadiga, calibração pior) só diria
 * ao paciente que ele piorou — o que é sobre o rastreador, não sobre ele.
 */
let recordeDaSessao = 0;

interface Bolha {
  id: number;
  x: number;
  y: number;
  tamanho: number;
}

type Fase = 'jogando' | 'fim';

/** Área útil onde uma bolha pode nascer, já descontadas as faixas seguras. */
function areaUtil() {
  const w = typeof window === 'undefined' ? 1024 : window.innerWidth;
  const h = typeof window === 'undefined' ? 768 : window.innerHeight;
  return {
    esquerda: MARGEM_DA_BORDA_PX,
    topo: FAIXA_SEGURA_TOPO_PX,
    direita: w - MARGEM_DA_BORDA_PX,
    base: h - MARGEM_DA_BORDA_PX,
  };
}

/**
 * Sorteia um centro para uma bolha de `tamanho`, sem sobrepor as já existentes.
 *
 * Amostragem por rejeição com teto de tentativas: numa janela pequena com três
 * bolhas grandes pode simplesmente não haver lugar, e um `while (true)`
 * travaria a aba. Devolver `null` faz o chamador desistir dessa bolha — a
 * rodada continua com menos bolhas em vez de congelar.
 */
function sortearPosicao(tamanho: number, existentes: Bolha[]): { x: number; y: number } | null {
  const area = areaUtil();
  const raio = tamanho / 2;
  const minX = area.esquerda + raio;
  const maxX = area.direita - raio;
  const minY = area.topo + raio;
  const maxY = area.base - raio;
  // Janela menor que a própria bolha: nada a sortear.
  if (maxX <= minX || maxY <= minY) return null;

  for (let tentativa = 0; tentativa < 60; tentativa++) {
    const x = minX + Math.random() * (maxX - minX);
    const y = minY + Math.random() * (maxY - minY);
    const colide = existentes.some((b) => {
      const distanciaMinima = raio + b.tamanho / 2 + VAO_ENTRE_BOLHAS_PX;
      return Math.hypot(b.x - x, b.y - y) < distanciaMinima;
    });
    if (!colide) return { x, y };
  }
  return null;
}

export const BubblePopGame: React.FC = () => {
  const navigate = useNavigate();
  const [fase, setFase] = useState<Fase>('jogando');
  const [pontos, setPontos] = useState(0);
  const [segundos, setSegundos] = useState(DURACAO_DA_RODADA_S);
  const [bolhas, setBolhas] = useState<Bolha[]>([]);
  const [recorde, setRecorde] = useState(recordeDaSessao);
  const proximoId = useRef(1);
  /**
   * Acertos da rodada, em ref.
   *
   * O tamanho da PRÓXIMA bolha é função dos acertos, não do tamanho da bolha
   * que acabou de estourar: derivar do alvo estourado deixaria o tamanho subir
   * de volta quando o paciente estourasse uma bolha antiga (maior) depois de
   * uma nova. A dificuldade tem de ser monotônica.
   */
  const acertosRef = useRef(0);

  /** Completa o conjunto de bolhas até `BOLHAS_SIMULTANEAS`, no tamanho atual. */
  const reabastecer = useCallback((atuais: Bolha[], tamanhoAtual: number): Bolha[] => {
    const proximas = [...atuais];
    while (proximas.length < BOLHAS_SIMULTANEAS) {
      const pos = sortearPosicao(tamanhoAtual, proximas);
      if (!pos) break; // sem espaço: joga com menos bolhas nesta leva
      proximas.push({ id: proximoId.current++, x: pos.x, y: pos.y, tamanho: tamanhoAtual });
    }
    return proximas;
  }, []);

  const comecar = useCallback(() => {
    acertosRef.current = 0;
    setPontos(0);
    setSegundos(DURACAO_DA_RODADA_S);
    setBolhas(reabastecer([], TAMANHO_INICIAL_PX));
    setFase('jogando');
  }, [reabastecer]);

  // Primeira leva de bolhas.
  useEffect(() => {
    setBolhas((atuais) => (atuais.length === 0 ? reabastecer([], TAMANHO_INICIAL_PX) : atuais));
  }, [reabastecer]);

  // Relógio da rodada.
  useEffect(() => {
    if (fase !== 'jogando') return;
    const id = window.setInterval(() => {
      setSegundos((s) => {
        if (s <= 1) {
          setFase('fim');
          return 0;
        }
        return s - 1;
      });
    }, 1000);
    return () => window.clearInterval(id);
  }, [fase]);

  // O recorde só é gravado no fim da rodada, com o placar já fechado.
  useEffect(() => {
    if (fase !== 'fim') return;
    if (pontos > recordeDaSessao) recordeDaSessao = pontos;
    setRecorde(recordeDaSessao);
  }, [fase, pontos]);

  const estourar = useCallback(
    (id: number) => {
      acertosRef.current += 1;
      setPontos(acertosRef.current);
      const proximoTamanho = Math.max(
        TAMANHO_MINIMO_PX,
        TAMANHO_INICIAL_PX - acertosRef.current * ENCOLHIMENTO_POR_ACERTO_PX
      );
      setBolhas((atuais) => reabastecer(atuais.filter((b) => b.id !== id), proximoTamanho));
    },
    [reabastecer]
  );

  const jogando = fase === 'jogando';

  return (
    <main
      role="main"
      aria-labelledby="bubble-title"
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background:
          'radial-gradient(circle at 20% 15%, rgba(99,102,241,0.18), transparent 55%),' +
          'radial-gradient(circle at 80% 85%, rgba(147,51,234,0.18), transparent 55%),' +
          'var(--color-bg-base)',
        color: 'var(--color-text-base)',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* Barra superior: saída sempre visível e alcançável pelo olhar. Vive
          dentro da faixa segura, onde nenhuma bolha pode nascer. */}
      <header
        style={{
          position: 'absolute',
          top: '2rem',
          left: '2.5rem',
          right: '2.5rem',
          display: 'flex',
          alignItems: 'center',
          gap: '1.5rem',
          zIndex: 40,
        }}
      >
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

        <h1 id="bubble-title" style={{ fontSize: '1.9rem', fontWeight: 900, margin: 0, letterSpacing: '-0.02em' }}>
          Estoura Bolhas
        </h1>

        <div style={{ marginLeft: 'auto', display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <Indicador
            icone={<Timer size={26} aria-hidden="true" />}
            rotulo="Tempo"
            valor={`${segundos}s`}
            aria-label={`Tempo restante: ${segundos} segundos`}
          />
          <Indicador
            icone={<Trophy size={26} aria-hidden="true" />}
            rotulo="Pontos"
            valor={String(pontos)}
            aria-label={`Pontuação: ${pontos} pontos`}
          />
        </div>
      </header>

      {/* Campo de jogo */}
      {jogando &&
        bolhas.map((bolha) => (
          <GazeButton
            key={bolha.id}
            onClick={() => estourar(bolha.id)}
            // O dwell curto é a regra do jogo, não uma preferência de estilo:
            // ver DWELL_DA_BOLHA_MS.
            data-dwell-ms={DWELL_DA_BOLHA_MS}
            // A bolha encolhe DE PROPÓSITO abaixo do alvo mínimo de 5° — é o
            // treino de precisão. O piso de 130 px está em TAMANHO_MINIMO_PX.
            noWarn
            aria-label="Estourar bolha"
            style={{
              position: 'absolute',
              left: bolha.x - bolha.tamanho / 2,
              top: bolha.y - bolha.tamanho / 2,
              width: bolha.tamanho,
              height: bolha.tamanho,
              borderRadius: '50%',
              padding: 0,
              border: '4px solid rgba(255,255,255,0.75)',
              background:
                'radial-gradient(circle at 34% 30%, rgba(255,255,255,0.85), rgba(99,102,241,0.85) 62%, rgba(79,70,229,0.95))',
              boxShadow: '0 10px 34px rgba(79,70,229,0.45), inset 0 -10px 20px rgba(0,0,0,0.12)',
              fontSize: `${Math.round(bolha.tamanho * 0.28)}px`,
              zIndex: 20,
            }}
          >
            <span aria-hidden="true">✨</span>
          </GazeButton>
        ))}

      {/* Fim de rodada */}
      {fase === 'fim' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="bubble-fim-title"
          style={{
            position: 'absolute',
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
              border: '3px solid var(--color-card-border)',
              borderRadius: '2.5rem',
              padding: '3rem 3.5rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1.75rem',
              boxShadow: '0 25px 60px rgba(0,0,0,0.35)',
              maxWidth: 720,
            }}
          >
            <h2 id="bubble-fim-title" style={{ fontSize: '2.4rem', fontWeight: 900, margin: 0 }}>
              Fim da rodada!
            </h2>
            <p role="status" style={{ fontSize: '1.5rem', margin: 0, textAlign: 'center', fontWeight: 700 }}>
              Você estourou <strong>{pontos}</strong> {pontos === 1 ? 'bolha' : 'bolhas'} em{' '}
              {DURACAO_DA_RODADA_S} segundos.
            </p>
            <p style={{ fontSize: '1.2rem', margin: 0, opacity: 0.8, fontWeight: 600 }}>
              Melhor resultado desta sessão: {recorde}
            </p>

            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              <GazeButton
                onClick={comecar}
                width={280}
                height={84}
                style={{
                  borderRadius: '1.75rem',
                  background: 'linear-gradient(135deg, #4f46e5, #4338ca)',
                  color: '#ffffff',
                  border: '2px solid rgba(255,255,255,0.3)',
                  boxShadow: '0 10px 28px rgba(79,70,229,0.35)',
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

const Indicador: React.FC<{
  icone: React.ReactNode;
  rotulo: string;
  valor: string;
  'aria-label': string;
}> = ({ icone, rotulo, valor, 'aria-label': ariaLabel }) => (
  <div
    role="status"
    aria-live="polite"
    aria-label={ariaLabel}
    data-no-dwell="true"
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.7rem',
      background: 'var(--color-card-bg)',
      border: '2px solid var(--color-card-border)',
      borderRadius: '1.25rem',
      padding: '0.75rem 1.5rem',
      boxShadow: '0 6px 18px var(--color-card-shadow)',
    }}
  >
    <span style={{ color: 'var(--color-primary)', display: 'flex' }}>{icone}</span>
    <span style={{ fontSize: '1rem', fontWeight: 700, opacity: 0.7 }}>{rotulo}</span>
    <span style={{ fontSize: '1.5rem', fontWeight: 900 }}>{valor}</span>
  </div>
);
