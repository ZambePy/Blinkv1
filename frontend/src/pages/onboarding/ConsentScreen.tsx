import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { ShieldCheck, MonitorSmartphone, Cloud } from 'lucide-react';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { useLicense } from '../../context/LicenseContext';
import { aceitarConsentimento } from '../../services/local/consent';

/**
 * Termo de privacidade.
 *
 * Vem antes do cadastro do paciente de propósito: pedir nome, idade, condição
 * e foto de alguém com ELA para só então explicar o destino desses dados
 * inverte a ordem que importa.
 *
 * O texto é curto porque um termo longo não é lido — e um termo não lido é uma
 * assinatura sem consentimento.
 */
export const ConsentScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { license } = useLicense();
  const [aceito, setAceito] = useState(false);

  const confirmar = () => {
    if (!aceito) return;
    aceitarConsentimento(license?.account.email ?? '');
    navigate('/profiles', { replace: true });
  };

  return (
    <main
      role="main"
      aria-labelledby="consent-title"
      style={{
        minHeight: '100vh',
        background: 'linear-gradient(160deg, #f0f4ff 0%, #e8f0fb 50%, #f1f5f9 100%)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: '2rem',
      }}
    >
      <div
        className="glass-card animate-scale-in"
        style={{
          background: 'rgba(255,255,255,0.94)',
          padding: '2.75rem 2.5rem',
          borderRadius: '2rem',
          boxShadow: '0 20px 40px -10px rgba(27,84,168,0.12)',
          width: '100%',
          maxWidth: 620,
          display: 'flex',
          flexDirection: 'column',
          gap: '1.75rem',
        }}
      >
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.6rem',
            textAlign: 'center',
          }}
        >
          <ShieldCheck size={44} color="#1B54A8" aria-hidden="true" />
          <h1
            id="consent-title"
            style={{
              fontSize: '1.85rem',
              fontWeight: 800,
              margin: 0,
              color: 'var(--color-text-base)',
            }}
          >
            {t('consent.title')}
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: '1.02rem',
              opacity: 0.8,
              color: 'var(--color-text-base)',
            }}
          >
            {t('consent.lead')}
          </p>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          <Bloco
            icone={<MonitorSmartphone size={22} color="#15803d" aria-hidden="true" />}
            cor="#15803d"
            fundo="#f0fdf4"
            borda="#bbf7d0"
            titulo={t('consent.localTitle')}
            corpo={t('consent.localBody')}
          />
          <Bloco
            icone={<Cloud size={22} color="#1B54A8" aria-hidden="true" />}
            cor="#1B54A8"
            fundo="#eff6ff"
            borda="#bfdbfe"
            titulo={t('consent.remoteTitle')}
            corpo={t('consent.remoteBody')}
          />
        </div>

        <label
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: '0.85rem',
            padding: '1rem 1.15rem',
            borderRadius: '1rem',
            border: `2px solid ${aceito ? '#1B54A8' : '#e2e8f0'}`,
            background: aceito ? 'rgba(27,84,168,0.06)' : 'transparent',
            cursor: 'pointer',
            transition: 'border-color 0.2s, background 0.2s',
          }}
        >
          <input
            type="checkbox"
            checked={aceito}
            onChange={(e) => setAceito(e.target.checked)}
            style={{
              width: 22,
              height: 22,
              marginTop: 2,
              cursor: 'pointer',
              accentColor: '#1B54A8',
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: '1rem',
              lineHeight: 1.5,
              color: 'var(--color-text-base)',
              fontWeight: 600,
            }}
          >
            {t('consent.checkbox')}
          </span>
        </label>

        <PrimaryButton
          type="button"
          fullWidth
          disabled={!aceito}
          onClick={confirmar}
          style={{ padding: '1rem', fontSize: '1.05rem' }}
        >
          {t('consent.continue')}
        </PrimaryButton>
      </div>
    </main>
  );
};

const Bloco: React.FC<{
  icone: React.ReactNode;
  cor: string;
  fundo: string;
  borda: string;
  titulo: string;
  corpo: string;
}> = ({ icone, cor, fundo, borda, titulo, corpo }) => (
  <div
    style={{
      display: 'flex',
      gap: '0.9rem',
      padding: '1.1rem 1.25rem',
      borderRadius: '1.1rem',
      background: fundo,
      border: `1px solid ${borda}`,
    }}
  >
    <div style={{ flexShrink: 0, marginTop: 2 }}>{icone}</div>
    <div style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
      <strong style={{ fontSize: '1rem', color: cor, fontWeight: 800 }}>{titulo}</strong>
      <span
        style={{
          fontSize: '0.95rem',
          lineHeight: 1.55,
          color: 'var(--color-text-base)',
          opacity: 0.85,
        }}
      >
        {corpo}
      </span>
    </div>
  </div>
);
