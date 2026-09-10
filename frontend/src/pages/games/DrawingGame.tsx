import React, { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Eraser, Eye, EyeOff } from 'lucide-react';
import { GazeButton } from '../../components/ui/GazeButton';
import { useGaze } from '../../context/GazeContext';

/**
 * DESENHO COM O OLHAR.
 *
 * O canvas não é um alvo de dwell — desenhar é contínuo, não um clique. Então
 * a tela assina `useGaze().subscribe` e pinta na posição de cada amostra
 * enquanto o pincel estiver ligado. O liga/desliga é um `GazeButton` na barra
 * lateral: é o único jeito de o paciente parar de pintar, já que ele não pode
 * "levantar a mão".
 *
 * O desenho por mouse continua funcionando, para quem estiver testando o app
 * sem rastreamento.
 */

/**
 * Dwell do liga/desliga do pincel.
 *
 * 1,5 s, bem acima do dwell normal, porque este botão é a única forma de
 * PARAR. Se ele ligasse com o dwell curto dos outros alvos, o olhar de
 * passagem pela barra lateral ligaria o pincel e riscaria o desenho inteiro no
 * caminho de volta ao canvas.
 */
const DWELL_DO_PINCEL_MS = 1500;

const CORES = [
  { valor: '#1b54a8', nome: 'Azul' },
  { valor: '#dc2626', nome: 'Vermelho' },
  { valor: '#16a34a', nome: 'Verde' },
  { valor: '#eab308', nome: 'Amarelo' },
];

const ESPESSURAS = [
  { valor: 10, nome: 'Fina' },
  { valor: 20, nome: 'Média' },
  { valor: 34, nome: 'Grossa' },
];

/**
 * Salto máximo, em px, que ainda é tratado como o mesmo traço.
 *
 * O olhar salta: um sacádico atravessa a tela em ~40 ms, e ligar os dois
 * extremos com uma reta desenharia um risco que o paciente não pediu. Acima
 * deste limiar o traço é reiniciado — o pincel "pula" em vez de arrastar.
 */
const SALTO_MAXIMO_PX = 220;

export const DrawingGame: React.FC = () => {
  const navigate = useNavigate();
  const { subscribe } = useGaze();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [pincelLigado, setPincelLigado] = useState(false);
  const [cor, setCor] = useState(CORES[0].valor);
  const [espessuraIdx, setEspessuraIdx] = useState(1);

  // O callback do gaze roda a 30 Hz fora do ciclo de render: ler o state
  // direto dele congelaria os valores do primeiro render. Refs mantêm a
  // assinatura estável (uma só) e sempre com o valor atual.
  const pincelRef = useRef(pincelLigado);
  const corRef = useRef(cor);
  const espessuraRef = useRef(ESPESSURAS[espessuraIdx].valor);
  pincelRef.current = pincelLigado;
  corRef.current = cor;
  espessuraRef.current = ESPESSURAS[espessuraIdx].valor;

  /** Último ponto pintado, em coordenadas do canvas. `null` = traço novo. */
  const ultimoPontoRef = useRef<{ x: number; y: number } | null>(null);

  // O canvas precisa de largura/altura em ATRIBUTOS (o buffer), não só em CSS:
  // sem isso ele nasce 300×150 e o desenho sai esticado.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ajustar = () => {
      const pai = canvas.parentElement;
      if (!pai) return;
      const l = pai.clientWidth;
      const a = pai.clientHeight;
      if (l > 0 && a > 0 && (canvas.width !== l || canvas.height !== a)) {
        // Redimensionar limpa o buffer; guardar e repor o conteúdo mantém o
        // desenho vivo quando a janela muda de tamanho.
        const ctx = canvas.getContext('2d');
        const anterior = ctx && canvas.width > 0 && canvas.height > 0 ? ctx.getImageData(0, 0, canvas.width, canvas.height) : null;
        canvas.width = l;
        canvas.height = a;
        if (ctx && anterior) ctx.putImageData(anterior, 0, 0);
      }
    };
    ajustar();
    window.addEventListener('resize', ajustar);
    return () => window.removeEventListener('resize', ajustar);
  }, []);

  /** Pinta de `ultimoPonto` até (x, y), em coordenadas do canvas. */
  const pintarAte = useCallback((x: number, y: number) => {
    const canvas = canvasRef.current;
    // `getContext` devolve null em ambiente de teste (jsdom sem canvas real).
    // Sair em silêncio é o certo: o resto da tela continua operável.
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const anterior = ultimoPontoRef.current;
    ctx.strokeStyle = corRef.current;
    ctx.lineWidth = espessuraRef.current;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    ctx.beginPath();
    if (anterior && Math.hypot(x - anterior.x, y - anterior.y) <= SALTO_MAXIMO_PX) {
      ctx.moveTo(anterior.x, anterior.y);
      ctx.lineTo(x, y);
    } else {
      // Traço novo (ou salto grande): um ponto no lugar de uma reta atravessando.
      ctx.moveTo(x, y);
      ctx.lineTo(x + 0.01, y);
    }
    ctx.stroke();
    ultimoPontoRef.current = { x, y };
  }, []);

  // Assinatura do olhar. Uma só, criada no mount: as opções (cor, espessura,
  // pincel) entram pelos refs acima.
  useEffect(() => {
    const cancelar = subscribe((sample) => {
      if (!pincelRef.current) return;
      // Sem rosto a posição é a última válida, não onde o paciente está
      // olhando — pintar aí deixaria um borrão no ponto em que ele piscou.
      if (!sample.hasFace) return;

      const canvas = canvasRef.current;
      if (!canvas) return;
      const rect = canvas.getBoundingClientRect();
      const x = sample.x - rect.left;
      const y = sample.y - rect.top;

      // Olhar fora do canvas (na barra lateral, escolhendo uma cor) NÃO pinta,
      // e ainda quebra o traço: sem isso, voltar da barra para o desenho
      // deixaria um risco reto atravessando a tela.
      if (x < 0 || y < 0 || x > rect.width || y > rect.height) {
        ultimoPontoRef.current = null;
        return;
      }
      // O buffer pode ter escala diferente do tamanho em CSS.
      const escalaX = rect.width > 0 ? canvas.width / rect.width : 1;
      const escalaY = rect.height > 0 ? canvas.height / rect.height : 1;
      pintarAte(x * escalaX, y * escalaY);
    });
    return cancelar;
  }, [subscribe, pintarAte]);

  const alternarPincel = useCallback(() => {
    setPincelLigado((ligado) => {
      // Ao desligar E ao ligar o traço recomeça: religar o pincel do outro
      // lado da tela não pode emendar com o que foi desenhado antes.
      ultimoPontoRef.current = null;
      return !ligado;
    });
  }, []);

  const apagarTudo = useCallback(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ultimoPontoRef.current = null;
  }, []);

  // ── Desenho por mouse (para testes sem rastreamento) ───────────────────────
  const arrastandoRef = useRef(false);
  const pontoDoMouse = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    const escalaX = rect.width > 0 ? canvas.width / rect.width : 1;
    const escalaY = rect.height > 0 ? canvas.height / rect.height : 1;
    return { x: (e.clientX - rect.left) * escalaX, y: (e.clientY - rect.top) * escalaY };
  };

  const espessura = ESPESSURAS[espessuraIdx];

  return (
    <main
      role="main"
      aria-labelledby="drawing-title"
      style={{
        display: 'flex',
        width: '100vw',
        height: '100vh',
        boxSizing: 'border-box',
        background: 'var(--color-bg-base)',
        color: 'var(--color-text-base)',
        fontFamily: "'Inter', system-ui, sans-serif",
        overflow: 'hidden',
      }}
    >
      {/* Barra lateral: todos os controles ficam fora do canvas, para que olhar
          um controle nunca pinte por acidente. */}
      <aside
        aria-label="Ferramentas de desenho"
        style={{
          width: 320,
          flexShrink: 0,
          padding: '1.5rem 1.25rem',
          boxSizing: 'border-box',
          display: 'flex',
          flexDirection: 'column',
          gap: '0.9rem',
          background: 'var(--color-card-bg)',
          borderRight: '2px solid var(--color-card-border)',
          overflowY: 'auto',
        }}
      >
        <GazeButton
          onClick={() => navigate('/games')}
          width={290}
          height={64}
          noWarn
          isolado
          style={{
            borderRadius: '1.25rem',
            border: '2px solid var(--color-card-border)',
            background: 'var(--color-bg-base)',
          }}
          aria-label="Voltar para Ajuda e Lazer"
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.6rem', fontSize: '1.2rem', fontWeight: 800 }}>
            <ArrowLeft size={26} /> Voltar
          </span>
        </GazeButton>

        <h1 id="drawing-title" style={{ fontSize: '1.35rem', fontWeight: 900, margin: '0.25rem 0 0 0' }}>
          Desenho com Olhar
        </h1>

        <GazeButton
          onClick={alternarPincel}
          data-dwell-ms={DWELL_DO_PINCEL_MS}
          width={290}
          height={120}
          aria-pressed={pincelLigado}
          aria-label={pincelLigado ? 'Desligar o pincel' : 'Ligar o pincel'}
          style={{
            borderRadius: '1.5rem',
            background: pincelLigado
              ? 'linear-gradient(135deg, #16a34a, #15803d)'
              : 'var(--color-bg-base)',
            color: pincelLigado ? '#ffffff' : 'var(--color-text-base)',
            border: pincelLigado ? '3px solid #14532d' : '3px solid var(--color-card-border)',
          }}
        >
          <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.35rem' }}>
            {pincelLigado ? <Eye size={34} /> : <EyeOff size={34} />}
            <span style={{ fontSize: '1.3rem', fontWeight: 900 }}>
              {pincelLigado ? 'Pincel ligado' : 'Pincel desligado'}
            </span>
            <span style={{ fontSize: '0.95rem', fontWeight: 600, opacity: 0.8 }}>
              Olhe {DWELL_DO_PINCEL_MS / 1000} s para trocar
            </span>
          </span>
        </GazeButton>

        <span style={{ fontSize: '1rem', fontWeight: 800, opacity: 0.7, marginTop: '0.25rem' }}>
          Cor
        </span>
        <div
          role="radiogroup"
          aria-label="Cor do pincel"
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0.75rem' }}
        >
          {CORES.map((c) => (
            <GazeButton
              key={c.valor}
              onClick={() => setCor(c.valor)}
              role="radio"
              aria-checked={cor === c.valor}
              aria-label={`Cor ${c.nome}`}
              // 140×100 fica abaixo do alvo mínimo de 5°: o canvas precisa do
              // resto da tela. O vão de 0,75rem é o que protege a escolha —
              // errar o alvo cai numa cor vizinha (inofensivo), não no canvas.
              noWarn
              width={140}
              height={100}
              style={{
                borderRadius: '1.25rem',
                background: c.valor,
                border: cor === c.valor ? '5px solid var(--color-text-base)' : '3px solid rgba(255,255,255,0.6)',
                color: '#ffffff',
                fontSize: '1.05rem',
                fontWeight: 800,
                textShadow: '0 1px 4px rgba(0,0,0,0.45)',
              }}
            >
              {c.nome}
            </GazeButton>
          ))}
        </div>

        <GazeButton
          onClick={() => setEspessuraIdx((i) => (i + 1) % ESPESSURAS.length)}
          width={290}
          height={88}
          noWarn
          aria-label={`Espessura ${espessura.nome}. Acione para trocar.`}
          style={{
            borderRadius: '1.25rem',
            border: '3px solid var(--color-card-border)',
            background: 'var(--color-bg-base)',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.85rem' }}>
            <span
              aria-hidden="true"
              style={{
                width: espessura.valor,
                height: espessura.valor,
                borderRadius: '50%',
                background: cor,
                flexShrink: 0,
              }}
            />
            <span style={{ fontSize: '1.15rem', fontWeight: 800 }}>
              Espessura: {espessura.nome}
            </span>
          </span>
        </GazeButton>

        <GazeButton
          onClick={apagarTudo}
          width={290}
          height={88}
          noWarn
          aria-label="Apagar todo o desenho"
          style={{
            borderRadius: '1.25rem',
            border: '3px solid #fecaca',
            background: '#fee2e2',
            color: '#b91c1c',
          }}
        >
          <span style={{ display: 'flex', alignItems: 'center', gap: '0.7rem', fontSize: '1.2rem', fontWeight: 800 }}>
            <Eraser size={28} /> Apagar tudo
          </span>
        </GazeButton>
      </aside>

      {/* Área de desenho */}
      <div style={{ flex: 1, position: 'relative', overflow: 'hidden' }}>
        <canvas
          ref={canvasRef}
          role="img"
          aria-label="Área de desenho"
          onMouseDown={(e) => {
            arrastandoRef.current = true;
            ultimoPontoRef.current = null;
            const p = pontoDoMouse(e);
            if (p) pintarAte(p.x, p.y);
          }}
          onMouseMove={(e) => {
            if (!arrastandoRef.current) return;
            const p = pontoDoMouse(e);
            if (p) pintarAte(p.x, p.y);
          }}
          onMouseUp={() => {
            arrastandoRef.current = false;
            ultimoPontoRef.current = null;
          }}
          onMouseLeave={() => {
            arrastandoRef.current = false;
            ultimoPontoRef.current = null;
          }}
          style={{ display: 'block', width: '100%', height: '100%', cursor: 'crosshair', touchAction: 'none' }}
        />

        <div
          role="status"
          aria-live="polite"
          data-no-dwell="true"
          style={{
            position: 'absolute',
            bottom: '1.5rem',
            left: '50%',
            transform: 'translateX(-50%)',
            background: pincelLigado ? 'rgba(22,163,74,0.95)' : 'var(--color-card-bg)',
            color: pincelLigado ? '#ffffff' : 'var(--color-text-base)',
            border: '2px solid var(--color-card-border)',
            borderRadius: '1.25rem',
            padding: '0.85rem 1.75rem',
            fontSize: '1.1rem',
            fontWeight: 800,
            pointerEvents: 'none',
            boxShadow: '0 8px 22px var(--color-card-shadow)',
          }}
        >
          {pincelLigado
            ? 'Pintando onde você olhar — desligue o pincel para parar'
            : 'Ligue o pincel na barra ao lado para desenhar com o olhar'}
        </div>
      </div>
    </main>
  );
};
