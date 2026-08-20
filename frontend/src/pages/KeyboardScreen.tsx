import React, { useMemo, useState, useEffect } from 'react';
import { Delete, Play, RotateCcw } from 'lucide-react';
import { useSettings } from '../context/SettingsContext';
import { GazePageLayout } from '../components/ui/GazePageLayout';
import { GazeButton } from '../components/ui/GazeButton';
import { GazeGrid } from '../components/ui/GazeGrid';
import { useGaze } from '../context/GazeContext';
import { getPredictions, learnSentence } from '../utils/wordPredictor';
import { logSentence } from '../utils/clinicalLogger';

const LAYOUTS: Record<'frequency' | 'alphabetical' | 'qwerty', string[][]> = {
  frequency: [
    ['A', 'E', 'O', 'S', 'R', 'I', 'N', 'D', 'M', 'U'],
    ['T', 'C', 'L', 'P', 'V', 'G', 'H', 'Q', 'B', 'F'],
    ['Z', 'J', 'X', 'K', 'W', 'Y', '1', '2', '3', '4'],
    ['5', '6', '7', '8', '9', '0', ',', '.', '?', '!'],
  ],
  alphabetical: [
    ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I', 'J'],
    ['K', 'L', 'M', 'N', 'O', 'P', 'Q', 'R', 'S', 'T'],
    ['U', 'V', 'W', 'X', 'Y', 'Z', '1', '2', '3', '4'],
    ['5', '6', '7', '8', '9', '0', ',', '.', '?', '!'],
  ],
  qwerty: [
    ['Q', 'W', 'E', 'R', 'T', 'Y', 'U', 'I', 'O', 'P'],
    ['A', 'S', 'D', 'F', 'G', 'H', 'J', 'K', 'L', 'M'],
    ['Z', 'X', 'C', 'V', 'B', 'N', ',', '.', '?', '!'],
    ['1', '2', '3', '4', '5', '6', '7', '8', '9', '0'],
  ],
};

interface HierarchicalGroup {
  label: string;
  preview: string;
  items: string[];
}

const HIERARCHICAL_GROUPS: HierarchicalGroup[] = [
  { label: 'A - E', preview: 'A B C D E', items: ['A', 'B', 'C', 'D', 'E', 'BACK'] },
  { label: 'F - J', preview: 'F G H I J', items: ['F', 'G', 'H', 'I', 'J', 'BACK'] },
  { label: 'K - O', preview: 'K L M N O', items: ['K', 'L', 'M', 'N', 'O', 'BACK'] },
  { label: 'P - T', preview: 'P Q R S T', items: ['P', 'Q', 'R', 'S', 'T', 'BACK'] },
  { label: 'U - Y', preview: 'U V W X Y', items: ['U', 'V', 'W', 'X', 'Y', 'BACK'] },
  { label: 'Z / Outros', preview: 'Z, números, pontuação', items: ['Z', '1 - 5', '6 - 0', 'Pontuação', 'BACK'] },
];

const SUB_GROUPS = {
  '1 - 5': ['1', '2', '3', '4', '5', 'BACK'],
  '6 - 0': ['6', '7', '8', '9', '0', 'BACK'],
  'Pontuação': [',', '.', '?', '!', ';', 'BACK'],
};

export const KeyboardScreen: React.FC = () => {
  const { settings } = useSettings();
  const { isDwelling, setIsComposing } = useGaze();
  const [text, setText] = useState('');
  const [lastPressed, setLastPressed] = useState<string | null>(null);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [menuPath, setMenuPath] = useState<string[]>([]);

  useEffect(() => {
    if (isDwelling) return;
    setSuggestions(getPredictions(text));
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
  };

  const getHierarchicalItems = (): string[] => {
    if (menuPath.length === 0) {
      return ['A - E', 'F - J', 'K - O', 'P - T', 'U - Y', 'Z / Outros'];
    }
    if (menuPath.length === 1) {
      const g = menuPath[0];
      if (g === 'Z / Outros') {
        return ['Z', '1 - 5', '6 - 0', 'Pontuação', 'BACK'];
      }
      const found = HIERARCHICAL_GROUPS.find((group) => group.label === g);
      return found ? found.items : [];
    }
    if (menuPath.length === 2) {
      const sub = menuPath[1] as keyof typeof SUB_GROUPS;
      return SUB_GROUPS[sub] || [];
    }
    return [];
  };

  const handleHierarchicalClick = (item: string) => {
    if (item === 'BACK') {
      setMenuPath((p) => p.slice(0, -1));
    } else if (item === '1 - 5' || item === '6 - 0' || item === 'Pontuação') {
      setMenuPath((p) => [...p, item]);
    } else if (item === 'Z / Outros' || item === 'A - E' || item === 'F - J' || item === 'K - O' || item === 'P - T' || item === 'U - Y') {
      setMenuPath([item]);
    } else if (item) {
      append(item);
      setMenuPath([]);
    }
  };

  const rows = useMemo(() => {
    if (settings.keyboardLayout === 'hierarchical') return [];
    return LAYOUTS[settings.keyboardLayout as keyof typeof LAYOUTS];
  }, [settings.keyboardLayout]);

  const triggerFeedback = (key: string) => {
    setLastPressed(key);
    setTimeout(() => setLastPressed(null), 200);
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

  return (
    <GazePageLayout showBack={true} backRoute="/menu">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          width: '100%',
          boxSizing: 'border-box',
          gap: '1.5rem',
        }}
      >
        {/* Barra superior de saída de texto e botão de Fala */}
        <div style={{ display: 'flex', gap: '1rem', height: '6rem', width: '100%' }}>
          <div
            style={{
              flex: 1,
              display: 'flex',
              alignItems: 'center',
              padding: '0 2rem',
              background: 'var(--color-card-bg)',
              borderRadius: '1.5rem',
              border: '2px solid var(--color-card-border)',
              fontSize: '2.5rem',
              fontWeight: 700,
              color: text ? 'var(--color-text-base)' : 'var(--color-card-border)',
              overflow: 'hidden',
              whiteSpace: 'nowrap',
            }}
          >
            {text || 'Digite algo...'}
          </div>

          <GazeButton
            onClick={speak}
            disabled={!text.trim()}
            style={{
              width: '200px',
              height: '100%',
              background: text.trim() ? '#1B54A8' : 'rgba(15, 23, 42, 0.03)',
              border: '2px solid var(--color-card-border)',
              borderRadius: '1.5rem',
              color: text.trim() ? 'white' : 'rgba(15, 23, 42, 0.25)',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem', fontSize: '1.4rem', fontWeight: 800 }}>
              <Play size={28} fill={text.trim() ? 'white' : 'none'} stroke={text.trim() ? 'white' : 'rgba(15, 23, 42, 0.25)'} /> Falar
            </div>
          </GazeButton>
        </div>

        {/* Barra de Sugestões de Palavras (B3-1) */}
        <div style={{ display: 'flex', gap: '1rem', height: '4.5rem', width: '100%' }}>
          {suggestions.map((word, index) => (
            <GazeButton
              key={index}
              onClick={() => handleSelectSuggestion(word)}
              noWarn={true}
              style={{
                flex: 1,
                height: '100%',
                background: 'rgba(27, 84, 168, 0.05)',
                border: '2px solid rgba(27, 84, 168, 0.25)',
                borderRadius: '1.25rem',
                color: '#1B54A8',
              }}
            >
              <span style={{ fontSize: '1.4rem', fontWeight: 800 }}>{word}</span>
            </GazeButton>
          ))}
          {Array.from({ length: 4 - suggestions.length }).map((_, idx) => (
            <GazeButton
              key={`empty-${idx}`}
              disabled
              style={{
                flex: 1,
                height: '100%',
                borderRadius: '1.25rem',
                opacity: 0.1,
              }}
            >
              <span>-</span>
            </GazeButton>
          ))}
        </div>

        {/* Teclado e Painel Lateral de Ações */}
        <div style={{ display: 'flex', gap: '1.5rem', flex: 1, minHeight: 0 }}>
          {settings.keyboardLayout === 'hierarchical' ? (
            /* Teclado por Varredura Hierárquica (B3-2) */
            <div style={{ flex: 1 }}>
              <GazeGrid columns={3} rows={2}>
                {getHierarchicalItems().map((item, index) => {
                  const isNavigation = item === 'BACK' || item === '1 - 5' || item === '6 - 0' || item === 'Pontuação' || item === 'Z / Outros' || item === 'A - E' || item === 'F - J' || item === 'K - O' || item === 'P - T' || item === 'U - Y';
                  return (
                    <GazeButton
                      key={index}
                      onClick={() => handleHierarchicalClick(item)}
                      noWarn={true}
                      style={{
                        height: '100%',
                        borderRadius: '2rem',
                        background: item === 'BACK' ? 'rgba(15, 23, 42, 0.03)' : 'var(--color-card-bg)',
                        border: item === 'BACK' ? '2px solid rgba(15, 23, 42, 0.15)' : '2px solid var(--color-card-border)',
                        color: isNavigation ? 'var(--color-text-base)' : 'var(--color-primary)',
                      }}
                    >
                      {item === 'BACK' ? (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.8rem', fontWeight: 800 }}>
                          <RotateCcw size={32} /> Voltar
                        </div>
                      ) : (
                        <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', alignItems: 'center', gap: '0.25rem' }}>
                          <span style={{ fontSize: isNavigation ? '2rem' : '3.2rem', fontWeight: 900 }}>
                            {item}
                          </span>
                          {menuPath.length === 0 && index < 5 && (
                            <span style={{ fontSize: '1.15rem', opacity: 0.5, letterSpacing: '0.05em' }}>
                              {HIERARCHICAL_GROUPS[index].preview}
                            </span>
                          )}
                        </div>
                      )}
                    </GazeButton>
                  );
                })}
                {Array.from({ length: 6 - getHierarchicalItems().length }).map((_, idx) => (
                  <GazeButton
                    key={`empty-h-${idx}`}
                    disabled
                    style={{
                      height: '100%',
                      borderRadius: '2rem',
                      opacity: 0.1,
                    }}
                  >
                    <span>-</span>
                  </GazeButton>
                ))}
              </GazeGrid>
            </div>
          ) : (
            /* Teclado Padrão (QWERTY / Frequencial / Alfabético) */
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
              {rows.map((row: string[], ri: number) => (
                <div key={ri} style={{ display: 'flex', gap: '0.75rem', flex: 1 }}>
                  {row.map((k: string) => (
                    <GazeButton
                      key={k}
                      onClick={() => append(k)}
                      noWarn={true}
                      style={{
                        flex: 1,
                        height: '100%',
                        background: lastPressed === k ? 'rgba(27, 84, 168, 0.2)' : 'var(--color-card-bg)',
                        border: '2px solid',
                        borderColor: lastPressed === k ? '#1B54A8' : 'var(--color-card-border)',
                        borderRadius: '1rem',
                        fontSize: '2.5rem',
                        fontWeight: 700,
                        color: lastPressed === k ? '#1B54A8' : 'var(--color-text-base)',
                      }}
                    >
                      {k}
                    </GazeButton>
                  ))}
                </div>
              ))}
            </div>
          )}

          {/* Controle Lateral */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '220px' }}>
            <GazeButton
              onClick={backspace}
              style={{
                flex: 1.5,
                background: 'rgba(239, 68, 68, 0.05)',
                border: '2px solid rgba(239, 68, 68, 0.3)',
                borderRadius: '1.5rem',
                color: '#ef4444',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <Delete size={36} />
                <span style={{ fontSize: '1.3rem', fontWeight: 800 }}>Apagar</span>
              </div>
            </GazeButton>

            <GazeButton
              onClick={clear}
              style={{
                flex: 1,
                background: 'var(--color-card-bg)',
                border: '2px solid var(--color-card-border)',
                borderRadius: '1.5rem',
                color: 'var(--color-text-base)',
              }}
            >
              <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.5rem' }}>
                <RotateCcw size={28} />
                <span style={{ fontSize: '1.15rem', fontWeight: 700 }}>Limpar</span>
              </div>
            </GazeButton>

            <GazeButton
              onClick={space}
              style={{
                flex: 2,
                background: 'rgba(27, 84, 168, 0.05)',
                border: '2px solid rgba(27, 84, 168, 0.3)',
                borderRadius: '1.5rem',
                color: '#1B54A8',
              }}
            >
              <span style={{ fontSize: '1.5rem', fontWeight: 800 }}>Espaço</span>
            </GazeButton>
          </div>
        </div>
      </div>
    </GazePageLayout>
  );
};
