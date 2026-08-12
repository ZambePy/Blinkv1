import React, { useRef, useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { CheckCircle2, Eye } from 'lucide-react';
import { BackButton } from '../../components/ui/BackButton';
import { SystemStatusHeader } from '../../components/ui/SystemStatusHeader';
import { useGaze } from '../../context/GazeContext';

// Grade simétrica de 13 pontos (Sprint 1.3). Quatro em cada linha (10, 37, 63,
// 90) mais o centro (50, 50). Substitui a grade antiga 4-5-3 + diagonal, que
// subamostrava a borda inferior e enviesava o erro na periferia.
const CALIBRATION_POINTS = [
  { x: 10, y: 10, name: "Superior Esquerdo" },
  { x: 37, y: 10, name: "Superior Meio-Esquerdo" },
  { x: 63, y: 10, name: "Superior Meio-Direito" },
  { x: 90, y: 10, name: "Superior Direito" },
  { x: 10, y: 50, name: "Meio Esquerdo" },
  { x: 37, y: 50, name: "Meio Esquerdo-Central" },
  { x: 63, y: 50, name: "Meio Direito-Central" },
  { x: 90, y: 50, name: "Meio Direito" },
  { x: 10, y: 90, name: "Inferior Esquerdo" },
  { x: 37, y: 90, name: "Inferior Meio-Esquerdo" },
  { x: 63, y: 90, name: "Inferior Meio-Direito" },
  { x: 90, y: 90, name: "Inferior Direito" },
  { x: 50, y: 50, name: "Centro" },
];

export const CalibrationCheck: React.FC = () => {
  const navigate = useNavigate();
  const { calibration, state } = useGaze();

  const [stage, setStage] = useState<'tutorial' | 'calibrating' | 'finished' | 'transitioning'>('tutorial');
  const [currentIndex, setCurrentIndex] = useState(0);
  const [completedList, setCompletedList] = useState<number[]>([]);
  const [isCollecting, setIsCollecting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [lastCompletedPoint, setLastCompletedPoint] = useState<number | null>(null);

  const shuffleOrderRef = useRef<number[]>([]);

  const isMounted = useRef(true);

  // Mount/unmount guard only. Do NOT depend on `calibration` here — its identity
  // used to change on every engine state transition, which fired this cleanup
  // mid-flow, flipped isMounted to false, and hung the collection callback.
  // Do NOT call calibration.clear() on unmount either — if the calibration
  // finished successfully it would wipe the trained model. The next
  // startCalibrationMode() resets `profile` anyway.
  useEffect(() => {
    isMounted.current = true;
    return () => {
      isMounted.current = false;
    };
  }, []);

  const retryCountRef = useRef(0);
  const MAX_RETRIES_PER_POINT = 3;

  const startNextPoint = (step: number) => {
    if (!isMounted.current) return;
    
    const order = shuffleOrderRef.current;
    if (step >= order.length) {
      setStage('finished');
      calibration.completeCalibration?.(() => {
        console.log('[React] Calibração Headless Concluída e Modelo Treinado!');
      });
      return;
    }

    const pointIdx = order[step];
    setCurrentIndex(pointIdx);
    setErrorMessage(null);
    setIsCollecting(true);
    setLastCompletedPoint(null);

    const pt = CALIBRATION_POINTS[pointIdx];
    console.log(`[React] Iniciando ponto ${step + 1}/${order.length} (idx=${pointIdx}, ${pt.name})`);
    
    calibration.startCollectingPoint?.(pt.x / 100, pt.y / 100, (success: boolean) => {
      if (!isMounted.current) return;
      
      console.log(`[React] Callback do ponto ${pointIdx}: success=${success}`);
      
      if (success) {
        retryCountRef.current = 0;
        setIsCollecting(false);
        setLastCompletedPoint(pointIdx);
        setCompletedList(prev => [...prev, pointIdx]);
        setTimeout(() => {
          if (isMounted.current) startNextPoint(step + 1);
        }, 1200);
      } else {
        retryCountRef.current++;
        setIsCollecting(false);
        
        if (retryCountRef.current >= MAX_RETRIES_PER_POINT) {
          // Skip this point after too many failures
          console.warn(`[React] Ponto ${pointIdx} falhou ${MAX_RETRIES_PER_POINT}x — pulando`);
          retryCountRef.current = 0;
          setCompletedList(prev => [...prev, pointIdx]);
          setTimeout(() => {
            if (isMounted.current) startNextPoint(step + 1);
          }, 500);
        } else {
          setErrorMessage('Tente não se mover. Tentando novamente...');
          setTimeout(() => {
            if (isMounted.current) startNextPoint(step);
          }, 1500); 
        }
      }
    });
  };

  const handleStart = () => {
    setStage('calibrating');
    setCompletedList([]);
    const order = CALIBRATION_POINTS.map((_, i) => i);
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    shuffleOrderRef.current = order;
    setCurrentIndex(order[0]);
    calibration.startCalibrationMode?.();
    startNextPoint(0);
  };

  const finishAndTransition = () => {
    setStage('transitioning');
    setTimeout(() => {
      navigate('/menu');
    }, 800);
  };

  const progressPct = (completedList.length / CALIBRATION_POINTS.length) * 100;

  if (stage === 'transitioning') {
    return (
      <div style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: '#ffffff',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        animation: 'fadeOutToHome 0.8s ease-in-out forwards',
      }}>
        <div style={{
          width: '100vw',
          height: '100vh',
          background: 'radial-gradient(circle, #e8f0fb 0%, #ffffff 100%)',
          animation: 'expandRipple 0.8s ease-out forwards'
        }} />
        <style>{`
          @keyframes fadeOutToHome {
            0% { opacity: 1; }
            100% { opacity: 0; }
          }
          @keyframes expandRipple {
            0% { transform: scale(0.1); opacity: 1; }
            100% { transform: scale(3); opacity: 0; }
          }
        `}</style>
      </div>
    );
  }

  return (
    <>
      <SystemStatusHeader
        cameraActive={state !== 'idle' && state !== 'loading'}
        trackingActive={stage === 'calibrating'}
        calibrationDone={stage === 'finished'}
      />

      <main
        role="main"
        style={{
          position: 'relative',
          width: '100vw',
          height: 'calc(100vh - 40px)',
          background: '#ffffff',
          color: '#1e293b',
          overflow: 'hidden',
          userSelect: 'none',
          display: 'flex',
          flexDirection: 'column',
          fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        }}
      >
        <div style={{ position: 'absolute', top: '2rem', left: '2rem', zIndex: 60 }}>
          <BackButton />
        </div>

        {stage === 'tutorial' && (
          <div className="animate-fade-in-up" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', zIndex: 10 }}>
            <div style={{ background: '#ffffff', borderRadius: '2rem', padding: '4rem', maxWidth: 600, width: '100%', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', gap: '2rem' }}>
              <div style={{ width: 100, height: 100, borderRadius: '50%', background: '#e8f0fb', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <Eye size={50} color="#1B54A8" />
              </div>
              <div>
                <h1 style={{ fontSize: '2.5rem', fontWeight: 800, color: '#0f172a', margin: '0 0 1rem 0' }}>Calibração</h1>
                <p style={{ color: '#475569', fontSize: '1.25rem', margin: 0, lineHeight: 1.5 }}>
                  Siga o ponto com os olhos para calibrar o sistema. Mantenha seu rosto confortável e natural.
                </p>
              </div>
              
              <button 
                type="button" 
                onClick={handleStart} 
                style={{ background: '#1B54A8', color: 'white', border: 'none', padding: '1.2rem 3rem', borderRadius: '2rem', fontSize: '1.25rem', fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '0.75rem', marginTop: '1rem', transition: 'all 0.2s', boxShadow: '0 12px 24px rgba(27,84,168,0.2)' }}
                onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-2px)' }}
                onMouseOut={(e) => { e.currentTarget.style.transform = 'translateY(0)' }}
              >
                Começar
              </button>
            </div>
          </div>
        )}

        {stage === 'calibrating' && (
          <>
            <div className="animate-fade-in-up" style={{ position: 'absolute', bottom: '6rem', left: '50%', transform: 'translateX(-50%)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem', zIndex: 40, background: 'rgba(255,255,255,0.9)', padding: '1rem 3rem', borderRadius: '2rem', backdropFilter: 'blur(10px)', boxShadow: '0 10px 30px rgba(0,0,0,0.05)' }}>
              <span style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1B54A8' }}>
                {completedList.length} / {CALIBRATION_POINTS.length}
              </span>
              <div style={{ width: 160, height: 6, background: '#e2e8f0', borderRadius: 3, overflow: 'hidden' }}>
                <div style={{ width: `${progressPct}%`, height: '100%', background: '#1B54A8', transition: 'width 0.4s ease-out' }} />
              </div>
            </div>

            <div style={{ position: 'absolute', bottom: '2rem', left: '50%', transform: 'translateX(-50%)', zIndex: 40, color: errorMessage ? '#ef4444' : '#64748b', fontSize: '1.5rem', fontWeight: 600, transition: 'all 0.3s ease', opacity: isCollecting || errorMessage ? 1 : 0.4 }}>
              {errorMessage ? errorMessage : "Siga o ponto com os olhos"}
            </div>

            {CALIBRATION_POINTS.map((pt, idx) => {
              const isCurrent = idx === currentIndex;
              const isDone = completedList.includes(idx);
              const isJustFinished = idx === lastCompletedPoint;

              return (
                <div key={idx} style={{ position: 'absolute', left: `${pt.x}%`, top: `${pt.y}%`, transform: 'translate(-50%, -50%)', width: 100, height: 100, display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: isCurrent ? 30 : 10, transition: 'all 0.4s ease-out' }}>
                  
                  {isCurrent && !isJustFinished && (
                    <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ position: 'absolute', width: 70, height: 70, borderRadius: '50%', border: '4px solid rgba(27, 84, 168, 0.2)', animation: 'spin 4s linear infinite' }}>
                        <div style={{ position: 'absolute', top: -4, left: '50%', width: 8, height: 8, borderRadius: '50%', background: '#1B54A8' }} />
                      </div>
                      <div style={{ width: 32, height: 32, borderRadius: '50%', background: '#1B54A8', boxShadow: '0 0 20px rgba(27, 84, 168, 0.6)', animation: 'pulseGlow 1.2s infinite alternate' }} />
                    </div>
                  )}

                  {isJustFinished && (
                    <div className="animate-scale-in" style={{ width: 44, height: 44, borderRadius: '50%', background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 0 24px rgba(22, 163, 74, 0.6)' }}>
                      <CheckCircle2 size={26} color="#ffffff" />
                    </div>
                  )}

                  {isDone && !isJustFinished && (
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#cbd5e1' }} />
                  )}

                  {!isCurrent && !isDone && (
                    <div style={{ width: 12, height: 12, borderRadius: '50%', background: '#e2e8f0' }} />
                  )}
                </div>
              );
            })}
          </>
        )}

        {stage === 'finished' && (
          <div className="animate-scale-in" style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '2rem', zIndex: 50 }}>
            <div style={{ background: '#ffffff', padding: '4rem', borderRadius: '2rem', display: 'flex', flexDirection: 'column', alignItems: 'center', textAlign: 'center', maxWidth: 600, width: '100%', gap: '2rem' }}>
              <div style={{ width: 100, height: 100, borderRadius: '50%', background: '#16a34a', display: 'flex', alignItems: 'center', justifyContent: 'center', boxShadow: '0 20px 40px rgba(22,163,74,0.2)' }}>
                <CheckCircle2 size={50} color="#ffffff" />
              </div>
              <div>
                <h2 style={{ fontSize: '2.5rem', fontWeight: 800, color: '#0f172a', margin: '0 0 1rem 0' }}>Tudo pronto!</h2>
                <p style={{ color: '#475569', fontSize: '1.25rem', margin: 0 }}>Seu olhar foi calibrado com sucesso.</p>
              </div>
              <div style={{ display: 'flex', gap: '1.5rem', width: '100%', marginTop: '1rem', justifyContent: 'center' }}>
                <button type="button" onClick={handleStart} style={{ padding: '1.2rem 2.5rem', borderRadius: '2rem', border: '2px solid #e2e8f0', background: 'transparent', color: '#64748b', fontSize: '1.1rem', fontWeight: 700, cursor: 'pointer', transition: 'all 0.2s' }} onMouseOver={(e) => e.currentTarget.style.color = '#334155'} onMouseOut={(e) => e.currentTarget.style.color = '#64748b'}>
                  Refazer
                </button>
                <button type="button" onClick={finishAndTransition} style={{ padding: '1.2rem 3.5rem', borderRadius: '2rem', border: 'none', background: '#1B54A8', color: 'white', fontSize: '1.25rem', fontWeight: 700, cursor: 'pointer', boxShadow: '0 12px 24px rgba(27, 84, 168, 0.3)', transition: 'all 0.2s' }} onMouseOver={(e) => { e.currentTarget.style.transform = 'translateY(-2px)' }} onMouseOut={(e) => { e.currentTarget.style.transform = 'translateY(0)' }}>
                  Continuar
                </button>
              </div>
            </div>
          </div>
        )}

        <style>{`
          @keyframes pulseGlow {
            0% { transform: scale(0.9); opacity: 0.85; }
            100% { transform: scale(1.2); opacity: 1; box-shadow: 0 0 30px rgba(27, 84, 168, 0.8); }
          }
          @keyframes spin {
            from { transform: rotate(0deg); }
            to { transform: rotate(360deg); }
          }
        `}</style>
      </main>
    </>
  );
};
