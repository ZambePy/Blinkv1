import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock, LogOut } from 'lucide-react';
import { BackButton } from './BackButton';
import { useAuth } from '../../context/AuthContext';

interface CaregiverPageLayoutProps {
  children: React.ReactNode;
  title: string;
}

export const CaregiverPageLayout: React.FC<CaregiverPageLayoutProps> = ({ children, title }) => {
  const navigate = useNavigate();
  const { logout } = useAuth();

  const handleLogout = () => {
    logout();
    navigate('/menu');
  };

  return (
    <div
      style={{
        minHeight: '100vh',
        backgroundColor: '#0f172a', // Slate escuro padrão administrativo
        color: '#f8fafc',
        fontFamily: "'Inter', sans-serif",
        display: 'flex',
        flexDirection: 'column',
      }}
    >
      {/* Cabeçalho do Cuidador */}
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '1.25rem 2.5rem',
          borderBottom: '1px solid rgba(255, 255, 255, 0.08)',
          background: '#1e293b',
          zIndex: 100,
        }}
      >
        <div style={{ display: 'flex', gap: '1.25rem', alignItems: 'center' }}>
          <BackButton to="/menu" />
          <span style={{ fontSize: '1.35rem', fontWeight: 800, color: '#f8fafc', display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
            <Lock size={18} color="#eab308" /> Área do Cuidador
          </span>
          <span style={{ color: 'rgba(255,255,255,0.15)' }}>|</span>
          <span style={{ fontSize: '1.2rem', color: '#94a3b8', fontWeight: 500 }}>{title}</span>
        </div>

        <button
          onClick={handleLogout}
          style={{
            background: 'rgba(255, 255, 255, 0.05)',
            border: '1px solid rgba(255, 255, 255, 0.1)',
            borderRadius: '0.75rem',
            padding: '0.6rem 1.2rem',
            color: '#f8fafc',
            fontWeight: 600,
            cursor: 'pointer',
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            transition: 'background 0.2s',
          }}
          onMouseOver={(e) => (e.currentTarget.style.background = 'rgba(239, 68, 68, 0.15)')}
          onMouseOut={(e) => (e.currentTarget.style.background = 'rgba(255, 255, 255, 0.05)')}
        >
          <LogOut size={16} /> Encerrar Acesso
        </button>
      </header>

      {/* Área de Conteúdo Principal */}
      <div style={{ flex: 1, padding: '2.5rem 2.5rem 4rem 2.5rem', maxWidth: '1200px', width: '100%', margin: '0 auto', boxSizing: 'border-box' }}>
        {children}
      </div>
    </div>
  );
};
