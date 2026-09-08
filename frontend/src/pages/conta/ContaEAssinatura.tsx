import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { UserRound, CreditCard, Monitor, Clock, LogOut, AlertTriangle } from 'lucide-react';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { useLicense } from '../../context/LicenseContext';
import { idadeEmTexto } from '../../idadeEmTexto';

/**
 * Conta e assinatura.
 *
 * A tela existe porque **a licença pode vencer no meio do uso**. Quando isso
 * acontece, o cuidador precisa de um lugar que diga o que está havendo — não de
 * um app que simplesmente parou de funcionar. Por isso os quatro estados
 * aparecem com nome, inclusive os ruins.
 *
 * "Sair desta máquina" derruba o acesso do paciente, e esta tela é operada com
 * o mesmo dwell do resto: um clique acidental não pode custar isso. Daí a
 * confirmação — e o aviso dizer o que se PERDE e o que FICA. Sem a segunda
 * metade, "sair" parece apagar a calibração e ninguém clica; ou clica achando
 * que é só trocar de tela.
 */
export const ContaEAssinatura: React.FC = () => {
  const { t, i18n } = useTranslation();
  const navigate = useNavigate();
  const { status, license, lastVerifiedAt, sair } = useLicense();
  const [confirmando, setConfirmando] = useState(false);

  const porExtenso = (iso: string) => {
    const d = new Date(iso);
    return Number.isNaN(d.getTime())
      ? iso
      : d.toLocaleDateString(i18n.language, { day: 'numeric', month: 'long', year: 'numeric' });
  };

  const confirmarSaida = async () => {
    await sair();
    navigate('/login', { replace: true });
  };

  return (
    <main
      role="main"
      aria-labelledby="conta-title"
      style={{
        minHeight: '100vh',
        background: 'var(--settings-bg)',
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'center',
        padding: '2rem 1.5rem',
        overflowY: 'auto',
      }}
    >
      <div
        className="glass-card"
        style={{
          width: '100%',
          maxWidth: 560,
          background: 'var(--color-card-bg)',
          border: '1px solid var(--color-card-border)',
          borderRadius: '1.5rem',
          padding: '2rem',
          display: 'flex',
          flexDirection: 'column',
          gap: '1.2rem',
        }}
      >
        <h1
          id="conta-title"
          style={{
            margin: 0,
            fontSize: '1.3rem',
            fontWeight: 800,
            color: 'var(--color-text-base)',
          }}
        >
          {t('sessao.conta.title')}
        </h1>

        {/* O estado vem primeiro: é a pergunta que traz alguém a esta tela. */}
        <div
          style={{
            padding: '0.95rem 1.15rem',
            borderRadius: '1rem',
            background: status === 'active' ? 'var(--tint-ok-bg)' : 'var(--tint-warn-bg)',
            border: `1px solid ${status === 'active' ? 'var(--tint-ok-border)' : 'var(--tint-warn-border)'}`,
            fontSize: '0.98rem',
            fontWeight: 600,
            color: 'var(--color-text-base)',
          }}
        >
          {t(`sessao.conta.estado.${status}`)}
        </div>

        {license && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
            <Linha icone={<UserRound size={17} aria-hidden="true" />}>
              {license.account.email}
            </Linha>

            <Linha icone={<CreditCard size={17} aria-hidden="true" />}>
              {t('sessao.conta.plano')}: {license.plan.name}
              {' — '}
              {license.plan.validUntil
                ? t('sessao.conta.validade', { data: porExtenso(license.plan.validUntil) })
                : t('sessao.conta.semValidade')}
            </Linha>

            <Linha icone={<Monitor size={17} aria-hidden="true" />}>
              {license.thisDevice.deviceName}
              {' — '}
              {t('sessao.conta.vinculadoEm', { data: porExtenso(license.thisDevice.boundAt) })}
            </Linha>

            <Linha icone={<Clock size={17} aria-hidden="true" />}>
              {t('sessao.conta.verificada', { idade: idadeEmTexto(lastVerifiedAt) })}
            </Linha>
          </div>
        )}

        {/* Só oferece sair de uma máquina onde alguém entrou. */}
        {license && !confirmando && (
          <PrimaryButton
            type="button"
            variant="secondary"
            onClick={() => setConfirmando(true)}
            data-dwell-ms="2500"
            style={{ alignSelf: 'flex-start' }}
          >
            <LogOut size={17} aria-hidden="true" /> {t('sessao.conta.sair')}
          </PrimaryButton>
        )}

        {confirmando && (
          <div
            role="alertdialog"
            aria-label={t('sessao.conta.sair')}
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: '0.85rem',
              padding: '1.15rem',
              borderRadius: '1rem',
              background: 'var(--tint-danger-bg)',
              border: '1px solid var(--tint-danger-border)',
            }}
          >
            <span
              style={{
                display: 'flex',
                gap: '0.55rem',
                alignItems: 'flex-start',
                fontSize: '0.96rem',
                lineHeight: 1.55,
                color: 'var(--color-text-base)',
              }}
            >
              <AlertTriangle
                size={18}
                color="var(--tint-danger-text)"
                aria-hidden="true"
                style={{ flexShrink: 0, marginTop: 2 }}
              />
              {t('sessao.conta.sairAviso')}
            </span>

            <div style={{ display: 'flex', gap: '0.6rem', flexWrap: 'wrap' }}>
              <PrimaryButton type="button" variant="danger" onClick={() => void confirmarSaida()}>
                {t('sessao.conta.sairConfirmar')}
              </PrimaryButton>
              <PrimaryButton type="button" variant="ghost" onClick={() => setConfirmando(false)}>
                {t('sessao.conta.sairCancelar')}
              </PrimaryButton>
            </div>
          </div>
        )}
      </div>
    </main>
  );
};

const Linha: React.FC<{ icone: React.ReactNode; children: React.ReactNode }> = ({
  icone,
  children,
}) => (
  <div style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start' }}>
    <span style={{ color: 'var(--color-primary)', flexShrink: 0, marginTop: 2, display: 'flex' }}>
      {icone}
    </span>
    <span
      style={{
        fontSize: '0.95rem',
        lineHeight: 1.5,
        color: 'var(--color-text-base)',
        opacity: 0.88,
      }}
    >
      {children}
    </span>
  </div>
);
