import React from 'react';
import { alvoMinimoPx } from '../../design/gazeMetrics';

interface GazeGridProps {
  columns: number;
  rows: number;
  children: React.ReactNode;
  /** Espaçamento entre alvos, em px. Mínimo recomendado: 24. */
  gap?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Grade de alvos para telas do paciente.
 *
 * Publica `--gaze-grid-gap` para os filhos: a hit-area ampliada do
 * `GazeButton` usa metade desse valor como limite, então duas zonas vizinhas
 * nunca se sobrepõem — inclusive em grades apertadas como a do teclado.
 */
export const GazeGrid: React.FC<GazeGridProps> = ({
  columns,
  rows,
  children,
  gap = 40,
  className = '',
  style,
}) => {
  const cellMinPx = alvoMinimoPx();
  const childCount = React.Children.count(children);

  React.useEffect(() => {
    if (import.meta.env?.DEV) {
      if (childCount > 6) {
        console.warn(
          `[GazeGrid] Máximo de 6 alvos por tela recomendado para pacientes (solicitado: ${childCount}).`
        );
      }
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const cellW = (vw - (columns + 1) * gap) / columns;
      const cellH = (vh - (rows + 1) * gap) / rows;
      if (cellW < cellMinPx || cellH < cellMinPx) {
        console.warn(
          `[GazeGrid] Grade ${columns}x${rows} pode resultar em células abaixo do mínimo recomendado (W: ${Math.round(cellW)}px, H: ${Math.round(cellH)}px < ${cellMinPx}px).`
        );
      }
    }
  }, [columns, rows, gap, childCount, cellMinPx]);

  return (
    <div
      className={`gaze-grid ${className}`.trim()}
      style={
        {
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`,
          gap: `${gap}px`,
          '--gaze-grid-gap': `${gap}px`,
          ...style,
        } as React.CSSProperties
      }
    >
      {children}
    </div>
  );
};
