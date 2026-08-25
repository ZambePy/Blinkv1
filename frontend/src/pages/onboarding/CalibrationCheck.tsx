import React, { useRef, useState, useEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Eye, Ruler, Lightbulb, Loader2, AlertTriangle } from 'lucide-react';
import { useGaze } from '../../context/GazeContext';
import { BackButton } from '../../components/ui/BackButton';
import { startAccuracyTest } from '@tracker/accuracy';
import { buildAutoTestMeta } from '../../utils/autoTestMeta';
import type { OpticalCondition } from '@tracker/calibrationProfiles';

// D6.1 — a lista canônica de alvos passou a viver em `src/calibration.ts`
// (CALIBRATION_TARGETS_FULL). A UI consulta pelo context após chamar
// startCalibrationMode(opts) — a lista muda entre full (9 alvos) e quick
// (4 cantos) conforme `opts.quick`. Enquanto nada é iniciado, a lista default
// é a full pra a tela de tutorial mostrar "9 pontos" com honestidade.
interface CalibrationPointUI { x: number; y: number; name: string; }
const POINT_NAME: Record<string, string> = {
  '0.1,0.1': 'Superior Esquerdo',
  '0.5,0.1': 'Superior Central',
  '0.9,0.1': 'Superior Direito',
  '0.1,0.5': 'Meio Esquerdo',
  '0.5,0.5': 'Centro',
  '0.9,0.5': 'Meio Direito',
  '0.1,0.9': 'Inferior Esquerdo',
  '0.5,0.9': 'Inferior Central',
  '0.9,0.9': 'Inferior Direito',
};

// D6.2 — opções de condição óptica expostas ao cuidador. `desconhecido` é o
// default de compat (perfil pré-D6). Progressivos ganham warn no console
// via shouldWarnPrecisionForCondition — não é mentira dizer que a precisão
// vai ser pior. A UI mostra o rótulo em português.
const OPTICAL_LABELS: Record<OpticalCondition, string> = {
  sem_oculos:          'Sem óculos',
  oculos_simples:      'Óculos comuns (leitura, míopia)',
  oculos_progressivo:  'Óculos progressivos (multifocais)',
  lentes_contato:      'Lentes de contato',
  desconhecido:        'Prefiro não dizer',
};
const OPTICAL_OPTIONS: OpticalCondition[] = [
  'sem_oculos',
  'oculos_simples',
  'oculos_progressivo',
  'lentes_contato',
  'desconhecido',
];

// ─── Paleta CAA — escura em todas as etapas ────────────────────────────────
// Fundo preto reduz fadiga ocular e força menos a piscada, permitindo fixações
// mais longas e estáveis. Contraste alto (branco/âmbar sobre preto) é o padrão CAA.
const BG           = '#000000';
const TEXT_PRIMARY = '#FFFFFF';
const TEXT_DIM     = 'rgba(255,255,255,0.65)';
const ACCENT       = '#1B54A8';          // IrisFlow Azul
const ACCENT_DIM   = 'rgba(27, 84, 168, 0.15)';
const SUCCESS      = '#22C55E';
const DANGER       = '#EF4444';

const humanMessage: Record<string, string> = {
  singular_matrix: 'Não foi possível treinar o modelo (matriz singular). A causa mais comum é reflexo constante nos óculos ou desvio extremo do olhar.',
  insufficient_samples: 'Amostras insuficientes coletadas. Certifique-se de que seu rosto está visível e centralizado durante toda a calibração.',
  degenerate_features: 'Os dados coletados não variaram o suficiente. A causa mais comum é reflexo nos óculos travando a detecção ou olhar fixo fora dos pontos.',
  unknown: 'Erro desconhecido durante o treinamento do modelo. Por favor, tente novamente.',
};

export const CalibrationCheck: React.FC = () => {
  const navigate = useNavigate();
  const { calibration, l2csStatus, getSessionUptimeMs } = useGaze();

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

  // D6.2 — seleção da condição óptica antes de iniciar. Default `desconhecido`
  // preserva o comportamento antes de D6 (perfil salvo como desconhecido).
  const [opticalCondition, setOpticalCondition] = useState<OpticalCondition>('desconhecido');
  // D6.1 — modo em curso; controla renderização de "4/4" vs "9/9" e a lista
  // de alvos consultada para display. Nulo enquanto nada iniciou.
  const [calibrationMode, setCalibrationMode] = useState<'full' | 'quick' | null>(null);

  // Lista de alvos ATUALMENTE usada pela sessão em curso (ou full por default).
  // useMemo por segurança contra rerenders desnecessários — a lista muda só
  // quando calibrationMode muda.
  const activePoints: CalibrationPointUI[] = useMemo(() => {
    const targets = calibrationMode === 'quick'
      ? calibration.getCalibrationTargets?.() ?? []
      : calibration.getCalibrationTargets?.() ?? [];
    if (targets.length === 0) {
      // Fallback: se o engine ainda não subiu, hardcode a grade full para
      // não quebrar a tela de tutorial. Idêntico ao layout pré-D6.
      return [
        { x: 0.1, y: 0.1 }, { x: 0.5, y: 0.1 }, { x: 0.9, y: 0.1 },
        { x: 0.1, y: 0.5 }, { x: 0.5, y: 0.5 }, { x: 0.9, y: 0.5 },
        { x: 0.1, y: 0.9 }, { x: 0.5, y: 0.9 }, { x: 0.9, y: 0.9 },
      ].map((t) => ({ x: t.x * 100, y: t.y * 100, name: POINT_NAME[`${t.x},${t.y}`] ?? '' }));
    }
    return targets.map((t) => ({
      x: t.x * 100,
      y: t.y * 100,
      name: POINT_NAME[`${t.x},${t.y}`] ?? '',
    }));
  }, [calibrationMode, calibration]);

  const shuffleOrderRef          = useRef<number[]>([]);
  const isMounted                = useRef(true);
  const retryCountRef            = useRef(0);
  const MAX_RETRIES_PER_POINT    = 3;

  useEffect(() => {
    isMounted.current = true;
    return () => { isMounted.current = false; };
  }, []);

  const finishAndTransition = () => {
    setStage('transitioning');
    setTimeout(() => { navigate('/menu'); }, 800);
  };

  const runAccuracyTestThenExit = () => {
    // D2 (ROADMAP.md) — meta capturada NA HORA do accuracy test, não no mount:
    //   - `minutosDeSessao` reflete uptime real do engine (via engine.getSessionUptimeMs)
    //   - `oculos` deriva do perfil ativo (`desconhecido` até D6 expor a UI)
    // Antes: hardcode 0/false, todo relatório automático mentia.
    const meta = buildAutoTestMeta({
      sessionUptimeMs: getSessionUptimeMs(),
      opticalCondition: calibration.getActiveOpticalCondition?.() ?? 'desconhecido',
      // Geometria segue como default nesta sprint — D5 troca por distância
      // medida via faceMatrix[14]. `telaPolegadas: 15.6` é o hardcode que
      // o ROADMAP §5 registra explicitamente como pendência do D5/S1-1.
      distanciaCm: 60,
      telaPolegadas: 15.6,
    });
    startAccuracyTest((_result, action) => {
      if (!isMounted.current) return;
      if (action === 'redo') {
        calibration.clear?.();
        setStage('tutorial');
        setCompletedList([]);
        return;
      }
      finishAndTransition();
    }, meta);
  };

  const startNextPoint = (step: number) => {
    if (!isMounted.current) return;
    const order = shuffleOrderRef.current;

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

    const pt = activePoints[pointIdx];
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

  // D6.1/D6.2 — inicia calibração. `quick=true` reduz para 4 cantos e passa
  // opts.quick para o backend. `opticalCondition` grava o perfil sob a
  // condição escolhida — antes de D6.2, todo perfil ficava como `desconhecido`
  // silenciosamente.
  const handleStart = (quick: boolean = false) => {
    if (!l2csReady) return;
    setCalibrationMode(quick ? 'quick' : 'full');
    setStage('calibrating');
    setCompletedList([]);

    // startCalibrationMode ANTES do useMemo reagir — chamamos aqui e a lista
    // ativa vem via getCalibrationTargets() na hora do startNextPoint.
    calibration.startCalibrationMode?.({ quick, opticalCondition });

    // Ordem embaralhada em cima do TAMANHO REAL da lista ativa após o setState
    // (que ainda não propagou). Como `getCalibrationTargets` já retorna a
    // lista certa depois de startCalibrationMode, usamos ela direto.
    const targets = calibration.getCalibrationTargets?.() ?? [];
    const order = targets.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    shuffleOrderRef.current = order;
    setCurrentIndex(order[0]);

    setPreparing(true);
    setTimeout(() => {
      if (!isMounted.current) return;
      setPreparing(false);
      startNextPoint(0);
    }, PREPARE_MS);
  };

  const progressPct = activePoints.length > 0
    ? (completedList.length / activePoints.length) * 100
    : 0;

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

              {/* D6.2 — seleção da condição óptica ANTES de iniciar. Persiste no
                   perfil salvo (StoredCalibrationProfile.meta.opticalCondition).
                   Antes de D6.2 todo perfil ficava como 'desconhecido' — o
                   default aqui preserva esse fallback caso o cuidador não escolha. */}
              <label
                htmlFor="opticalConditionSelect"
                data-testid="optical-condition-label"
                style={{
                  fontSize: '0.9rem',
                  color: TEXT_DIM,
                  alignSelf: 'stretch',
                  textAlign: 'left',
                  fontWeight: 600,
                }}
              >
                Condição óptica do usuário:
              </label>
              <select
                id="opticalConditionSelect"
                data-testid="optical-condition-select"
                value={opticalCondition}
                onChange={(e) => setOpticalCondition(e.target.value as OpticalCondition)}
                data-no-dwell="true"
                style={{
                  alignSelf: 'stretch',
                  padding: '0.75rem 1rem',
                  background: 'rgba(255,255,255,0.08)',
                  border: '1px solid rgba(255,255,255,0.15)',
                  borderRadius: '0.75rem',
                  color: TEXT_PRIMARY,
                  fontSize: '1rem',
                  fontFamily: 'inherit',
                  cursor: 'pointer',
                }}
              >
                {OPTICAL_OPTIONS.map((cond) => (
                  <option key={cond} value={cond} style={{ background: '#111' }}>
                    {OPTICAL_LABELS[cond]}
                  </option>
                ))}
              </select>

              <button
                type="button"
                onClick={() => handleStart(false)}
                disabled={!l2csReady}
                data-no-dwell="true"
                data-testid="start-calibration-full"
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
                {l2csReady && '👁  Começar (9 pontos)'}
                {l2csStatus === 'loading' && (<><Loader2 size={20} style={{ animation: 'cfSpin 1s linear infinite' }} />Carregando...</>)}
                {l2csFailed && (<><AlertTriangle size={20} />Modelo indisponível</>)}
              </button>

              {/* D6.1 — modo rápido: 4 cantos, sem centro. Coerente com o
                   achado Frontiers 2024 (§3 do ROADMAP). Meta de tempo: <15s
                   contra ~19-29s do modo completo. Botão SECUNDÁRIO — o full
                   continua sendo a via principal para usuário novo. */}
              {l2csReady && (
                <button
                  type="button"
                  onClick={() => handleStart(true)}
                  data-no-dwell="true"
                  data-testid="start-calibration-quick"
                  style={{
                    background: 'transparent',
                    color: TEXT_PRIMARY,
                    border: `1px solid rgba(255,255,255,0.35)`,
                    padding: '0.7rem 2.2rem',
                    borderRadius: '2rem',
                    fontSize: '0.95rem', fontWeight: 700,
                    cursor: 'pointer',
                    transition: 'all 0.15s',
                  }}
                  onMouseOver={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.08)'; }}
                  onMouseOut={e => { e.currentTarget.style.background = 'transparent'; }}
                >
                  Recalibração rápida (4 pontos)
                </button>
              )}

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
                {completedList.length} / {activePoints.length}
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

            {/* Pontos de calibração */}
            {activePoints.map((pt, idx) => {
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
                      {/* Halo pulsante — "olhe aqui" */}
                      <div style={{
                        position: 'absolute', width: 72, height: 72, borderRadius: '50%',
                        background: 'radial-gradient(circle, rgba(27, 84, 168, 0.22) 0%, transparent 70%)',
                        animation: 'cfRadarPing 2.2s ease-out infinite',
                      }} />
                      {/* Anel rotativo de guia */}
                      <div style={{
                        position: 'absolute', width: 52, height: 52, borderRadius: '50%',
                        border: '2px solid rgba(27, 84, 168, 0.40)',
                        animation: 'cfHalo 3s linear infinite',
                      }} />
                      {/* Ponto central — azul, limpo, sem elementos sobre ele */}
                      <div style={{
                        width: 34, height: 34, borderRadius: '50%',
                        background: ACCENT,
                        boxShadow: `0 0 0 8px rgba(27, 84, 168, 0.18), 0 0 36px ${ACCENT}`,
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
