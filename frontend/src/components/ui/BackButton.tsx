import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { GazeButton } from './GazeButton';

interface BackButtonProps {
  to?: string;
}

export const BackButton: React.FC<BackButtonProps> = ({ to }) => {
  const navigate = useNavigate();
  return (
    <GazeButton
      onClick={() => (to ? navigate(to) : navigate(-1))}
      width={180}
      height={64}
      style={{
        border: 'none',
        boxShadow: '0 4px 16px rgba(27,84,168,0.12)',
      }}
      aria-label="Voltar para a tela anterior"
    >
      <ArrowLeft size={24} /> Voltar
    </GazeButton>
  );
};
