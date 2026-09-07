import React from 'react';
import { useTranslation } from 'react-i18next';
import { Video, RefreshCw, Check } from 'lucide-react';
import { PrimaryButton } from '../../../components/ui/PrimaryButton';
import { Semaforo } from '../../../components/ui/Semaforo';
import {
  classificarFps,
  type CameraCapacidade,
  type CameraDevice,
  type QualidadeDeFps,
} from '../../../services/camera/devices';

/**
 * Escolha da câmera e medição do que ela entrega.
 *
 * A informação que esta tela existe para dar é o FPS **real**. O pipeline
 * assume 30 quadros por segundo — as janelas de baseline da calibração e o
 * detector de flicker contam com isso. A 15 fps tudo trabalha com metade dos
 * quadros, e a diferença aparece no relatório sem explicação nenhuma.
 *
 * **Avisa; nunca impede.** Não há controle desabilitado aqui, com taxa nenhuma:
 * negar comunicação a alguém com ELA porque a webcam é barata é pior do que
 * precisão ruim. Quem é dono do botão "Continuar" é o wizard, e ele não olha
 * para o FPS.
 */

const STATUS_DE: Record<QualidadeDeFps, 'ok' | 'warn' | 'fail'> = {
  boa: 'ok',
  baixa: 'warn',
  // 'fail' pinta de vermelho, e é o que a situação merece — mas nada aqui lê
  // esta cor para travar coisa alguma.
  ruim: 'fail',
};

export interface EscolhaDaCameraProps {
  cameras: CameraDevice[];
  selecionada: string | null;
  capacidade: CameraCapacidade | null;
  medindo: boolean;
  aoSelecionar: (deviceId: string) => void;
  aoRecarregar: () => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}

export const EscolhaDaCamera: React.FC<EscolhaDaCameraProps> = ({
  cameras,
  selecionada,
  capacidade,
  medindo,
  aoSelecionar,
  aoRecarregar,
  videoRef,
}) => {
  const { t } = useTranslation();
  const qualidade = capacidade ? classificarFps(capacidade.fpsMedido) : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
      <Cabecalho titulo={t('setup.camera.title')} lead={t('setup.camera.lead')} />

      {cameras.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            alignItems: 'flex-start',
          }}
        >
          <Semaforo status="fail" titulo={t('setup.camera.none')} />
          <PrimaryButton type="button" variant="secondary" onClick={aoRecarregar}>
            <RefreshCw size={16} aria-hidden="true" /> {t('setup.camera.reload')}
          </PrimaryButton>
        </div>
      ) : (
        <>
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            style={{
              width: '100%',
              maxHeight: 260,
              objectFit: 'cover',
              borderRadius: '1rem',
              background: 'var(--field-bg)',
              border: '1px solid var(--field-border)',
              // Espelhado: o cuidador se enxerga como num espelho, não como
              // numa foto. Sem isto, mover para a direita parece mover para a
              // esquerda e o ajuste de posição vira tentativa e erro.
              transform: 'scaleX(-1)',
            }}
          />

          <div
            role="radiogroup"
            aria-label={t('setup.camera.title')}
            style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}
          >
            {cameras.map((c) => {
              const ativa = c.deviceId === selecionada;
              return (
                <button
                  key={c.deviceId}
                  type="button"
                  role="radio"
                  aria-checked={ativa}
                  onClick={() => aoSelecionar(c.deviceId)}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '0.7rem',
                    padding: '0.85rem 1rem',
                    borderRadius: '0.9rem',
                    background: ativa ? 'var(--tint-info-bg)' : 'transparent',
                    border: `1px solid ${ativa ? 'var(--tint-info-border)' : 'var(--color-card-border)'}`,
                    color: 'var(--color-text-base)',
                    fontSize: '0.98rem',
                    fontWeight: ativa ? 700 : 500,
                    cursor: 'pointer',
                    textAlign: 'left',
                  }}
                >
                  <Video size={18} color="var(--color-primary)" aria-hidden="true" />
                  <span style={{ flex: 1 }}>{c.label}</span>
                  {ativa && <Check size={17} color="var(--tint-ok-text)" aria-hidden="true" />}
                </button>
              );
            })}
          </div>

          {medindo || !capacidade ? (
            <Semaforo status="unknown" titulo={t('setup.camera.measuring')} />
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
              <Semaforo
                status="ok"
                titulo={t('setup.camera.resolution')}
                valor={`${capacidade.larguraPx} × ${capacidade.alturaPx}`}
              />
              <Semaforo
                status={STATUS_DE[qualidade!]}
                titulo={t('setup.camera.fps')}
                valor={String(Math.round(capacidade.fpsMedido))}
                detalhe={
                  t(`setup.camera.fps${qualidade![0].toUpperCase()}${qualidade!.slice(1)}`) +
                  (capacidade.fpsDeclarado !== null
                    ? ` (${t('setup.camera.declared', { fps: Math.round(capacidade.fpsDeclarado) })})`
                    : '')
                }
              />
              <p
                style={{
                  margin: 0,
                  fontSize: '0.85rem',
                  opacity: 0.7,
                  color: 'var(--color-text-base)',
                }}
              >
                {t('setup.camera.neverBlocks')}
              </p>
            </div>
          )}
        </>
      )}
    </div>
  );
};

export const Cabecalho: React.FC<{ titulo: string; lead?: string }> = ({ titulo, lead }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
    <h2 style={{ margin: 0, fontSize: '1.5rem', fontWeight: 800, color: 'var(--color-text-base)' }}>
      {titulo}
    </h2>
    {lead && (
      <p
        style={{
          margin: 0,
          fontSize: '1rem',
          lineHeight: 1.5,
          opacity: 0.8,
          color: 'var(--color-text-base)',
        }}
      >
        {lead}
      </p>
    )}
  </div>
);
