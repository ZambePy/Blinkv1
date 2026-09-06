import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Delete, Home, Speech, Trash2 } from 'lucide-react';
import { GazePageLayout } from '../components/ui/GazePageLayout';
import { GazeButton } from '../components/ui/GazeButton';
import { GazeGrid } from '../components/ui/GazeGrid';
import { useGaze, useIsDwelling } from '../context/GazeContext';
import { getPredictions, learnSentence } from '../utils/wordPredictor';
import { logSentence } from '../utils/clinicalLogger';
import { useNavigate } from 'react-router-dom';

/* ────────────────────────────────────────────────────────────────────────────
 * DIREÇÃO VISUAL
 *
 * O material desta tela não são as letras — é a ESPERA. Toda ação custa ao
 * usuário ~1,5 s de olhar parado, e cada seleção errada custa fadiga real:
 *
 *  1. Feedback de dwell só na fóvea. A tecla aquece (cor, sem deslocamento) e
 *     um traço curto cresce sob o glifo. Nada se mexe nas bordas, porque
 *     movimento periférico dispara sacada reflexa e cancelaria o próprio dwell.
 *     Ver o bloco `.kb-key` em index.css.
 *
 *  2. Os dois níveis são cromaticamente distintos. Escolher um GRUPO é recuado
 *     (nada comprometido ainda); escolher a LETRA é contraste cheio.
 *
 *  3. Um único acento (o âmbar de `--warn`) marca sempre a mesma coisa:
 *     compromisso. Aparece no dwell, na confirmação e no texto já escrito.
 *
 *  4. A linha de composição é monoespaçada: é um buffer de texto, e dá para
 *     conferir o que se escreveu contando posições.
 *
 * Todas as cores vêm dos tokens do tema, mapeadas para as variáveis `--kb-*`
 * que o CSS do teclado consome. Assim o teclado acompanha claro/escuro.
 * ──────────────────────────────────────────────────────────────────────────── */
const KB_VARS = {
  /** Cor do glifo na tecla "disparada" (fundo âmbar cheio). */
  '--kb-ground': 'var(--on-primary)',
  '--kb-key': 'var(--surface)',
  '--kb-key-edge': 'var(--border)',
  /** Contraste cheio — nível 2, a letra que vai ser escrita. */
  '--kb-glyph': 'var(--text)',
  /** Recuado — nível 1 e chrome de navegação. */
  '--kb-glyph-dim': 'var(--text-3)',
  '--kb-ember': 'var(--warn)',
  '--kb-ember-edge': 'color-mix(in srgb, var(--warn) 45%, var(--border))',
  '--kb-ember-bright': 'var(--warn)',
} as const;

/** Monoespaçada para o buffer: caracteres em células iguais, conferíveis. */
const KB_FONT_TEXT = "ui-monospace, 'Cascadia Mono', Consolas, 'Courier New', monospace";

/** Barra superior alta o bastante para início/voltar respeitarem o mínimo de
 *  5° (198 px). Abaixo disso não é alvo de olhar, é enfeite. */
const TOPBAR_H = 208;
const NAV_W = 200;
const NAV_H = 200;
const GRID_GAP = 18;

/** Dwell mais longo no chrome que nas teclas. Ir para o início no meio de uma
 *  frase descarta o que foi escrito; olhar por acaso 1,5 s acontece, fixar
 *  2,6 s contínuos é decisão. */
const DWELL_HOME_MS = 2600;
const DWELL_BACK_MS = 2000;

const FS_LETTER = '6rem';
const FS_GROUP = '3.4rem';
const FS_SUGGESTION = '2.5rem';
const FS_TEXT = '3.25rem';
const FS_ACTION = '1.6rem';
const ICON_SIZE = 68;

const DEFAULT_WORDS = ['EU', 'SIM', 'NÃO', 'TALVEZ'];
const MAX_SUGGESTIONS = 5;

const GROUPS = [
  ['A', 'B', 'C', 'D', 'E', 'F'],
  ['G', 'H', 'I', 'J', 'K', 'L'],
  ['M', 'N', 'O', 'P', 'Q', 'R'],
  ['S', 'T', 'U', 'V', 'W', 'X'],
  ['Y', 'Z', 'Espaço', 'Falar', 'Apagar', 'Limpar'],
];

/**
 * Glifo de espaço (⌴) em SVG.
 *
 * O caractere U+2423 sai com corpo diferente em cada fonte — encolhia e caía
 * abaixo da linha de base do "Y Z" ao lado. Em SVG a barra tem sempre a mesma
 * proporção, qualquer que seja a fonte que o sistema resolver.
 */
const EspacoGlifo: React.FC<{ width: number }> = ({ width }) => {
  const altura = Math.round(width * 0.18);
  const traco = Math.max(2, Math.round(width * 0.07));
  const m = traco / 2;
  return (
    <svg
      width={width}
      height={altura}
      viewBox={'0 0 ' + width + ' ' + altura}
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      <path
        d={'M ' + m + ' 0 V ' + (altura - m) + ' H ' + (width - m) + ' V 0'}
        fill="none"
        stroke="currentColor"
        strokeWidth={traco}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

export const KeyboardScreen: React.FC = () => {
  const { setIsComposing } = useGaze();
  // Contexto separado: assinar `useGaze()` só para ler `isDwelling` faria a
  // tela inteira re-renderizar a cada mudança de estado do engine.
  const isDwelling = useIsDwelling();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [lastPressed, setLastPressed] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // activeGroup: null (nível 1) | 0-4 (letras/ações) | 5 (sugestões)
  const [activeGroup, setActiveGroup] = useState<number | null>(null);

  useEffect(() => {
    if (isDwelling) return;
    setSuggestions(getPredictions(text).slice(0, MAX_SUGGESTIONS));
  }, [text, isDwelling]);

  useEffect(() => {
    setIsComposing(text.trim().length > 0);
    return () => setIsComposing(false);
  }, [text, setIsComposing]);

  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    };
  }, []);

  const triggerFeedback = (key: string) => {
    setLastPressed(key);
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    feedbackTimeoutRef.current = setTimeout(() => setLastPressed(null), 200);
  };

  const handleSelectSuggestion = (word: string) => {
    setText((t) => {
      if (t.endsWith(' ') || t === '') return t + word + ' ';
      const words = t.trim().split(/\s+/);
      words[words.length - 1] = word;
      return words.join(' ') + ' ';
    });
    triggerFeedback(word);
    setActiveGroup(null);
  };

  const append = (char: string) => {
    setText((t) => t + char);
    triggerFeedback(char);
  };
  const backspace = () => {
    setText((t) => t.slice(0, -1));
    triggerFeedback('backspace');
  };
  const clear = () => {
    setText('');
    triggerFeedback('clear');
  };
  const space = () => {
    setText((t) => t + ' ');
    triggerFeedback('space');
  };

  const speak = () => {
    if ('speechSynthesis' in window && text.trim()) {
      window.speechSynthesis.cancel();
      const u = new SpeechSynthesisUtterance(text);
      u.lang = 'pt-BR';
      u.rate = 0.9;
      window.speechSynthesis.speak(u);
      triggerFeedback('speak');
      learnSentence(text);
      logSentence(text);
    }
  };

  /** Sobe um nível. Só existe quando há nível para subir. */
  const handleBackClick = () => setActiveGroup(null);
  const handleHomeClick = () => navigate('/menu');

  const handleItemClick = (item: string) => {
    if (item === 'Espaço') {
      space();
      setActiveGroup(null);
    } else if (item === 'Falar') {
      speak();
      setActiveGroup(null);
    } else if (item === 'Apagar') {
      backspace();
      // Permanece no grupo de ações para permitir apagar várias letras
    } else if (item === 'Limpar') {
      clear();
      setActiveGroup(null);
    } else {
      append(item);
      setActiveGroup(null);
    }
  };

  const currentSuggestions =
    text.trim().length > 0 && suggestions.length > 0 ? suggestions : DEFAULT_WORDS;

  const keyClass = (variante: 'group' | 'letter' | 'words', pressed = false) =>
    'kb-key kb-key--' + variante + (pressed ? ' kb-key--fired' : '');

  const cell: React.CSSProperties = { height: '100%', width: '100%' };

  /** Tracking largo separa as letras do grupo: são itens de uma lista, não uma
   *  palavra para ler de uma vez. */
  const groupLabel: React.CSSProperties = {
    fontSize: FS_GROUP,
    fontWeight: 600,
    lineHeight: 1.24,
    letterSpacing: '0.18em',
    textIndent: '0.18em',
  };

  const letterGlyph: React.CSSProperties = {
    fontSize: FS_LETTER,
    fontWeight: 500,
    lineHeight: 1,
  };

  const actionLabel: React.CSSProperties = {
    fontSize: FS_ACTION,
    fontWeight: 600,
    letterSpacing: '0.12em',
    textTransform: 'uppercase',
  };

  const renderMainGrid = () => {
    const grupos = [
      ['A B C', 'D E F'],
      ['G H I', 'J K L'],
      ['M N O', 'P Q R'],
      ['S T U', 'V W X'],
    ];

    return (
      <GazeGrid columns={3} rows={2} gap={GRID_GAP}>
        {grupos.map((linhas, idx) => (
          <GazeButton
            key={'group-' + idx}
            className={keyClass('group')}
            onClick={() => setActiveGroup(idx)}
            noWarn
            style={cell}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              {linhas.map((l) => (
                <span key={l} style={groupLabel}>{l}</span>
              ))}
            </div>
          </GazeButton>
        ))}

        {/* Grupo 5: Y, Z e as três ações. A prévia mostra o que há dentro. */}
        <GazeButton
          key="group-4"
          className={keyClass('group')}
          onClick={() => setActiveGroup(4)}
          noWarn
          style={cell}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.4em', ...groupLabel }}>
              <span>Y Z</span>
              <span style={{ paddingBottom: '0.34em' }}>
                <EspacoGlifo width={40} />
              </span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', opacity: 0.75 }}>
              <Speech size={44} />
              <Delete size={44} />
              <Trash2 size={44} />
            </div>
          </div>
        </GazeButton>

        {/* Grupo 6: palavras. Única tecla que escreve uma palavra inteira — o
            fio âmbar no contorno é o que diz isso, sem precisar de legenda. */}
        <GazeButton
          key="group-suggestions"
          className={keyClass('words')}
          onClick={() => { if (currentSuggestions.length > 0) setActiveGroup(5); }}
          noWarn
          style={cell}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.15rem' }}>
            {currentSuggestions.map((word) => (
              <span
                key={word}
                style={{
                  fontSize: FS_SUGGESTION,
                  fontWeight: 500,
                  lineHeight: 1.24,
                }}
              >
                {word}
              </span>
            ))}
          </div>
        </GazeButton>
      </GazeGrid>
    );
  };

  const renderSubGrid = () => {
    let items: string[] = [];
    if (activeGroup === 5) items = currentSuggestions.slice(0, 6);
    else if (activeGroup !== null && activeGroup < 5) items = GROUPS[activeGroup];

    const pilha = (icone: React.ReactNode, rotulo: string) => (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.9rem' }}>
        {icone}
        <span style={actionLabel}>{rotulo}</span>
      </div>
    );

    return (
      <GazeGrid columns={3} rows={2} gap={GRID_GAP}>
        {items.map((item, index) => {
          let content = <span style={letterGlyph}>{item}</span>;

          if (item === 'Espaço') content = pilha(<EspacoGlifo width={76} />, 'Espaço');
          if (item === 'Falar') content = pilha(<Speech size={ICON_SIZE} />, 'Falar');
          if (item === 'Apagar') content = pilha(<Delete size={ICON_SIZE} />, 'Apagar');
          if (item === 'Limpar') content = pilha(<Trash2 size={ICON_SIZE} />, 'Limpar');
          if (activeGroup === 5)
            content = <span style={{ ...letterGlyph, fontSize: FS_SUGGESTION }}>{item}</span>;

          return (
            <GazeButton
              key={index}
              className={keyClass('letter', lastPressed === item)}
              onClick={() => (activeGroup === 5 ? handleSelectSuggestion(item) : handleItemClick(item))}
              noWarn
              style={cell}
            >
              {content}
            </GazeButton>
          );
        })}

        {Array.from({ length: 6 - items.length }).map((_, idx) => (
          <GazeButton
            key={'empty-' + idx}
            className="kb-key kb-key-empty"
            disabled
            noWarn
            style={cell}
          >
            <span />
          </GazeButton>
        ))}
      </GazeGrid>
    );
  };

  const navContent = (icone: React.ReactNode, rotulo: string) => (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}>
      {icone}
      <span style={{ ...actionLabel, fontSize: '1.25rem' }}>{rotulo}</span>
    </div>
  );

  return (
    <GazePageLayout bare showBack={false}>
      <div
        style={
          {
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            background: 'var(--bg)',
            fontFamily: 'var(--font-body)',
            overflow: 'hidden',
            padding: GRID_GAP,
            gap: GRID_GAP,
            boxSizing: 'border-box',
            // Consumidas pelo bloco .kb-* em index.css
            ...KB_VARS,
          } as React.CSSProperties
        }
      >
        {/* ── Barra superior: saídas à esquerda, o que está sendo escrito à
            direita. O texto ocupa o maior espaço porque é o produto da tela. */}
        <div
          style={{
            flex: '0 0 ' + TOPBAR_H + 'px',
            display: 'flex',
            alignItems: 'stretch',
            gap: GRID_GAP,
            boxSizing: 'border-box',
          }}
        >
          <GazeButton
            className="kb-nav"
            onClick={handleHomeClick}
            aria-label="Início"
            data-dwell-ms={DWELL_HOME_MS}
            width={NAV_W}
            height={NAV_H}
            style={{ flex: '0 0 auto' }}
          >
            {navContent(<Home size={46} />, 'Início')}
          </GazeButton>

          {/* Voltar só existe quando há nível para subir. No nível 1 ele não
              teria função, e alvo sem função é alvo para errar. */}
          {activeGroup !== null && (
            <GazeButton
              className="kb-nav"
              onClick={handleBackClick}
              aria-label="Voltar"
              data-dwell-ms={DWELL_BACK_MS}
              width={NAV_W}
              height={NAV_H}
              style={{ flex: '0 0 auto' }}
            >
              {navContent(<ArrowLeft size={46} />, 'Voltar')}
            </GazeButton>
          )}

          {/* Linha de composição, alinhada ao fim: o cursor fica sempre no mesmo
              lugar, então o olho não precisa procurar onde a frase cresceu. */}
          <div
            data-no-dwell="true"
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              justifyContent: text === '' ? 'flex-start' : 'flex-end',
              padding: '0 2.5rem',
              borderRadius: 20,
              border: '1px solid var(--kb-key-edge)',
              background: 'var(--kb-key)',
              fontFamily: KB_FONT_TEXT,
              fontSize: FS_TEXT,
              fontWeight: 500,
              letterSpacing: '0.04em',
              color: 'var(--kb-ember)',
              whiteSpace: 'pre',
              overflow: 'hidden',
            }}
          >
            {text === '' ? (
              <span style={{ color: 'var(--kb-glyph-dim)', opacity: 0.8, fontSize: '2.4rem', letterSpacing: '0.06em' }}>
                Escolha um grupo para começar
              </span>
            ) : (
              <span className="kb-landing" key={text.length} style={{ animation: 'kb-land 160ms ease-out' }}>
                {text}
              </span>
            )}
            <span
              className="kb-caret"
              aria-hidden="true"
              style={{
                display: 'inline-block',
                width: '0.1em',
                height: '1em',
                marginLeft: '0.12em',
                background: 'var(--kb-ember)',
                animation: 'kb-caret-blink 1.1s step-start infinite',
              }}
            />
          </div>

          {/* Espaço do botão de emergência global (canto superior direito):
              sem ele o botão cobriria o fim da linha de texto, onde fica o
              cursor. */}
          <div aria-hidden="true" style={{ flex: '0 0 var(--emergency-w)' }} />
        </div>

        {/* ── Grade 3×2 ── */}
        <div style={{ flex: 1, minHeight: 0 }}>
          {activeGroup === null ? renderMainGrid() : renderSubGrid()}
        </div>
      </div>
    </GazePageLayout>
  );
};
