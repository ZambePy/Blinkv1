import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Crosshair, RotateCcw } from 'lucide-react';
import { GazeButton } from '../../components/ui/GazeButton';

/**
 * SIGA O ALVO — treino de sacádicos e fixação, com métrica clínica.
 *
 * ⚠️ REGRA CENTRAL DESTE ARQUIVO: o placar só sobe dentro de `acertar()`, que
 * só é chamado pelo `onClick` do alvo — ou seja, por um dwell de verdade sobre
 * ele. A versão anterior incrementava o placar dentro do `moveTarget()`
 * chamado pelo `setInterval`: o número subia sozinho, sem o paciente fazer
 * nada. Num app clínico isso é pior que não funcionar, porque o cuidador lê o
 * placar como medida de desempenho. Nenhum temporizador aqui pode tocar em
 * `acertos` ou em `temposAteAcertar`.
 */

/** Alvos por rodada. Curto o bastante para não cansar, longo o bastante para a
 *  média de tempo ter alguma estabilidade. */
const ALVOS_POR_RODADA = 12;

/**
 * Prazo de cada alvo.
 *
 * Precisa caber: sacádico até o alvo (~200 ms) + acomodação + o dwell de
 * 800 ms, com folga para quem tem controle ocular reduzido. Abaixo de ~3 s a
 * rodada mediria a velocidade do rastreador, não a do paciente.
 */
const PRAZO_DO_ALVO_MS = 4000;

/**
 * Fixação para contar como acerto. Mais longa que a das bolhas porque aqui o
 * alvo é único e vale uma medição: um toque de olhar de passagem não pode
 * virar um acerto registrado no relatório.
 */
const DWELL_DO_ALVO_MS = 800;

/** Alvo menor que o mínimo de 5° de propósito — o exercício é de precisão —
 *  mas acima do piso de 130 px, abaixo do qual acertar viraria sorte. */
const TAMANHO_DO_ALVO_PX = 160;

/** Faixa livre no topo, onde ficam o voltar e a emergência. */
const FAIXA_SEGURA_TOPO_PCT = 20;
const MARGEM_LATERAL_PCT = 10;
/**
 * Margem inferior, em porcentagem da altura.
 *
 * O alvo é posicionado pelo CENTRO (`translate(-50%, -50%)`), então um `yPct`
 * de 95 põe metade dele fora da tela numa janela de 800 px. A margem lateral
 * tinha sido pensada; esta não. Um alvo cortado é impossível de fixar no prazo,
 * conta como perdido, e estraga justamente o "tempo médio até acertar" — que é
 * a única informação clinicamente útil desta tela.
 */
const MARGEM_INFERIOR_PCT = 12;

type Fase = 'jogando' | 'fim';

interface Alvo {
  /** Índice do alvo na rodada (0-based). Serve de chave para o temporizador. */
  indice: number;
  xPct: number;
  yPct: number;
  /** Instante em que o alvo apareceu, para medir o tempo até o acerto. */
  nascidoEm: number;
}

function sortearAlvo(indice: number): Alvo {
  return {
    indice,
    xPct: MARGEM_LATERAL_PCT + Math.random() * (100 - 2 * MARGEM_LATERAL_PCT),
    yPct:
      FAIXA_SEGURA_TOPO_PCT +
      Math.random() * (100 - MARGEM_INFERIOR_PCT - FAIXA_SEGURA_TOPO_PCT),
    nascidoEm: Date.now(),
  };
}

export const FollowTarget: React.FC = () => {
  const navigate = useNavigate();
  const [fase, setFase] = useState<Fase>('jogando');
  const [alvo, setAlvo] = useState<Alvo>(() => sortearAlvo(0));
  const [acertos, setAcertos] = useState(0);
  const [perdidos, setPerdidos] = useState(0);
  const [temposAteAcertar, setTemposAteAcertar] = useState<number[]>([]);
  /** Evita que o timeout de expiração e um acerto no mesmo instante contem
   *  duas vezes o mesmo alvo. */
  const alvoResolvidoRef = useRef(-1);

  const avancar = useCallback((indiceAtual: number) => {
    const proximo = indiceAtual + 1;
    if (proximo >= ALVOS_POR_RODADA) {
      setFase('fim');
      return;
    }
    setAlvo(sortearAlvo(proximo));
  }, []);

  /**
   * Único caminho que incrementa `acertos`. Chamado apenas pelo `onClick` do
   * alvo — dwell do olhar ou clique de mouse, o mesmo evento nos dois casos.
   */
  const acertar = useCallback(() => {
    if (alvoResolvidoRef.current === alvo.indice) return;
    alvoResolvidoRef.current = alvo.indice;
    setAcertos((a) => a + 1);
    setTemposAteAcertar((t) => [...t, Date.now() - alvo.nascidoEm]);
    avancar(alvo.indice);
  }, [alvo, avancar]);

  // Expiração do alvo. Só conta ERRO — nunca acerto. Fixações fora do alvo não
  // passam por aqui e, por decisão de projeto, não contam como erro: penalizar
  // o olhar que vagueia mediria ansiedade, não controle ocular.
  useEffect(() => {
    if (fase !== 'jogando') return;
    const indice = alvo.indice;
    const id = window.setTimeout(() => {
      if (alvoResolvidoRef.current === indice) return;
      alvoResolvidoRef.current = indice;
      setPerdidos((p) => p + 1);
      avancar(indice);
    }, PRAZO_DO_ALVO_MS);
    return () => window.clearTimeout(id);
  }, [alvo, fase, avancar]);

  const reiniciar = useCallback(() => {
    alvoResolvidoRef.current = -1;
    setAcertos(0);
    setPerdidos(0);
    setTemposAteAcertar([]);
    setAlvo(sortearAlvo(0));
    setFase('jogando');
  }, []);

  const mediaMs =
    temposAteAcertar.length > 0
      ? temposAteAcertar.reduce((a, b) => a + b, 0) / temposAteAcertar.length
      : null;

  return (
    <main
      role="main"
      aria-labelledby="follow-title"
      style={{
        position: 'relative',
        width: '100vw',
        height: '100vh',
        overflow: 'hidden',
        background: 'linear-gradient(160deg, #0f172a 0%, #1e293b 100%)',
        color: '#f8fafc',
        fontFamily: "'Inter', system-ui, sans-serif",
      }}
    >
      {/* Saída sempre visível, dentro da faixa onde nenhum alvo nasce. */}
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
          isolado
          style={{
            borderRadius: '1.5rem',
            background: 'rgba(248,250,252,0.12)',
            border: '2px solid rgba(248,250,252,0.35)',
            color: '#f8fafc',
          }}
          aria-label="Voltar para Ajuda e Lazer"
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', fontSize: '1.3rem', fontWeight: 800 }}>
            <ArrowLeft size={28} /> Voltar
          </span>
        </GazeButton>

        <h1 id="follow-title" style={{ fontSize: '1.9rem', fontWeight: 900, margin: 0 }}>
          Siga o Alvo
        </h1>

        <div
          role="status"
          aria-live="polite"
          aria-label={`Acertos: ${acertos}. Alvos perdidos: ${perdidos}.`}
          data-no-dwell="true"
          style={{
            marginLeft: 'auto',
            display: 'flex',
            gap: '2rem',
            background: 'rgba(248,250,252,0.1)',
            border: '2px solid rgba(248,250,252,0.2)',
            borderRadius: '1.25rem',
            padding: '0.75rem 1.75rem',
          }}
        >
          <Placar rotulo="Acertos" valor={acertos} cor="#4ade80" />
          <Placar rotulo="Perdidos" valor={perdidos} cor="#fca5a5" />
          <Placar
            rotulo="Alvo"
            valor={`${Math.min(alvo.indice + 1, ALVOS_POR_RODADA)}/${ALVOS_POR_RODADA}`}
            cor="#f8fafc"
          />
        </div>
      </header>

      {fase === 'jogando' && (
        <>
          <p
            data-no-dwell="true"
            style={{
              position: 'absolute',
              top: '8.5rem',
              left: 0,
              right: 0,
              textAlign: 'center',
              margin: 0,
              fontSize: '1.15rem',
              fontWeight: 600,
              opacity: 0.65,
            }}
          >
            Olhe para o alvo vermelho e mantenha o olhar nele até ele estourar.
          </p>

          <GazeButton
            // A chave por índice remonta o botão a cada alvo: sem isso, a
            // transição de posição faria o alvo "deslizar" e o dwell
            // acumularia enquanto ele ainda está viajando.
            key={alvo.indice}
            onClick={acertar}
            data-dwell-ms={DWELL_DO_ALVO_MS}
            // Menor que o mínimo de 5° de propósito: ver TAMANHO_DO_ALVO_PX.
            noWarn
            aria-label="Fixar o alvo"
            style={{
              position: 'absolute',
              left: `${alvo.xPct}%`,
              top: `${alvo.yPct}%`,
              transform: 'translate(-50%, -50%)',
              width: TAMANHO_DO_ALVO_PX,
              height: TAMANHO_DO_ALVO_PX,
              borderRadius: '50%',
              padding: 0,
              border: '6px solid #ffffff',
              background: 'radial-gradient(circle, #ef4444 25%, #b91c1c 85%)',
              boxShadow: '0 0 40px rgba(239,68,68,0.6)',
              color: '#ffffff',
              zIndex: 20,
            }}
          >
            <Crosshair size={64} aria-hidden="true" />
          </GazeButton>
        </>
      )}

      {fase === 'fim' && (
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="follow-fim-title"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 60,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(2,6,23,0.7)',
          }}
        >
          <div
            style={{
              background: '#0f172a',
              border: '3px solid rgba(248,250,252,0.2)',
              borderRadius: '2.5rem',
              padding: '3rem 3.5rem',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: '1.5rem',
              maxWidth: 760,
            }}
          >
            <h2 id="follow-fim-title" style={{ fontSize: '2.4rem', fontWeight: 900, margin: 0 }}>
              Rodada concluída
            </h2>

            <dl
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: '2rem',
                margin: 0,
                textAlign: 'center',
              }}
            >
              <Resultado rotulo="Acertos" valor={`${acertos}`} cor="#4ade80" />
              <Resultado rotulo="Alvos perdidos" valor={`${perdidos}`} cor="#fca5a5" />
              {/* Tempo médio até acertar: é a informação clinicamente útil desta
                  tela. Uma média que sobe entre sessões indica fadiga ou
                  calibração pior muito antes de o paciente reclamar. */}
              <Resultado
                rotulo="Tempo médio até acertar"
                valor={mediaMs === null ? '—' : `${(mediaMs / 1000).toFixed(1)} s`}
                cor="#93c5fd"
              />
            </dl>

            <p style={{ margin: 0, opacity: 0.7, fontSize: '1.05rem', textAlign: 'center', maxWidth: 520 }}>
              {mediaMs === null
                ? 'Nenhum alvo foi fixado nesta rodada. Se estiver difícil demais, vale checar a calibração.'
                : 'O tempo médio é medido do momento em que o alvo aparece até a fixação se completar.'}
            </p>

            <div style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap', justifyContent: 'center' }}>
              <GazeButton
                onClick={reiniciar}
                width={280}
                height={84}
                style={{
                  borderRadius: '1.75rem',
                  background: 'linear-gradient(135deg, #dc2626, #b91c1c)',
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
                  background: 'rgba(248,250,252,0.12)',
                  border: '2px solid rgba(248,250,252,0.4)',
                  color: '#f8fafc',
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

const Placar: React.FC<{ rotulo: string; valor: number | string; cor: string }> = ({
  rotulo,
  valor,
  cor,
}) => (
  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.15rem' }}>
    <span style={{ fontSize: '0.9rem', fontWeight: 700, opacity: 0.7, textTransform: 'uppercase' }}>
      {rotulo}
    </span>
    <span style={{ fontSize: '1.6rem', fontWeight: 900, color: cor }}>{valor}</span>
  </div>
);

const Resultado: React.FC<{ rotulo: string; valor: string; cor: string }> = ({
  rotulo,
  valor,
  cor,
}) => (
  <div>
    <dt style={{ fontSize: '1rem', fontWeight: 700, opacity: 0.7 }}>{rotulo}</dt>
    <dd style={{ fontSize: '2.4rem', fontWeight: 900, color: cor, margin: '0.35rem 0 0 0' }}>
      {valor}
    </dd>
  </div>
);
