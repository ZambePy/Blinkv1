import React from 'react';
import { useTranslation } from 'react-i18next';
import { Camera, ShieldCheck, UserRound, AlertTriangle } from 'lucide-react';
import { PrimaryButton } from '../../../components/ui/PrimaryButton';
import { Semaforo } from '../../../components/ui/Semaforo';
import { Cabecalho } from './EscolhaDaCamera';

/**
 * Permissão de câmera — explicada antes de ser pedida.
 *
 * **Uma peculiaridade do Electron muda esta tela.** O processo principal já
 * concede `media` para origem local (`setPermissionRequestHandler` →
 * `permitirPermissao`), então o prompt do navegador **não aparece** no app
 * empacotado. Quando a câmera falha aqui, quem bloqueia é a privacidade do
 * Windows, não o IrisFlow — e a tela precisa dizer isso, senão o cuidador
 * procura a permissão num lugar onde ela não está.
 *
 * ⚠️ Abrir `ms-settings:privacy-webcam` exigiria `shell.openExternal` no
 * processo principal, fora do escopo do Bloco 2. O caminho vai como texto.
 */

export type EstadoDaPermissao = 'explicando' | 'pedindo' | 'concedida' | 'negada';

export const PermissaoCamera: React.FC<{
  estado: EstadoDaPermissao;
  erro: string | null;
  aoPedir: () => void;
}> = ({ estado, erro, aoPedir }) => {
  const { t } = useTranslation();

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
      <Cabecalho titulo={t('setup.permissao.title')} lead={t('setup.permissao.why')} />

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
        <Ponto
          icone={<ShieldCheck size={20} color="var(--tint-ok-text)" aria-hidden="true" />}
          texto={t('setup.permissao.privacy')}
        />
        <Ponto
          icone={<UserRound size={20} color="var(--color-primary)" aria-hidden="true" />}
          texto={t('setup.permissao.patient')}
        />
      </div>

      {estado === 'concedida' && <Semaforo status="ok" titulo={t('setup.permissao.granted')} />}

      {estado === 'pedindo' && <Semaforo status="unknown" titulo={t('setup.permissao.checking')} />}

      {estado === 'negada' && (
        <div
          role="alert"
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: '0.7rem',
            padding: '1rem 1.15rem',
            borderRadius: '1rem',
            background: 'var(--tint-danger-bg)',
            border: '1px solid var(--tint-danger-border)',
          }}
        >
          <strong
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '1rem',
              fontWeight: 800,
              color: 'var(--tint-danger-text)',
            }}
          >
            <AlertTriangle size={18} aria-hidden="true" /> {t('setup.permissao.deniedTitle')}
          </strong>
          <span style={{ fontSize: '0.92rem', lineHeight: 1.5, color: 'var(--color-text-base)' }}>
            {t('setup.permissao.deniedBody')}
          </span>
          {/* Texto selecionável, e não botão: o app não consegue abrir as
              configurações do Windows sem tocar no processo principal. */}
          <code
            style={{
              fontSize: '0.88rem',
              padding: '0.5rem 0.7rem',
              borderRadius: '0.5rem',
              background: 'var(--field-bg)',
              border: '1px solid var(--field-border)',
              color: 'var(--color-text-base)',
              userSelect: 'all',
            }}
          >
            {t('setup.permissao.deniedPath')}
          </code>
          {erro && (
            <span style={{ fontSize: '0.85rem', opacity: 0.8, color: 'var(--color-text-base)' }}>
              {erro}
            </span>
          )}
        </div>
      )}

      {estado !== 'concedida' && (
        <PrimaryButton
          type="button"
          onClick={aoPedir}
          disabled={estado === 'pedindo'}
          aria-busy={estado === 'pedindo'}
          style={{ alignSelf: 'flex-start', padding: '0.9rem 1.6rem' }}
        >
          <Camera size={18} aria-hidden="true" />
          {estado === 'negada' ? t('setup.permissao.retry') : t('setup.permissao.grant')}
        </PrimaryButton>
      )}
    </div>
  );
};

const Ponto: React.FC<{ icone: React.ReactNode; texto: string }> = ({ icone, texto }) => (
  <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-start' }}>
    <span style={{ flexShrink: 0, marginTop: 2 }}>{icone}</span>
    <span
      style={{
        fontSize: '0.98rem',
        lineHeight: 1.55,
        color: 'var(--color-text-base)',
        opacity: 0.88,
      }}
    >
      {texto}
    </span>
  </div>
);
