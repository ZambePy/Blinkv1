import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Mic, Accessibility } from 'lucide-react';
import { GazePageLayout } from '../../components/ui/GazePageLayout';
import { GazeButton } from '../../components/ui/GazeButton';

/**
 * Telas anunciadas no menu que ainda não têm módulo por trás: Controle de Voz
 * e Acessibilidade. Um cartão do menu não pode levar a lugar nenhum — o
 * paciente não tem como saber que "não fez nada" e tenta de novo.
 *
 * Quando o módulo existir, troque a rota em App.tsx e apague o caso daqui.
 */
type Modulo = 'voz' | 'acessibilidade';

const CONTEUDO: Record<Modulo, { titulo: string; icone: React.ReactNode; badge: string; texto: string }> = {
  voz: {
    titulo: 'Controle de Voz',
    icone: <Mic size={56} />,
    badge: '#5EEAD4',
    texto: 'Os comandos por voz ainda estão em desenvolvimento. Por enquanto, o teclado e as frases rápidas continuam sendo o caminho para falar.',
  },
  acessibilidade: {
    titulo: 'Acessibilidade',
    icone: <Accessibility size={56} />,
    badge: '#6CB6F5',
    texto: 'Os recursos inclusivos ficam em Configurações: tema escuro, filtro âmbar, brilho, tempo de fixação e tamanho dos alvos.',
  },
};

const EmBreve: React.FC<{ modulo: Modulo }> = ({ modulo }) => {
  const navigate = useNavigate();
  const c = CONTEUDO[modulo];

  return (
    <GazePageLayout showBack backRoute="/menu">
      <div
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100%',
          gap: '1.5rem',
          textAlign: 'center',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 120, height: 120, borderRadius: '50%', background: c.badge, color: '#0f172a',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
          }}
        >
          {c.icone}
        </div>
        <h1 style={{ fontSize: '2.4rem', fontWeight: 900, margin: 0, color: 'var(--color-text-base)' }}>{c.titulo}</h1>
        <p style={{ fontSize: '1.3rem', maxWidth: 640, margin: 0, opacity: 0.8, lineHeight: 1.5, color: 'var(--color-text-base)' }}>
          {c.texto}
        </p>
        <div style={{ display: 'flex', gap: '1rem', marginTop: '1rem', flexWrap: 'wrap', justifyContent: 'center' }}>
          {modulo === 'acessibilidade' && (
            <GazeButton onClick={() => navigate('/settings')} width={320} height={90} style={{ borderRadius: '1.5rem' }}>
              <span style={{ fontSize: '1.3rem', fontWeight: 800 }}>Abrir Configurações</span>
            </GazeButton>
          )}
          <GazeButton onClick={() => navigate('/menu')} width={320} height={90} style={{ borderRadius: '1.5rem' }}>
            <ArrowLeft size={28} /> <span style={{ fontSize: '1.3rem', fontWeight: 800 }}>Voltar ao menu</span>
          </GazeButton>
        </div>
      </div>
    </GazePageLayout>
  );
};

export const VoiceControlScreen: React.FC = () => <EmBreve modulo="voz" />;
export const AccessibilityScreen: React.FC = () => <EmBreve modulo="acessibilidade" />;
