import React, { useState } from 'react';
import { useLocation, useNavigate, Navigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { CheckCircle2, Monitor, ArrowRightLeft, AlertTriangle } from 'lucide-react';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { useLicense } from '../../context/LicenseContext';
import { getDeviceName } from '../../services/license';
import type { LoginFailure } from '../../services/license';

/**
 * Ativação concluída — e a variante de transferência.
 *
 * As duas moram no mesmo componente porque são o mesmo momento do fluxo: "sua
 * licença está ativa aqui" e "sua licença está ativa noutro lugar, quer
 * trazer?". A transferência derruba o vínculo antigo, então exige confirmação
 * explícita: fazer isso em silêncio desconectaria o computador da clínica sem
 * ninguém perceber.
 */

type Transferencia = Extract<LoginFailure, { reason: 'device-limit' }>;

/** Data por extenso. "2027-03-14T00:00:00.000Z" não é informação para um cuidador. */
const porExtenso = (iso: string, lang: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString(lang, { day: 'numeric', month: 'long', year: 'numeric' });
};

export const ActivatedScreen: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const location = useLocation();
  const { license, status, transferir } = useLicense();

  const transferencia = (location.state as { transferencia?: Transferencia } | null)?.transferencia;
  const [transferindo, setTransferindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  if (status === 'checking') return null;

  // Nem licença nem transferência pendente: não há nada a mostrar aqui, e uma
  // tela vazia deixaria o cuidador sem saída.
  if (!license && !transferencia) return <Navigate to="/login" replace />;

  if (transferencia && !license) {
    const confirmar = async () => {
      setTransferindo(true);
      setErro(null);
      const r = await transferir(transferencia.transferToken);
      setTransferindo(false);
      if (!r.ok) setErro(t(`login.errors.${r.reason}`));
    };

    const limite = transferencia.plan.deviceLimit ?? 1;

    return (
      <Moldura
        titulo={t('license.transfer.title')}
        icone={<ArrowRightLeft size={44} color="#b45309" />}
      >
        <p style={{ margin: 0, textAlign: 'center', lineHeight: 1.6, opacity: 0.85 }}>
          {t('license.transfer.explain', { limit: limite })}
        </p>

        {transferencia.devices.map((d) => (
          <div
            key={d.deviceId}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.85rem',
              padding: '1rem 1.15rem',
              borderRadius: '1rem',
              background: 'var(--tint-warn-bg)',
              border: '1px solid var(--tint-warn-border)',
            }}
          >
            <Monitor size={22} color="#b45309" aria-hidden="true" style={{ flexShrink: 0 }} />
            <div style={{ display: 'flex', flexDirection: 'column' }}>
              <strong style={{ fontWeight: 800 }}>{d.deviceName}</strong>
              <span style={{ fontSize: '0.86rem', opacity: 0.75 }}>
                {t('license.transfer.boundSince', { date: porExtenso(d.boundAt, i18n.language) })}
              </span>
            </div>
          </div>
        ))}

        {erro && (
          <div role="alert" style={alertaStyle}>
            <AlertTriangle size={18} color="#dc2626" aria-hidden="true" style={{ flexShrink: 0 }} />
            <span>{erro}</span>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.7rem' }}>
          <PrimaryButton
            type="button"
            fullWidth
            disabled={transferindo}
            aria-busy={transferindo}
            onClick={confirmar}
          >
            {transferindo ? t('license.transfer.working') : t('license.transfer.confirm')}
          </PrimaryButton>
          <PrimaryButton
            type="button"
            variant="ghost"
            fullWidth
            disabled={transferindo}
            onClick={() => navigate('/login', { replace: true })}
          >
            {t('license.transfer.cancel')}
          </PrimaryButton>
        </div>
      </Moldura>
    );
  }

  if (!license) return <Navigate to="/login" replace />;

  const { plan } = license;
  const limite = plan.deviceLimit;

  return (
    <Moldura
      titulo={t('license.activated.title')}
      icone={<CheckCircle2 size={48} color="#15803d" />}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem', width: '100%' }}>
        <Linha rotulo={t('license.activated.plan')} valor={plan.name} />
        <Linha
          rotulo={t('license.activated.device')}
          valor={license.thisDevice.deviceName || getDeviceName()}
        />
        <Linha
          rotulo=""
          valor={
            plan.validUntil
              ? t('license.activated.validUntil', {
                  date: porExtenso(plan.validUntil, i18n.language),
                })
              : t('license.activated.noExpiry')
          }
        />
        {limite !== null && limite > 1 && (
          <Linha
            rotulo=""
            valor={t('license.activated.devices', { used: license.devicesUsed, limit: limite })}
          />
        )}
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: '0.7rem',
          padding: '0.95rem 1.1rem',
          borderRadius: '1rem',
          background: 'var(--tint-ok-bg)',
          border: '1px solid var(--tint-ok-border)',
          width: '100%',
        }}
      >
        <Monitor size={20} color="#15803d" aria-hidden="true" style={{ flexShrink: 0 }} />
        <span
          style={{
            fontSize: '0.95rem',
            lineHeight: 1.5,
            color: 'var(--tint-ok-text)',
            fontWeight: 600,
          }}
        >
          {t('license.activated.boundHere')}
        </span>
      </div>

      <PrimaryButton
        type="button"
        fullWidth
        onClick={() => navigate('/consent', { replace: true })}
        style={{ padding: '0.95rem' }}
      >
        {t('license.activated.continue')}
      </PrimaryButton>
    </Moldura>
  );
};

const alertaStyle: React.CSSProperties = {
  display: 'flex',
  alignItems: 'flex-start',
  gap: '0.55rem',
  background: 'var(--tint-danger-bg)',
  border: '1px solid var(--tint-danger-border)',
  padding: '0.85rem 1rem',
  borderRadius: '0.9rem',
  color: 'var(--tint-danger-text)',
  fontSize: '0.92rem',
};

const Linha: React.FC<{ rotulo: string; valor: string }> = ({ rotulo, valor }) => (
  <div style={{ display: 'flex', justifyContent: 'space-between', gap: '1rem', fontSize: '1rem' }}>
    {rotulo && <span style={{ opacity: 0.7 }}>{rotulo}</span>}
    <strong style={{ fontWeight: 800, textAlign: 'right', color: 'var(--color-text-base)' }}>
      {valor}
    </strong>
  </div>
);

const Moldura: React.FC<{ titulo: string; icone: React.ReactNode; children: React.ReactNode }> = ({
  titulo,
  icone,
  children,
}) => (
  <main
    role="main"
    aria-labelledby="activated-title"
    style={{
      minHeight: '100vh',
      background: 'var(--settings-bg)',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      padding: '2rem',
    }}
  >
    <div
      className="glass-card animate-scale-in"
      style={{
        background: 'var(--color-card-bg)',
        padding: '2.75rem 2.5rem',
        borderRadius: '2rem',
        boxShadow: '0 20px 40px -10px rgba(27,84,168,0.12)',
        width: '100%',
        maxWidth: 490,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: '1.5rem',
      }}
    >
      {icone}
      <h1
        id="activated-title"
        style={{
          fontSize: '1.75rem',
          fontWeight: 800,
          margin: 0,
          textAlign: 'center',
          color: 'var(--color-text-base)',
        }}
      >
        {titulo}
      </h1>
      {children}
    </div>
  </main>
);
