import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UserRound, Users, CreditCard } from 'lucide-react';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { useAuth } from '../../context/AuthContext';

/**
 * Trocar de paciente e abrir a conta, a partir dos Ajustes.
 *
 * Eram os dois caminhos que faltavam ali: câmera, filtro, tempo de permanência
 * e refazer tutorial já estavam. Sem o primeiro, trocar de paciente exigia
 * fechar o app; sem o segundo, não havia como ver a assinatura de dentro do
 * produto — só descobrir que ela venceu quando tudo parou.
 */
export const AtalhoDePerfilEConta: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { currentProfile } = useAuth();

  return (
    <section
      aria-labelledby="atalho-perfil-title"
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
        id="atalho-perfil-title"
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
        <UserRound size={20} color="var(--color-primary)" aria-hidden="true" />
        {t('sessao.perfil.title')}
      </h2>

      <p style={{ margin: 0, fontSize: '0.98rem', color: 'var(--color-text-base)', opacity: 0.85 }}>
        {currentProfile
          ? t('sessao.perfil.ativo', { nome: currentProfile.name })
          : t('sessao.perfil.nenhum')}
      </p>

      <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
        <PrimaryButton type="button" variant="secondary" onClick={() => navigate('/profiles')}>
          <Users size={17} aria-hidden="true" /> {t('sessao.perfil.trocar')}
        </PrimaryButton>

        <PrimaryButton type="button" variant="secondary" onClick={() => navigate('/conta')}>
          <CreditCard size={17} aria-hidden="true" /> {t('sessao.conta.title')}
        </PrimaryButton>
      </div>
    </section>
  );
};
