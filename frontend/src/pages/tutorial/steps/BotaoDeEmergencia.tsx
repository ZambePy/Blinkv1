import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertOctagon, ShieldCheck, Info } from 'lucide-react';
import { PrimaryButton } from '../../../components/ui/PrimaryButton';
import { useEmergency } from '../../../context/EmergencyContext';

/**
 * O botão de emergência — onde fica e como aciona.
 *
 * Ele existe em toda tela de paciente desde sempre e ninguém é ensinado. Um
 * botão de socorro que a pessoa descobre no momento em que precisa dele é um
 * botão que não existe.
 *
 * O ensaio é o ponto do passo: saber o que vai acontecer ANTES de precisar. O
 * isolamento vive no `EmergencyContext` — nada sai do app durante o ensaio, e
 * `EmergencyContext.ensaio.test.tsx` afirma isso pelo lado do envio.
 */
export const BotaoDeEmergencia: React.FC<{
  aoEnsaiar: (ensaiou: boolean) => void;
}> = ({ aoEnsaiar }) => {
  const { t } = useTranslation();
  const { setModoEnsaio, ensaioDisparado } = useEmergency();

  // Liga ao entrar e DESLIGA ao sair, inclusive se o componente cair por erro.
  // Um ensaio que ficasse ligado transformaria o botão de emergência num
  // enfeite pelo resto da sessão.
  useEffect(() => {
    setModoEnsaio(true);
    return () => setModoEnsaio(false);
  }, [setModoEnsaio]);

  useEffect(() => {
    if (ensaioDisparado) aoEnsaiar(true);
  }, [ensaioDisparado, aoEnsaiar]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '1.4rem' }}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.35rem' }}>
        <h2
          style={{
            margin: 0,
            fontSize: '1.5rem',
            fontWeight: 800,
            color: 'var(--color-text-base)',
          }}
        >
          {t('tutorial.emergencia.title')}
        </h2>
        <p
          style={{
            margin: 0,
            fontSize: '1rem',
            lineHeight: 1.5,
            opacity: 0.8,
            color: 'var(--color-text-base)',
          }}
        >
          {t('tutorial.emergencia.lead')}
        </p>
      </div>

      {/* Réplica do botão real, na aparência que ele tem. Não é o botão de
          verdade — esse flutua no canto e é para lá que a seta aponta. */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'flex-end',
          padding: '1.5rem',
          borderRadius: '1.25rem',
          border: '1px solid var(--color-card-border)',
        }}
      >
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: '0.6rem',
            padding: '0.9rem 1.4rem',
            borderRadius: '999px',
            background: '#dc2626',
            color: 'white',
            fontSize: '1.15rem',
            fontWeight: 800,
          }}
        >
          <AlertOctagon size={24} /> Emergência
        </span>
      </div>

      <div style={{ display: 'flex', gap: '0.7rem', alignItems: 'flex-start' }}>
        <ShieldCheck
          size={19}
          color="var(--color-primary)"
          aria-hidden="true"
          style={{ flexShrink: 0, marginTop: 2 }}
        />
        <span
          style={{
            fontSize: '0.96rem',
            lineHeight: 1.55,
            color: 'var(--color-text-base)',
            opacity: 0.88,
          }}
        >
          {t('tutorial.emergencia.como')}
        </span>
      </div>

      <div
        role="status"
        aria-live="polite"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: '0.6rem',
          padding: '1rem 1.15rem',
          borderRadius: '1rem',
          background: ensaioDisparado ? 'var(--tint-ok-bg)' : 'var(--tint-warn-bg)',
          border: `1px solid ${ensaioDisparado ? 'var(--tint-ok-border)' : 'var(--tint-warn-border)'}`,
        }}
      >
        <span
          style={{
            display: 'flex',
            gap: '0.5rem',
            alignItems: 'flex-start',
            fontSize: '0.96rem',
            lineHeight: 1.5,
            color: 'var(--color-text-base)',
          }}
        >
          <Info size={17} aria-hidden="true" style={{ flexShrink: 0, marginTop: 2 }} />
          {ensaioDisparado
            ? t('tutorial.emergencia.ensaiado')
            : t('tutorial.emergencia.ensaioAtivo')}
        </span>
      </div>

      <PrimaryButton
        type="button"
        variant="ghost"
        onClick={() => aoEnsaiar(false)}
        style={{ alignSelf: 'flex-start' }}
      >
        {t('tutorial.emergencia.pular')}
      </PrimaryButton>
    </div>
  );
};
