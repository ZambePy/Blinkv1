import React, { useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { AlertOctagon } from 'lucide-react';
import { GazeButton } from './ui/GazeButton';
import { useGaze } from '../context/GazeContext';

// D6.3 (ROADMAP §5) — indicador de drift ao cuidador.
//
// PARA QUE SERVE
// A correção de bias em sessão (D1-3) absorve silenciosamente desvios do
// olhar via EMA sobre dwell clicks. Isso é bom: o cursor continua caindo
// no lugar certo mesmo quando o modelo base começa a errar. É ruim: o
// cuidador nunca fica sabendo que o modelo base perdeu qualidade, e a UI
// silenciosa mente sobre o estado real do sistema (viola regra 3).
//
// Este componente SINALIZA sem BLOQUEAR (regra 2). Quando |bias| passa
// de ~5% da tela, mostra um banner sugerindo recalibração rápida. Ao
// clicar, leva o cuidador para /calibration-check onde o D6.2 já oferece
// a opção "Recalibração rápida (4 pontos)".
//
// REGRA CRÍTICA — nunca aparece em rotas de emergência ou calibração.
// Um paciente com ELA em situação de crise não pode ter a rota de socorro
// coberta por banner de qualidade. Idêntica disciplina da B4-2 (aviso de
// rastreamento impreciso), replicada aqui.

// 5% da tela em unidades normalizadas. Coerente com o threshold sugerido
// no ROADMAP (5-6%). Abaixo disso o bias EMA está no seu regime normal
// e não é sinal acionável.
const DRIFT_THRESHOLD_NORM = 0.05;

// Antes de mostrar, exige N amostras acumuladas — bias com 1-2 dwell clicks
// é ruído, não drift. 20 é ~1 min de uso ativo típico e alinha com o
// ONLINE_RAMP_SAMPLES já usado como referência em calibration.ts.
const MIN_BIAS_SAMPLES = 20;

// Polling: o bias EMA muda no ritmo dos dwell clicks (poucos Hz no pior
// caso), então 1s é folga bastante. Não vale acordar a UI 4× por segundo
// (padrão do DebugHUD) para uma métrica que muda por minuto.
const POLL_INTERVAL_MS = 1000;

const HIDE_ON_PATHS = new Set(['/calibration-check', '/emergency']);

// Rotas do CUIDADOR onde o indicador não faz sentido (o cuidador não está
// olhando pra tela via gaze naquele momento). Mesma lista de `isPatientScreen`
// em EmergencyContext.tsx — mantendo em sincronia se ela crescer.
function isPatientScreen(pathname: string): boolean {
  if (pathname === '/' || pathname === '/login') return false;
  if (pathname.startsWith('/caregiver')) return false;
  if (pathname.startsWith('/settings')) return false;
  return true;
}

export const DriftIndicator: React.FC = () => {
  const location = useLocation();
  const navigate = useNavigate();
  const { calibration, isDegraded } = useGaze();
  const [driftMagnitude, setDriftMagnitude] = useState<number | null>(null);

  useEffect(() => {
    const tick = () => {
      // Se `getSessionBias` não existe no context (compat com testes antigos
      // que mockam parte do gaze), pula silenciosamente.
      const bias = calibration.getSessionBias?.();
      if (!bias || bias.samples < MIN_BIAS_SAMPLES) {
        setDriftMagnitude(null);
        return;
      }
      const mag = Math.hypot(bias.x, bias.y);
      setDriftMagnitude(mag);
    };
    tick();
    const id = setInterval(tick, POLL_INTERVAL_MS);
    return () => clearInterval(id);
  }, [calibration]);

  // Prioridade: se o rastreamento está DEGRADED (B4-2), o banner de degradação
  // domina — não empilhamos dois avisos amarelos. O de drift some.
  if (isDegraded) return null;

  // Nunca aparece em rotas de emergência/calibração (regra 2).
  if (HIDE_ON_PATHS.has(location.pathname)) return null;
  if (!isPatientScreen(location.pathname)) return null;

  if (driftMagnitude === null || driftMagnitude < DRIFT_THRESHOLD_NORM) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      data-testid="drift-indicator"
      style={{
        position: 'fixed',
        // Sobe um pouco para não colidir com o banner de rastreamento impreciso,
        // que já vive em `top: 2rem`. Se ambos aparecerem por acaso (não deveria,
        // guard `isDegraded` acima), este fica embaixo.
        top: '5.5rem',
        left: '50%',
        transform: 'translateX(-50%)',
        zIndex: 99970,
      }}
    >
      <GazeButton
        onClick={() => navigate('/calibration-check')}
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.75rem',
          // Tom mais frio que o degraded (âmbar). Azul-cinza = "recomendação",
          // não "alerta". Regra 4 do projeto: nada de flag/aviso ligado com
          // aparência de urgência sem número que justifique.
          background: '#dbeafe',
          border: '2px solid #60a5fa',
          borderRadius: '2rem',
          color: '#1e40af',
          padding: '0.5rem 1.25rem',
          boxShadow: '0 8px 15px -3px rgba(96, 165, 250, 0.20)',
          cursor: 'pointer',
          height: 'auto',
          width: 'auto',
        }}
        noWarn
      >
        <AlertOctagon size={18} color="#2563eb" />
        <span style={{ fontSize: '1rem', fontWeight: 700 }}>
          Recalibração rápida recomendada
        </span>
      </GazeButton>
    </div>
  );
};
