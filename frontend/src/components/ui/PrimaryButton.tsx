import React from 'react';

interface PrimaryButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  fullWidth?: boolean;
  /** Ícone opcional (lucide-react), à esquerda do texto. */
  icon?: React.ReactNode;
}

/**
 * Botão compacto das telas do cuidador (mouse/teclado). Altura mínima de
 * 44 px; realce só por cor e borda. Para alvos de gaze use `GazeButton`.
 */
export const PrimaryButton: React.FC<PrimaryButtonProps> = ({
  variant = 'primary',
  fullWidth,
  icon,
  className = '',
  children,
  type = 'button',
  ...rest
}) => (
  <button
    type={type}
    className={`btn btn--${variant} ${fullWidth ? 'btn--block' : ''} ${className}`.trim()}
    {...rest}
  >
    {icon && (
      <span aria-hidden="true" style={{ display: 'inline-flex' }}>
        {icon}
      </span>
    )}
    {children}
  </button>
);
