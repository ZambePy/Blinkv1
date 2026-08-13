import React, { useRef, useState, useEffect } from 'react';
import { BackButton } from '../../components/ui/BackButton';
import { Eraser, Download } from 'lucide-react';

type PointerLike = React.MouseEvent<HTMLCanvasElement> | React.TouchEvent<HTMLCanvasElement>;

const getCoords = (e: PointerLike, canvas: HTMLCanvasElement): { x: number; y: number } | null => {
  const rect = canvas.getBoundingClientRect();
  if ('touches' in e && e.touches.length > 0) {
    const touch = e.touches[0];
    return { x: touch.clientX - rect.left, y: touch.clientY - rect.top };
  }
  if ('clientX' in e) {
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  }
  return null;
};

export const DrawingGame: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [color, setColor] = useState('#1B54A8');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const parent = canvas.parentElement;
    if (parent) {
      canvas.width = parent.clientWidth;
      canvas.height = parent.clientHeight;
    }
  }, []);

  const startDrawing = (e: PointerLike) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const coords = getCoords(e, canvas);
    if (!coords) return;
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
    setIsDrawing(true);
  };

  const draw = (e: PointerLike) => {
    if (!isDrawing) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const coords = getCoords(e, canvas);
    if (!coords) return;
    ctx.lineTo(coords.x, coords.y);
    ctx.strokeStyle = color;
    ctx.lineWidth = 8;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  const stopDrawing = () => setIsDrawing(false);

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const downloadCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const url = canvas.toDataURL('image/png');
    const a = document.createElement('a');
    a.href = url;
    a.download = 'meu_desenho_irisflow.png';
    a.click();
  };

  const colors = ['#1B54A8', '#dc2626', '#16a34a', '#eab308', '#9333ea', '#000000'];

  return (
    <main
      role="main"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100vh',
        backgroundColor: 'var(--color-bg-base)',
      }}
    >
      <div
        style={{
          padding: '1rem 2rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          background: 'var(--color-card-bg)',
          boxShadow: '0 2px 10px rgba(0,0,0,0.05)',
          zIndex: 10,
          gap: '1rem',
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', gap: '1rem', alignItems: 'center' }}>
          <BackButton />
          <h1 style={{ fontSize: '1.5rem', color: '#1e293b', margin: 0 }}>Desenho Livre</h1>
        </div>

        <div
          role="radiogroup"
          aria-label="Paleta de cores"
          style={{ display: 'flex', gap: '1rem' }}
        >
          {colors.map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={color === c}
              aria-label={`Selecionar cor ${c}`}
              onClick={() => setColor(c)}
              style={{
                width: '40px',
                height: '40px',
                borderRadius: '50%',
                backgroundColor: c,
                border: color === c ? '4px solid #cbd5e1' : '2px solid transparent',
                cursor: 'pointer',
                boxShadow: '0 2px 5px rgba(0,0,0,0.2)',
              }}
            />
          ))}
        </div>

        <div style={{ display: 'flex', gap: '1rem' }}>
          <button
            type="button"
            onClick={clearCanvas}
            aria-label="Apagar o desenho"
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '1rem',
              border: 'none',
              background: '#fee2e2',
              color: '#dc2626',
              cursor: 'pointer',
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'center',
              fontWeight: 700,
            }}
          >
            <Eraser aria-hidden="true" /> Apagar
          </button>
          <button
            type="button"
            onClick={downloadCanvas}
            aria-label="Baixar desenho como imagem PNG"
            style={{
              padding: '0.75rem 1rem',
              borderRadius: '1rem',
              border: 'none',
              background: '#e0e7ff',
              color: '#4f46e5',
              cursor: 'pointer',
              display: 'flex',
              gap: '0.5rem',
              alignItems: 'center',
              fontWeight: 700,
            }}
          >
            <Download aria-hidden="true" /> Salvar
          </button>
        </div>
      </div>

      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Área de desenho livre"
          onMouseDown={startDrawing}
          onMouseMove={draw}
          onMouseUp={stopDrawing}
          onMouseLeave={stopDrawing}
          onTouchStart={startDrawing}
          onTouchMove={draw}
          onTouchEnd={stopDrawing}
          style={{ cursor: 'crosshair', touchAction: 'none' }}
        />
        <div
          style={{
            position: 'absolute',
            bottom: '2rem',
            left: 0,
            right: 0,
            textAlign: 'center',
            pointerEvents: 'none',
          }}
        >
          <span
            style={{
              background: 'rgba(255,255,255,0.85)',
              padding: '0.5rem 1rem',
              borderRadius: '1rem',
              color: 'var(--color-text-base)', opacity: 0.9,
              fontWeight: 700,
            }}
          >
            Dica: Clique e arraste para desenhar (no futuro, controle pelo olhar)
          </span>
        </div>
      </div>
    </main>
  );
};
