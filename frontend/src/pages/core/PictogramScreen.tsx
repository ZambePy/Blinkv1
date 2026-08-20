import React, { useState } from 'react';
import { Utensils, Droplets, Smile, Frown, Home, Phone, AlertCircle, Heart, ChevronRight, ChevronLeft, Play } from 'lucide-react';
import { GazePageLayout } from '../../components/ui/GazePageLayout';
import { GazeGrid } from '../../components/ui/GazeGrid';
import { GazeButton } from '../../components/ui/GazeButton';

const PICTOGRAMS = [
  { id: 1, label: 'Eu Quero Comer', Icon: Utensils, color: '#f59e0b', bg: 'rgba(245, 158, 11, 0.1)' },
  { id: 2, label: 'Estou com Sede', Icon: Droplets, color: '#3b82f6', bg: 'rgba(59, 130, 246, 0.1)' },
  { id: 3, label: 'Estou Bem', Icon: Smile, color: '#10b981', bg: 'rgba(16, 185, 129, 0.1)' },
  { id: 4, label: 'Estou com Dor', Icon: AlertCircle, color: '#ef4444', bg: 'rgba(239, 68, 68, 0.1)' },
  { id: 5, label: 'Quero Ir ao Banheiro', Icon: Home, color: '#6366f1', bg: 'rgba(99, 102, 241, 0.1)' },
  { id: 6, label: 'Chamar Família', Icon: Phone, color: '#8b5cf6', bg: 'rgba(139, 92, 246, 0.1)' },
  { id: 7, label: 'Obrigado(a)', Icon: Heart, color: '#ec4899', bg: 'rgba(236, 72, 153, 0.1)' },
  { id: 8, label: 'Não estou Bem', Icon: Frown, color: '#f43f5e', bg: 'rgba(244, 63, 94, 0.1)' },
];

export const PictogramScreen: React.FC = () => {
  const [selectedText, setSelectedText] = useState('');
  const [currentPage, setCurrentPage] = useState(0);

  const handleSpeak = (text: string) => {
    setSelectedText(text);
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
      const utterance = new SpeechSynthesisUtterance(text);
      utterance.lang = 'pt-BR';
      utterance.rate = 0.9;
      window.speechSynthesis.speak(utterance);
    }
  };

  const itemsPerPage = 5;
  const startIndex = currentPage * itemsPerPage;
  const visiblePictograms = PICTOGRAMS.slice(startIndex, startIndex + itemsPerPage);
  const totalPages = Math.ceil(PICTOGRAMS.length / itemsPerPage);

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
        <div style={{ textAlign: 'center' }}>
          <h1 style={{ fontSize: '2.5rem', fontWeight: 800, color: '#ffffff', margin: '0 0 0.5rem 0' }}>
            Pictogramas (CAA)
          </h1>
          <p style={{ fontSize: '1.2rem', color: 'rgba(255, 255, 255, 0.7)', margin: 0, fontWeight: 500 }}>
            Página {currentPage + 1} de {totalPages} — Olhe para selecionar e falar
          </p>
        </div>

        {/* Caixa de status do texto selecionado */}
        <div
          style={{
            background: 'var(--color-card-bg)',
            borderRadius: '1.5rem',
            padding: '1.25rem 2rem',
            fontSize: '2rem',
            fontWeight: 700,
            color: '#1B54A8',
            border: '2px solid var(--color-card-border)',
            minHeight: '80px',
            boxSizing: 'border-box',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <span>{selectedText || 'Selecione um pictograma...'}</span>
          {selectedText && (
            <GazeButton
              onClick={() => handleSpeak(selectedText)}
              style={{
                padding: '0.5rem 1.5rem',
                height: '56px',
                borderRadius: '1rem',
                background: '#1B54A8',
                color: 'white',
                border: 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '1.1rem', fontWeight: 700 }}>
                <Play size={20} fill="white" /> Falar
              </div>
            </GazeButton>
          )}
        </div>

        {/* Grade de Pictogramas */}
        <div style={{ flex: 1, minHeight: 0 }}>
          <GazeGrid columns={3} rows={2}>
            {visiblePictograms.map((pic) => (
              <GazeButton
                key={pic.id}
                onClick={() => handleSpeak(pic.label)}
                style={{
                  height: '100%',
                  borderRadius: '2rem',
                  background: 'var(--color-card-bg)',
                  border: `3px solid ${pic.color}40`,
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
                    width: '100%',
                    gap: '1rem'
                  }}
                >
                  <div
                    style={{
                      background: pic.bg,
                      color: pic.color,
                      padding: '1.25rem',
                      borderRadius: '1.5rem',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    <pic.Icon size={64} />
                  </div>
                  <span style={{ fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-text-base)' }}>
                    {pic.label}
                  </span>
                </div>
              </GazeButton>
            ))}

            {/* Paginação */}
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
                    Mais Opções
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

            {/* Placeholders desabilitados na página 1 */}
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
