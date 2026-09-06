import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { GazeButton, type GazeButtonSize } from './GazeButton';

interface BackButtonProps {
  /** Rota de destino. Sem `to`, volta no histórico. */
  to?: string;
  /** Texto do botão (padrão: "Voltar"). */
  label?: string;
  /**
   * Versão compacta para telas do cuidador (mouse): botão de 44 px, sem
   * dwell. Nas telas do paciente use o padrão, que é um alvo de gaze.
   */
  compact?: boolean;
  /** Tamanho do alvo de gaze (padrão `lg`). Ignorado em `compact`. */
  size?: GazeButtonSize;
  className?: string;
}

export const BackButton: React.FC<BackButtonProps> = ({
  to,
  label = 'Voltar',
  compact = false,
  size = 'lg',
  className = '',
}) => {
  const navigate = useNavigate();
  const goBack = () => (to ? navigate(to) : navigate(-1));

  if (compact) {
    return (
      <button
        type="button"
        onClick={goBack}
        className={`btn btn--secondary ${className}`.trim()}
        aria-label="Voltar para a tela anterior"
        data-no-dwell="true"
      >
        <ArrowLeft size={18} aria-hidden="true" /> {label}
      </button>
    );
  }

  return (
    <GazeButton
      onClick={goBack}
      variant="secondary"
      size={size}
      icon={<ArrowLeft />}
      label={label}
      className={className}
      aria-label="Voltar para a tela anterior"
    />
  );
};
