import React from 'react';

interface GazeGridProps {
  columns: number;
  rows: number;
  children: React.ReactNode;
  gap?: number; // em px
}

export const GazeGrid: React.FC<GazeGridProps> = ({
  columns,
  rows,
  children,
  gap = 59 // Equivalente a 1.5° de espaçamento mínimo (GAZE_TOKENS.spacingMinDeg)
}) => {
  const cellMinPx = 198; // Equivalente a 5.0° de tamanho mínimo
  const childCount = React.Children.count(children);

  React.useEffect(() => {
    if (import.meta.env?.DEV) {
      if (childCount > 6) {
        console.warn(`[GazeGrid] Máximo de 6 alvos por tela recomendado para pacientes (solicitado: ${childCount}).`);
      }

      const vw = window.innerWidth;
      const vh = window.innerHeight;
      
      // Estima o espaço disponível por célula
      const cellW = (vw - (columns + 1) * gap) / columns;
      const cellH = (vh - (rows + 1) * gap) / rows;
      if (cellW < cellMinPx || cellH < cellMinPx) {
        console.warn(
          `[GazeGrid] Grade ${columns}x${rows} pode resultar em células abaixo do mínimo recomendado (W: ${Math.round(cellW)}px, H: ${Math.round(cellH)}px < ${cellMinPx}px).`
        );
      }
    }
  }, [columns, rows, gap, childCount]);

  return (
    <div
      className="gaze-grid"
      style={{
        display: 'grid',
        gridTemplateColumns: `repeat(${columns}, 1fr)`,
        gridTemplateRows: `repeat(${rows}, 1fr)`,
        gap: `${gap}px`,
        width: '100%',
        height: '100%',
        boxSizing: 'border-box',
      }}
    >
      {children}
    </div>
  );
};
