import React, { useState } from 'react';
import { MessageSquare, AlertCircle, Tv, Wind, Activity, ChevronRight, ChevronLeft } from 'lucide-react';
import { GazePageLayout } from '../components/ui/GazePageLayout';
import { GazeGrid } from '../components/ui/GazeGrid';
import { GazeButton } from '../components/ui/GazeButton';
import { logSentence } from '../utils/clinicalLogger';

const PHRASES = [
  {
    id: 1,
    text: 'Gostaria de conversar',
    Icon: MessageSquare,
    iconColor: '#0d9488',
    bg: 'linear-gradient(135deg, rgba(13, 148, 136, 0.1), rgba(20, 253, 250, 0.05))',
  },
  {
    id: 2,
    text: 'Pode abrir a janela?',
    Icon: Wind,
    iconColor: '#0284c7',
    bg: 'linear-gradient(135deg, rgba(2, 132, 199, 0.1), rgba(240, 249, 255, 0.05))',
  },
  {
    id: 3,
    text: 'Quero descansar agora',
    Icon: Activity,
    iconColor: '#7c3aed',
    bg: 'linear-gradient(135deg, rgba(124, 58, 237, 0.1), rgba(245, 243, 255, 0.05))',
  },
  {
    id: 4,
    text: 'Pode mudar de posição?',
    Icon: AlertCircle,
    iconColor: '#d97706',
    bg: 'linear-gradient(135deg, rgba(217, 119, 6, 0.1), rgba(255, 251, 235, 0.05))',
  },
  {
    id: 5,
    text: 'Pode ligar a televisão?',
    Icon: Tv,
    iconColor: '#4f46e5',
    bg: 'linear-gradient(135deg, rgba(79, 70, 229, 0.1), rgba(238, 242, 255, 0.05))',
  },
  {
    id: 6,
    text: 'Preciso de um cobertor',
    Icon: Wind,
    iconColor: '#0891b2',
    bg: 'linear-gradient(135deg, rgba(8, 145, 178, 0.1), rgba(236, 254, 255, 0.05))',
  },
  {
    id: 7,
    text: 'Quero ouvir música',
    Icon: MessageSquare,
    iconColor: '#db2777',
    bg: 'linear-gradient(135deg, rgba(219, 39, 119, 0.1), rgba(253, 242, 248, 0.05))',
  },
  {
    id: 8,
    text: 'Preciso que alguém fique aqui',
    Icon: AlertCircle,
    iconColor: '#16a34a',
    bg: 'linear-gradient(135deg, rgba(22, 163, 74, 0.1), rgba(240, 253, 244, 0.05))',
  },
];

export const QuickPhrasesScreen: React.FC = () => {
  const [currentPage, setCurrentPage] = useState(0);

  const handleSpeak = (text: string) => {
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'pt-BR';
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
      logSentence(text);
    }
  };

  const itemsPerPage = 5;
  const startIndex = currentPage * itemsPerPage;
  const visiblePhrases = PHRASES.slice(startIndex, startIndex + itemsPerPage);
  const totalPages = Math.ceil(PHRASES.length / itemsPerPage);

  return (
    <GazePageLayout showBack={true} backRoute="/menu">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          width: '100%',
          boxSizing: 'border-box',
        }}
      >
        <div style={{ marginBottom: '2.5rem', textAlign: 'center' }}>
          <h1 style={{ fontSize: '2.75rem', fontWeight: 800, color: 'var(--color-text-base)', margin: '0 0 0.5rem 0' }}>
            Frases Rápidas
          </h1>
          <p style={{ fontSize: '1.25rem', color: 'var(--color-text-base)', opacity: 0.7, margin: 0, fontWeight: 500 }}>
            Página {currentPage + 1} de {totalPages} — Olhe para selecionar
          </p>
        </div>

        <div style={{ flex: 1, minHeight: 0 }}>
          <GazeGrid columns={3} rows={2}>
            {visiblePhrases.map((phrase) => (
              <GazeButton
                key={phrase.id}
                onClick={() => handleSpeak(phrase.text)}
                style={{
                  height: '100%',
                  borderRadius: '2rem',
                  background: 'var(--color-card-bg)',
                  border: '2px solid var(--color-card-border)',
                }}
              >
                <div 
                  style={{ 
                    display: 'flex', 
                    flexDirection: 'column', 
                    alignItems: 'center', 
                    justifyContent: 'center', 
                    textAlign: 'center', 
                    padding: '1rem',
                    width: '100%'
                  }}
                >
                  <div
                    style={{
                      background: phrase.bg,
                      padding: '1rem',
                      borderRadius: '1.5rem',
                      color: phrase.iconColor,
                      marginBottom: '1rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <phrase.Icon size={56} strokeWidth={1.5} />
                  </div>
                  <span style={{ fontSize: '1.4rem', fontWeight: 700, lineHeight: 1.3, color: 'var(--color-text-base)' }}>
                    {phrase.text}
                  </span>
                </div>
              </GazeButton>
            ))}

            {/* Sexto slot: Botão de Paginação */}
            {currentPage === 0 ? (
              <GazeButton
                onClick={() => setCurrentPage(1)}
                style={{
                  height: '100%',
                  borderRadius: '2rem',
                  border: '2px solid rgba(27, 84, 168, 0.3)',
                  background: 'rgba(27, 84, 168, 0.05)',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', width: '100%' }}>
                  <div style={{ color: '#1B54A8', marginBottom: '0.75rem' }}>
                    <ChevronRight size={56} />
                  </div>
                  <span style={{ fontSize: '1.6rem', fontWeight: 800, color: '#1B54A8' }}>
                    Mais Frases
                  </span>
                </div>
              </GazeButton>
            ) : (
              <GazeButton
                onClick={() => setCurrentPage(0)}
                style={{
                  height: '100%',
                  borderRadius: '2rem',
                  border: '2px solid rgba(27, 84, 168, 0.3)',
                  background: 'rgba(27, 84, 168, 0.05)',
                }}
              >
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', width: '100%' }}>
                  <div style={{ color: '#1B54A8', marginBottom: '0.75rem' }}>
                    <ChevronLeft size={56} />
                  </div>
                  <span style={{ fontSize: '1.6rem', fontWeight: 800, color: '#1B54A8' }}>
                    Voltar Página
                  </span>
                </div>
              </GazeButton>
            )}

            {/* Placeholders desabilitados se for página 1 para manter grade 3x2 consistente */}
            {currentPage === 1 && (
              <>
                <GazeButton disabled style={{ height: '100%', borderRadius: '2rem', opacity: 0.2 }}>
                  <span style={{ color: 'rgba(255,255,255,0.1)' }}>-</span>
                </GazeButton>
                <GazeButton disabled style={{ height: '100%', borderRadius: '2rem', opacity: 0.2 }}>
                  <span style={{ color: 'rgba(255,255,255,0.1)' }}>-</span>
                </GazeButton>
              </>
            )}
          </GazeGrid>
        </div>
      </div>
    </GazePageLayout>
  );
};
