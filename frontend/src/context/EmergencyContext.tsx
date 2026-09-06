import React, { createContext, useContext, useState, useEffect, useRef, useMemo } from 'react';
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

/** Segundos da contagem regressiva antes de disparar o alerta. */
const COUNTDOWN_S = 5;

/**
 * Atributo que as telas de calibração/teste podem colocar nos alvos visuais.
 * Se o botão compacto de emergência cobrir um deles, o botão some.
 */
const CALIBRATION_TARGET_ATTR = '[data-calibration-target]';

/**
 * O botão compacto cobre algum alvo?
 *
 * Preferência: elementos marcados com `data-calibration-target`. Como as telas
 * de calibração não necessariamente marcam seus pontos, vale também a
 * heurística: qualquer elemento pequeno (< 5% do viewport) sob a área do
 * botão, que não seja o próprio botão, é tratado como alvo — durante a coleta
 * a tela é só fundo, um ponto e uma legenda central.
 */
function botaoCobreAlvo(botao: HTMLElement): boolean {
  if (typeof document.elementsFromPoint !== 'function') return false;
  const r = botao.getBoundingClientRect();
  if (r.width === 0 || r.height === 0) return false;
  const areaViewport = window.innerWidth * window.innerHeight;
  const pontos: Array<[number, number]> = [
    [r.left + 2, r.top + 2],
    [r.right - 2, r.top + 2],
    [r.left + 2, r.bottom - 2],
    [r.right - 2, r.bottom - 2],
    [r.left + r.width / 2, r.top + r.height / 2],
  ];
  for (const [x, y] of pontos) {
    const pilha = document.elementsFromPoint(x, y);
    for (const el of pilha) {
      if (botao.contains(el)) continue;
      if (el.closest(CALIBRATION_TARGET_ATTR)) return true;
      const b = el.getBoundingClientRect();
      const area = b.width * b.height;
      if (area > 0 && area < areaViewport * 0.05) return true;
    }
  }
  return false;
}

export const EmergencyProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { isDegraded, state } = useGaze();
  // O teste de precisão roda com o engine em `tracking`; o ponto que ele
  // desenha no overlay é reconhecido pelo id.
  const [testandoPrecisao, setTestandoPrecisao] = useState(false);
  const calibrando = state === 'calibrating' || testandoPrecisao;

  const [isConfirming, setIsConfirming] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_S);
  const countdownIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const fabRef = useRef<HTMLDivElement>(null);
  const [fabOculto, setFabOculto] = useState(false);

  // Tela do paciente = qualquer rota fora do onboarding inicial e da área do
  // cuidador. É nela que o botão de emergência precisa existir.
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

  // O som vem de `utils/emergencyAudio`, que mantém UM AudioContext para a
  // sessão inteira (o Chromium limita ~50 por documento).
  const startEmergencyCountdown = () => {
    if (isConfirming) return;
    setIsConfirming(true);
    setCountdown(COUNTDOWN_S);
    playTickSound();
  };

  const cancelEmergency = () => {
    if (countdownIntervalRef.current) {
      clearInterval(countdownIntervalRef.current);
      countdownIntervalRef.current = null;
    }
    setIsConfirming(false);
    setCountdown(COUNTDOWN_S);
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
          if (c <= 1) return 0;
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
  const showDegradedBanner =
    isPatientScreen() &&
    location.pathname !== '/calibration-check' &&
    location.pathname !== '/emergency' &&
    isDegraded;

  useEffect(() => {
    if (!showEmergencyButton) {
      setTestandoPrecisao(false);
      return;
    }
    const verificar = () => setTestandoPrecisao(document.getElementById('accuracy-dot') !== null);
    verificar();
    const id = setInterval(verificar, 300);
    return () => clearInterval(id);
  }, [showEmergencyButton]);

  // Durante a calibração e o teste de precisão o botão vai para o canto
  // inferior direito, compacto. Se mesmo assim cobrir um alvo, some — e volta
  // assim que o alvo sair dali.
  useEffect(() => {
    if (!calibrando || !showEmergencyButton) {
      setFabOculto(false);
      return;
    }
    const verificar = () => {
      const el = fabRef.current;
      if (!el) return;
      // Mede com o botão visível: se estiver oculto, torna-o mensurável antes.
      const estavaOculto = el.style.visibility === 'hidden';
      if (estavaOculto) el.style.visibility = '';
      const cobre = botaoCobreAlvo(el);
      if (estavaOculto) el.style.visibility = 'hidden';
      setFabOculto(cobre);
    };
    verificar();
    const id = setInterval(verificar, 300);
    return () => clearInterval(id);
  }, [calibrando, showEmergencyButton]);

  const value = useMemo(
    () => ({ isConfirming, cancelEmergency, triggerEmergencyImmediately }),
    // As duas funções só usam setters, refs e `navigate` (estável).
    [isConfirming]
  );

  return (
    <EmergencyContext.Provider value={value}>
      {children}

      {/* Aviso de rastreamento degradado: alvo de recuperação */}
      {showDegradedBanner && !isConfirming && (
        <div className="degraded-banner">
          <GazeButton
            onClick={() => navigate('/calibration-check')}
            variant="secondary"
            icon={<AlertOctagon />}
            noWarn
            // Sem `recovery`, este botão seria decorativo: o dispatcher de
            // dwell bloqueia todo alvo comum exatamente em `degraded`.
            recovery
          >
            <span className="gaze-button__label">Rastreamento impreciso — Recalibre aqui</span>
          </GazeButton>
        </div>
      )}

      {/* Botão de emergência fixo */}
      {showEmergencyButton && !isConfirming && (
        <div
          ref={fabRef}
          className={`emergency-fab ${calibrando ? 'emergency-fab--compact' : ''}`.trim()}
          style={fabOculto ? { visibility: 'hidden' } : undefined}
          data-testid="emergency-fab"
        >
          <GazeButton
            emergency
            width={calibrando ? 144 : 200}
            height={calibrando ? 80 : 120}
            onClick={startEmergencyCountdown}
            dwellMs={isDegraded ? 3600 : 2000}
            icon={<AlertOctagon />}
            label="Emergência"
            aria-label="Acionar emergência"
            noWarn={calibrando}
            style={calibrando ? { fontSize: 'var(--fs-18)', gap: '0.4rem' } : undefined}
          />
        </div>
      )}

      {/* Confirmação em tela cheia */}
      {isConfirming && (
        <div
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="emerg-confirm-title"
          className="emergency-modal"
        >
          <AlertOctagon size={120} className="emergency-modal__icon" aria-hidden="true" />
          <h1 id="emerg-confirm-title" className="emergency-modal__title">
            Emergência acionada
          </h1>
          <p className="emergency-modal__text">
            Enviando alerta de socorro em{' '}
            <strong className="emergency-modal__count">{countdown}</strong> segundos
          </p>
          <GazeButton
            onClick={cancelEmergency}
            variant="secondary"
            size="lg"
            className="gaze-button--cancel"
            // Dwell curto: cancelar precisa ser fácil.
            dwellMs={1000}
            label="Cancelar"
            aria-label="Cancelar emergência"
          />
        </div>
      )}
    </EmergencyContext.Provider>
  );
};
