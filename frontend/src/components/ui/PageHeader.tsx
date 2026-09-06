import React from 'react';
import { BackButton } from './BackButton';

interface PageHeaderProps {
  title: string;
  subtitle?: string;
  icon?: React.ReactNode;
  actions?: React.ReactNode;
  showBack?: boolean;
  backRoute?: string;
}

/** Cabeçalho compacto das telas do cuidador (mouse). */
export const PageHeader: React.FC<PageHeaderProps> = ({
  title,
  subtitle,
  icon,
  actions,
  showBack = true,
  backRoute,
}) => (
  <header className="page-header">
    <div className="page-header__lead">
      {showBack && <BackButton compact to={backRoute} />}
      <div className="page-header__titles">
        <div className="page-header__row">
          {icon && <div className="page-header__icon">{icon}</div>}
          <h1 className="page-header__title">{title}</h1>
        </div>
        {subtitle && <p className="page-header__subtitle">{subtitle}</p>}
      </div>
    </div>
    {actions && <div className="page-header__actions">{actions}</div>}
  </header>
);
