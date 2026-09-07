import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UserRound, HeartHandshake, ArrowRight } from 'lucide-react';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { LanguageSwitcher } from '../../components/ui/LanguageSwitcher';
import { INTRO_SEEN_KEY } from './bootDestination';

/**
 * Boas-vindas — uma tela só.
 *
 * Responde três coisas antes de o cuidador decidir se continua: o que o
 * produto faz, quem usa, e em que idioma. O seletor de idioma vale já aqui,
 * porque escolher "English" e continuar lendo português seria pior do que não
 * oferecer a escolha.
 */
export const IntroScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();

  const comecar = () => {
    try {
      localStorage.setItem(INTRO_SEEN_KEY, 'true');
    } catch {
      // Sem persistência a apresentação reaparece. Chato, não impeditivo.
    }
    navigate('/login');
  };

  return (
    <main
      role="main"
      aria-labelledby="intro-title"
      style={{
        minHeight: '100vh',
        background: 'var(--settings-bg)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2.5rem 2rem',
        gap: '2rem',
      }}
    >
      <div
        className="animate-fade-in-up"
        style={{
          width: '100%',
          maxWidth: 760,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          gap: '2.25rem',
          textAlign: 'center',
        }}
      >
        <div
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '1.15rem' }}
        >
          <img
            src="/LOGO.png"
            alt="IrisFlow"
            style={{ width: 230, height: 'auto' }}
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
          <h1
            id="intro-title"
            style={{
              fontSize: '2.35rem',
              fontWeight: 800,
              margin: 0,
              lineHeight: 1.15,
              color: 'var(--color-text-base)',
            }}
          >
            {t('onboarding.intro.title')}
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: '1.15rem',
              lineHeight: 1.6,
              maxWidth: 620,
              color: 'var(--color-text-base)',
              opacity: 0.82,
            }}
          >
            {t('onboarding.intro.tagline')}
          </p>
        </div>

        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
            gap: '1.25rem',
            width: '100%',
          }}
        >
          <Papel
            icone={<UserRound size={26} color="#1B54A8" aria-hidden="true" />}
            titulo={t('onboarding.intro.patientTitle')}
            corpo={t('onboarding.intro.patientBody')}
          />
          <Papel
            icone={<HeartHandshake size={26} color="#1B54A8" aria-hidden="true" />}
            titulo={t('onboarding.intro.caregiverTitle')}
            corpo={t('onboarding.intro.caregiverBody')}
          />
        </div>

        <div
          style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '0.6rem' }}
        >
          <span
            style={{
              fontSize: '0.85rem',
              fontWeight: 700,
              opacity: 0.65,
              color: 'var(--color-text-base)',
            }}
          >
            {t('onboarding.intro.language')}
          </span>
          <LanguageSwitcher />
        </div>

        <PrimaryButton
          type="button"
          onClick={comecar}
          style={{ padding: '1.15rem 3rem', fontSize: '1.2rem', borderRadius: '1.5rem' }}
        >
          {t('onboarding.intro.start')} <ArrowRight size={22} aria-hidden="true" />
        </PrimaryButton>
      </div>
    </main>
  );
};

const Papel: React.FC<{ icone: React.ReactNode; titulo: string; corpo: string }> = ({
  icone,
  titulo,
  corpo,
}) => (
  <div
    className="glass-card"
    style={{
      background: 'var(--color-card-bg)',
      border: '1px solid var(--color-card-border)',
      borderRadius: '1.4rem',
      padding: '1.6rem 1.4rem',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      gap: '0.7rem',
      boxShadow: '0 8px 24px rgba(27,84,168,0.06)',
      textAlign: 'center',
    }}
  >
    {icone}
    <strong style={{ fontSize: '1.08rem', fontWeight: 800, color: 'var(--color-text-base)' }}>
      {titulo}
    </strong>
    <span
      style={{
        fontSize: '0.95rem',
        lineHeight: 1.55,
        color: 'var(--color-text-base)',
        opacity: 0.8,
      }}
    >
      {corpo}
    </span>
  </div>
);
