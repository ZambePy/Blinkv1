import React, { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Eye, Ruler, Lightbulb, Loader2, AlertTriangle, SunDim } from 'lucide-react';
import { useGaze } from '../../context/GazeContext';
import { useSettings } from '../../context/SettingsContext';
import { BackButton } from '../../components/ui/BackButton';
import { startAccuracyTest } from '@tracker/accuracy';
import type { RunMeta } from '@tracker/accuracy';

// Grade 3×3 (10/50/90). Mantida local para evitar dependência de API ainda não exportada.
const CALIBRATION_POINTS = [
  { x: 10, y: 10, name: 'Superior Esquerdo' },
  { x: 50, y: 10, name: 'Superior Central' },
  { x: 90, y: 10, name: 'Superior Direito' },
  { x: 10, y: 50, name: 'Meio Esquerdo' },
  { x: 50, y: 50, name: 'Centro' },
  { x: 90, y: 50, name: 'Meio Direito' },
  { x: 10, y: 90, name: 'Inferior Esquerdo' },
  { x: 50, y: 90, name: 'Inferior Central' },
  { x: 90, y: 90, name: 'Inferior Direito' },
];

// ─── Paleta CAA — escura em todas as etapas ────────────────────────────────
// Fundo preto reduz fadiga ocular e força menos a piscada, permitindo fixações
// mais longas e estáveis. Contraste alto (branco/âmbar sobre preto) é o padrão CAA.
//
// Ajuste do plano de brilho (Camadas 1-3): as cores de PONTO DE FIXAÇÃO foram
// dessaturadas — mesmo em tela escura, um alvo hipersaturado que o usuário
// olha fixamente por 3s satura a pupila e induz piscada reflexa. Trocamos
// azul cheio (#1B54A8) por um azul suave (#5B7FBF) SOMENTE no ponto de
// fixação; o resto da UI mantém a marca (#1B54A8) para hierarquia visual.
const BG           = '#050810';                     // era #000000 — quase-preto reduz smearing em LCD
const TEXT_PRIMARY = '#E5E7EB';                     // era #FFFFFF — evita branco puro (contraste ~13:1)
const TEXT_DIM     = 'rgba(229,231,235,0.60)';
const ACCENT       = '#1B54A8';                     // Mantém IrisFlow Azul para UI (botões, tags)
const ACCENT_DIM   = 'rgba(27, 84, 168, 0.15)';
const DOT_COLOR    = '#5B7FBF';                     // Ponto de fixação — azul dessaturado, menos ofuscante
const DOT_GLOW     = 'rgba(91, 127, 191, 0.35)';    // Halo do ponto — 35% em vez de "puro"
const SUCCESS      = '#22C55E';
const DANGER       = '#EF4444';

// Piscadas por minuto acima disso durante calibração = fadiga ou brilho
// excessivo. Referência clínica: repouso ~17/min; >25/min sustentado é
// sinal de irritação, dry eye ou glare. Usado só para AVISAR — nunca
// interromper a calibração.
const BLINK_ALERT_THRESHOLD = 25;

const humanMessage: Record<string, string> = {
  singular_matrix: 'Não foi possível treinar o modelo (matriz singular). A causa mais comum é reflexo constante nos óculos ou desvio extremo do olhar.',
  insufficient_samples: 'Amostras insuficientes coletadas. Certifique-se de que seu rosto está visível e centralizado durante toda a calibração.',
  degenerate_features: 'Os dados coletados não variaram o suficiente. A causa mais comum é reflexo nos óculos travando a detecção ou olhar fixo fora dos pontos.',
  unknown: 'Erro desconhecido durante o treinamento do modelo. Por favor, tente novamente.',
};

export const CalibrationCheck: React.FC = () => {
  const navigate = useNavigate();
  const { calibration, l2csStatus } = useGaze();
  const { settings, updateSettings } = useSettings();

  // Camada 3 do conforto visual — monitora taxa de piscada durante calibração.
  // Alerta discreto (não bloqueia) quando > 25/min sustentado. Botão de ação
  // baixa o brilho da UI 20 pontos percentuais imediatamente, sem sair da tela.
  const [blinkRate, setBlinkRate] = useState(0);
  const [blinkAlertDismissed, setBlinkAlertDismissed] = useState(false);

  const l2csReady  = l2csStatus === 'ready';
  const l2csFailed = l2csStatus === 'error';

  const [stage, setStage] = useState<
    'pre-calibration' | 'tutorial' | 'calibrating' | 'testing' | 'transitioning'
  >('pre-calibration');

  const [currentIndex, setCurrentIndex]       = useState(0);
  const [completedList, setCompletedList]     = useState<number[]>([]);
  const [errorMessage, setErrorMessage]       = useState<string | null>(null);
  const [lastCompletedPoint, setLastCompletedPoint] = useState<number | null>(null);
  const [preparing, setPreparing]             = useState(false);
  const PREPARE_MS = 1500;

  const orderRef                 = useRef<number[]>([]);
  const isMounted                = useRef(true);
  const retryCountRef            = useRef(0);
  const MAX_RETRIES_PER_POINT    = 3;

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  // Amostra taxa de piscada a cada 2s durante calibração. Só ativo no stage
  // 'calibrating' — em 'pre-calibration' e 'tutorial' o usuário está lendo
  // texto e piscando normalmente, não é sinal de nada. Reset do dismissal
  // toda vez que a calibração recomeça (novo alerta se persistir).
  useEffect(() => {
    if (stage !== 'calibrating') return;
    setBlinkAlertDismissed(false);
    const interval = setInterval(() => {
      if (!isMounted.current) return;
      // Janela curta (30s) — resposta mais rápida durante os ~25s de calibração.
      const rate = calibration.getRecentBlinkRatePerMinute?.(30000) ?? 0;
      setBlinkRate(rate);
    }, 2000);
    return () => clearInterval(interval);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const AUTO_TEST_META: RunMeta = {
    data: new Date().toISOString().slice(0, 10),
    iluminacao: 'boa',
    oculos: false,
    movimentoCabeca: 'parada',
    minutosDeSessao: 0,
    observacoes: 'auto (imediatamente após calibração)',
    distanciaCm: 60,
    telaPolegadas: 15.6,
  };

  const finishAndTransition = () => {
    setStage('transitioning');
    setTimeout(() => { navigate('/menu'); }, 800);
  };

  const runAccuracyTestThenExit = () => {
    startAccuracyTest((_result, action) => {
      if (!isMounted.current) return;
      if (action === 'redo') {
        calibration.clear?.();
        setStage('tutorial');
        setCompletedList([]);
        return;
      }
      finishAndTransition();
    }, AUTO_TEST_META);
  };

  const startNextPoint = (step: number) => {
    if (!isMounted.current) return;
    const order = orderRef.current;

    if (step >= order.length) {
      setStage('testing');
      calibration.completeCalibration?.((outcome) => {
        if (!outcome || outcome.ok !== false) {
          console.log('[React] Calibração concluída — disparando teste de precisão automático');
          setTimeout(() => { if (isMounted.current) runAccuracyTestThenExit(); }, 400);
        } else {
          if (isMounted.current) {
            const reason = outcome.reason || 'unknown';
            const msg = humanMessage[reason] || humanMessage.unknown;
            console.error(`[React] Treinamento falhou: ${reason} - ${outcome.detail}`);
            setErrorMessage(msg);
            setStage('tutorial');
          }
        }
      });
      return;
    }

    const pointIdx = order[step];
    setCurrentIndex(pointIdx);
    setErrorMessage(null);
    setLastCompletedPoint(null);

    const pt = CALIBRATION_POINTS[pointIdx];
    calibration.startCollectingPoint?.(pt.x / 100, pt.y / 100, (success: boolean) => {
      if (!isMounted.current) return;
      if (success) {
        retryCountRef.current = 0;
        setLastCompletedPoint(pointIdx);
        setCompletedList(prev => [...prev, pointIdx]);
        setTimeout(() => { if (isMounted.current) startNextPoint(step + 1); }, 1200);
      } else {
        retryCountRef.current++;
        if (retryCountRef.current >= MAX_RETRIES_PER_POINT) {
          retryCountRef.current = 0;
          setCompletedList(prev => [...prev, pointIdx]);
          setTimeout(() => { if (isMounted.current) startNextPoint(step + 1); }, 500);
        } else {
          setErrorMessage('Tente não se mover. Tentando novamente...');
          setTimeout(() => { if (isMounted.current) startNextPoint(step); }, 1500);
        }
      }
    });
  };

  const handleStart = () => {
    if (!l2csReady) return;
    setStage('calibrating');
    setCompletedList([]);

    // Ordem raster: superior-esquerdo → inferior-direito, linha por linha.
    // CALIBRATION_POINTS já está declarado nessa ordem, então basta [0..8].
    // Ordem previsível reduz carga cognitiva (usuário sabe pra onde olhar em
    // seguida) e evita que o ponto mais difícil (inferior-direito, canto de
    // rotação ocular extrema) caia no início antes do usuário estar acostumado.
    const order = CALIBRATION_POINTS.map((_, i) => i);
    orderRef.current = order;
    setCurrentIndex(order[0]);
    calibration.startCalibrationMode?.();

    setPreparing(true);
    setTimeout(() => {
      if (!isMounted.current) return;
      setPreparing(false);
      startNextPoint(0);
    }, PREPARE_MS);
  };

  const progressPct = (completedList.length / CALIBRATION_POINTS.length) * 100;

  // ─── TRANSIÇÃO ────────────────────────────────────────────────────────────
  if (stage === 'transitioning') {
    return (
      <div style={{
        position: 'fixed', inset: 0,
        backgroundColor: BG,
        zIndex: 9999,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        animation: 'cfFadeOut 0.8s ease-in-out forwards',
      }}>
        <div style={{
          width: '100vw', height: '100vh',
          background: `radial-gradient(circle, ${ACCENT} 0%, ${BG} 100%)`,
          animation: 'cfRipple 0.8s ease-out forwards',
        }} />
        <style>{`
          @keyframes cfFadeOut { from { opacity:1; } to { opacity:0; } }
          @keyframes cfRipple  { from { transform:scale(0.1); opacity:1; } to { transform:scale(3); opacity:0; } }
        `}</style>
      </div>
    );
  }

  return (
    <>
      <main
        role="main"
        style={{
          position: 'relative',
          width: '100vw', height: '100vh',
          background: BG,
          color: TEXT_PRIMARY,
          overflow: 'hidden',
          userSelect: 'none',
          display: 'flex', flexDirection: 'column',
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Botão Voltar — só nas telas pré-calibração */}
        {(stage === 'pre-calibration' || stage === 'tutorial') && (
          <div style={{ position: 'absolute', top: '2rem', left: '2rem', zIndex: 60 }}>
            <BackButton />
          </div>
        )}

        {/* ─── PRÉ-CALIBRAÇÃO ──────────────────────────────────────────── */}
        {stage === 'pre-calibration' && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
            <div style={{
              maxWidth: 600, width: '100%',
              display: 'flex', flexDirection: 'column', gap: '1.75rem',
              animation: 'cfFadeUp 0.4s ease-out both',
            }}>
              {/* Cabeçalho CAA */}
              <div style={{ textAlign: 'center' }}>
                <div style={{
                  width: 88, height: 88, borderRadius: '50%',
                  background: ACCENT_DIM,
                  border: `3px solid ${ACCENT}`,
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: '1.25rem',
                }}>
                  <Eye size={44} color={ACCENT} />
                </div>
                <h1 style={{ fontSize: '2rem', fontWeight: 800, margin: '0 0 0.5rem', color: TEXT_PRIMARY }}>
                  Antes de começar
                </h1>
                <p style={{ fontSize: '1.05rem', color: TEXT_DIM, margin: 0, lineHeight: 1.6 }}>
                  Verifique as condições para que o sistema funcione bem.
                </p>
              </div>

              {/* Cards de instrução — frases curtas, ícones grandes */}
              {([
                { icon: <Ruler size={30} color={ACCENT} />, title: '📏  50 a 60 cm da tela', body: 'Fique confortável. Não precisa se aproximar muito.' },
                { icon: <Lightbulb size={30} color={ACCENT} />, title: '💡  Rosto bem iluminado', body: 'Evite luz forte atrás de você ou reflexo nos óculos.' },
                { icon: <Eye size={30} color={ACCENT} />, title: '👁  Olhos abertos, cabeça parada', body: 'Mova só os olhos ao seguir o ponto. Não vire a cabeça.' },
              ] as { icon: React.ReactNode; title: string; body: string }[]).map((card, i) => (
                <div key={i} style={{
                  display: 'flex', alignItems: 'center', gap: '1.25rem',
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.10)',
                  padding: '1.1rem 1.4rem',
                  borderRadius: '1.25rem',
                }}>
                  <div style={{
                    width: 52, height: 52, borderRadius: '0.875rem',
                    background: ACCENT_DIM,
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    {card.icon}
                  </div>
                  <div>
                    <div style={{ fontWeight: 700, fontSize: '1rem', marginBottom: '0.2rem' }}>{card.title}</div>
                    <div style={{ fontSize: '0.9rem', color: TEXT_DIM, lineHeight: 1.5 }}>{card.body}</div>
                  </div>
                </div>
              ))}

              <button
                type="button"
                onClick={() => setStage('tutorial')}
                style={{
                  background: ACCENT, color: '#fff',
                  border: 'none', padding: '1rem 3rem',
                  borderRadius: '2rem', fontSize: '1.15rem', fontWeight: 800,
                  cursor: 'pointer', alignSelf: 'center',
                  boxShadow: '0 8px 24px rgba(27, 84, 168, 0.40)',
                  transition: 'transform 0.15s, box-shadow 0.15s',
                }}
                onMouseOver={e => { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(27, 84, 168, 0.55)'; }}
                onMouseOut={e => { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 8px 24px rgba(27, 84, 168, 0.40)'; }}
              >
                Entendi ✓
              </button>
            </div>
          </div>
        )}

        {/* ─── TUTORIAL / INÍCIO ───────────────────────────────────────── */}
        {stage === 'tutorial' && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
            <div style={{
              maxWidth: 500, width: '100%',
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              textAlign: 'center', gap: '2rem',
              animation: 'cfFadeUp 0.4s ease-out both',
            }}>
              {/* Preview do ponto — mostra ao usuário o que vai aparecer */}
              <div style={{ position: 'relative', width: 90, height: 90, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ position: 'absolute', width: 80, height: 80, borderRadius: '50%', background: `radial-gradient(circle, rgba(27, 84, 168, 0.22) 0%, transparent 70%)`, animation: 'cfRadarPing 2s ease-out infinite' }} />
                <div style={{ width: 34, height: 34, borderRadius: '50%', background: ACCENT, boxShadow: `0 0 30px ${ACCENT}`, animation: 'cfPulse 1.2s infinite alternate' }} />
                <div style={{ position: 'absolute', width: 9, height: 9, borderRadius: '50%', background: BG, opacity: 0.85 }} />
              </div>

              <div>
                <h1 style={{ fontSize: '2.1rem', fontWeight: 800, margin: '0 0 0.75rem', color: TEXT_PRIMARY }}>
                  Calibração
                </h1>
                <p style={{ fontSize: '1.1rem', color: TEXT_DIM, margin: 0, lineHeight: 1.65 }}>
                  Um ponto <strong style={{ color: ACCENT }}>azul</strong> vai aparecer na tela.<br />
                  Olhe <strong style={{ color: TEXT_PRIMARY }}>direto para ele</strong> e fique parado até sumir.
                </p>
              </div>

              {errorMessage && (
                <div style={{
                  padding: '1rem',
                  background: 'rgba(239, 68, 68, 0.1)',
                  border: `1px solid ${DANGER}`,
                  borderRadius: '0.75rem',
                  color: DANGER,
                  fontSize: '0.95rem',
                  maxWidth: 400,
                  lineHeight: 1.5,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.75rem',
                  textAlign: 'left',
                  animation: 'cfFadeUp 0.3s ease-out both'
                }}>
                  <AlertTriangle size={24} style={{ flexShrink: 0 }} />
                  <div>
                    <strong style={{ display: 'block', marginBottom: '0.15rem' }}>Falha na calibração</strong>
                    {errorMessage}
                    <div style={{ marginTop: '0.5rem' }}>
                      <a
                        href="/caregiver/guide"
                        onClick={(e) => {
                          e.preventDefault();
                          navigate('/caregiver/guide?from=/calibration-check');
                        }}
                        style={{
                          color: '#ef4444',
                          fontWeight: 700,
                          textDecoration: 'underline',
                          fontSize: '0.9rem',
                          cursor: 'pointer'
                        }}
                      >
                        Ver Guia de Instalação e Dicas do Cuidador
                      </a>
                    </div>
                  </div>
                </div>
              )}

              <button
                type="button"
                onClick={handleStart}
                disabled={!l2csReady}
                data-no-dwell="true"
                aria-disabled={!l2csReady}
                aria-describedby="l2cs-status-message"
                style={{
                  background: l2csReady ? ACCENT : 'rgba(255,255,255,0.10)',
                  color: l2csReady ? '#fff' : TEXT_DIM,
                  border: 'none',
                  padding: '1rem 3rem',
                  borderRadius: '2rem',
                  fontSize: '1.15rem', fontWeight: 800,
                  cursor: l2csReady ? 'pointer' : 'not-allowed',
                  display: 'flex', alignItems: 'center', gap: '0.7rem',
                  transition: 'all 0.2s',
                  boxShadow: l2csReady ? '0 8px 24px rgba(27, 84, 168, 0.40)' : 'none',
                  opacity: l2csReady ? 1 : 0.75,
                }}
                onMouseOver={e => { if (l2csReady) { e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 12px 32px rgba(27, 84, 168, 0.55)'; } }}
                onMouseOut={e => { if (l2csReady) { e.currentTarget.style.transform = ''; e.currentTarget.style.boxShadow = '0 8px 24px rgba(27, 84, 168, 0.40)'; } }}
              >
                {l2csReady && '👁  Começar'}
                {l2csStatus === 'loading' && (<><Loader2 size={20} style={{ animation: 'cfSpin 1s linear infinite' }} />Carregando...</>)}
                {l2csFailed && (<><AlertTriangle size={20} />Modelo indisponível</>)}
              </button>

              <div
                id="l2cs-status-message"
                role={l2csFailed ? 'alert' : 'status'}
                aria-live="polite"
                style={{ fontSize: '0.88rem', color: l2csFailed ? DANGER : TEXT_DIM, minHeight: '1.4rem', maxWidth: 400, lineHeight: 1.5 }}
              >
                {l2csStatus === 'loading' && 'Aguardando o modelo (~10-15s na 1ª vez). Não feche a página.'}
                {l2csFailed && 'Não foi possível carregar o modelo. Recarregue a página e tente novamente.'}
              </div>
            </div>
          </div>
        )}

        {/* ─── CALIBRANDO ──────────────────────────────────────────────── */}
        {stage === 'calibrating' && (
          <>
            {/* Barra de progresso — discreta, no topo, não distrai o olhar */}
            <div style={{
              position: 'absolute', top: '1.25rem', left: '50%', transform: 'translateX(-50%)',
              zIndex: 40, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem',
            }}>
              <div style={{ width: 130, height: 4, background: 'rgba(255,255,255,0.10)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${progressPct}%`, height: '100%', background: ACCENT, transition: 'width 0.5s ease-out', borderRadius: 2 }} />
              </div>
              <span style={{ fontSize: '0.8rem', color: TEXT_DIM, fontVariantNumeric: 'tabular-nums' }}>
                {completedList.length} / {CALIBRATION_POINTS.length}
              </span>
            </div>

            {/* Instrução contextual — só quando necessário (prepare-se / erro) */}
            {(preparing || errorMessage) && (
              <div style={{
                position: 'absolute', bottom: '2.5rem', left: '50%', transform: 'translateX(-50%)',
                zIndex: 40, padding: '0.7rem 2rem',
                background: errorMessage ? 'rgba(239,68,68,0.12)' : 'rgba(27, 84, 168, 0.10)',
                border: `1px solid ${errorMessage ? DANGER : ACCENT}`,
                borderRadius: '3rem',
                color: errorMessage ? DANGER : ACCENT,
                fontSize: '1.05rem', fontWeight: 600, whiteSpace: 'nowrap',
              }}>
                {errorMessage ?? '👁  Prepare-se… olhe para o ponto azul'}
              </div>
            )}

            {/* Alerta de piscada excessiva — Camada 3 do conforto visual.
             * Aparece só quando taxa > 25/min E cuidador ainda não dispensou.
             * Cor âmbar (não vermelho) — é sugestão, não erro. Ação inline
             * reduz brilho 20 pp e re-arma o dismissal. Ficar no CANTO SUPERIOR
             * DIREITO para não competir visualmente com o ponto de calibração
             * no centro/embaixo. */}
            {blinkRate > BLINK_ALERT_THRESHOLD && !blinkAlertDismissed && !errorMessage && !preparing && (
              <div
                role="status"
                aria-live="polite"
                style={{
                  position: 'absolute', top: '1.5rem', right: '1.5rem',
                  zIndex: 45,
                  display: 'flex', alignItems: 'center', gap: '0.75rem',
                  padding: '0.75rem 1rem',
                  background: 'rgba(217, 119, 6, 0.15)',
                  border: '1px solid rgba(217, 119, 6, 0.55)',
                  borderRadius: '1rem',
                  color: '#fbbf24',
                  fontSize: '0.9rem', fontWeight: 600,
                  maxWidth: 340,
                  backdropFilter: 'blur(6px)',
                }}
              >
                <SunDim size={22} color="#fbbf24" aria-hidden="true" />
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem', minWidth: 0 }}>
                  <span>Piscadas frequentes ({Math.round(blinkRate)}/min). O brilho pode estar alto.</span>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      type="button"
                      onClick={() => {
                        const next = Math.max(0.4, settings.brightnessLevel - 0.2);
                        updateSettings({ brightnessLevel: next });
                        setBlinkAlertDismissed(true);
                      }}
                      style={{
                        padding: '0.35rem 0.75rem', borderRadius: '999px',
                        background: '#d97706', color: '#fff',
                        border: 'none', fontWeight: 700, fontSize: '0.8rem', cursor: 'pointer',
                      }}
                    >
                      Baixar brilho
                    </button>
                    <button
                      type="button"
                      onClick={() => setBlinkAlertDismissed(true)}
                      style={{
                        padding: '0.35rem 0.75rem', borderRadius: '999px',
                        background: 'transparent', color: 'rgba(251,191,36,0.85)',
                        border: '1px solid rgba(251,191,36,0.35)', fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer',
                      }}
                    >
                      Ignorar
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Pontos de calibração */}
            {CALIBRATION_POINTS.map((pt, idx) => {
              const isCurrent      = idx === currentIndex;
              const isDone         = completedList.includes(idx);
              const isJustFinished = idx === lastCompletedPoint;

              return (
                <div
                  key={idx}
                  style={{
                    position: 'absolute',
                    left: `${pt.x}%`, top: `${pt.y}%`,
                    transform: 'translate(-50%, -50%)',
                    width: 80, height: 80,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    zIndex: isCurrent ? 30 : 10,
                  }}
                >
                  {/* ── Ponto atual ── */}
                  {isCurrent && !isJustFinished && (
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      {/* Halo pulsante — "olhe aqui" (mesma cor dessaturada do ponto) */}
                      <div style={{
                        position: 'absolute', width: 72, height: 72, borderRadius: '50%',
                        background: `radial-gradient(circle, ${DOT_GLOW} 0%, transparent 70%)`,
                        animation: 'cfRadarPing 2.2s ease-out infinite',
                      }} />
                      {/* Anel rotativo de guia */}
                      <div style={{
                        position: 'absolute', width: 52, height: 52, borderRadius: '50%',
                        border: '2px solid rgba(91, 127, 191, 0.30)',
                        animation: 'cfHalo 3s linear infinite',
                      }} />
                      {/* Ponto central — azul dessaturado, glow reduzido (Camada 1 do conforto)
                       * Antes: #1B54A8 (cheio) + glow de 36px = alvo hipersaturado que
                       * força contração pupilar constante durante os 3s de fixação.
                       * Agora: #5B7FBF + glow de 18px = ainda WCAG AAA sobre fundo escuro
                       * (contraste ~7:1) porém não ofuscante. */}
                      <div style={{
                        width: 34, height: 34, borderRadius: '50%',
                        background: DOT_COLOR,
                        boxShadow: `0 0 0 6px ${DOT_GLOW}, 0 0 18px rgba(91, 127, 191, 0.55)`,
                        animation: 'cfPulse 1.2s infinite alternate',
                      }} />
                    </div>
                  )}

                  {/* ── Recém concluído ── */}
                  {isJustFinished && (
                    <div style={{
                      width: 48, height: 48, borderRadius: '50%',
                      background: SUCCESS,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      boxShadow: `0 0 24px rgba(34,197,94,0.70)`,
                      animation: 'cfScaleIn 0.3s cubic-bezier(0.34,1.56,0.64,1) both',
                    }}>
                      <CheckCircle2 size={28} color="#fff" />
                    </div>
                  )}

                  {/* ── Feito, não recente ── */}
                  {isDone && !isJustFinished && (
                    <div style={{ width: 10, height: 10, borderRadius: '50%', background: SUCCESS, opacity: 0.35 }} />
                  )}

                  {/* ── Pendente ── */}
                  {!isCurrent && !isDone && (
                    <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'rgba(255,255,255,0.13)' }} />
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* ─── TESTING ─────────────────────────────────────────────────── */}
        {stage === 'testing' && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem' }}>
            <div style={{
              display: 'flex', flexDirection: 'column', alignItems: 'center',
              textAlign: 'center', gap: '1.5rem',
              animation: 'cfFadeUp 0.4s ease-out both',
            }}>
              <Loader2 size={52} color={ACCENT} style={{ animation: 'cfSpin 1s linear infinite' }} />
              <div>
                <h2 style={{ fontSize: '1.65rem', fontWeight: 800, margin: '0 0 0.5rem', color: TEXT_PRIMARY }}>
                  Iniciando teste de precisão
                </h2>
                <p style={{ color: TEXT_DIM, fontSize: '1rem', margin: 0, lineHeight: 1.6 }}>
                  Não se mexa. Olhe para os pontos que aparecerem.
                </p>
              </div>
            </div>
          </div>
        )}

        {/* ─── KEYFRAMES ───────────────────────────────────────────────── */}
        <style>{`
          @keyframes cfPulse {
            0%   { transform: scale(0.88); box-shadow: 0 0 0 8px rgba(27, 84, 168, 0.15), 0 0 18px #1B54A8; }
            100% { transform: scale(1.10); box-shadow: 0 0 0 12px rgba(27, 84, 168, 0.05), 0 0 44px #1B54A8; }
          }
          @keyframes cfRadarPing {
            0%   { transform: scale(0.1); opacity: 0.9; }
            100% { transform: scale(2.8); opacity: 0; }
          }
          @keyframes cfHalo {
            from { transform: rotate(0deg)   scale(1);    border-color: rgba(27, 84, 168, 0.40); }
            50%  { transform: rotate(180deg) scale(1.06); border-color: rgba(27, 84, 168, 0.20); }
            to   { transform: rotate(360deg) scale(1);    border-color: rgba(27, 84, 168, 0.40); }
          }
          @keyframes cfSpin    { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
          @keyframes cfFadeUp  { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }
          @keyframes cfScaleIn { from { opacity:0; transform:scale(0.4); } to { opacity:1; transform:scale(1); } }
        `}</style>
      </main>
    </>
  );
};
