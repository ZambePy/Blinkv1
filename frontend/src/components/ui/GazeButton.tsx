import React, { useRef, useEffect } from 'react';
import { alvoMinimoPx } from '../../design/gazeMetrics';

interface GazeButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  width?: number;
  height?: number;
  emergency?: boolean;
  /**
   * Alvo de RECUPERAÇÃO (B1.9).
   *
   * Marca o botão como acionável mesmo com o rastreamento em `degraded`, onde
   * o dispatcher bloqueia todo alvo comum. Existe para o botão "Recalibre
   * aqui": ele só aparece em `degraded` e, sem esta marcação, era inalcançável
   * pelo olhar — o paciente via a saída anunciada e não conseguia usá-la.
   *
   * Use APENAS em controles que consertam o próprio rastreamento. O dwell é
   * mais longo nesses alvos (2,5× em degradado) porque um acionamento
   * acidental custa uma recalibração inteira.
   */
  recovery?: boolean;
  noWarn?: boolean;
}

export const GazeButton: React.FC<GazeButtonProps> = ({
  children,
  width,
  height,
  emergency = false,
  recovery = false,
  noWarn = false,
  disabled,
  style,
  className = '',
  ...props
}) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  // B3.24 — fonte única. Antes era o literal `198` aqui E em `GazeGrid`,
  // derivado de 5,0° a 60 cm com 96 dpi hardcoded — números que o app conhece
  // de verdade em `settings` e que o design system ignorava.
  const minPx = alvoMinimoPx();

  useEffect(() => {
    if (import.meta.env?.DEV && !noWarn) {
      const w = width ?? buttonRef.current?.offsetWidth;
      const h = height ?? buttonRef.current?.offsetHeight;
      if ((w && w < minPx) || (h && h < minPx)) {
        console.warn(
          `[GazeButton] Alvo visual menor que o mínimo recomendado de 5.0° (${minPx}px).`
        );
      }
    }
  }, [width, height, noWarn]);

  return (
    <button
      ref={buttonRef}
      disabled={disabled}
      data-emergency={emergency ? 'true' : undefined}
      data-recovery={recovery ? 'true' : undefined}
      data-no-dwell={disabled ? 'true' : undefined}
      className={`gaze-button ${emergency ? 'emergency' : ''} ${className}`}
      style={{
        width: width ? `${width}px` : undefined,
        height: height ? `${height}px` : undefined,
        ...style,
      }}
      {...props}
    >
      <span className="gaze-button-hit-area" />
      <span className="gaze-button-content">{children}</span>
      <span className="gaze-button-progress-ring" />
    </button>
  );
};
