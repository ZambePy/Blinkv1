import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  AlertOctagon,
  ArrowLeft,
  ArrowRight,
  Check,
  Crosshair,
  Eye,
  Home,
  Moon,
  SkipForward,
} from 'lucide-react';
import { GazePageLayout } from '../../components/ui/GazePageLayout';
import { GazeButton } from '../../components/ui/GazeButton';
import { GazeGrid } from '../../components/ui/GazeGrid';

const TOTAL_PASSOS = 7;
const ALVOS_DA_PRATICA = 3;

/* ── Ilustrações (SVG inline, cores só por token) ─────────────────────── */

const estiloSvg: React.CSSProperties = { width: 'min(100%, 420px)', height: 'auto' };

/** Câmera olhando para o olho: não precisa mexer a cabeça. */
const IlustracaoCamera: React.FC = () => (
  <svg viewBox="0 0 420 200" style={estiloSvg} aria-hidden="true">
    <rect x="20" y="30" width="230" height="140" rx="14" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="3" />
    <rect x="105" y="170" width="60" height="10" rx="4" fill="var(--text-3)" />
    <circle cx="135" cy="30" r="9" fill="var(--text)" />
    <circle cx="135" cy="30" r="4" fill="var(--accent)" />
    <path d="M150 34 L330 100" stroke="var(--accent)" strokeWidth="3" strokeDasharray="8 8" fill="none" />
    <ellipse cx="345" cy="100" rx="44" ry="26" fill="var(--surface)" stroke="var(--text)" strokeWidth="4" />
    <circle cx="345" cy="100" r="16" fill="var(--primary)" />
    <circle cx="345" cy="100" r="7" fill="var(--text)" />
  </svg>
);

/** Vista lateral do posto de uso: distância do braço, luz na frente. */
const IlustracaoPosicao: React.FC = () => (
  <svg viewBox="0 0 420 220" style={estiloSvg} aria-hidden="true">
    {/* tela com câmera */}
    <rect x="30" y="40" width="18" height="130" rx="6" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="3" />
    <circle cx="39" cy="40" r="7" fill="var(--text)" />
    <circle cx="39" cy="40" r="3" fill="var(--accent)" />
    {/* luz na frente, junto da tela */}
    <circle cx="80" cy="26" r="14" fill="var(--warn)" />
    <path d="M62 26 H50 M98 26 H110 M80 8 V2 M69 15 L62 8 M91 15 L98 8" stroke="var(--warn)" strokeWidth="3" strokeLinecap="round" />
    {/* pessoa */}
    <circle cx="300" cy="80" r="34" fill="var(--surface)" stroke="var(--text)" strokeWidth="4" />
    <circle cx="282" cy="78" r="6" fill="var(--primary)" />
    <path d="M300 114 V180 M300 130 L250 150 M300 130 L340 160" stroke="var(--text)" strokeWidth="6" strokeLinecap="round" fill="none" />
    <rect x="240" y="180" width="120" height="14" rx="6" fill="var(--text-3)" />
    {/* distância do braço */}
    <path d="M60 205 H270" stroke="var(--primary)" strokeWidth="3" markerEnd="url(#seta)" markerStart="url(#seta)" />
    <text x="165" y="200" textAnchor="middle" fontSize="16" fontWeight="700" fill="var(--primary)" fontFamily="var(--font-body)">
      um braço
    </text>
    {/* janela atrás, riscada */}
    <rect x="360" y="20" width="44" height="60" rx="4" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="3" />
    <path d="M382 20 V80 M360 50 H404" stroke="var(--border)" strokeWidth="3" />
    <path d="M356 16 L408 84 M408 16 L356 84" stroke="var(--danger)" strokeWidth="5" strokeLinecap="round" />
    <defs>
      <marker id="seta" markerWidth="8" markerHeight="8" refX="4" refY="4" orient="auto-start-reverse">
        <path d="M0 0 L8 4 L0 8 Z" fill="var(--primary)" />
      </marker>
    </defs>
  </svg>
);

/** Tela pequena com os pontos da calibração; um deles aceso. */
const IlustracaoCalibracao: React.FC = () => (
  <svg viewBox="0 0 420 220" style={estiloSvg} aria-hidden="true">
    <rect x="40" y="20" width="340" height="190" rx="14" fill="var(--surface-2)" stroke="var(--border)" strokeWidth="3" />
    {[0, 1, 2].flatMap((linha) =>
      [0, 1, 2].map((coluna) => {
        const aceso = linha === 0 && coluna === 0;
        return (
          <circle
            key={`${linha}-${coluna}`}
            cx={90 + coluna * 120}
            cy={60 + linha * 55}
            r={aceso ? 14 : 6}
            fill={aceso ? 'var(--accent)' : 'var(--text-3)'}
            opacity={aceso ? 1 : 0.5}
          />
        );
      }),
    )}
    <circle cx="90" cy="60" r="26" fill="none" stroke="var(--accent)" strokeWidth="3" opacity="0.5" />
  </svg>
);

/**
 * Demonstração do dwell: um alvo que "enche" sozinho, em ciclo. Não é botão
 * de verdade — é uma `div` com as classes do GazeButton, para o anel ser
 * exatamente o que o paciente vai ver depois.
 */
const DemoDeDwell: React.FC = () => {
  const ref = useRef<HTMLDivElement>(null);
  const [cheio, setCheio] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const DURACAO_MS = 1500;
    const PAUSA_MS = 900;
    let inicio = performance.now();
    let cheioLocal = false;
    const id = window.setInterval(() => {
      const t = performance.now() - inicio;
      if (t < DURACAO_MS) {
        el.style.setProperty('--gaze-dwell-progress', String(t / DURACAO_MS));
        if (cheioLocal) { cheioLocal = false; setCheio(false); }
      } else if (t < DURACAO_MS + PAUSA_MS) {
        el.style.setProperty('--gaze-dwell-progress', '1');
        if (!cheioLocal) { cheioLocal = true; setCheio(true); }
      } else {
        inicio = performance.now();
      }
    }, 40);
    return () => window.clearInterval(id);
  }, []);

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className={`gaze-button gaze-button--lg gaze-hover ${cheio ? 'gaze-button--primary' : 'gaze-button--secondary'}`}
      style={{ width: 240, height: 140, cursor: 'default' }}
    >
      <span className="gaze-button-content">
        <span className="gaze-button__icon">{cheio ? <Check /> : <Eye />}</span>
        <span className="gaze-button__label">{cheio ? 'Clicou!' : 'Olhe aqui'}</span>
      </span>
      <span className="gaze-button-progress-ring" />
    </div>
  );
};

/* ── Tela ─────────────────────────────────────────────────────────────── */

export const TutorialScreen: React.FC = () => {
  const navigate = useNavigate();
  const [passo, setPasso] = useState(0);

  // Prática de dwell: os alvos precisam ser acionados na ordem 1, 2, 3.
  // Funciona igual com o olhar (o dwell dispara um click de verdade) e com o
  // mouse do cuidador quando o rastreamento ainda não está calibrado.
  const [acertos, setAcertos] = useState(0);
  const praticaConcluida = acertos >= ALVOS_DA_PRATICA;

  const ultimo = passo === TOTAL_PASSOS - 1;
  const proximo = () => setPasso((p) => Math.min(TOTAL_PASSOS - 1, p + 1));
  const anterior = () => setPasso((p) => Math.max(0, p - 1));

  const acertarAlvo = (indice: number) => {
    if (indice === acertos) setAcertos(indice + 1);
  };

  const passos: { titulo: string; corpo: React.ReactNode; figura: React.ReactNode }[] = [
    {
      titulo: 'A câmera vê seus olhos',
      figura: <IlustracaoCamera />,
      corpo: (
        <>
          <p>A câmera do computador acompanha para onde você está olhando.</p>
          <p>Você não precisa mexer a cabeça: só os olhos. Mantenha a cabeça confortável e parada.</p>
        </>
      ),
    },
    {
      titulo: 'Fique numa boa posição',
      figura: <IlustracaoPosicao />,
      corpo: (
        <>
          <p>Sente-se a mais ou menos um braço de distância da tela, com o rosto no meio da imagem.</p>
          <p>A luz deve vir da frente, não de trás. Evite janela ou lâmpada atrás de você.</p>
        </>
      ),
    },
    {
      titulo: 'Para clicar, é só olhar',
      figura: <DemoDeDwell />,
      corpo: (
        <>
          <p>Olhe para um botão e fique olhando. Um anel vai se enchendo em volta dele.</p>
          <p>Quando o anel completa, o botão é acionado. Se desviar o olhar antes, nada acontece.</p>
        </>
      ),
    },
    {
      titulo: 'Vamos praticar',
      figura: (
        <div style={{ width: 'min(100%, 720px)', height: 180 }}>
          <GazeGrid columns={ALVOS_DA_PRATICA} rows={1} gap={40}>
            {Array.from({ length: ALVOS_DA_PRATICA }, (_, i) => {
              const feito = i < acertos;
              const daVez = i === acertos;
              return (
                <GazeButton
                  key={i}
                  size="lg"
                  variant={daVez ? 'primary' : 'secondary'}
                  disabled={feito}
                  icon={feito ? <Check /> : <Crosshair />}
                  label={feito ? 'Feito' : `Alvo ${i + 1}`}
                  aria-label={feito ? `Alvo ${i + 1} já acionado` : `Alvo ${i + 1}`}
                  onClick={() => acertarAlvo(i)}
                />
              );
            })}
          </GazeGrid>
        </div>
      ),
      corpo: praticaConcluida ? (
        <p role="status" style={{ color: 'var(--ok)', fontWeight: 700 }}>
          Muito bem! Você já sabe clicar com o olhar.
        </p>
      ) : (
        <>
          <p>Olhe para os alvos na ordem, do 1 ao 3, até cada um ser acionado.</p>
          <p role="status" aria-live="polite" style={{ fontWeight: 700 }}>
            {acertos} de {ALVOS_DA_PRATICA}
          </p>
        </>
      ),
    },
    {
      titulo: 'O botão de emergência',
      figura: (
        <div
          aria-hidden="true"
          className="gaze-button gaze-button--danger gaze-button--lg"
          style={{ width: 200, height: 120, cursor: 'default' }}
        >
          <span className="gaze-button-content">
            <span className="gaze-button__icon"><AlertOctagon /></span>
            <span className="gaze-button__label">Emergência</span>
          </span>
        </div>
      ),
      corpo: (
        <>
          <p>O botão vermelho fica sempre no canto superior direito da tela.</p>
          <p>Olhe para ele quando precisar de ajuda. Ele conta cinco segundos antes de chamar, e nesse tempo você pode cancelar.</p>
        </>
      ),
    },
    {
      titulo: 'Descansar os olhos',
      figura: (
        <div
          data-no-dwell="true"
          className="gaze-rest-zone"
          aria-hidden="true"
          style={{ width: 'min(100%, 420px)', height: 120, flex: 'none' }}
        >
          <Moon size={28} />
          <span>Zona de descanso</span>
        </div>
      ),
      corpo: (
        <>
          <p>A área tracejada no alto de cada tela não aciona nada. Deixe o olhar parado ali quando quiser pensar.</p>
          <p>Para uma pausa maior, o menu tem a opção Descansar: a tela escurece e só um botão acorda o sistema.</p>
        </>
      ),
    },
    {
      titulo: 'Agora, a calibração',
      figura: <IlustracaoCalibracao />,
      corpo: (
        <>
          <p>Para o sistema aprender o seu olhar, pontos vão aparecer um por vez na tela.</p>
          <p>Olhe para cada ponto e fique parado até ele sumir. Leva cerca de um minuto.</p>
        </>
      ),
    },
  ];

  const atual = passos[passo];

  return (
    <GazePageLayout showBack backRoute="/" title="Tutorial">
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%', gap: '1.25rem' }}>
        {/* Conteúdo do passo */}
        <section
          key={passo}
          className="animate-fade-in"
          aria-labelledby="tutorial-step-title"
          style={{
            flex: '1 1 auto',
            minHeight: 0,
            overflowY: 'auto',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            textAlign: 'center',
            gap: '1.5rem',
            padding: '0 1rem',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: '100%' }}>
            {atual.figura}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', maxWidth: '44ch' }}>
            <p style={{ fontSize: 'var(--fs-16)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', color: 'var(--text-3)' }}>
              Passo {passo + 1} de {TOTAL_PASSOS}
            </p>
            <h2 id="tutorial-step-title" className="font-display" style={{ fontSize: 'var(--fs-32)' }}>
              {atual.titulo}
            </h2>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', fontSize: 'var(--fs-24)', color: 'var(--text-2)', lineHeight: 1.45 }}>
              {atual.corpo}
            </div>
          </div>
        </section>

        {/* Indicador de progresso (não é alvo) */}
        <ol
          aria-label={`Passo ${passo + 1} de ${TOTAL_PASSOS}`}
          style={{ display: 'flex', justifyContent: 'center', gap: '0.6rem', listStyle: 'none', margin: 0, padding: 0 }}
        >
          {passos.map((p, i) => (
            <li
              key={p.titulo}
              aria-current={i === passo ? 'step' : undefined}
              style={{
                width: i === passo ? 36 : 12,
                height: 12,
                borderRadius: 'var(--r-pill)',
                background: i <= passo ? 'var(--primary)' : 'var(--border)',
                transition: 'width 0.25s ease, background-color 0.25s ease',
              }}
            />
          ))}
        </ol>

        {/* Navegação: uma ação principal (à direita), as outras discretas */}
        <div style={{ height: 160, flex: '0 0 auto' }}>
          <GazeGrid columns={3} rows={1} gap={40}>
            <GazeButton
              size="lg"
              variant="secondary"
              icon={<ArrowLeft />}
              label="Voltar"
              disabled={passo === 0}
              onClick={anterior}
            />
            {ultimo ? (
              <GazeButton
                size="lg"
                variant="ghost"
                icon={<Home />}
                label="Voltar ao início"
                onClick={() => navigate('/')}
              />
            ) : (
              <GazeButton
                size="lg"
                variant="ghost"
                icon={<SkipForward />}
                label="Pular tutorial"
                onClick={() => navigate('/calibration-check')}
              />
            )}
            {ultimo ? (
              <GazeButton
                size="lg"
                variant="primary"
                icon={<Crosshair />}
                label="Ir para a calibração"
                onClick={() => navigate('/calibration-check')}
              />
            ) : (
              <GazeButton
                size="lg"
                variant="primary"
                icon={<ArrowRight />}
                label="Próximo"
                onClick={proximo}
              />
            )}
          </GazeGrid>
        </div>
      </div>
    </GazePageLayout>
  );
};
