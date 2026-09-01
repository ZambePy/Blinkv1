import React, { useState, useEffect, useRef } from 'react';
import { ArrowLeft, Delete, Speech, Trash2 } from 'lucide-react';
import { GazePageLayout } from '../components/ui/GazePageLayout';
import { GazeButton } from '../components/ui/GazeButton';
import { GazeGrid } from '../components/ui/GazeGrid';
import { useGaze } from '../context/GazeContext';
import { getPredictions, learnSentence } from '../utils/wordPredictor';
import { logSentence } from '../utils/clinicalLogger';
import { useNavigate } from 'react-router-dom';

/* ────────────────────────────────────────────────────────────────────────────
 * Especificação visual — medida pixel a pixel nas gravações de referência
 * (viewport 1918x1078). Não alterar "no olho": qualquer ajuste deve sair de
 * uma nova medição, senão a tela deixa de bater com a referência.
 *
 *   fundo da página e das teclas ............ #000000
 *   separador entre teclas .................. #333333, 10px (gap da grade)
 *   letras / texto digitado / sugestões ..... #c2bde4
 *   ícones e rótulos de ação ................ #d0d0d0
 *   moldura de dwell ........................ #0e183c, borda de 30px
 *   linha sob a barra superior .............. #b4bdd6 esmaecendo em 10px
 *
 *   barra superior .......................... 68px de altura
 *   linha/brilho sob a barra ................ 10px  (grade começa em y=78)
 *   área da grade ........................... y 78 → 1016 (2 linhas x 3 colunas)
 *   faixa preta abaixo da grade ............. 62px
 *
 *   altura de caixa das letras .............. 60px  → 5.25rem
 *   entrelinha do bloco de letras ........... 101px → 1.2
 *   altura de caixa das sugestões ........... 30px  → 2.7rem
 *   entrelinha das sugestões ................ 52px  → 1.21
 *   altura de caixa da barra superior ....... 42px  → 3.75rem
 * ──────────────────────────────────────────────────────────────────────────── */
const KB = {
  black: '#000000',
  gridLine: '#333333',
  letter: '#c2bde4',
  action: '#d0d0d0',
  dwell: '#0e183c',
  divider: '#b4bdd6',
  backArrow: '#9aa0ad',
};

/* A referência foi renderizada numa sans GEOMÉTRICA em peso bold — `a` e `g` de
 * um andar só. Identifiquei comparando a assinatura métrica de "Apagar" no frame
 * (larg/altura-do-A = 5.07, altura-total/A = 1.36) contra as fontes do sistema:
 * Century Gothic Bold ficou em 1º (erro 0.078), e o `a` de um andar descarta
 * Segoe UI e Candara, que vinham logo atrás. Poppins vem primeiro na pilha para
 * o caso de o projeto passar a embarcá-la; sem ela, o Windows cai em Century
 * Gothic, que é o que a gravação mostra. Nada aqui baixa fonte da rede — este é
 * um app assistivo e não pode depender de CDN para desenhar o teclado. */
const KB_FONT = "'Poppins', 'Century Gothic', 'Questrial', 'Futura', 'Trebuchet MS', system-ui, sans-serif";

const TOPBAR_H = 68;
const DIVIDER_H = 10;
const GRID_GAP = 10;
const GRID_BOTTOM = 62;

const FS_LETTER = '5.25rem';
const FS_SUGGESTION = '2.7rem';
const FS_TOPBAR = '3.75rem';
const LH_LETTER = 1.2;
const LH_SUGGESTION = 1.21;
const ICON_SIZE = 80;

// A referência mostra 4 palavras padrão (EU / SIM / NÃO / TALVEZ) e no máximo
// 5 previsões, sempre como lista vertical simples dentro da 6ª tecla.
const DEFAULT_WORDS = ['EU', 'SIM', 'NÃO', 'TALVEZ'];
const MAX_SUGGESTIONS = 5;

/**
 * Glifo de espaço (⌴) desenhado à mão em SVG.
 *
 * O caractere U+2423 foi a primeira tentativa e saiu errado na captura: cada
 * fonte o desenha num corpo diferente, e na geométrica ele encolhe e cai abaixo
 * da linha de base do "Y Z" ao lado. Em SVG a barra tem sempre a proporção
 * medida na referência — 88×16 px no subgrupo, razão altura/largura 0,18, traço
 * a 7% da largura — independente da fonte que o sistema resolver.
 */
const EspacoGlifo: React.FC<{ width: number }> = ({ width }) => {
  const altura = Math.round(width * 0.18);
  const traco = Math.max(2, Math.round(width * 0.07));
  const m = traco / 2;
  return (
    <svg
      width={width}
      height={altura}
      viewBox={`0 0 ${width} ${altura}`}
      aria-hidden="true"
      focusable="false"
      style={{ display: 'block' }}
    >
      <path
        d={`M ${m} 0 V ${altura - m} H ${width - m} V 0`}
        fill="none"
        stroke="currentColor"
        strokeWidth={traco}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
};

const GROUPS = [
  ['A', 'B', 'C', 'D', 'E', 'F'],
  ['G', 'H', 'I', 'J', 'K', 'L'],
  ['M', 'N', 'O', 'P', 'Q', 'R'],
  ['S', 'T', 'U', 'V', 'W', 'X'],
  ['Y', 'Z', 'Espaço', 'Falar', 'Apagar', 'Limpar']
];

export const KeyboardScreen: React.FC = () => {
  const { isDwelling, setIsComposing } = useGaze();
  const navigate = useNavigate();
  const [text, setText] = useState('');
  const [lastPressed, setLastPressed] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  // activeGroup: null (main screen) | 0-4 (letter/action groups) | 5 (suggestions group)
  const [activeGroup, setActiveGroup] = useState<number | null>(null);

  useEffect(() => {
    if (isDwelling) return;
    setSuggestions(getPredictions(text).slice(0, MAX_SUGGESTIONS));
  }, [text, isDwelling]);

  useEffect(() => {
    setIsComposing(text.trim().length > 0);
    return () => setIsComposing(false);
  }, [text, setIsComposing]);

  const handleSelectSuggestion = (word: string) => {
    setText((t) => {
      if (t.endsWith(' ') || t === '') {
        return t + word + ' ';
      } else {
        const words = t.trim().split(/\s+/);
        words[words.length - 1] = word;
        return words.join(' ') + ' ';
      }
    });
    triggerFeedback(word);
    setActiveGroup(null);
  };

  const feedbackTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    };
  }, []);

  const triggerFeedback = (key: string) => {
    setLastPressed(key);
    if (feedbackTimeoutRef.current) clearTimeout(feedbackTimeoutRef.current);
    feedbackTimeoutRef.current = setTimeout(() => {
      setLastPressed(null);
    }, 200);
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

  const handleBackClick = () => {
    if (activeGroup !== null) {
      setActiveGroup(null);
    } else {
      navigate('/menu');
    }
  };

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

  // Tecla: preta, sem borda; o realce de dwell vem do .kb-key::after (index.css).
  // O flash de confirmação usa o mesmo azul-marinho da moldura, e não o azul da
  // marca — na referência a tecla nunca acende em azul claro.
  const keyStyle = (pressed: boolean): React.CSSProperties => ({
    height: '100%',
    width: '100%',
    background: pressed ? KB.dwell : KB.black,
  });

  const letterStyle: React.CSSProperties = {
    fontSize: FS_LETTER,
    fontWeight: 700,
    lineHeight: LH_LETTER,
    color: KB.letter,
  };

  const actionLabelStyle: React.CSSProperties = {
    fontSize: FS_LETTER,
    fontWeight: 700,
    lineHeight: LH_LETTER,
    color: KB.action,
  };

  const renderMainGrid = () => {
    const mainLabels = [
      { top: 'A B C', bottom: 'D E F' },
      { top: 'G H I', bottom: 'J K L' },
      { top: 'M N O', bottom: 'P Q R' },
      { top: 'S T U', bottom: 'V W X' },
    ];

    return (
      <GazeGrid columns={3} rows={2} gap={GRID_GAP}>
        {mainLabels.map((label, idx) => (
          <GazeButton
            key={`group-${idx}`}
            className="kb-key"
            onClick={() => setActiveGroup(idx)}
            noWarn={true}
            style={keyStyle(false)}
          >
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
              <span style={letterStyle}>{label.top}</span>
              <span style={letterStyle}>{label.bottom}</span>
            </div>
          </GazeButton>
        ))}

        {/* Bloco 5: Y, Z e as três ações, prévia em ícones */}
        <GazeButton
          key="group-4"
          className="kb-key"
          onClick={() => setActiveGroup(4)}
          noWarn={true}
          style={keyStyle(false)}
        >
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            {/* "Y Z" e a barra de espaço na mesma linha, como na referência. O
                glifo desce até a base do texto, daí o alinhamento pelo fim. */}
            <div style={{ display: 'flex', alignItems: 'flex-end', gap: '0.35em', ...letterStyle }}>
              <span>Y Z</span>
              <span style={{ paddingBottom: '0.3em' }}>
                <EspacoGlifo width={54} />
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: '0.25rem',
                color: KB.action,
              }}
            >
              <Speech size={ICON_SIZE} />
              <Delete size={ICON_SIZE} />
              <Trash2 size={ICON_SIZE} />
            </div>
          </div>
        </GazeButton>

        {/* Bloco 6: Sugestões, lista vertical simples (sem molduras internas) */}
        <GazeButton
          key="group-suggestions"
          className="kb-key"
          onClick={() => {
            if (currentSuggestions.length > 0) setActiveGroup(5);
          }}
          noWarn={true}
          style={keyStyle(false)}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            {currentSuggestions.map((word) => (
              <span
                key={word}
                style={{
                  fontSize: FS_SUGGESTION,
                  fontWeight: 700,
                  lineHeight: LH_SUGGESTION,
                  color: KB.letter,
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
    if (activeGroup === 5) {
      items = currentSuggestions.slice(0, 6);
    } else if (activeGroup !== null && activeGroup < 5) {
      items = GROUPS[activeGroup];
    }

    const stack = (icon: React.ReactNode, label: string) => (
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', color: KB.action }}>
        {icon}
        <span style={actionLabelStyle}>{label}</span>
      </div>
    );

    return (
      <GazeGrid columns={3} rows={2} gap={GRID_GAP}>
        {items.map((item, index) => {
          let content = <span style={letterStyle}>{item}</span>;

          // 88px de largura é a medida do glifo na gravação de referência.
          if (item === 'Espaço')
            content = stack(
              <span style={{ color: KB.action, paddingBottom: '1.4rem' }}>
                <EspacoGlifo width={88} />
              </span>,
              'Espaço'
            );
          if (item === 'Falar') content = stack(<Speech size={ICON_SIZE} />, 'Falar');
          if (item === 'Apagar') content = stack(<Delete size={ICON_SIZE} />, 'Apagar');
          if (item === 'Limpar') content = stack(<Trash2 size={ICON_SIZE} />, 'Limpar');

          if (activeGroup === 5) {
            content = (
              <span style={{ ...letterStyle, fontSize: FS_SUGGESTION }}>{item}</span>
            );
          }

          return (
            <GazeButton
              key={index}
              className="kb-key"
              onClick={() => (activeGroup === 5 ? handleSelectSuggestion(item) : handleItemClick(item))}
              noWarn={true}
              style={keyStyle(lastPressed === item)}
            >
              {content}
            </GazeButton>
          );
        })}

        {/* Preenche as células vazias para sugestões (se houver menos que 6) */}
        {Array.from({ length: 6 - items.length }).map((_, idx) => (
          <GazeButton
            key={`empty-${idx}`}
            className="kb-key kb-key-empty"
            disabled
            noWarn={true}
            style={keyStyle(false)}
          >
            <span />
          </GazeButton>
        ))}
      </GazeGrid>
    );
  };

  return (
    <GazePageLayout bare showBack={false}>
      <div
        style={
          {
            position: 'absolute',
            inset: 0,
            display: 'flex',
            flexDirection: 'column',
            background: KB.black,
            fontFamily: KB_FONT,
            overflow: 'hidden',
            // Consumidas por .kb-key / .kb-key::after em index.css
            '--kb-letter': KB.letter,
            '--kb-dwell': KB.dwell,
          } as React.CSSProperties
        }
      >
        {/* Barra superior: seta discreta + texto digitado com cursor piscando */}
        <div
          style={{
            flex: `0 0 ${TOPBAR_H}px`,
            display: 'flex',
            alignItems: 'center',
            gap: '0.75rem',
            paddingLeft: '1.25rem',
            boxSizing: 'border-box',
            overflow: 'hidden',
          }}
        >
          <GazeButton
            onClick={handleBackClick}
            noWarn={true}
            aria-label="Voltar"
            style={{
              flex: '0 0 auto',
              width: 40,
              height: TOPBAR_H,
              padding: 0,
              background: 'transparent',
              border: 'none',
              borderRadius: 0,
              boxShadow: 'none',
              color: KB.backArrow,
            }}
          >
            <ArrowLeft size={26} />
          </GazeButton>

          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: 'flex',
              alignItems: 'center',
              fontSize: FS_TOPBAR,
              fontWeight: 700,
              color: KB.letter,
              whiteSpace: 'pre',
              overflow: 'hidden',
            }}
          >
            {text}
            <span style={{ animation: 'kb-caret-blink 1s step-start infinite' }}>_</span>
          </div>
        </div>

        {/* Fio luminoso sob a barra: #b4bdd6 esmaecendo ao longo de 10px */}
        <div
          style={{
            flex: `0 0 ${DIVIDER_H}px`,
            background: `linear-gradient(180deg, ${KB.divider} 0%, rgba(180, 189, 214, 0.12) 100%)`,
          }}
        />

        {/* Grade 3x2 sangrando até as bordas. O fundo #333 do invólucro é o que
            aparece no gap de 10px entre as teclas — não há borda nas teclas. */}
        <div
          style={{
            flex: 1,
            minHeight: 0,
            paddingBottom: GRID_BOTTOM,
            boxSizing: 'border-box',
            background: KB.black,
          }}
        >
          <div style={{ width: '100%', height: '100%', background: KB.gridLine }}>
            {activeGroup === null ? renderMainGrid() : renderSubGrid()}
          </div>
        </div>
      </div>
    </GazePageLayout>
  );
};
