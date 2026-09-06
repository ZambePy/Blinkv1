import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Moon, ArrowLeft } from 'lucide-react';
import { GazeButton } from '../../components/ui/GazeButton';

/**
 * Dwell mais longo que o normal: sair do descanso por um olhar distraído
 * anularia o próprio descanso.
 */
const DWELL_VOLTAR_MS = 3000;

/**
 * Tela de descanso: o centro inteiro é zona sem alvo. O único botão fica no
 * canto inferior esquerdo, longe de onde o olhar repousa naturalmente. O
 * botão de emergência global continua no canto superior direito.
 */
export const RestScreen: React.FC = () => {
  const navigate = useNavigate();

  return (
    <main
      role="main"
      aria-labelledby="rest-title"
      className="gaze-page gaze-page--bare"
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background:
          'radial-gradient(ellipse at center, color-mix(in srgb, var(--primary) 8%, var(--bg)) 0%, var(--bg) 70%)',
      }}
    >
      <div
        data-no-dwell="true"
        aria-label="Zona de descanso: olhar aqui não aciona nada"
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '1.5rem',
          textAlign: 'center',
          maxWidth: 560,
          padding: '2rem',
          color: 'var(--text-2)',
          userSelect: 'none',
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 112,
            height: 112,
            borderRadius: '50%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'var(--primary-soft)',
            color: 'var(--primary)',
          }}
        >
          <Moon size={52} />
        </div>

        <h1 id="rest-title" style={{ fontSize: 'var(--fs-40)', color: 'var(--text)' }}>
          Modo Descanso
        </h1>
        <p style={{ fontSize: 'var(--fs-24)', lineHeight: 1.5 }}>
          Nada aqui reage ao olhar. Descanse o quanto quiser.
        </p>
        <p style={{ fontSize: 'var(--fs-20)', color: 'var(--text-3)' }}>
          Para voltar, olhe por 3 segundos para o botão no canto de baixo.
        </p>
      </div>

      <div style={{ position: 'absolute', left: 'var(--gaze-page-pad)', bottom: 'var(--gaze-page-pad)' }}>
        <GazeButton
          onClick={() => navigate('/menu')}
          size="xl"
          variant="secondary"
          icon={<ArrowLeft />}
          label="Voltar ao menu"
          dwellMs={DWELL_VOLTAR_MS}
          aria-label="Voltar ao menu (olhe por 3 segundos)"
        />
      </div>
    </main>
  );
};
