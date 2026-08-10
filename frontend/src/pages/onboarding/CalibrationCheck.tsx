import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Eye, RefreshCw, ArrowRight, Play, Sparkles, AlertTriangle } from 'lucide-react';
import { BackButton } from '../../components/ui/BackButton';
import { SystemStatusHeader } from '../../components/ui/SystemStatusHeader';
import { useGaze } from '../../context/GazeContext';

// Os 13 pontos em porcentagem
const CALIBRATION_POINTS = [
  { x: 10, y: 10, name: "Superior Esquerdo" },
  { x: 36, y: 10, name: "Superior Meio-Esquerdo" },
  { x: 63, y: 10, name: "Superior Meio-Direito" },
  { x: 90, y: 10, name: "Superior Direito" },
  { x: 10, y: 50, name: "Centro Esquerdo" },
  { x: 36, y: 50, name: "Centro Meio-Esquerdo" },
  { x: 50, y: 50, name: "Centro" },
  { x: 63, y: 50, name: "Centro Meio-Direito" },
  { x: 90, y: 50, name: "Centro Direito" },
  { x: 10, y: 90, name: "Inferior Esquerdo" },
  { x: 50, y: 90, name: "Inferior Centro" },
  { x: 90, y: 90, name: "Inferior Direito" },
  { x: 75, y: 75, name: "Diagonal Inferior-Direita" },
];

export const CalibrationCheck: React.FC = () => {
  const navigate = useNavigate();
  const { calibration, state } = useGaze();

  const [stage, setStage] = useState<'tutorial' | 'calibrating' | 'finished'>('tutorial');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [completedList, setCompletedList] = useState<number[]>([]);
  const [isCollecting, setIsCollecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const startNextPoint = (index: number) => {
    if (index >= CALIBRATION_POINTS.length) {
      setStage('finished');
      calibration.completeCalibration?.(() => {
        console.log('[React] Calibração Headless Concluída e Modelo Treinado!');
      });
      return;
    }

    setCurrentIndex(index);
    setErrorMessage(null);
    setIsCollecting(true);
    
    // Motor Headless requer coordenadas relativas (0 a 1)
    const pt = CALIBRATION_POINTS[index];
    calibration.startCollectingPoint?.(pt.x / 100, pt.y / 100, (success: boolean) => {
      if (success) {
        setIsCollecting(false);
        setCompletedList(prev => [...prev, index]);
        setTimeout(() => {
          startNextPoint(index + 1);
        }, 1000); // 1 segundo de transição
      } else {
        setIsCollecting(false);
        setErrorMessage('Atenção! Você se distraiu ou piscou muito. Tentando de novo...');
        setTimeout(() => {
          startNextPoint(index);
        }, 2000); // Tenta de novo em 2s
      }
    });
  };

  const handleStart = () => {
    setStage('calibrating');
    setCompletedList([]);
    setCurrentIndex(0);
    calibration.startCalibrationMode?.();
    startNextPoint(0);
  };

  return (
    <>
      <SystemStatusHeader
        cameraActive={state !== 'idle' && state !== 'loading'}
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
        <div style={{ position: 'absolute', top: '1.5rem', left: '1.5rem', zIndex: 60 }}>
          <BackButton />
        </div>

        {stage === 'tutorial' && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', zIndex: 10 }}>
            <div style={{ background: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(20px)', borderRadius: '2rem', padding: '3rem 2.5rem', maxWidth: 540, width: '100%', boxShadow: '0 20px 40px rgba(27, 84, 168, 0.08)', border: '2px solid rgba(255, 255, 255, 0.9)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '1.75rem' }}>
              <div style={{ width: 84, height: 84, borderRadius: '50%', background: 'linear-gradient(135deg, #1B54A8 0%, #2563eb 100%)', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 10px 25px rgba(27, 84, 168, 0.25)' }}>
                <Eye size={44} color="#ffffff" />
              </div>
              <div>
                <h1 id="calibration-title" style={{ fontSize: '2rem', fontWeight: 800, color: '#1B54A8', margin: '0 0 0.5rem 0' }}>Calibração Ocular</h1>
                <p style={{ color: '#64748b', fontSize: '1.05rem', margin: 0, lineHeight: 1.5 }}>Prepare a câmera e seu olhar antes de começarmos a navegação por visão.</p>
              </div>
              <div style={{ background: 'rgba(241, 245, 249, 0.8)', borderRadius: '1.25rem', padding: '1.25rem 1.5rem', width: '100%', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column', gap: '1rem', textAlign: 'left' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
                  <span style={{ background: '#1B54A8', color: 'white', width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.85rem', flexShrink: 0 }}>1</span>
                  <span style={{ color: '#334155', fontSize: '0.95rem' }}>Siga as instruções na tela e acompanhe os <strong>13 pontos</strong> usando seu olhar. Tente não piscar enquanto a bolinha estiver pulsando.</span>
                </div>
              </div>
              <button type="button" onClick={handleStart} style={{ background: 'linear-gradient(135deg, #1B54A8 0%, #2563eb 100%)', color: 'white', border: 'none', padding: '1.1rem 2rem', borderRadius: '1.25rem', fontSize: '1.2rem', fontWeight: 700, cursor: 'pointer', width: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.75rem', boxShadow: '0 10px 25px rgba(27, 84, 168, 0.3)', transition: 'all 0.2s ease' }}>
                <Play size={22} fill="white" /> Iniciar Calibração
              </button>
            </div>
          </div>
        )}

        {stage === 'calibrating' && (
          <>
            <header style={{ position: 'absolute', top: '1.5rem', left: '50%', transform: 'translateX(-50%)', zIndex: 40, background: 'rgba(255, 255, 255, 0.85)', backdropFilter: 'blur(16px)', padding: '0.6rem 1.75rem', borderRadius: '2rem', border: '1px solid rgba(27, 84, 168, 0.15)', display: 'flex', alignItems: 'center', gap: '1.25rem', boxShadow: '0 8px 24px rgba(0, 0, 0, 0.05)' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                <Eye color="#1B54A8" size={22} />
                <span style={{ fontSize: '1rem', fontWeight: 700, color: '#1B54A8' }}>Calibrando (Headless Mode)</span>
              </div>
              <div style={{ background: 'rgba(27, 84, 168, 0.1)', border: '1px solid rgba(27, 84, 168, 0.2)', padding: '0.2rem 0.75rem', borderRadius: '1rem', fontSize: '0.85rem', fontWeight: 700, color: '#1B54A8' }}>
                Ponto {currentIndex + 1} de {CALIBRATION_POINTS.length}
              </div>
            </header>

            <div style={{ position: 'absolute', bottom: '2.5rem', left: '50%', transform: 'translateX(-50%)', zIndex: 40, background: errorMessage ? '#ef4444' : (isCollecting ? 'rgba(255, 255, 255, 0.9)' : '#16a34a'), backdropFilter: 'blur(12px)', padding: '0.75rem 2rem', borderRadius: '1.5rem', border: isCollecting && !errorMessage ? '1px solid rgba(27, 84, 168, 0.2)' : 'none', color: isCollecting && !errorMessage ? '#1e293b' : '#ffffff', fontSize: '1rem', fontWeight: 600, boxShadow: '0 10px 25px rgba(0, 0, 0, 0.06)', transition: 'all 0.3s ease', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              {errorMessage ? <><AlertTriangle size={20}/> {errorMessage}</> :
                isCollecting ? `Olhe fixamente para o ponto ${CALIBRATION_POINTS[currentIndex]?.name}` : '✓ Ponto registrado! Movendo para o próximo...'}
            </div>

            {CALIBRATION_POINTS.map((pt, idx) => {
              const isCurrent = idx === currentIndex;
              const isDone = completedList.includes(idx);

              return (
                <div key={idx} style={{ position: 'absolute', left: `${pt.x}%`, top: `${pt.y}%`, transform: 'translate(-50%, -50%)', width: 80, height: 80, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: isCurrent ? 30 : 10 }}>
                  {isDone && (
                    <div style={{ width: 40, height: 40, borderRadius: '50%', background: '#16a34a', boxShadow: '0 4px 12px rgba(22, 163, 74, 0.4)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <CheckCircle2 size={24} color="#ffffff" />
                    </div>
                  )}

                  {isCurrent && (
                    <div style={{ position: 'relative', width: 80, height: 80 }}>
                      <svg width="80" height="80" style={{ transform: 'rotate(-90deg)' }}>
                        <circle cx="40" cy="40" r="32" stroke="rgba(27, 84, 168, 0.15)" strokeWidth="6" fill="transparent" />
                        <circle cx="40" cy="40" r="32" stroke="#1B54A8" strokeWidth="6" fill="transparent" strokeDasharray="201" strokeDashoffset={isCollecting ? 0 : 201} strokeLinecap="round" style={{ transition: 'stroke-dashoffset 1.5s linear' }} />
                      </svg>
                      <div style={{ position: 'absolute', top: '50%', left: '50%', transform: 'translate(-50%, -50%)', width: 22, height: 22, borderRadius: '50%', background: '#1B54A8', boxShadow: '0 0 15px rgba(27, 84, 168, 0.6)', animation: 'pulseGlow 1s infinite alternate' }} />
                    </div>
                  )}

                  {!isCurrent && !isDone && (
                    <div style={{ width: 14, height: 14, borderRadius: '50%', background: 'rgba(27, 84, 168, 0.2)', border: '2px solid rgba(27, 84, 168, 0.3)' }} />
                  )}
                </div>
              );
            })}
          </>
        )}

        {stage === 'finished' && (
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', zIndex: 50 }}>
            <div style={{ background: 'rgba(255, 255, 255, 0.9)', backdropFilter: 'blur(24px)', padding: '3rem 2.5rem', borderRadius: '2rem', border: '2px solid rgba(255, 255, 255, 0.9)', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', maxWidth: 500, width: '100%', boxShadow: '0 20px 40px rgba(27, 84, 168, 0.08)', gap: '1.5rem' }}>
              <div style={{ width: 84, height: 84, borderRadius: '50%', background: 'rgba(22, 163, 74, 0.12)', border: '1px solid rgba(22, 163, 74, 0.2)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Sparkles size={46} color="#16a34a" />
              </div>
              <div>
                <h2 style={{ fontSize: '2rem', fontWeight: 800, color: '#1E293B', margin: '0 0 0.5rem 0' }}>Calibração Concluída!</h2>
                <p style={{ color: '#64748b', fontSize: '1.05rem', margin: 0 }}>Sua navegação por olhar foi calibrada nos 13 pontos Headless de precisão e salva no seu perfil.</p>
              </div>
              <div style={{ display: 'flex', gap: '1rem', width: '100%', marginTop: '0.5rem' }}>
                <button type="button" onClick={handleStart} style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '1rem', borderRadius: '1.25rem', border: '1px solid #e2e8f0', background: 'white', color: '#475569', fontSize: '1rem', fontWeight: 600, cursor: 'pointer' }}>
                  <RefreshCw size={18} /> Repetir
                </button>
                <button type="button" onClick={() => navigate('/menu')} style={{ flex: 1.5, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '0.5rem', padding: '1rem', borderRadius: '1.25rem', border: 'none', background: 'linear-gradient(135deg, #1B54A8 0%, #2563eb 100%)', color: 'white', fontSize: '1rem', fontWeight: 700, cursor: 'pointer', boxShadow: '0 10px 20px rgba(27, 84, 168, 0.3)' }}>
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
