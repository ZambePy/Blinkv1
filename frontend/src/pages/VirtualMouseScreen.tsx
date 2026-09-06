import React, { useState } from 'react';
import { MousePointer2, Power, CircleCheck, ShieldAlert } from 'lucide-react';
import { GazePageLayout } from '../components/ui/GazePageLayout';
import { GazeButton } from '../components/ui/GazeButton';
import { useGaze } from '../context/GazeContext';

/**
 * Controle do computador pelo olhar. A ligação com o cursor do sistema ainda é
 * uma demonstração: a tela guarda só o estado ligado/desligado.
 */
export const VirtualMouseScreen: React.FC = () => {
  const { state } = useGaze();
  const [active, setActive] = useState(false);
  // O rastreador está pronto quando não está ocioso nem carregando.
  const isConnected = state !== 'idle' && state !== 'loading';

  const toggle = () => setActive((prev) => !prev);

  return (
    <GazePageLayout backRoute="/menu" title="Computador">
      <h1 className="sr-only">Controle do computador pelo olhar</h1>
      <div
        style={{
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '2rem',
          textAlign: 'center',
        }}
      >
        <div
          data-no-dwell="true"
          style={{
            width: 'min(720px, 100%)',
            padding: '2rem 2.5rem',
            borderRadius: 'var(--r-lg)',
            border: '2px solid var(--border)',
            background: 'var(--surface)',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '1rem',
          }}
        >
          <MousePointer2 size={56} color="var(--primary)" aria-hidden="true" />
          <p style={{ fontSize: 'var(--fs-24)', color: 'var(--text)', fontWeight: 700 }}>
            {active ? 'O cursor do computador está seguindo o seu olhar.' : 'O cursor do computador está parado.'}
          </p>
          <p style={{ fontSize: 'var(--fs-18)', color: 'var(--text-2)', lineHeight: 1.5 }}>
            Quando ligado, o ponteiro do computador acompanha para onde você olha. Para pausar, volte a esta tela ou use o botão de emergência.
          </p>

          <div
            role="status"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '0.5rem',
              padding: '0.5rem 1rem',
              borderRadius: 'var(--r-pill)',
              background: isConnected ? 'var(--ok-soft)' : 'var(--danger-soft)',
              color: isConnected ? 'var(--ok)' : 'var(--danger)',
              fontSize: 'var(--fs-16)',
              fontWeight: 700,
            }}
          >
            {isConnected ? <CircleCheck size={20} aria-hidden="true" /> : <ShieldAlert size={20} aria-hidden="true" />}
            {isConnected ? 'Rastreamento pronto' : 'Aguardando o rastreamento'}
          </div>
        </div>

        <GazeButton
          onClick={toggle}
          disabled={!isConnected}
          size="xl"
          variant={active ? 'danger' : 'primary'}
          icon={<Power />}
          label={active ? 'Desligar controle' : 'Ligar controle'}
          aria-pressed={active}
          aria-label={active ? 'Desligar o controle do computador pelo olhar' : 'Ligar o controle do computador pelo olhar'}
          // Ligar o cursor do sistema muda o que o computador inteiro faz:
          // dwell mais longo que o padrão.
          dwellMs={2500}
          style={{ minWidth: 360 }}
        />
      </div>
    </GazePageLayout>
  );
};
