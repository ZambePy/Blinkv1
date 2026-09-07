import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { SlidersHorizontal, Video, Monitor, Sun, Info } from 'lucide-react';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { useAuth } from '../../context/AuthContext';
import { lerPreparo } from '../../services/local/setupProfile';

/**
 * Atalho para refazer o preparo do ambiente, nas Configurações.
 *
 * O preparo roda uma vez por perfil (D7 do spec do Bloco 2). Sem este atalho,
 * trocar de sala ou de webcam deixaria o cuidador preso a um preparo que não
 * descreve mais nada — e o único jeito de refazer seria apagar o perfil, o que
 * levaria a calibração junto.
 *
 * **Não apaga o preparo ao ser clicado.** Só navega; quem grava por cima é a
 * conclusão do wizard. Apagar antes deixaria o perfil sem preparo se o cuidador
 * desistisse no meio, e sem preparo ele nem chega à calibração.
 */
export const AtalhoDePreparo: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { currentProfile } = useAuth();

  // Sem paciente escolhido não há preparo de que falar.
  if (!currentProfile) return null;

  const preparo = lerPreparo(currentProfile.id);

  const data = preparo
    ? new Date(preparo.completedAt).toLocaleDateString(i18n.language, {
        day: 'numeric',
        month: 'long',
        year: 'numeric',
      })
    : null;

  return (
    <section
      aria-labelledby="atalho-preparo-title"
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
        id="atalho-preparo-title"
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
        <SlidersHorizontal size={20} color="var(--color-primary)" aria-hidden="true" />
        {t('setup.atalho.title')}
      </h2>

      <p style={{ margin: 0, fontSize: '0.98rem', color: 'var(--color-text-base)', opacity: 0.85 }}>
        {data ? t('setup.atalho.done', { data }) : t('setup.atalho.never')}
      </p>

      {preparo && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
          {preparo.fpsMedido !== null && (
            <Linha
              icone={<Video size={16} aria-hidden="true" />}
              texto={`${t('setup.atalho.camera')}: ${t('setup.atalho.fps', {
                fps: Math.round(preparo.fpsMedido),
              })}`}
            />
          )}
          {preparo.monitorDiagonalIn !== null && (
            <Linha
              icone={<Monitor size={16} aria-hidden="true" />}
              texto={t('setup.atalho.monitor', { polegadas: preparo.monitorDiagonalIn })}
            />
          )}
          {preparo.luxAmbiente !== null && (
            <Linha
              icone={<Sun size={16} aria-hidden="true" />}
              texto={t('setup.atalho.lux', { lux: preparo.luxAmbiente })}
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
          {t('setup.atalho.why')}
        </span>
      </div>

      <PrimaryButton
        type="button"
        onClick={() => navigate('/setup')}
        style={{ alignSelf: 'flex-start' }}
      >
        {t('setup.atalho.button')}
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
