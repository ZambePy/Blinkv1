import React, { useState } from 'react';
import { MousePointer2, Power, Info, CheckCircle2, ShieldAlert } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { SystemStatusHeader } from '../components/ui/SystemStatusHeader';
import { useWebSocket } from '../context/WebSocketContext';
import { PrimaryButton } from '../components/ui/PrimaryButton';

export const VirtualMouseScreen: React.FC = () => {
  const { sendAction, isConnected } = useWebSocket();
  const [active, setActive] = useState(false);

  const toggle = () => {
    const next = !active;
    setActive(next);
    sendAction(next ? 'virtual_mouse_start' : 'virtual_mouse_stop');
  };

  return (
    <>
      <SystemStatusHeader
        cameraActive={true}
        trackingActive={active}
        calibrationDone={true}
      />

      <main
        role="main"
        style={{
          minHeight: 'calc(100vh - 40px)',
          background: 'linear-gradient(160deg, #f0f4ff 0%, #e8f0fb 50%, #f1f5f9 100%)',
          padding: '2rem 2.5rem',
        }}
      >
        <PageHeader
          title="Controle do Cursor pelo Olhar (Mouse Virtual)"
          subtitle="Permite interagir livremente com a área de trabalho do Windows utilizando apenas o movimento dos olhos."
          icon={<MousePointer2 color="#1B54A8" size={28} aria-hidden="true" />}
        />

        <div
          style={{
            maxWidth: 760,
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            gap: '1.75rem',
          }}
        >
          <section
            aria-labelledby="vm-status"
            className="glass-card animate-scale-in"
            style={{
              background: 'rgba(255, 255, 255, 0.92)',
              padding: '2.5rem',
              borderRadius: '2rem',
              boxShadow: '0 12px 32px rgba(27, 84, 168, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.5rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
              <div>
                <h2
                  id="vm-status"
                  style={{ fontSize: '1.35rem', color: '#0f172a', fontWeight: 800, margin: 0 }}
                >
                  Navegação no Sistema Operacional
                </h2>
                <p style={{ color: '#64748b', fontSize: '0.95rem', marginTop: '0.4rem', margin: 0, lineHeight: 1.5 }}>
                  Ao ativar, o cursor do computador responderá ao ponto de foco do seu olhar.
                </p>
              </div>

              <div
                role="status"
                style={{
                  padding: '0.4rem 0.9rem',
                  borderRadius: '1rem',
                  background: isConnected ? 'rgba(22, 163, 74, 0.1)' : 'rgba(220, 38, 38, 0.1)',
                  color: isConnected ? '#15803d' : '#991b1b',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  flexShrink: 0,
                }}
              >
                {isConnected ? <CheckCircle2 size={16} color="#16a34a" /> : <ShieldAlert size={16} color="#dc2626" />}
                {isConnected ? 'Motor Conectado' : 'Aguardando Motor'}
              </div>
            </div>

            <div
              style={{
                background: active ? 'rgba(22, 163, 74, 0.06)' : 'rgba(241, 245, 249, 0.7)',
                border: active ? '1px solid rgba(22, 163, 74, 0.2)' : '1px solid #e2e8f0',
                padding: '1.25rem 1.5rem',
                borderRadius: '1.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: active ? '#16a34a' : '#94a3b8',
                    boxShadow: active ? '0 0 10px rgba(22, 163, 74, 0.8)' : 'none',
                  }}
                />
                <span style={{ fontWeight: 700, color: active ? '#15803d' : '#475569', fontSize: '1rem' }}>
                  {active ? 'Mouse Virtual em Execução' : 'Mouse Virtual Desativado'}
                </span>
              </div>
            </div>

            <PrimaryButton
              type="button"
              onClick={toggle}
              disabled={!isConnected}
              variant={active ? 'danger' : 'primary'}
              aria-pressed={active}
              style={{ padding: '1.25rem', fontSize: '1.15rem' }}
            >
              <Power size={22} aria-hidden="true" />
              {active ? 'Desativar Controle pelo Olhar' : 'Ativar Controle pelo Olhar'}
            </PrimaryButton>
          </section>

          <section
            aria-labelledby="vm-info"
            style={{
              padding: '1.5rem 1.75rem',
              borderRadius: '1.5rem',
              background: 'rgba(255, 255, 255, 0.8)',
              border: '1px solid rgba(27, 84, 168, 0.15)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Info size={20} color="#1B54A8" aria-hidden="true" />
              <h3 id="vm-info" style={{ fontSize: '1.05rem', color: '#1B54A8', fontWeight: 700, margin: 0 }}>
                Orientações de Uso Assistivo
              </h3>
            </div>
            <p style={{ color: '#475569', fontSize: '0.95rem', lineHeight: 1.6, margin: 0 }}>
              O rastreamento converte as coordenadas de seu olho diretamente no ponteiro do mouse do sistema Windows. Para pausar a qualquer momento, olhe para o topo da tela ou utilize o atalho de emergência.
            </p>
          </section>
        </div>
      </main>
    </>
  );
};

