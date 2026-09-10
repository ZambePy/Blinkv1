import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  MousePointerClick,
  MousePointer2,
  Move,
  MoveVertical,
  Keyboard,
  ZoomIn,
  Pin,
  Pause,
  Play,
  TriangleAlert,
  Home,
  CornerDownLeft,
  Delete,
  ArrowBigUp,
  ArrowLeft,
  ArrowRight,
  X,
} from 'lucide-react';
import { createDwellState, stepDwell, DEFAULT_DWELL_CONFIG, type DwellState, type DwellTarget } from '@tracker/interaction/dwell';
import { estiloDoCursor } from '@tracker/interaction/cursorStyle';
import { geometriaDoAnel } from '@tracker/interaction/dwellRing';
import type { AmostraDeOlhar, ConfiguracaoDoModo, AcaoDoSistema } from '@tracker/computador/protocolo';
import type { Ponto } from '@tracker/computador/geometria';
import {
  ESTADO_INICIAL,
  LUPA_RAIO_PX,
  LUPA_ZOOM,
  reduzir,
  descricaoDoEstado,
  type EstadoDaMaquina,
  type EventoDaMaquina,
  type IdDeBotao,
  type Efeito,
} from './maquina';
import { pontePara } from './ponte';

/**
 * A sobreposição: o que o paciente vê por cima do Windows.
 *
 *   - cursor pequeno com anel de progresso (o mesmo desenho do app, menor);
 *   - barra lateral de ações (armar tarefa, teclado, lupa, fixar, pausar,
 *     emergência, voltar ao IrisFlow);
 *   - painel da lupa (região ampliada) e teclado, quando abertos;
 *   - uma linha de estado no canto superior esquerdo.
 *
 * O dwell é o do core (`stepDwell`), com uma diferença: sobre a ÁREA (que
 * não tem elementos) o "alvo" é uma fixação — um ponto que vale enquanto o
 * olhar fica a menos de `RAIO_DE_FIXACAO_PX` dele. Sem isso, olhar 1,5 s para
 * qualquer lugar da tela contaria como dwell, e ler um parágrafo clicaria.
 */

const RAIO_DE_FIXACAO_PX = 35;
const RAIO_DE_FIXACAO_NA_LUPA_PX = 24;
const LUPA_CANCELA_APOS_MS = 1200;
const INATIVIDADE_MS = 3 * 60_000;
const CORES = {
  painel: 'rgba(15, 23, 42, 0.86)',
  borda: 'rgba(148, 163, 184, 0.35)',
  texto: '#f8fafc',
  ativo: '#38bdf8',
  emergencia: '#dc2626',
  voltar: '#22c55e',
};

interface BotaoDaBarra {
  id: IdDeBotao;
  rotulo: string;
  icone: React.ReactNode;
  cor?: string;
}

const BOTOES: BotaoDaBarra[] = [
  { id: 'clique', rotulo: 'Clicar', icone: <MousePointerClick size={26} /> },
  { id: 'duplo', rotulo: 'Duplo', icone: <MousePointer2 size={26} /> },
  { id: 'direito', rotulo: 'Direito', icone: <MousePointer2 size={26} style={{ transform: 'scaleX(-1)' }} /> },
  { id: 'arrastar', rotulo: 'Arrastar', icone: <Move size={26} /> },
  { id: 'rolar', rotulo: 'Rolar', icone: <MoveVertical size={26} /> },
  { id: 'teclado', rotulo: 'Teclado', icone: <Keyboard size={26} /> },
  { id: 'lupa', rotulo: 'Lupa', icone: <ZoomIn size={26} /> },
  { id: 'fixar', rotulo: 'Fixar', icone: <Pin size={26} /> },
  { id: 'pausar', rotulo: 'Pausar', icone: <Pause size={26} /> },
  { id: 'emergencia', rotulo: 'Socorro', icone: <TriangleAlert size={26} />, cor: CORES.emergencia },
  { id: 'voltar', rotulo: 'IrisFlow', icone: <Home size={26} />, cor: CORES.voltar },
];

const LINHAS_DO_TECLADO: string[][] = [
  ['q', 'w', 'e', 'r', 't', 'y', 'u', 'i', 'o', 'p'],
  ['a', 's', 'd', 'f', 'g', 'h', 'j', 'k', 'l', 'ç'],
  ['maiuscula', 'z', 'x', 'c', 'v', 'b', 'n', 'm', 'apagar'],
  ['á', 'é', 'í', 'ó', 'ú', 'â', 'ê', 'ô', 'ã', 'õ'],
  ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ['.', ',', '?', '!', '@', '-', '_', ':', '/', "'"],
  ['esquerda', 'direita', 'espaco', 'enter', 'ctrl+c', 'ctrl+v', 'fechar'],
];

const ROTULO_DA_TECLA: Record<string, React.ReactNode> = {
  maiuscula: <ArrowBigUp size={22} />,
  apagar: <Delete size={22} />,
  espaco: 'espaço',
  enter: <CornerDownLeft size={22} />,
  esquerda: <ArrowLeft size={22} />,
  direita: <ArrowRight size={22} />,
  fechar: <X size={22} />,
  'ctrl+c': 'copiar',
  'ctrl+v': 'colar',
};

const idDaTecla = (k: string) => (k.length === 1 ? `c:${k}` : k);

interface Fixacao {
  key: object;
  ponto: Ponto;
}

export const Overlay: React.FC = () => {
  const ponte = useMemo(() => pontePara(window), []);
  const [config, setConfig] = useState<ConfiguracaoDoModo | null>(null);
  const [estado, setEstado] = useState<EstadoDaMaquina>(ESTADO_INICIAL);
  const [semOlhar, setSemOlhar] = useState(false);
  const estadoRef = useRef<EstadoDaMaquina>(ESTADO_INICIAL);
  const configRef = useRef<ConfiguracaoDoModo | null>(null);
  const dwellRef = useRef<DwellState>(createDwellState());
  const fixacaoRef = useRef<Fixacao | null>(null);
  const cursorRef = useRef<HTMLDivElement>(null);
  const anelRef = useRef<SVGCircleElement>(null);
  const realceRef = useRef<HTMLElement | null>(null);
  const foraDaLupaDesdeRef = useRef<number | null>(null);
  const ultimoRostoRef = useRef<number>(performance.now());
  const lupaPedidoRef = useRef(0);

  // `despachar` e `executarEfeito` se chamam mutuamente (a lupa despacha o
  // resultado da captura); o ref quebra o ciclo sem re-assinar o olhar.
  const despacharRef = useRef<(evento: EventoDaMaquina) => void>(() => {});
  const despachar = useCallback((evento: EventoDaMaquina) => despacharRef.current(evento), []);

  const executarEfeito = (ef: Efeito): void => {
    if (ef.tipo === 'acao') {
      void ponte.acao(ef.acao).then((r) => {
        if (!r.ok) console.warn('[overlay] ação recusada', ef.acao.tipo, r.erro);
      });
      return;
    }
    // Lupa: pede a captura e, quando chega, abre o painel. Um pedido antigo
    // que chegue depois de o paciente ter cancelado é descartado.
    const pedido = ++lupaPedidoRef.current;
    const acao: AcaoDoSistema = { tipo: 'lupa', ponto: ef.ponto, raioPx: LUPA_RAIO_PX };
    void ponte.acao(acao).then((r) => {
      if (pedido !== lupaPedidoRef.current) return;
      if (r.ok && 'lupa' in r) despachar({ tipo: 'lupaPronta', regiao: r.lupa.regiao, imagem: r.lupa.imagem });
      else despachar({ tipo: 'lupaFalhou' });
    });
  };

  despacharRef.current = (evento: EventoDaMaquina) => {
    const { estado: novo, efeitos } = reduzir(estadoRef.current, evento);
    if (novo !== estadoRef.current) {
      estadoRef.current = novo;
      setEstado(novo);
    }
    for (const ef of efeitos) executarEfeito(ef);
  };

  useEffect(() => {
    const aplicar = (c: ConfiguracaoDoModo) => {
      if (configRef.current) return; // a primeira que chegar vale
      configRef.current = c;
      setConfig(c);
      estadoRef.current = { ...ESTADO_INICIAL, lupa: c.lupa };
      setEstado(estadoRef.current);
    };
    const off = ponte.onConfig(aplicar);
    // Também PEDE a configuração: se o push do main chegou antes de este
    // ouvinte existir, a página ficaria transparente e sem barra — com o app
    // escondido atrás. Os dois caminhos convergem em `aplicar`.
    void ponte.acao({ tipo: 'pronto' }).then((r) => {
      if (r.ok && 'config' in r) aplicar(r.config);
    });
    return off;
  }, [ponte]);

  // Inatividade: sem rosto por muito tempo, volta ao IrisFlow. O paciente
  // que saiu da frente da tela não pode voltar e achar o Windows "travado".
  useEffect(() => {
    const t = setInterval(() => {
      const idade = performance.now() - ultimoRostoRef.current;
      setSemOlhar(idade > 4000);
      if (idade > INATIVIDADE_MS) void ponte.acao({ tipo: 'sair', motivo: 'inatividade' });
    }, 1000);
    return () => clearInterval(t);
  }, [ponte]);

  /** Resolve o alvo do dwell para uma amostra: elemento da UI ou fixação. */
  const resolverAlvo = (a: AmostraDeOlhar): { target: DwellTarget | null; tipo: 'botao' | 'tecla' | 'lupa' | 'area' | null; el: HTMLElement | null } => {
    const e = estadoRef.current;
    const elemento = (document.elementFromPoint(a.x, a.y) as Element | null)?.closest<HTMLElement>('[data-alvo]') ?? null;
    if (elemento) {
      const id = elemento.dataset.alvo ?? '';
      const tipo = id.startsWith('botao:') ? 'botao' : id.startsWith('tecla:') ? 'tecla' : id === 'lupa-area' ? 'lupa' : null;
      if (tipo === 'lupa') {
        const fix = fixacao(a, RAIO_DE_FIXACAO_NA_LUPA_PX);
        return { target: { key: fix.key, customDwellMs: null, isEmergency: false, isRecovery: false, isDisabled: false }, tipo, el: elemento };
      }
      if (tipo) {
        fixacaoRef.current = null;
        return {
          target: {
            key: elemento,
            customDwellMs: null,
            isEmergency: id === 'botao:emergencia',
            isRecovery: id === 'botao:voltar',
            isDisabled: elemento.getAttribute('aria-disabled') === 'true',
          },
          tipo,
          el: elemento,
        };
      }
    }
    // Área: só conta quando há algo para fazer com a fixação.
    const areaAtiva = !e.pausado && !e.teclado && e.fase.tipo !== 'lupa' && (e.tarefa !== null || e.fase.tipo === 'rolando');
    if (!areaAtiva) {
      fixacaoRef.current = null;
      return { target: null, tipo: null, el: null };
    }
    const fix = fixacao(a, RAIO_DE_FIXACAO_PX);
    return { target: { key: fix.key, customDwellMs: null, isEmergency: false, isRecovery: false, isDisabled: false }, tipo: 'area', el: null };
  };

  const fixacao = (a: Ponto, raio: number): Fixacao => {
    const atual = fixacaoRef.current;
    if (atual && Math.hypot(a.x - atual.ponto.x, a.y - atual.ponto.y) <= raio) return atual;
    const nova = { key: {}, ponto: { x: a.x, y: a.y } };
    fixacaoRef.current = nova;
    return nova;
  };

  const realcar = (el: HTMLElement | null, pct: number) => {
    const anterior = realceRef.current;
    if (anterior && anterior !== el) {
      anterior.style.boxShadow = '';
      anterior.style.background = '';
    }
    realceRef.current = el;
    if (!el) return;
    const p = Math.round(pct * 100);
    el.style.background = `conic-gradient(${CORES.ativo} ${p}%, rgba(56,189,248,0.18) ${p}%)`;
    el.style.boxShadow = `0 0 0 3px ${CORES.ativo}`;
  };

  useEffect(() => {
    const off = ponte.onOlhar((a) => {
      const c = configRef.current;
      if (!c) return;
      if (a.hasFace) ultimoRostoRef.current = performance.now();

      const { target, tipo, el } = resolverAlvo(a);
      const saida = stepDwell(
        dwellRef.current,
        { x: a.x, y: a.y, timestamp: a.t, hasFace: a.hasFace, degraded: a.degraded, uncalibrated: a.uncalibrated, eyeState: a.eyeState },
        target,
        { ...DEFAULT_DWELL_CONFIG, dwellMs: c.dwellMs },
      );
      dwellRef.current = saida.state;

      let pct = 0;
      if (saida.effect.type === 'progress') pct = saida.effect.pct;
      if (saida.effect.type === 'click') {
        pct = 0;
        fixacaoRef.current = null;
        if (tipo === 'botao' && el) despachar({ tipo: 'botao', id: el.dataset.alvo!.slice('botao:'.length) as IdDeBotao });
        else if (tipo === 'tecla' && el) despachar({ tipo: 'tecla', id: el.dataset.alvo!.slice('tecla:'.length) });
        else if (tipo === 'lupa' && el) {
          const r = el.getBoundingClientRect();
          despachar({ tipo: 'lupaAlvo', pontoNoPainel: { x: a.x - r.left, y: a.y - r.top }, painel: { width: r.width, height: r.height } });
        } else if (tipo === 'area') despachar({ tipo: 'area', ponto: { x: a.x, y: a.y } });
      }
      realcar(tipo === 'botao' || tipo === 'tecla' ? el : null, pct);

      // Rolagem contínua e cancelamento da lupa dependem do fluxo, não do dwell.
      const e = estadoRef.current;
      if (e.fase.tipo === 'rolando') despachar({ tipo: 'olhar', ponto: { x: a.x, y: a.y }, t: a.t });
      if (e.fase.tipo === 'lupa' && e.fase.regiao) {
        if (tipo === 'lupa') foraDaLupaDesdeRef.current = null;
        else if (foraDaLupaDesdeRef.current === null) foraDaLupaDesdeRef.current = a.t;
        else if (a.t - foraDaLupaDesdeRef.current > LUPA_CANCELA_APOS_MS) {
          foraDaLupaDesdeRef.current = null;
          lupaPedidoRef.current++;
          despachar({ tipo: 'lupaCancelada' });
        }
      } else {
        foraDaLupaDesdeRef.current = null;
      }

      // Cursor e anel, escrita direta no DOM (30–60 Hz).
      const cursor = cursorRef.current;
      if (!cursor) return;
      const est = estiloDoCursor({
        tamanhoPx: c.tamanhoCursorPx,
        estado: target ? 'sobreAlvo' : a.degraded ? 'degradado' : 'normal',
        dwellPct: pct,
      });
      cursor.style.transform = `translate3d(${a.x - est.offsetPx}px, ${a.y - est.offsetPx}px, 0) scale(${est.escala})`;
      cursor.style.opacity = a.hasFace ? '1' : '0.3';
      cursor.style.background = est.preenchimento;
      cursor.style.boxShadow = est.anel;
      cursor.style.border = est.tracejado ? '2px dashed rgba(234,179,8,0.9)' : '';
      const anel = anelRef.current;
      if (anel) {
        const svg = anel.ownerSVGElement!;
        if (target && pct > 0) {
          const g = geometriaDoAnel(est.tamanhoPx, pct);
          anel.setAttribute('stroke-dashoffset', String(g.offset));
          svg.style.transform = `translate3d(${a.x - g.centro}px, ${a.y - g.centro}px, 0)`;
          svg.style.opacity = '1';
        } else {
          svg.style.opacity = '0';
        }
      }
    });
    return off;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ponte, despachar]);

  if (!config) return null;

  const g = geometriaDoAnel(config.tamanhoCursorPx, 0);
  const larguraDaBarra = 96;
  const alturaUtil = config.monitor.height - 24;
  const ladoDoBotao = Math.max(52, Math.min(72, Math.floor((alturaUtil - (BOTOES.length - 1) * 8) / BOTOES.length)));

  // Painel da lupa: centrado no ponto, mas inteiro na tela e fora da barra.
  const ladoDaLupa = Math.round(LUPA_RAIO_PX * 2 * LUPA_ZOOM);
  const lupa = estado.fase.tipo === 'lupa' && estado.fase.regiao ? estado.fase : null;
  const posLupa = lupa
    ? {
        left: Math.min(config.monitor.width - larguraDaBarra - ladoDaLupa - 8, Math.max(8, lupa.centro.x - ladoDaLupa / 2)),
        top: Math.min(config.monitor.height - ladoDaLupa - 8, Math.max(8, lupa.centro.y - ladoDaLupa / 2)),
      }
    : null;

  const larguraDoTeclado = Math.min(config.monitor.width - larguraDaBarra - 32, 10 * 72 + 9 * 8);
  const ladoDaTecla = Math.floor((larguraDoTeclado - 9 * 8) / 10);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        width: config.monitor.width,
        height: config.monitor.height,
        overflow: 'hidden',
        fontFamily: "'Inter', system-ui, -apple-system, sans-serif",
        color: CORES.texto,
        userSelect: 'none',
      }}
    >
      {/* Estado, canto superior esquerdo. */}
      <div
        role="status"
        style={{
          position: 'absolute', top: 10, left: 10, padding: '6px 12px', borderRadius: 10,
          background: CORES.painel, border: `1px solid ${CORES.borda}`, fontSize: 14, fontWeight: 700,
          display: 'flex', alignItems: 'center', gap: 8, maxWidth: 480,
        }}
      >
        <span style={{ width: 10, height: 10, borderRadius: 5, background: semOlhar ? '#f59e0b' : CORES.voltar }} />
        {semOlhar ? 'Procurando o olhar…' : descricaoDoEstado(estado)}
      </div>

      {/* Barra lateral. Também responde ao mouse FÍSICO: quando ele entra na
          barra, a sobreposição deixa de ser atravessável, e um cuidador pode
          clicar em "IrisFlow" ou "Socorro" com o mouse de verdade. */}
      <div
        aria-label="Ações do Modo Computador"
        onMouseEnter={() => void ponte.acao({ tipo: 'capturarMouse', ligado: true })}
        onMouseLeave={() => void ponte.acao({ tipo: 'capturarMouse', ligado: false })}
        style={{
          position: 'absolute', top: 12, right: 8, bottom: 12, width: larguraDaBarra - 16,
          display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'center', justifyContent: 'center',
        }}
      >
        {BOTOES.map((b) => {
          const ligado =
            (b.id === estado.tarefa) ||
            (b.id === 'teclado' && estado.teclado) ||
            (b.id === 'lupa' && estado.lupa) ||
            (b.id === 'fixar' && estado.fixar) ||
            (b.id === 'pausar' && estado.pausado);
          const cor = b.cor ?? (ligado ? CORES.ativo : CORES.borda);
          return (
            <div
              key={b.id}
              data-alvo={`botao:${b.id}`}
              role="button"
              aria-pressed={ligado}
              onClick={() => despachar({ tipo: 'botao', id: b.id })}
              onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') despachar({ tipo: 'botao', id: b.id }); }}
              tabIndex={0}
              style={{
                width: ladoDoBotao, height: ladoDoBotao, borderRadius: 14, boxSizing: 'border-box',
                background: ligado ? 'rgba(56,189,248,0.22)' : CORES.painel,
                border: `2px solid ${cor}`,
                display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 2,
                color: b.cor ?? CORES.texto, fontSize: 11, fontWeight: 700, letterSpacing: '0.01em',
                cursor: 'pointer',
              }}
            >
              {b.id === 'pausar' && estado.pausado ? <Play size={26} /> : b.icone}
              <span>{b.id === 'pausar' && estado.pausado ? 'Retomar' : b.rotulo}</span>
            </div>
          );
        })}
      </div>

      {/* Painel da lupa. */}
      {lupa && posLupa && (
        <div
          data-alvo="lupa-area"
          style={{
            position: 'absolute', left: posLupa.left, top: posLupa.top, width: ladoDaLupa, height: ladoDaLupa,
            borderRadius: 16, overflow: 'hidden', border: `3px solid ${CORES.ativo}`,
            boxShadow: '0 12px 40px rgba(0,0,0,0.5)', background: '#000',
          }}
        >
          {lupa.imagem && (
            <img src={lupa.imagem} alt="" draggable={false} style={{ width: '100%', height: '100%', display: 'block', imageRendering: 'auto' }} />
          )}
        </div>
      )}

      {/* Teclado. */}
      {estado.teclado && (
        <div
          aria-label="Teclado"
          style={{
            position: 'absolute', left: 16, bottom: 12, width: larguraDoTeclado, padding: 8, boxSizing: 'border-box',
            borderRadius: 16, background: CORES.painel, border: `1px solid ${CORES.borda}`,
            display: 'flex', flexDirection: 'column', gap: 8,
          }}
        >
          {LINHAS_DO_TECLADO.map((linha, i) => (
            <div key={i} style={{ display: 'flex', gap: 8, justifyContent: 'center' }}>
              {linha.map((k) => {
                const id = idDaTecla(k);
                const largo = k === 'espaco' ? 3 : k === 'ctrl+c' || k === 'ctrl+v' ? 1.4 : 1;
                const ligado = k === 'maiuscula' && estado.maiuscula;
                return (
                  <div
                    key={k}
                    data-alvo={`tecla:${id}`}
                    role="button"
                    style={{
                      width: ladoDaTecla * largo + 8 * (largo - 1), height: Math.min(56, ladoDaTecla), borderRadius: 10, boxSizing: 'border-box',
                      background: ligado ? 'rgba(56,189,248,0.22)' : 'rgba(30,41,59,0.9)',
                      border: `2px solid ${ligado ? CORES.ativo : CORES.borda}`,
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                      fontSize: k.length === 1 ? 22 : 13, fontWeight: 700, color: k === 'fechar' ? '#fca5a5' : CORES.texto,
                    }}
                  >
                    {ROTULO_DA_TECLA[k] ?? (k.length === 1 && estado.maiuscula ? k.toUpperCase() : k)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}

      {/* Cursor e anel de progresso. */}
      <div
        ref={cursorRef}
        aria-hidden="true"
        style={{
          position: 'absolute', left: 0, top: 0, width: config.tamanhoCursorPx, height: config.tamanhoCursorPx,
          borderRadius: '50%', pointerEvents: 'none', transform: 'translate3d(-9999px,-9999px,0)',
          transformOrigin: 'center center', willChange: 'transform', opacity: 0, zIndex: 20,
        }}
      />
      <svg
        aria-hidden="true"
        width={g.lado}
        height={g.lado}
        viewBox={`0 0 ${g.lado} ${g.lado}`}
        style={{ position: 'absolute', left: 0, top: 0, pointerEvents: 'none', opacity: 0, zIndex: 21, transform: 'translate3d(-9999px,-9999px,0)' }}
      >
        <circle
          ref={anelRef}
          cx={g.centro}
          cy={g.centro}
          r={g.raio}
          fill="none"
          stroke={CORES.ativo}
          strokeWidth={g.espessura}
          strokeDasharray={g.circunferencia}
          strokeDashoffset={g.circunferencia}
          strokeLinecap="round"
          transform={`rotate(${g.rotacaoDeg} ${g.centro} ${g.centro})`}
        />
      </svg>
    </div>
  );
};
