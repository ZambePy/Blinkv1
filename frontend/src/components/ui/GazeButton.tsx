import React, { useRef, useEffect } from 'react';

interface GazeButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children: React.ReactNode;
  width?: number;
  height?: number;
  emergency?: boolean;
}

export const GazeButton: React.FC<GazeButtonProps> = ({
  children,
  width,
  height,
  emergency = false,
  disabled,
  style,
  className = '',
  ...props
}) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const minPx = 198; // Equivale a 5.0° (GAZE_TOKENS.targetMinDeg)

  useEffect(() => {
    if (import.meta.env?.DEV) {
      const w = width ?? buttonRef.current?.offsetWidth;
      const h = height ?? buttonRef.current?.offsetHeight;
      if ((w && w < minPx) || (h && h < minPx)) {
        console.warn(
          `[GazeButton] Alvo visual menor que o mínimo recomendado de 5.0° (${minPx}px).`
        );
      }
    }
  }, [width, height]);

  return (
    <button
      ref={buttonRef}
      disabled={disabled}
      data-emergency={emergency ? 'true' : undefined}
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
