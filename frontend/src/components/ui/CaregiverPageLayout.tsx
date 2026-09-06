import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, LogOut } from 'lucide-react';
import { BackButton } from './BackButton';
import { LanguageSwitcher } from './LanguageSwitcher';
import { useAuth } from '../../context/AuthContext';

interface CaregiverPageLayoutProps {
  children: React.ReactNode;
  title: string;
  /** Ações extras no cabeçalho (à esquerda do idioma/sair). */
  actions?: React.ReactNode;
  /** Esconde o seletor de idioma no cabeçalho. */
  hideLanguage?: boolean;
}

/**
 * Moldura das telas do cuidador: cabeçalho fixo com Voltar, identificação da
 * área, título da tela, idioma e "Encerrar acesso". Operada por mouse —
 * os controles do cabeçalho não são alvos de dwell.
 */
export const CaregiverPageLayout: React.FC<CaregiverPageLayoutProps> = ({
  children,
  title,
  actions,
  hideLanguage = false,
}) => {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/menu');
  };

  return (
    <div className="cg-page">
      <header className="cg-header">
        <div className="cg-header__group">
          <BackButton compact to="/menu" />
          <span className="cg-header__brand">
            <Lock size={18} aria-hidden="true" /> Área do Cuidador
          </span>
          <span className="cg-header__sep" aria-hidden="true">
            |
          </span>
          <span className="cg-header__title">{title}</span>
        </div>

        <div className="cg-header__group">
          {actions}
          {!hideLanguage && <LanguageSwitcher compact />}
          <button
            type="button"
            onClick={handleLogout}
            className="btn btn--ghost"
            data-no-dwell="true"
          >
            <LogOut size={16} aria-hidden="true" /> Encerrar acesso
          </button>
        </div>
      </header>

      <main className="cg-content">{children}</main>
    </div>
  );
};
