import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { Mail, Lock, LogIn, AlertCircle, ExternalLink } from 'lucide-react';
import { PrimaryButton } from '../../components/ui/PrimaryButton';
import { useLicense } from '../../context/LicenseContext';
import { MANAGE_URL } from '../../services/license';
import type { LoginFailure } from '../../services/license';

/**
 * Login / ativação.
 *
 * Antes esta tela aceitava qualquer e-mail com qualquer senha não-vazia e
 * navegava para o tutorial: o único erro possível era "campo vazio".
 *
 * Agora cada motivo de recusa tem uma saída própria. Mostrar "algo deu errado"
 * nos seis casos deixaria o cuidador sem saber se o problema é a senha, o
 * cartão de crédito ou o Wi-Fi — e essa dúvida é exatamente a ligação de
 * suporte que a tela existe para evitar.
 */

const SITE = 'https://irisflow.com.br';
const RECUPERAR_URL = `${SITE}/conta/recuperar`;
const CRIAR_CONTA_URL = `${SITE}/assinar`;

export const LoginScreen: React.FC = () => {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const { entrar } = useLicense();

  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erroDeCampo, setErroDeCampo] = useState<string | null>(null);
  const [falha, setFalha] = useState<LoginFailure | null>(null);
  const [horaDaTentativa, setHoraDaTentativa] = useState<string | null>(null);
  const [segundosRestantes, setSegundosRestantes] = useState(0);

  // Contagem regressiva do bloqueio por tentativas.
  useEffect(() => {
    if (segundosRestantes <= 0) return;
    const timer = setTimeout(() => setSegundosRestantes((s) => s - 1), 1000);
    return () => clearTimeout(timer);
  }, [segundosRestantes]);

  const bloqueado = segundosRestantes > 0;

  const submeter = async (e: React.FormEvent) => {
    e.preventDefault();
    if (enviando || bloqueado) return;

    if (!email.trim() || !senha.trim()) {
      setFalha(null);
      setErroDeCampo(t('login.emptyFields'));
      return;
    }

    setErroDeCampo(null);
    setFalha(null);
    setEnviando(true);

    const r = await entrar(email, senha);

    setEnviando(false);
    setHoraDaTentativa(new Date().toLocaleTimeString());

    if (r.ok) {
      navigate('/activated', { replace: true });
      return;
    }

    if (r.reason === 'device-limit') {
      // A tela de ativação sabe apresentar a transferência; ela precisa do
      // `transferToken`, que só existe neste retorno.
      navigate('/activated', { state: { transferencia: r } });
      return;
    }

    if (r.reason === 'rate-limited') setSegundosRestantes(r.retryAfterSeconds);
    setFalha(r);
  };

  const mensagem = erroDeCampo ?? (falha ? t(`login.errors.${falha.reason}`) : null);

  return (
    <main
      role="main"
      aria-labelledby="login-title"
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
          maxWidth: 470,
          display: 'flex',
          flexDirection: 'column',
          gap: '1.75rem',
        }}
      >
        <div
          style={{
            textAlign: 'center',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: '0.6rem',
          }}
        >
          <img
            src="/LOGO.png"
            alt=""
            aria-hidden="true"
            style={{ width: 130, height: 'auto' }}
            onError={(e) => (e.currentTarget.style.display = 'none')}
          />
          <h1
            id="login-title"
            style={{
              fontSize: '1.75rem',
              fontWeight: 800,
              margin: 0,
              color: 'var(--color-text-base)',
            }}
          >
            {t('login.title')}
          </h1>
          <p
            style={{
              margin: 0,
              fontSize: '0.98rem',
              opacity: 0.78,
              color: 'var(--color-text-base)',
            }}
          >
            {t('login.subtitle')}
          </p>
        </div>

        <form
          onSubmit={submeter}
          noValidate
          style={{ display: 'flex', flexDirection: 'column', gap: '1.15rem' }}
        >
          <Campo
            id="login-email"
            rotulo={t('login.email')}
            icone={<Mail color="#64748b" size={19} aria-hidden="true" />}
            tipo="email"
            valor={email}
            aoMudar={setEmail}
            placeholder={t('login.emailPlaceholder')}
            autoComplete="username"
          />
          <Campo
            id="login-password"
            rotulo={t('login.password')}
            icone={<Lock color="#64748b" size={19} aria-hidden="true" />}
            tipo="password"
            valor={senha}
            aoMudar={setSenha}
            placeholder="••••••••"
            autoComplete="current-password"
          />

          {mensagem && (
            <div
              role="alert"
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: '0.65rem',
                background: 'var(--tint-danger-bg)',
                border: '1px solid var(--tint-danger-border)',
                padding: '0.9rem 1rem',
                borderRadius: '0.9rem',
                color: 'var(--tint-danger-text)',
                fontSize: '0.92rem',
                lineHeight: 1.45,
              }}
            >
              <span style={{ display: 'flex', alignItems: 'flex-start', gap: '0.55rem' }}>
                <AlertCircle
                  size={18}
                  color="#dc2626"
                  style={{ flexShrink: 0, marginTop: 1 }}
                  aria-hidden="true"
                />
                <span>{mensagem}</span>
              </span>

              {falha?.reason === 'invalid-credentials' && (
                <LinkExterno href={RECUPERAR_URL} rotulo={t('login.forgot')} />
              )}

              {falha?.reason === 'no-subscription' && (
                <LinkExterno
                  href={falha.manageUrl || MANAGE_URL}
                  rotulo={t('login.cta.manage')}
                  mostrarUrl
                />
              )}

              {(falha?.reason === 'offline' || falha?.reason === 'server-down') &&
                horaDaTentativa && (
                  <span style={{ opacity: 0.85, fontSize: '0.85rem' }}>
                    {t('login.lastAttempt', { time: horaDaTentativa })}
                  </span>
                )}
            </div>
          )}

          <PrimaryButton
            type="submit"
            fullWidth
            disabled={enviando || bloqueado}
            aria-busy={enviando}
            style={{ marginTop: '0.25rem', padding: '0.95rem' }}
          >
            {bloqueado
              ? t('login.cta.retryIn', { seconds: segundosRestantes })
              : enviando
                ? t('login.submitting')
                : falha && falha.reason !== 'no-subscription'
                  ? t('login.cta.retry')
                  : t('login.submit')}
            {!enviando && !bloqueado && <LogIn size={19} aria-hidden="true" />}
          </PrimaryButton>
        </form>

        <div
          style={{
            textAlign: 'center',
            borderTop: '1px solid var(--color-card-border)',
            paddingTop: '1.25rem',
          }}
        >
          <LinkExterno href={CRIAR_CONTA_URL} rotulo={t('login.createAccount')} />
        </div>
      </div>
    </main>
  );
};

/**
 * Link para o site.
 *
 * ⚠️ O processo principal do Electron nega toda abertura de janela
 * (`setWindowOpenHandler` → `deny`), então este link **não abre nada** no app
 * empacotado. Por isso a URL aparece como texto selecionável ao lado: sem ela
 * o cuidador clicaria num botão morto e ficaria travado. A correção definitiva
 * é `shell.openExternal` no `electron/main.ts` — fora do escopo do Bloco 1.
 */
const LinkExterno: React.FC<{ href: string; rotulo: string; mostrarUrl?: boolean }> = ({
  href,
  rotulo,
  mostrarUrl,
}) => (
  <span style={{ display: 'flex', flexDirection: 'column', gap: '0.3rem' }}>
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: '0.35rem',
        color: '#1B54A8',
        fontWeight: 700,
        fontSize: '0.9rem',
      }}
    >
      {rotulo} <ExternalLink size={14} aria-hidden="true" />
    </a>
    {mostrarUrl && (
      <code
        style={{
          fontSize: '0.8rem',
          color: '#475569',
          background: 'rgba(15,23,42,0.05)',
          padding: '0.3rem 0.5rem',
          borderRadius: '0.4rem',
          userSelect: 'all',
          wordBreak: 'break-all',
        }}
      >
        {href}
      </code>
    )}
  </span>
);

const Campo: React.FC<{
  id: string;
  rotulo: string;
  icone: React.ReactNode;
  tipo: string;
  valor: string;
  aoMudar: (v: string) => void;
  placeholder: string;
  autoComplete: string;
}> = ({ id, rotulo, icone, tipo, valor, aoMudar, placeholder, autoComplete }) => (
  <div style={{ display: 'flex', flexDirection: 'column', gap: '0.4rem' }}>
    <label
      htmlFor={id}
      style={{ fontSize: '0.9rem', fontWeight: 700, opacity: 0.9, color: 'var(--color-text-base)' }}
    >
      {rotulo}
    </label>
    {/*
      Fundo, borda e raio vivem no PROPRIO input, nao numa div em volta.

      O `index.css` aplica `outline` + `box-shadow` de 6px em
      `input:focus-visible`. Com o visual na div externa e o input transparente
      por dentro, esse anel desenhava em volta do input INTERNO — dentro da
      caixa — e o campo aparecia partido em duas cores. Agora o anel coincide
      com a caixa que a pessoa enxerga.
    */}
    <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
      <span
        aria-hidden="true"
        style={{
          position: 'absolute',
          left: '0.9rem',
          display: 'flex',
          alignItems: 'center',
          pointerEvents: 'none',
        }}
      >
        {icone}
      </span>
      <input
        id={id}
        type={tipo}
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        placeholder={placeholder}
        autoComplete={autoComplete}
        style={{
          background: 'var(--field-bg)',
          border: '1px solid var(--field-border)',
          borderRadius: '0.9rem',
          padding: '0.9rem 0.9rem 0.9rem 2.9rem',
          fontSize: '1rem',
          width: '100%',
          color: 'var(--color-text-base)',
        }}
      />
    </div>
  </div>
);
