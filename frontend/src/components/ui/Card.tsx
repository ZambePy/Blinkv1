import React from 'react';

interface CardProps {
  icon: React.ReactNode;
  label: string;
  sublabel?: string;
  color?: string;
  onClick: () => void;
  disabled?: boolean;
}

export const Card: React.FC<CardProps> = ({
  icon,
  label,
  sublabel,
  color = '#1B54A8',
  onClick,
  disabled,
}) => (
  <button
    type="button"
    onClick={onClick}
    disabled={disabled}
    className="action-card glass-card"
    style={{
      background: 'var(--color-card-bg)',
      border: '1px solid var(--color-card-border)',
      borderRadius: '1.5rem',
      padding: '2rem 1.5rem',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '1rem',
      cursor: disabled ? 'not-allowed' : 'pointer',
      opacity: disabled ? 0.5 : 1,
      width: '100%',
      position: 'relative',
    }}
  >
    <div
      style={{
        width: 60,
        height: 60,
        borderRadius: '1.25rem',
        background: `linear-gradient(135deg, ${color}15 0%, ${color}08 100%)`,
        border: `1px solid ${color}25`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        boxShadow: `0 8px 16px -4px ${color}20`,
      }}
    >
      {icon}
    </div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem', alignItems: 'center' }}>
      <span
        style={{
          fontSize: '1.1rem',
          fontWeight: 800,
          color: 'var(--color-text-base)',
          textAlign: 'center',
          lineHeight: 1.3,
        }}
      >
        {label}
      </span>
      {sublabel && (
        <span
          style={{
            fontSize: '0.85rem',
            color: 'var(--color-text-base)',
            opacity: 0.8,
            fontWeight: 500,
            textAlign: 'center',
            lineHeight: 1.4,
          }}
        >
          {sublabel}
        </span>
      )}
    </div>
  </button>
);

