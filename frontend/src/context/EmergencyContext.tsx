import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertOctagon } from 'lucide-react';
import { GazeButton } from '../components/ui/GazeButton';
import { useGaze } from './GazeContext';
import { playTickSound, playCancelSound } from '../utils/emergencyAudio';

interface EmergencyContextValue {
  isConfirming: boolean;
  cancelEmergency: () => void;
  triggerEmergencyImmediately: () => void;
}

const EmergencyContext = createContext<EmergencyContextValue | null>(null);

export const useEmergency = () => {
  const ctx = useContext(EmergencyContext);
  if (!ctx) throw new Error('useEmergency must be used inside <EmergencyProvider>');
  return ctx;
};

export const EmergencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isDegraded, state } = useGaze();

  // Durante a calibração e o teste de precisão o botão desce para o canto
  // inferior direito e some se ainda assim cobrir um alvo. Um botão sobre o
  // alvo de borda não é incômodo visual: numa sessão real produziu erro de
  // borda de 740 px contra 123 px de interior.
  const [medindo, setMedindo] = useState(false);
  const [fabOculto, setFabOculto] = useState(false);
  const fabRef = useRef<HTMLDivElement>(null);

  const [isConfirming, setIsConfirming] = useState(false);
  const [countdown, setCountdown] = useState(5);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Determina se a tela atual é de uso do paciente
  const isPatientScreen = () => {
    const path = location.pathname;
    if (
      path === '/' ||
      path === '/login' ||
      path.startsWith('/caregiver') ||
      path.startsWith('/settings')
    ) {
      return false;
    }
    return true;
  };

  // o som vem de `utils/emergencyAudio`, que mantém UM `AudioContext`
  // para a sessão inteira.
  //
  // Antes, cada tick criava `new AudioCtx()` e nada era fechado. O Chromium
  // limita ~50 contextos por documento: depois de ~8 acionamentos o construtor
  // passava a lançar dentro de um `catch` silencioso, e o feedback sonoro da
  // emergência sumia pelo resto da sessão — o canal que avisa o cuidador,
  // falhando exatamente num dia de acionamentos frequentes.

  const startEmergencyCountdown = () => {
    if (isConfirming) return;
    setIsConfirming(true);
    setCountdown(5);
    playTickSound();
  };

  const cancelEmergency = () => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setIsConfirming(false);
    setCountdown(5);

    // Som de cancelamento (bip duplo rápido de confirmação de recuo).
    // reutiliza o contexto compartilhado; ver o comentário acima.
    playCancelSound();
  };

  const triggerEmergencyImmediately = () => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setIsConfirming(false);
    navigate('/emergency?autoTrigger=other');
  };

  useEffect(() => {
    if (isConfirming) {
      countdownIntervalRef.current = setInterval(() => {
        setCountdown((c) => {
          if (c <= 1) {
            return 0;
          }
          playTickSound();
          return c - 1;
        });
      }, 1000);
    }

    return () => {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
    };
  }, [isConfirming]);

  useEffect(() => {
    if (isConfirming && countdown === 0) {
      if (countdownIntervalRef.current) {
        clearInterval(countdownIntervalRef.current);
        countdownIntervalRef.current = null;
      }
      setIsConfirming(false);
      navigate('/emergency?autoTrigger=other');
    }
  }, [isConfirming, countdown, navigate]);

  const showEmergencyButton = isPatientScreen() && location.pathname !== '/emergency';

  useEffect(() => {
    if (!showEmergencyButton) { setMedindo(false); return; }
    // O ponto do teste de precisão é desenhado pelo núcleo (`#accuracy-dot`).
    const verificar = () =>
      setMedindo(state === 'calibrating' || document.getElementById('accuracy-dot') !== null);
    verificar();
    const id = setInterval(verificar, 300);
    return () => clearInterval(id);
  }, [showEmergencyButton, state]);

  useEffect(() => {
    if (!medindo || !showEmergencyButton) { setFabOculto(false); return; }
    const verificar = () => {
      const el = fabRef.current;
      if (!el || typeof document.elementsFromPoint !== 'function') return;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) return;
      const cantos: Array<[number, number]> = [
        [r.left + 2, r.top + 2], [r.right - 2, r.top + 2],
        [r.left + 2, r.bottom - 2], [r.right - 2, r.bottom - 2],
        [r.left + r.width / 2, r.top + r.height / 2],
      ];
      const cobre = cantos.some(([x, y]) =>
        document.elementsFromPoint(x, y).some(
          (e) => !el.contains(e) && e.closest('[data-calibration-target]') !== null,
        ),
      );
      setFabOculto(cobre);
    };
    verificar();
    const id = setInterval(verificar, 300);
    return () => clearInterval(id);
  }, [medindo, showEmergencyButton]);
  const showDegradedBanner =
    isPatientScreen() &&
    location.pathname !== '/calibration-check' &&
    location.pathname !== '/emergency' &&
    isDegraded;

  return (
    <EmergencyContext.Provider
      value={{
        isConfirming,
        cancelEmergency,
        triggerEmergencyImmediately,
      }}
    >
      {children}

      {/* Indicador de Rastreamento Degradado */}
      {showDegradedBanner && !isConfirming && (
        <div
          style={{
            position: 'fixed',
            top: '2rem',
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 99980,
          }}
        >
          <GazeButton
            onClick={() => navigate('/calibration-check')}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.75rem',
              background: '#fef3c7',
              border: '2px solid #f59e0b',
              borderRadius: '2rem',
              color: '#b45309',
              padding: '0.65rem 1.5rem',
              boxShadow: '0 10px 15px -3px rgba(245, 158, 11, 0.2)',
              cursor: 'pointer',
              height: 'auto',
              width: 'auto',
            }}
            noWarn
            /*
             * sem `recovery`, este botão era decorativo.
             *
             * O banner só aparece quando `isDegraded === true`, e o dispatcher
             * de dwell bloqueava todo alvo não-emergency exatamente nesse
             * estado. O paciente ficava com o cursor amarelo tracejado, este
             * banner piscando "Recalibre aqui", e nenhuma forma de acioná-lo
             * pelo único meio de entrada que tem. Para alguém com ELA usando
             * o sistema sem acompanhante, era perda total de autonomia.
             */
            recovery
          >
            <AlertOctagon size={20} color="#d97706" />
            <span style={{ fontSize: '1.1rem', fontWeight: 700 }}>
              Rastreamento impreciso — Recalibre aqui
            </span>
          </GazeButton>
        </div>
      )}

      {/* Botão de Emergência Fixo Canônico */}
      {showEmergencyButton && !isConfirming && (
        <div
          ref={fabRef}
          style={{
            position: 'fixed',
            ...(medindo
              ? { bottom: '1.5rem', right: '1.5rem' }
              : { top: '2rem', right: '3rem' }),
            zIndex: 99990,
            visibility: fabOculto ? 'hidden' : undefined,
          }}
        >
          <GazeButton
            emergency
            /* 132 px não cabiam o conteúdo: "Emergência" em 1,25rem/700
               mede ~132 px SOZINHA, e com o ícone de 24 px mais o gap o
               texto vazava ~18 px para cada lado da borda arredondada —
               fora da área de acerto do dwell, que segue a caixa do
               botão. 176 px cabe sem mudar a tipografia; quando ainda
               assim cobrir um alvo, o `fabOculto` esconde o botão. */
            width={medindo ? 176 : 200}
            height={medindo ? 52 : 64}
            onClick={startEmergencyCountdown}
            data-dwell-ms={isDegraded ? 3600 : 2000}
            aria-label="Disparar Emergência Médica"
          >
            <AlertOctagon size={24} /> Emergência
          </GazeButton>
        </div>
      )}

      {/* Modal Fullscreen de Confirmação */}
      {isConfirming && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="emerg-confirm-title"
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            width: '100vw',
            height: '100vh',
            background: 'rgba(239, 68, 68, 0.95)',
            zIndex: 999999,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'white',
            fontFamily: "'Inter', sans-serif",
            animation: 'flashBg 0.5s infinite alternate',
          }}
        >
          <style>{`
            @keyframes flashBg {
              from { background-color: rgba(220, 38, 38, 0.95); }
              to { background-color: rgba(153, 27, 27, 0.95); }
            }
          `}</style>
          
          <AlertOctagon size={120} style={{ marginBottom: '2rem', filter: 'drop-shadow(0 10px 15px rgba(0,0,0,0.3))' }} />
          
          <h1
            id="emerg-confirm-title"
            style={{
              fontSize: '4.5rem',
              fontWeight: 900,
              margin: '0 0 1rem 0',
              textAlign: 'center',
              textShadow: '0 4px 10px rgba(0,0,0,0.3)',
            }}
          >
            EMERGÊNCIA ACIONADA
          </h1>
          
          <p
            style={{
              fontSize: '2rem',
              fontWeight: 700,
              margin: '0 0 4rem 0',
              textAlign: 'center',
              opacity: 0.9,
            }}
          >
            Enviando alerta de socorro em <strong style={{ fontSize: '3rem', color: '#fde047' }}>{countdown}</strong> segundos...
          </p>

          <GazeButton
            onClick={cancelEmergency}
            data-dwell-ms={1000} // dwell rápido para facilidade de cancelamento voluntário
            style={{
              width: '320px',
              height: '84px',
              background: '#ffffff',
              border: 'none',
              borderRadius: '2rem',
              color: '#dc2626',
              boxShadow: '0 15px 30px rgba(0,0,0,0.3)',
            }}
          >
            <span style={{ fontSize: '1.8rem', fontWeight: 900 }}>CANCELAR</span>
          </GazeButton>
        </div>
      )}
    </EmergencyContext.Provider>
  );
};
