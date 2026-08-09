import React from 'react';
import { BackButton } from './BackButton';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  showBack?: boolean;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  icon,
  actions,
  showBack = true,
}) => (
  <header
    style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: '2rem',
      paddingBottom: '1rem',
      borderBottom: '1px solid rgba(226, 232, 240, 0.8)',
    }}
  >
    <div style={{ display: 'flex', alignItems: 'center', gap: '1rem' }}>
      {showBack && <BackButton />}
      <div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          {icon && <div style={{ display: 'flex', alignItems: 'center' }}>{icon}</div>}
          <h1 style={{ fontSize: '1.75rem', fontWeight: 800, color: '#0f172a', margin: 0 }}>
            {title}
          </h1>
        </div>
        {subtitle && (
          <p style={{ margin: '0.25rem 0 0 0', color: '#64748b', fontSize: '0.95rem' }}>
            {subtitle}
          </p>
        )}
      </div>
    </div>
    {actions && <div style={{ display: 'flex', gap: '0.75rem' }}>{actions}</div>}
  </header>
);

