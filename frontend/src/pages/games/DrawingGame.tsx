import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Eraser, Download } from 'lucide-react';
import { GazePageLayout } from '../../components/ui/GazePageLayout';
import { GazeButton } from '../../components/ui/GazeButton';

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

/**
 * Tintas do desenho. São os tokens do tema: o canvas precisa de uma cor
 * concreta, então o valor é resolvido em `getComputedStyle` na hora do traço.
 */
const TINTAS: { id: string; nome: string; token: string }[] = [
  { id: 'azul', nome: 'Azul', token: '--primary' },
  { id: 'vermelho', nome: 'Vermelho', token: '--danger' },
  { id: 'verde', nome: 'Verde', token: '--ok' },
  { id: 'amarelo', nome: 'Amarelo', token: '--warn' },
  { id: 'claro', nome: 'Azul-claro', token: '--accent' },
  { id: 'lapis', nome: 'Lápis', token: '--text' },
];

const ESPESSURA = 8;

function resolverToken(token: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(token).trim();
  return v || 'currentColor';
}

/**
 * Desenho livre. O traço é feito com mouse ou toque; a paleta e os botões
 * são alvos de olhar, então o paciente escolhe a cor sozinho e o cuidador (ou
 * o próprio paciente, se conseguir) desenha.
 */
export const DrawingGame: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const areaRef = useRef<HTMLDivElement>(null);
  const drawingRef = useRef(false);
  const [tinta, setTinta] = useState(TINTAS[0]);

  // Ajusta o canvas ao container e preserva o desenho ao redimensionar.
  const ajustarTamanho = useCallback(() => {
    const canvas = canvasRef.current;
    const area = areaRef.current;
    if (!canvas || !area) return;
    const { clientWidth: w, clientHeight: h } = area;
    if (w === 0 || h === 0 || (canvas.width === w && canvas.height === h)) return;
    const copia = document.createElement('canvas');
    copia.width = canvas.width;
    copia.height = canvas.height;
    copia.getContext('2d')?.drawImage(canvas, 0, 0);
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')?.drawImage(copia, 0, 0);
  }, []);

  useEffect(() => {
    ajustarTamanho();
    window.addEventListener('resize', ajustarTamanho);
    return () => window.removeEventListener('resize', ajustarTamanho);
  }, [ajustarTamanho]);

  const startDrawing = (e: PointerLike) => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const coords = getCoords(e, canvas);
    if (!coords) return;
    ctx.beginPath();
    ctx.moveTo(coords.x, coords.y);
    drawingRef.current = true;
  };

  const draw = (e: PointerLike) => {
    if (!drawingRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    const coords = getCoords(e, canvas);
    if (!coords) return;
    ctx.lineTo(coords.x, coords.y);
    ctx.strokeStyle = resolverToken(tinta.token);
    ctx.lineWidth = ESPESSURA;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.stroke();
  };

  const stopDrawing = () => {
    drawingRef.current = false;
  };

  const clearCanvas = () => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
  };

  const downloadCanvas = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // Exporta com o fundo da superfície, senão o PNG sai transparente.
    const saida = document.createElement('canvas');
    saida.width = canvas.width;
    saida.height = canvas.height;
    const ctx = saida.getContext('2d');
    if (!ctx) return;
    ctx.fillStyle = resolverToken('--surface');
    ctx.fillRect(0, 0, saida.width, saida.height);
    ctx.drawImage(canvas, 0, 0);
    const a = document.createElement('a');
    a.href = saida.toDataURL('image/png');
    a.download = 'meu_desenho_irisflow.png';
    a.click();
  };

  return (
    <GazePageLayout backRoute="/games" title="Desenho">
      <h1 className="sr-only">Desenho livre</h1>
      <div style={{ display: 'flex', gap: 24, height: '100%', minHeight: 0 }}>
        {/* Área de desenho (mouse/toque). Não é alvo de olhar. */}
        <div
          ref={areaRef}
          data-no-dwell="true"
          style={{
            flex: 1,
            minWidth: 0,
            position: 'relative',
            borderRadius: 'var(--r-lg)',
            border: '2px solid var(--border)',
            background: 'var(--surface)',
            overflow: 'hidden',
          }}
        >
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
            style={{ display: 'block', cursor: 'crosshair', touchAction: 'none' }}
          />
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              bottom: '1rem',
              left: '50%',
              transform: 'translateX(-50%)',
              padding: '0.4rem 1rem',
              borderRadius: 'var(--r-pill)',
              background: 'var(--surface-2)',
              color: 'var(--text-3)',
              fontSize: 'var(--fs-16)',
              fontWeight: 600,
              pointerEvents: 'none',
              whiteSpace: 'nowrap',
            }}
          >
            Desenhe com o mouse ou o toque. As cores respondem ao olhar.
          </span>
        </div>

        {/* Paleta e ações: alvos de olhar em duas colunas */}
        <div
          aria-label="Cores e ações do desenho"
          style={{
            flex: '0 0 auto',
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 160px)',
            gridAutoRows: 'minmax(120px, 1fr)',
            gap: 24,
            alignContent: 'stretch',
            '--gaze-grid-gap': '24px',
          } as React.CSSProperties}
        >
          {TINTAS.map((t) => {
            const ativa = tinta.id === t.id;
            return (
              <GazeButton
                key={t.id}
                aria-pressed={ativa}
                aria-label={`Cor ${t.nome}`}
                onClick={() => setTinta(t)}
                size="lg"
                stacked
                variant="secondary"
                icon={
                  <span
                    aria-hidden="true"
                    style={{
                      width: 44,
                      height: 44,
                      borderRadius: '50%',
                      background: `var(${t.token})`,
                      boxShadow: ativa ? '0 0 0 4px var(--surface), 0 0 0 7px var(--primary)' : 'none',
                    }}
                  />
                }
                label={t.nome}
                style={{
                  width: '100%',
                  height: '100%',
                  fontSize: 'var(--fs-18)',
                  borderColor: ativa ? 'var(--primary)' : undefined,
                  background: ativa ? 'var(--primary-soft)' : undefined,
                }}
              />
            );
          })}

          <GazeButton
            onClick={clearCanvas}
            size="lg"
            stacked
            variant="secondary"
            icon={<Eraser color="var(--danger)" />}
            label="Apagar"
            aria-label="Apagar o desenho"
            dwellMs={2500}
            style={{ width: '100%', height: '100%' }}
          />
          <GazeButton
            onClick={downloadCanvas}
            size="lg"
            stacked
            variant="primary"
            icon={<Download />}
            label="Salvar"
            aria-label="Salvar o desenho como imagem"
            style={{ width: '100%', height: '100%' }}
          />
        </div>
      </div>
    </GazePageLayout>
  );
};
