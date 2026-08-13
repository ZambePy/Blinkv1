import React from 'react';

interface PrimaryButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'danger' | 'ghost';
  fullWidth?: boolean;
}

const styles: Record<Required<PrimaryButtonProps>['variant'], React.CSSProperties> = {
  primary: {
    background: 'linear-gradient(135deg, #1B54A8 0%, #2563eb 100%)',
    color: 'white',
    boxShadow: '0 6px 20px -4px rgba(27,84,168,0.35)',
    border: 'none',
  },
  secondary: {
    background: 'var(--color-card-bg)',
    color: 'var(--color-text-base)',
    border: '1px solid var(--color-card-border)',
    boxShadow: '0 2px 8px var(--color-card-shadow)',
  },
  danger: {
    background: 'linear-gradient(135deg, #dc2626 0%, #ef4444 100%)',
    color: 'white',
    boxShadow: '0 6px 20px -4px rgba(220,38,38,0.35)',
    border: 'none',
  },
  ghost: {
    background: 'transparent',
    color: '#1B54A8',
    border: '1px solid rgba(27,84,168,0.2)',
    boxShadow: 'none',
  },
};

export const PrimaryButton: React.FC<PrimaryButtonProps> = ({
  variant = 'primary',
  fullWidth,
  style,
  children,
  disabled,
  ...rest
}) => {
  return (
    <button
      {...rest}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.6rem',
        padding: '0.85rem 1.6rem',
        borderRadius: '1.1rem',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        fontSize: '1rem',
        fontWeight: 700,
        opacity: disabled ? 0.5 : 1,
        width: fullWidth ? '100%' : undefined,
        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        userSelect: 'none',
        ...styles[variant],
        ...style,
      }}
      onMouseOver={(e) => {
        if (!disabled) {
          e.currentTarget.style.transform = 'translateY(-2px)';
        }
      }}
      onMouseOut={(e) => {
        if (!disabled) {
          e.currentTarget.style.transform = 'translateY(0)';
        }
      }}
      onMouseDown={(e) => {
        if (!disabled) {
          e.currentTarget.style.transform = 'translateY(1px) scale(0.99)';
        }
      }}
      onMouseUp={(e) => {
        if (!disabled) {
          e.currentTarget.style.transform = 'translateY(-2px)';
        }
      }}
    >
      {children}
    </button>
  );
};

