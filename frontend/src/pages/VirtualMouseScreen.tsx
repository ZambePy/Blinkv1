import React from 'react';
import { MousePointer2, Power, Info, CheckCircle2, ShieldAlert, Monitor } from 'lucide-react';
import { PageHeader } from '../components/ui/PageHeader';
import { useGaze } from '../context/GazeContext';
import { PrimaryButton } from '../components/ui/PrimaryButton';
import { useModoComputador } from '../computador/useModoComputador';

/**
 * Tela "Computador": liga o Modo Computador — o cursor do IrisFlow sai do
 * app e passa a percorrer o Windows, com a mesma barra de ações por dwell.
 *
 * Quem faz o trabalho é `useModoComputador` (app) + `electron/computador/`
 * (sistema) + `src/overlay/` (o que aparece por cima do Windows). Esta tela
 * só explica, liga e mostra por que não ligou.
 */
export const VirtualMouseScreen: React.FC = () => {
  const { state } = useGaze();
  const modo = useModoComputador();
  // Motor considerado disponível quando não está ocioso/carregando.
  const motorPronto = state !== 'idle' && state !== 'loading';
  const calibrado = motorPronto && state !== 'uncalibrated' && state !== 'calibrating' && state !== 'error';

  const bloqueio = !modo.disponivel
    ? 'O Modo Computador só existe no aplicativo instalado (Electron), não no navegador.'
    : modo.capacidades && !modo.capacidades.suportado
      ? modo.capacidades.motivo ?? 'Não suportado neste sistema.'
      : !motorPronto
        ? 'Aguardando o motor de rastreamento.'
        : !calibrado
          ? 'Calibre o olhar antes de controlar o computador: sem calibração o cursor não segue os olhos.'
          : null;

  const alternar = () => {
    if (modo.ativo) void modo.parar();
    else void modo.iniciar();
  };

  return (
    <>
      {/* Escudo: enquanto o modo está ativo o app fica escondido, mas o olhar
          continua passando por esta página. Sem o escudo, o dwell do app
          clicaria nos botões daqui (inclusive no "Desativar") enquanto o
          paciente usa o Windows. */}
      {modo.ativo && <div aria-hidden="true" style={{ position: 'fixed', inset: 0, zIndex: 9998, background: 'var(--color-bg-base)' }} />}
      <main
        role="main"
        style={{
          minHeight: '100vh',
          background: 'var(--color-bg-base)',
          padding: '2rem 2.5rem',
        }}
      >
        <PageHeader
          title="Computador: controle do Windows pelo olhar"
          subtitle="O cursor do IrisFlow sai do aplicativo e passa a percorrer a área de trabalho, com as mesmas ações por olhar."
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
              background: 'var(--color-card-bg)',
              padding: '2.5rem',
              borderRadius: '2rem',
              boxShadow: '0 12px 32px rgba(27, 84, 168, 0.08)',
              display: 'flex',
              flexDirection: 'column',
              gap: '1.5rem',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '1rem' }}>
              <div>
                <h2
                  id="vm-status"
                  style={{ fontSize: '1.35rem', color: 'var(--color-text-base)', fontWeight: 800, margin: 0 }}
                >
                  Navegação no sistema operacional
                </h2>
                <p style={{ color: 'var(--color-text-base)', opacity: 0.8, fontSize: '0.95rem', marginTop: '0.4rem', marginBottom: 0, lineHeight: 1.5 }}>
                  Ao ativar, o IrisFlow se esconde e uma barra lateral aparece sobre o Windows. Escolha uma ação
                  na barra (clicar, duplo, direito, arrastar, rolar, teclado) e olhe para o alvo. A lupa amplia a
                  região antes do clique, para acertar botões pequenos.
                </p>
              </div>

              <div
                role="status"
                style={{
                  padding: '0.4rem 0.9rem',
                  borderRadius: '1rem',
                  background: motorPronto ? 'rgba(22, 163, 74, 0.1)' : 'rgba(220, 38, 38, 0.1)',
                  color: motorPronto ? '#15803d' : '#991b1b',
                  fontSize: '0.85rem',
                  fontWeight: 700,
                  display: 'flex',
                  alignItems: 'center',
                  gap: '0.4rem',
                  flexShrink: 0,
                }}
              >
                {motorPronto ? <CheckCircle2 size={16} color="#16a34a" /> : <ShieldAlert size={16} color="#dc2626" />}
                {motorPronto ? 'Motor conectado' : 'Aguardando motor'}
              </div>
            </div>

            <div
              style={{
                background: modo.ativo ? 'rgba(22, 163, 74, 0.06)' : 'var(--color-bg-base)',
                border: modo.ativo ? '1px solid rgba(22, 163, 74, 0.2)' : '1px solid var(--color-card-border)',
                padding: '1.25rem 1.5rem',
                borderRadius: '1.25rem',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: '1rem',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
                <div
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: '50%',
                    background: modo.ativo ? '#16a34a' : '#94a3b8',
                    boxShadow: modo.ativo ? '0 0 10px rgba(22, 163, 74, 0.8)' : 'none',
                  }}
                />
                <span style={{ fontWeight: 700, color: modo.ativo ? '#15803d' : 'var(--color-text-base)', fontSize: '1rem' }}>
                  {modo.ativo ? 'Modo Computador em execução' : modo.iniciando ? 'Iniciando…' : 'Modo Computador desativado'}
                </span>
              </div>
              {modo.capacidades?.suportado && (
                <span style={{ display: 'flex', alignItems: 'center', gap: '0.4rem', fontSize: '0.85rem', opacity: 0.75, color: 'var(--color-text-base)' }}>
                  <Monitor size={16} aria-hidden="true" />
                  {modo.capacidades.plataforma === 'win32' ? 'Windows' : modo.capacidades.plataforma}
                </span>
              )}
            </div>

            {bloqueio && !modo.ativo && (
              <p role="status" style={{ margin: 0, color: '#92400e', background: '#fffbeb', border: '1px solid #fde68a', padding: '0.9rem 1.1rem', borderRadius: '1rem', lineHeight: 1.5 }}>
                {bloqueio}
              </p>
            )}
            {modo.erro && (
              <p role="alert" style={{ margin: 0, color: '#991b1b', background: 'rgba(220,38,38,0.08)', border: '1px solid rgba(220,38,38,0.3)', padding: '0.9rem 1.1rem', borderRadius: '1rem', lineHeight: 1.5 }}>
                {modo.erro}
              </p>
            )}
            {modo.aviso && !modo.erro && (
              <p role="status" style={{ margin: 0, color: 'var(--color-text-base)', background: 'var(--color-bg-base)', border: '1px solid var(--color-card-border)', padding: '0.9rem 1.1rem', borderRadius: '1rem', lineHeight: 1.5 }}>
                {modo.aviso}
              </p>
            )}

            <PrimaryButton
              type="button"
              onClick={alternar}
              disabled={!modo.ativo && (bloqueio !== null || modo.iniciando)}
              variant={modo.ativo ? 'danger' : 'primary'}
              aria-pressed={modo.ativo}
              style={{ padding: '1.25rem', fontSize: '1.15rem' }}
            >
              <Power size={22} aria-hidden="true" />
              {modo.ativo ? 'Desativar controle pelo olhar' : 'Ativar controle pelo olhar'}
            </PrimaryButton>
          </section>

          <section
            aria-labelledby="vm-info"
            style={{
              padding: '1.5rem 1.75rem',
              borderRadius: '1.5rem',
              background: 'var(--color-card-bg)',
              border: '1px solid var(--color-card-border)',
              display: 'flex',
              flexDirection: 'column',
              gap: '0.5rem',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.6rem' }}>
              <Info size={20} color="#1B54A8" aria-hidden="true" />
              <h3 id="vm-info" style={{ fontSize: '1.05rem', color: '#1B54A8', fontWeight: 700, margin: 0 }}>
                Como voltar
              </h3>
            </div>
            <p style={{ color: 'var(--color-text-base)', opacity: 0.9, fontSize: '0.95rem', lineHeight: 1.6, margin: 0 }}>
              Na barra lateral, o botão verde <strong>IrisFlow</strong> traz o aplicativo de volta, e o botão
              vermelho <strong>Socorro</strong> abre a tela de emergência. Se o olhar não for encontrado por
              três minutos, o IrisFlow volta sozinho. <strong>Pausar</strong> congela a área sem sair do modo — útil
              para assistir a um vídeo sem clicar por acidente. Mudar a resolução, a escala ou o monitor encerra
              o modo, porque a calibração deixa de valer.
            </p>
          </section>
        </div>
      </main>
    </>
  );
};
