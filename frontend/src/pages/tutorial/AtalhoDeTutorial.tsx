import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { GraduationCap, Timer, AlertOctagon, Info } from 'lucide-react';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { lerTutorial } from '../../services/local/tutorialProfile';

/**
 * Atalho para refazer o tutorial, nas Configurações.
 *
 * O passo de conclusão promete "dá para refazer em Ajustes". Prometer um
 * caminho que não está lá é pior que não prometer nada: o cuidador procura, não
 * acha, e passa a duvidar do resto do que o app diz.
 *
 * Refazer importa mais aqui do que no preparo: ELA é progressiva, e o tempo de
 * permanência bom hoje pode não ser o de daqui a três meses.
 *
 * Como o `AtalhoDePreparo`, **não apaga** o registro ao ser clicado — quem
 * grava por cima é a conclusão do wizard.
 */
export const AtalhoDeTutorial: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { currentProfile } = useAuth();

  if (!currentProfile) return null;

  const feito = lerTutorial(currentProfile.id);

  const data = feito
    ? new Date(feito.completedAt).toLocaleDateString(i18n.language, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  return (
    <section
      aria-labelledby="atalho-tutorial-title"
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        padding: '1.5rem',
        borderRadius: '1.25rem',
        background: 'var(--color-card-bg)',
        border: '1px solid var(--color-card-border)',
      }}
    >
      <h2
        id="atalho-tutorial-title"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.6rem',
          margin: 0,
          fontSize: '1.2rem',
          fontWeight: 800,
          color: 'var(--color-text-base)',
        }}
      >
        <GraduationCap size={20} color="var(--color-primary)" aria-hidden="true" />
        {t('tutorial.atalho.title')}
      </h2>

      <p style={{ margin: 0, fontSize: '0.98rem', color: 'var(--color-text-base)', opacity: 0.85 }}>
        {data ? t('tutorial.atalho.done', { data }) : t('tutorial.atalho.never')}
      </p>

      {feito && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          <Linha
            icone={<Timer size={16} aria-hidden="true" />}
            texto={t('tutorial.atalho.dwell', {
              s: (feito.dwellMsEscolhido / 1000).toFixed(1).replace('.', ','),
            })}
          />
          {/* Dito em voz alta quando NÃO aconteceu: é a diferença entre o
              cuidador ter clicado avançar e o paciente saber onde o botão fica. */}
          {!feito.ensaiouEmergencia && (
            <Linha
              icone={<AlertOctagon size={16} aria-hidden="true" />}
              texto={t('tutorial.atalho.semEnsaio')}
            />
          )}
        </div>
      )}

      <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
        <Info
          size={16}
          color="var(--color-primary)"
          aria-hidden="true"
          style={{ flexShrink: 0, marginTop: 3 }}
        />
        <span
          style={{
            fontSize: '0.86rem',
            lineHeight: 1.5,
            opacity: 0.75,
            color: 'var(--color-text-base)',
          }}
        >
          {t('tutorial.atalho.why')}
        </span>
      </div>

      <PrimaryButton
        type="button"
        onClick={() => navigate('/tutorial')}
        style={{ alignSelf: 'flex-start' }}
      >
        {t('tutorial.atalho.button')}
      </PrimaryButton>
    </section>
  );
};

const Linha: React.FC<{ icone: React.ReactNode; texto: string }> = ({ icone, texto }) => (
  <div
    style={{
      display: 'flex',
      alignItems: 'center',
      gap: '0.5rem',
      fontSize: '0.9rem',
      color: 'var(--color-text-base)',
      opacity: 0.8,
    }}
  >
    <span style={{ display: 'flex', color: 'var(--color-primary)' }}>{icone}</span>
    <span>{texto}</span>
  </div>
);
