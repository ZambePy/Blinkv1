import React, { useRef, useEffect } from 'react';
import { alvoMinimoPx } from '../../design/gazeMetrics';

export type GazeButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';
export type GazeButtonSize = 'lg' | 'xl';

export interface GazeButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  children?: React.ReactNode;
  /** Aparência. `secondary` (padrão) é a superfície neutra com borda. */
  variant?: GazeButtonVariant;
  /**
   * Tamanho mínimo do alvo: `lg` = 160×120 px, `xl` = 200×160 px.
   * Sem `size`, o botão dimensiona pelo conteúdo ou por `width`/`height`.
   */
  size?: GazeButtonSize;
  /** Ícone (lucide-react). Renderizado com 40 px (48 px em `xl`). */
  icon?: React.ReactNode;
  /** Rótulo textual. Alternativa a `children`; quebras de linha são respeitadas. */
  label?: React.ReactNode;
  /** Ícone acima do rótulo (cards de menu). */
  stacked?: boolean;
  /** Tempo de dwell específico deste alvo, em ms (vira `data-dwell-ms`). */
  dwellMs?: number;
  width?: number;
  height?: number;
  /** Botão de emergência: vermelho, acionável mesmo durante a calibração. */
  emergency?: boolean;
  /**
   * Alvo de recuperação: acionável mesmo com o rastreamento degradado, onde
   * o dispatcher bloqueia todo alvo comum. Use apenas em controles que
   * consertam o próprio rastreamento (ex.: "Recalibrar"). O dwell é mais
   * longo nesses alvos porque um acionamento acidental custa uma
   * recalibração inteira.
   */
  recovery?: boolean;
  /** Silencia o aviso de desenvolvimento sobre alvo abaixo do mínimo. */
  noWarn?: boolean;
}

/**
 * Alvo canônico de interação por olhar.
 *
 * Estrutura interna (consumida pelo CSS em index.css):
 *  - `.gaze-button-hit-area`: zona de acerto ampliada (metade do gap vizinho)
 *  - `.gaze-button-content`: ícone + rótulo
 *  - `.gaze-button-progress-ring`: anel de dwell, lê `--gaze-dwell-progress`
 *
 * O GazeContext aplica `.gaze-hover` e a variável de progresso diretamente no
 * elemento; nada aqui depende de estado React para o feedback do dwell.
 */
export const GazeButton: React.FC<GazeButtonProps> = ({
  children,
  variant = 'secondary',
  size,
  icon,
  label,
  stacked = false,
  dwellMs,
  width,
  height,
  emergency = false,
  recovery = false,
  noWarn = false,
  disabled,
  style,
  className = '',
  type = 'button',
  ...props
}) => {
  const buttonRef = useRef<HTMLButtonElement>(null);
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
  }, [width, height, noWarn, minPx]);

  const classes = [
    'gaze-button',
    `gaze-button--${variant}`,
    size ? `gaze-button--${size}` : '',
    stacked ? 'gaze-button--stacked' : '',
    emergency ? 'emergency' : '',
    className,
  ]
    .filter(Boolean)
    .join(' ');

  // `data-dwell-ms` passado direto pela página continua valendo: o spread de
  // `props` vem depois e sobrescreve.
  return (
    <button
      ref={buttonRef}
      type={type}
      disabled={disabled}
      data-emergency={emergency ? 'true' : undefined}
      data-recovery={recovery ? 'true' : undefined}
      data-no-dwell={disabled ? 'true' : undefined}
      data-dwell-ms={dwellMs}
      className={classes}
      style={{
        width: width ? `${width}px` : undefined,
        height: height ? `${height}px` : undefined,
        ...style,
      }}
      {...props}
    >
      <span className="gaze-button-hit-area" aria-hidden="true" />
      <span className="gaze-button-content">
        {icon && (
          <span className="gaze-button__icon" aria-hidden="true">
            {icon}
          </span>
        )}
        {label !== undefined && <span className="gaze-button__label">{label}</span>}
        {children}
      </span>
      <span className="gaze-button-progress-ring" aria-hidden="true" />
    </button>
  );
};
