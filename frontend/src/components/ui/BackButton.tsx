import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

export const BackButton: React.FC = () => {
  const navigate = useNavigate();
  return (
    <button
      onClick={() => navigate(-1)}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: '0.5rem',
        padding: '0.75rem 1.5rem',
        background: 'var(--color-card-bg)',
        borderRadius: '1rem',
        color: '#1B54A8',
        fontSize: '1rem',
        fontWeight: 700,
        border: 'none',
        cursor: 'pointer',
        boxShadow: '0 4px 16px rgba(27,84,168,0.12)',
      }}
    >
      <ArrowLeft size={24} /> Voltar
    </button>
  );
};
