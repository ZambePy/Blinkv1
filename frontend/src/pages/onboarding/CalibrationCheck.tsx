import React, { useEffect, useState, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Eye, RefreshCw, ArrowRight, Play, Sparkles } from 'lucide-react';
import { BackButton } from '../../components/ui/BackButton';
import { SystemStatusHeader } from '../../components/ui/SystemStatusHeader';

interface Point {
  x: number; // % horizontal
  y: number; // % vertical
  name: string;
}

// 9 pontos: Ziguezague horizontal constante (Linha 1 -> Linha 2 -> Linha 3)
const CALIBRATION_POINTS: Point[] = [
  { x: 12, y: 15, name: 'Superior Esquerdo' },
  { x: 50, y: 15, name: 'Superior Centro' },
  { x: 88, y: 15, name: 'Superior Direito' },
  { x: 12, y: 50, name: 'Centro Esquerdo' },
  { x: 50, y: 50, name: 'Centro' },
  { x: 88, y: 50, name: 'Centro Direito' },
  { x: 12, y: 85, name: 'Inferior Esquerdo' },
  { x: 50, y: 85, name: 'Inferior Centro' },
  { x: 88, y: 85, name: 'Inferior Direito' },
];

const HOLD_DURATION = 2000; // 2 segundos no ponto
const PAUSE_DURATION = 1000; // 1 segundo entre os pontos

export const CalibrationCheck: React.FC = () => {
  const navigate = useNavigate();

  const [stage, setStage] = useState<'tutorial' | 'calibrating' | 'finished'>('tutorial');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [progress, setProgress] = useState(0);
  const [isPausing, setIsPausing] = useState(false);
  const [completedList, setCompletedList] = useState<number[]>([]);

  // Refs de controle de estado em tempo real para evitar dependências cíclicas em hooks
  const currentIndexRef = useRef(0);
  const isPausingRef = useRef(false);
  const completedListRef = useRef<number[]>([]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    isPausingRef.current = isPausing;
  }, [isPausing]);

  useEffect(() => {
    let animId: number;
    let pauseTimeout: NodeJS.Timeout;
    let startTime: number | null = null;

    if (stage !== 'calibrating') return;

    const step = (timestamp: number) => {
      if (isPausingRef.current) return;

      if (!startTime) startTime = timestamp;
      const elapsed = timestamp - startTime;
      const pct = Math.min((elapsed / HOLD_DURATION) * 100, 100);

      setProgress(pct);

      if (pct < 100) {
        animId = requestAnimationFrame(step);
      } else {
        // Concluiu o ponto atual!
        const activeIndex = currentIndexRef.current;
        const newCompleted = [...completedListRef.current, activeIndex];
        completedListRef.current = newCompleted;
        setCompletedList(newCompleted);

        setIsPausing(true);
        isPausingRef.current = true;

        if (activeIndex + 1 < CALIBRATION_POINTS.length) {
          pauseTimeout = setTimeout(() => {
            const nextIdx = activeIndex + 1;
            setCurrentIndex(nextIdx);
            currentIndexRef.current = nextIdx;
            setProgress(0);
            setIsPausing(false);
            isPausingRef.current = false;
            startTime = null;
            animId = requestAnimationFrame(step);
          }, PAUSE_DURATION);
        } else {
          pauseTimeout = setTimeout(() => {
            setStage('finished');
          }, 600);
        }
      }
    };

    animId = requestAnimationFrame(step);

    return () => {
      cancelAnimationFrame(animId);
      clearTimeout(pauseTimeout);
    };
  }, [stage, currentIndex]);

  const handleStart = () => {
    setCurrentIndex(0);
    currentIndexRef.current = 0;
    setProgress(0);
    setIsPausing(false);
    isPausingRef.current = false;
    setCompletedList([]);
    completedListRef.current = [];
    setStage('calibrating');
  };

  return (
    <>
      <SystemStatusHeader
        cameraActive={true}
        trackingActive={stage === 'calibrating'}
        calibrationDone={stage === 'finished'}
      />

      <main
        role="main"
        aria-labelledby="calibration-title"
        style={{
          position: 'relative',
          width: '100vw',
          height: 'calc(100vh - 40px)',
          background: 'linear-gradient(160deg, #f0f4ff 0%, #e8f0fb 50%, #f1f5f9 100%)',
          color: '#1e293b',
          overflow: 'hidden',
          userSelect: 'none',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        }}
      >
        {/* Botão Voltar */}
        <div style={{ position: 'absolute', top: '1.5rem', left: '1.5rem', zIndex: 60 }}>
          <BackButton />
        </div>

        {/* 1. TELA DE TUTORIAL */}
        {stage === 'tutorial' && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2rem',
              zIndex: 10,
            }}
          >
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.85)',
                backdropFilter: 'blur(20px)',
                WebkitBackdropFilter: 'blur(20px)',
                borderRadius: '2rem',
                padding: '3rem 2.5rem',
                maxWidth: 540,
                width: '100%',
                boxShadow: '0 20px 40px rgba(27, 84, 168, 0.08)',
                border: '2px solid rgba(255, 255, 255, 0.9)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                gap: '1.75rem',
              }}
            >
              <div
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: '50%',
                  background: 'linear-gradient(135deg, #1B54A8 0%, #2563eb 100%)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  boxShadow: '0 10px 25px rgba(27, 84, 168, 0.25)',
                }}
              >
                <Eye size={44} color="#ffffff" />
              </div>

              <div>
                <h1
                  id="calibration-title"
                  style={{ fontSize: '2rem', fontWeight: 800, color: '#1B54A8', margin: '0 0 0.5rem 0' }}
                >
                  Calibração Ocular
                </h1>
                <p style={{ color: '#64748b', fontSize: '1.05rem', margin: 0, lineHeight: 1.5 }}>
                  Prepare a câmera e seu olhar antes de começarmos a navegação por visão.
                </p>
              </div>

              <div
                style={{
                  background: 'rgba(241, 245, 249, 0.8)',
                  borderRadius: '1.25rem',
                  padding: '1.25rem 1.5rem',
                  width: '100%',
                  border: '1px solid #e2e8f0',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: '1rem',
                  textAlign: 'left',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <span
                    style={{
                      background: '#1B54A8',
                      color: 'white',
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      flexShrink: 0,
                    }}
                  >
                    1
                  </span>
                  <span style={{ color: '#334155', fontSize: '0.95rem' }}>
                    Acompanhe os <strong>9 pontos</strong> na tela (da esquerda à direita).
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <span
                    style={{
                      background: '#1B54A8',
                      color: 'white',
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      flexShrink: 0,
                    }}
                  >
                    2
                  </span>
                  <span style={{ color: '#334155', fontSize: '0.95rem' }}>
                    Mantenha o foco fixo por <strong>2 segundos</strong> em cada ponto.
                  </span>
                </div>

                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <span
                    style={{
                      background: '#1B54A8',
                      color: 'white',
                      width: 26,
                      height: 26,
                      borderRadius: '50%',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 700,
                      fontSize: '0.85rem',
                      flexShrink: 0,
                    }}
                  >
                    3
                  </span>
                  <span style={{ color: '#334155', fontSize: '0.95rem' }}>
                    Haverá um descanso de <strong>1 segundo</strong> entre as trocas de ponto.
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={handleStart}
                style={{
                  background: 'linear-gradient(135deg, #1B54A8 0%, #2563eb 100%)',
                  color: 'white',
                  border: 'none',
                  padding: '1.1rem 2rem',
                  borderRadius: '1.25rem',
                  fontSize: '1.2rem',
                  fontWeight: 700,
                  cursor: 'pointer',
                  width: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: '0.75rem',
                  boxShadow: '0 10px 25px rgba(27, 84, 168, 0.3)',
                  transition: 'all 0.2s ease',
                }}
              >
                <Play size={22} fill="white" /> Iniciar Calibração
              </button>
            </div>
          </div>
        )}

        {/* 2. TELA DE EXECUÇÃO DA CALIBRAÇÃO */}
        {stage === 'calibrating' && (
          <>
            {/* Header Superior */}
            <header
              style={{
                position: 'absolute',
                top: '1.5rem',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 40,
                background: 'rgba(255, 255, 255, 0.85)',
                backdropFilter: 'blur(16px)',
                WebkitBackdropFilter: 'blur(16px)',
                padding: '0.6rem 1.75rem',
                borderRadius: '2rem',
                border: '1px solid rgba(27, 84, 168, 0.15)',
                display: 'flex',
                alignItems: 'center',
                gap: '1.25rem',
                boxShadow: '0 8px 24px rgba(0, 0, 0, 0.05)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Eye color="#1B54A8" size={22} />
                <span style={{ fontSize: '1rem', fontWeight: 700, color: '#1B54A8' }}>
                  Calibrando
                </span>
              </div>
              <div
                style={{
                  background: 'rgba(27, 84, 168, 0.1)',
                  border: '1px solid rgba(27, 84, 168, 0.2)',
                  padding: '0.2rem 0.75rem',
                  borderRadius: '1rem',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  color: '#1B54A8',
                }}
              >
                Ponto {currentIndex + 1} de 9
              </div>
            </header>

            {/* Banner de status flutuante inferior */}
            <div
              style={{
                position: 'absolute',
                bottom: '2.5rem',
                left: '50%',
                transform: 'translateX(-50%)',
                zIndex: 40,
                background: isPausing ? '#16a34a' : 'rgba(255, 255, 255, 0.9)',
                backdropFilter: 'blur(12px)',
                WebkitBackdropFilter: 'blur(12px)',
                padding: '0.75rem 2rem',
                borderRadius: '1.5rem',
                border: isPausing ? 'none' : '1px solid rgba(27, 84, 168, 0.2)',
                color: isPausing ? '#ffffff' : '#1e293b',
                fontSize: '1rem',
                fontWeight: 600,
                boxShadow: '0 10px 25px rgba(0, 0, 0, 0.06)',
                transition: 'all 0.3s ease',
              }}
            >
              {isPausing
                ? '✓ Ponto registrado! Movendo para o próximo...'
                : `Olhe para o ponto no ${CALIBRATION_POINTS[currentIndex].name}`}
            </div>

            {/* 9 Pontos de Calibração */}
            {CALIBRATION_POINTS.map((pt, idx) => {
              const isCurrent = idx === currentIndex;
              const isDone = completedList.includes(idx);

              // SVG Radial Progress Ring
              const radius = 32;
              const circumference = 2 * Math.PI * radius;
              const strokeDashoffset = circumference - (progress / 100) * circumference;

              return (
                <div
                  key={idx}
                  style={{
                    position: 'absolute',
                    left: `${pt.x}%`,
                    top: `${pt.y}%`,
                    transform: 'translate(-50%, -50%)',
                    width: 80,
                    height: 80,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: isCurrent ? 30 : 10,
                  }}
                >
                  {/* 1. Ponto concluído */}
                  {isDone && (
                    <div
                      style={{
                        width: 40,
                        height: 40,
                        borderRadius: '50%',
                        background: '#16a34a',
                        boxShadow: '0 4px 12px rgba(22, 163, 74, 0.4)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <CheckCircle2 size={24} color="#ffffff" />
                    </div>
                  )}

                  {/* 2. Ponto Ativo (Com anel SVG animado e centralizador) */}
                  {isCurrent && (
                    <div style={{ position: 'relative', width: 80, height: 80 }}>
                      <svg width="80" height="80" style={{ transform: 'rotate(-90deg)' }}>
                        {/* Anel de fundo */}
                        <circle
                          cx="40"
                          cy="40"
                          r={radius}
                          stroke="rgba(27, 84, 168, 0.15)"
                          strokeWidth="6"
                          fill="transparent"
                        />
                        {/* Anel de progresso preenchendo */}
                        <circle
                          cx="40"
                          cy="40"
                          r={radius}
                          stroke="#1B54A8"
                          strokeWidth="6"
                          fill="transparent"
                          strokeDasharray={circumference}
                          strokeDashoffset={strokeDashoffset}
                          strokeLinecap="round"
                          style={{ transition: 'stroke-dashoffset 0.05s linear' }}
                        />
                      </svg>

                      {/* Centro do alvo ativo */}
                      <div
                        style={{
                          position: 'absolute',
                          top: '50%',
                          left: '50%',
                          transform: 'translate(-50%, -50%)',
                          width: 22,
                          height: 22,
                          borderRadius: '50%',
                          background: '#1B54A8',
                          boxShadow: '0 0 15px rgba(27, 84, 168, 0.6)',
                          animation: 'pulseGlow 1s infinite alternate',
                        }}
                      />
                    </div>
                  )}

                  {/* 3. Ponto Inativo (Futuro) */}
                  {!isCurrent && !isDone && (
                    <div
                      style={{
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        background: 'rgba(27, 84, 168, 0.2)',
                        border: '2px solid rgba(27, 84, 168, 0.3)',
                      }}
                    />
                  )}
                </div>
              );
            })}
          </>
        )}

        {/* 3. TELA DE CONCLUSÃO */}
        {stage === 'finished' && (
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: '2rem',
              zIndex: 50,
            }}
          >
            <div
              style={{
                background: 'rgba(255, 255, 255, 0.9)',
                backdropFilter: 'blur(24px)',
                WebkitBackdropFilter: 'blur(24px)',
                padding: '3rem 2.5rem',
                borderRadius: '2rem',
                border: '2px solid rgba(255, 255, 255, 0.9)',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                textAlign: 'center',
                maxWidth: 500,
                width: '100%',
                boxShadow: '0 20px 40px rgba(27, 84, 168, 0.08)',
                gap: '1.5rem',
              }}
            >
              <div
                style={{
                  width: 84,
                  height: 84,
                  borderRadius: '50%',
                  background: 'rgba(22, 163, 74, 0.12)',
                  border: '1px solid rgba(22, 163, 74, 0.2)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <Sparkles size={46} color="#16a34a" />
              </div>

              <div>
                <h2 style={{ fontSize: '2rem', fontWeight: 800, color: '#1E293B', margin: '0 0 0.5rem 0' }}>
                  Calibração Concluída!
                </h2>
                <p style={{ color: '#64748b', fontSize: '1.05rem', margin: 0 }}>
                  Sua navegação por olhar foi calibrada nos 9 pontos de referência.
                </p>
              </div>

              <div style={{ display: 'flex', gap: '1rem', width: '100%', marginTop: '0.5rem' }}>
                <button
                  type="button"
                  onClick={handleStart}
                  style={{
                    flex: 1,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    padding: '1rem',
                    borderRadius: '1.25rem',
                    border: '1px solid #e2e8f0',
                    background: 'white',
                    color: '#475569',
                    fontSize: '1rem',
                    fontWeight: 600,
                    cursor: 'pointer',
                  }}
                >
                  <RefreshCw size={18} /> Repetir
                </button>

                <button
                  type="button"
                  onClick={() => navigate('/menu')}
                  style={{
                    flex: 1.5,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    gap: '0.5rem',
                    padding: '1rem',
                    borderRadius: '1.25rem',
                    border: 'none',
                    background: 'linear-gradient(135deg, #1B54A8 0%, #2563eb 100%)',
                    color: 'white',
                    fontSize: '1rem',
                    fontWeight: 700,
                    cursor: 'pointer',
                    boxShadow: '0 10px 20px rgba(27, 84, 168, 0.3)',
                  }}
                >
                  Continuar <ArrowRight size={18} />
                </button>
              </div>
            </div>
          </div>
        )}

        <style>{`
          @keyframes pulseGlow {
            0% { transform: translate(-50%, -50%) scale(0.85); opacity: 0.8; }
            100% { transform: translate(-50%, -50%) scale(1.15); opacity: 1; }
          }
        `}</style>
      </main>
    </>
  );
};



