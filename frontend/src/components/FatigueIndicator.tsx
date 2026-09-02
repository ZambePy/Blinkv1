import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { Coffee } from 'lucide-react';
import { GazeButton } from './ui/GazeButton';
import { useGaze } from '../context/GazeContext';

// Indicador de fadiga não-bloqueante.
//
// PARA QUE SERVE
// A taxa de piscadas já é medida em `extractor.ts`
// (`getRecentBlinkRatePerMinute`), mas o número existia no engine sem chegar
// ao usuário. Referência clínica: repouso é 15-20/min, >25/min sustentado
// indica fadiga, brilho excessivo ou olho seco. Este componente SINALIZA
// (nunca bloqueia a UI do paciente) quando a taxa sustentada ultrapassa o
// limiar clínico e oferece caminho de 1 clique para o Modo Descanso.
//
// POR QUE "SUSTENTADO"
// Uma janela de 60s pode subir acima de 25/min em picos (bocejo, tosse, tela
// mudou de brilho). Aviso num único pico gera "cry wolf". Exigimos
// MIN_CONSECUTIVE_ABOVE polls acima do limiar antes de mostrar, e histerese
// em BLINK_RATE_HYSTERESIS antes de esconder, para o aviso não piscar
// in-and-out.
//
// REGRA CRÍTICA — nunca aparece em rotas de emergência ou calibração.

// >25/min é o limiar clínico documentado em extractor.ts. Não escolhemos
// número novo — reaproveitamos o que o BlinkDetector já usa como referência.
export const FATIGUE_BLINK_RATE_THRESHOLD = 25;

// Histerese: só some quando cai 5 abaixo do threshold. Evita banner piscando
// quando a taxa oscila em torno de 25.
export const FATIGUE_BLINK_RATE_HYSTERESIS = 5;

// Poll de ~10s. Piscadas mudam em escala de segundos-minutos, então mais
// frequente que isso só queima CPU sem info nova. Menor que 30s pra o
// teste rodar em tempo razoável.
export const FATIGUE_POLL_INTERVAL_MS = 10_000;

// Janela sobre a qual calculamos a taxa (últimos 60s). Casa com o default
// do BlinkDetector.getBlinkRatePerMinute.
const BLINK_WINDOW_MS = 60_000;

// Sustained: precisa de N polls seguidos acima do limiar antes de mostrar.
// 3 × 10s = 30s de sinal consistente. Menos que isso é ruído.
export const MIN_CONSECUTIVE_ABOVE = 3;

const HIDE_ON_PATHS = new Set(['/calibration-check', '/emergency']);

function isPatientScreen(pathname: string): boolean {
  if (pathname === '/' || pathname === '/login') return false;
  if (pathname.startsWith('/caregiver')) return false;
  if (pathname.startsWith('/settings')) return false;
  return true;
}

export const FatigueIndicator: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { calibration, isDegraded } = useGaze();
  const [showFatigue, setShowFatigue] = useState(false);

  useEffect(() => {
    let consecutiveAbove = 0;
    let isShowing = false;

    const tick = () => {
      const rate = calibration.getRecentBlinkRatePerMinute?.(BLINK_WINDOW_MS) ?? 0;

      if (rate >= FATIGUE_BLINK_RATE_THRESHOLD) {
        consecutiveAbove++;
        if (consecutiveAbove >= MIN_CONSECUTIVE_ABOVE && !isShowing) {
          isShowing = true;
          setShowFatigue(true);
        }
      } else if (rate < FATIGUE_BLINK_RATE_THRESHOLD - FATIGUE_BLINK_RATE_HYSTERESIS) {
        // Só reseta e esconde quando cai abaixo do threshold - histerese.
        consecutiveAbove = 0;
        if (isShowing) {
          isShowing = false;
          setShowFatigue(false);
        }
      }
      // Zona de histerese (entre threshold-hyst e threshold): mantém estado atual.
    };
    tick();
    const id = setInterval(tick, FATIGUE_POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [calibration]);

  // Prioridade idêntica ao DriftIndicator: rastreamento degraded domina.
  // Não empilhamos avisos.
  if (isDegraded) return null;

  if (HIDE_ON_PATHS.has(location.pathname)) return null;
  if (!isPatientScreen(location.pathname)) return null;

  if (!showFatigue) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="fatigue-indicator"
      style={{
        position: 'fixed',
        // O DriftIndicator vive em top: 5.5rem. Se ambos aparecerem (raro —
        // fadiga e drift são causas independentes), este fica logo abaixo.
        top: '9rem',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 99960,
      }}
    >
      <GazeButton
        onClick={() => navigate('/rest')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          // Verde suave — sugestão de pausa, não alerta. Diferencia do azul
          // do DriftIndicator (recalibração) e do âmbar do degraded (falha
          // de rastreamento). Regra 4: aparência de urgência exige número
          // que justifique — fadiga é conforto, não crise.
          background: '#d1fae5',
          border: '2px solid #34d399',
          borderRadius: '2rem',
          color: '#065f46',
          padding: '0.5rem 1.25rem',
          boxShadow: '0 8px 15px -3px rgba(52, 211, 153, 0.20)',
          cursor: 'pointer',
          height: 'auto',
          width: 'auto',
        }}
        noWarn
      >
        <Coffee size={18} color="#059669" />
        <span style={{ fontSize: '1rem', fontWeight: 700 }}>
          Uma pausa? Modo Descanso disponível
        </span>
      </GazeButton>
    </div>
  );
};
